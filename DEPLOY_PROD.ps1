[CmdletBinding()]
param(
    [switch]$ResetData,
    [switch]$ResetOwnerPassword,
    [switch]$NoCache,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"
$initializer = Join-Path $root "scripts\Initialize-NarchiEnv.ps1"
$deploymentLogDir = Join-Path $root "logs\deployment"
$deploymentStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$deploymentLog = Join-Path $deploymentLogDir "deployment-$deploymentStamp.log"
$deploymentLatest = Join-Path $deploymentLogDir "deployment-latest.log"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:handlingDeploymentFailure = $false

New-Item -ItemType Directory -Path $deploymentLogDir -Force | Out-Null
[System.IO.File]::WriteAllText($deploymentLog, "", $utf8NoBom)
[System.IO.File]::WriteAllText($deploymentLatest, "", $utf8NoBom)
Get-ChildItem -Path $deploymentLogDir -Filter "deployment-*.log" -File |
    Where-Object { $_.Name -ne "deployment-latest.log" } |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 |
    Remove-Item -Force

function Write-DeploymentEvent {
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet("DEBUG", "INFO", "WARNING", "ERROR")][string]$Level = "INFO"
    )
    # Ne jamais transmettre de mot de passe ou de valeur .env a cette fonction.
    $safeMessage = $Message -replace "[\r\n]+", " "
    $line = "{0} | {1} | {2} | {3}" -f (Get-Date).ToUniversalTime().ToString("o"), $Level, $Code, $safeMessage
    [System.IO.File]::AppendAllText($deploymentLog, $line + [Environment]::NewLine, $utf8NoBom)
    [System.IO.File]::AppendAllText($deploymentLatest, $line + [Environment]::NewLine, $utf8NoBom)
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Yellow
    Write-DeploymentEvent -Code "DEPLOY_STEP" -Message $Message
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArgs)
    $commandLabel = "docker compose " + ($ComposeArgs -join " ")
    $started = Get-Date
    Write-DeploymentEvent -Code "COMPOSE_COMMAND_STARTED" -Message $commandLabel
    & docker compose --env-file $envPath @ComposeArgs
    $exitCode = $LASTEXITCODE
    $durationMs = [math]::Round(((Get-Date) - $started).TotalMilliseconds, 0)
    if ($exitCode -ne 0) {
        Write-DeploymentEvent -Code "COMPOSE_COMMAND_FAILED" -Level "ERROR" -Message "$commandLabel ; exit=$exitCode ; duration_ms=$durationMs"
        throw "La commande '$commandLabel' a echoue (code $exitCode)."
    }
    Write-DeploymentEvent -Code "COMPOSE_COMMAND_SUCCEEDED" -Message "$commandLabel ; duration_ms=$durationMs"
}

function Set-DotEnvValue {
    param([string]$Name, [string]$Value)
    [string[]]$lines = @(Get-Content -Path $envPath)
    $prefix = "$Name="
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index].StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $lines[$index] = "$Name=$Value"
            $found = $true
        }
    }
    if (-not $found) { $lines += "$Name=$Value" }
    [System.IO.File]::WriteAllLines($envPath, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-TcpPortInUse {
    param([int]$Port)
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch {
        # Get-NetTCPConnection n'existe pas sur certaines anciennes versions Windows.
        $probe = New-Object System.Net.Sockets.TcpClient
        try {
            $probe.Connect("127.0.0.1", $Port)
            return $true
        } catch {
            return $false
        } finally {
            $probe.Dispose()
        }
    }
}

function Select-FreeFlowerPort {
    $configured = 5555
    $envLines = @(Get-Content -Path $envPath -ErrorAction Stop)
    $configuredLine = $envLines | Where-Object { $_ -match '^FLOWER_HOST_PORT=(\\d+)$' } | Select-Object -First 1
    if ($configuredLine) {
        $configured = [int]$Matches[1]
    }

    if ($configured -lt 1024 -or $configured -gt 65535) {
        throw "FLOWER_HOST_PORT doit etre compris entre 1024 et 65535."
    }

    $port = $configured
    while (Test-TcpPortInUse -Port $port) {
        $port++
        if ($port -gt 65535) {
            throw "Aucun port libre trouve pour Flower."
        }
    }

    if ($port -ne $configured) {
        Set-DotEnvValue "FLOWER_HOST_PORT" ([string]$port)
        Write-Host "[INFO] Le port $configured est deja utilise; Flower sera expose sur $port." -ForegroundColor Yellow
        Write-DeploymentEvent -Code "FLOWER_PORT_AUTO_SELECTED" -Message "configured=$configured selected=$port"
    } else {
        Write-DeploymentEvent -Code "FLOWER_PORT_SELECTED" -Message "selected=$port"
    }
    return $port
}

function Get-DotEnvEntry {
    param([string]$Name, [string]$Default = "")
    $line = @(Get-Content -Path $envPath | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1)
    if ($line.Count -gt 0) { return ([string]$line[0] -split '=', 2)[1].Trim() }
    return $Default
}

function Wait-DbHealthy {
    # Attend que le service db soit "healthy" (maximum 120 s). Retourne $true/$false.
    for ($i = 0; $i -lt 60; $i++) {
        $dbCid = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
        if ($dbCid) {
            $state = (& docker inspect --format '{{.State.Health.Status}}' $dbCid 2>$null)
            if ($state -eq "healthy") { return $true }
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Invoke-V6ToV7DataMigration {
    # [51+54] - Migration automatique des donnees : volume postgres_v6_data
    # (cree par l'image 16-alpine/musl) -> postgres_v7_data (image locale
    # pgvector Debian/glibc). Pourquoi ne pas remonter l'ancien volume ? Les collations
    # d'index texte different entre musl et glibc : des index silencieusement
    # FAUX (recherches tronquees). On passe donc par pg_dump/pg_restore, qui
    # reconstruit les index proprement.
    #
    # [54] Reprise a chaud SURE : la fin de migration est marquee DANS LA BASE
    # (table narchi_ops.migration_markers). Un volume v7 present SANS marqueur
    # = reste d'un essai echoue : il est reconstruit proprement (jamais
    # presente comme migre). Le volume v6 n'est JAMAIS modifie ni supprime.
    if ($ResetData) {
        Write-DeploymentEvent -Code "DB_MIGRATION_SKIPPED" -Message "ResetData explicite : archive v6 ignoree"
        return
    }
    # [55] EAP=Stop transforme le stderr d'une commande NATIVE redirigee
    # (2>&1 / *>) en erreur fatale brute qui court-circuite nos controles
    # $LASTEXITCODE - mecanisme exact de l'ecran [CAUSE] brut du 07/08.
    # Ici seuls NOS controles font foi : Continue, puis restauration
    # stricte a la sortie (return/throw inclus, via finally).
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
    $volumes = @(& docker volume ls --format "{{.Name}}" 2>$null)
    $v6 = @($volumes | Where-Object { $_ -like "*postgres_v6_data" })
    $v7 = @($volumes | Where-Object { $_ -like "*postgres_v7_data" })
    if ($v6.Count -eq 0) {
        Write-DeploymentEvent -Code "DB_MIGRATION_SKIPPED" -Message "aucun volume postgres_v6_data detecte (installation neuve)"
        return
    }
    if ($v6.Count -gt 1) {
        throw "Plusieurs volumes *postgres_v6_data detectes ($($v6 -join ', ')). Listez-les avec 'docker volume ls', gardez celui du projet, supprimez les orphelins puis relancez."
    }
    $v6Name = [string]$v6[0]

    $dbUser = Get-DotEnvEntry "POSTGRES_USER" "narchi"
    $dbName = Get-DotEnvEntry "POSTGRES_DB" "narchi_v3"

    # ---- [54] Cas 1 : v7 existe deja -> verifier le MARQUEUR de fin ----
    if ($v7.Count -gt 0) {
        Write-Step "[5/8] Volume v7 present : verification de la fin de migration (marqueur en base)..."
        Invoke-Compose -ComposeArgs @("up", "-d", "db")
        $markerCheck = Wait-DbHealthy
        if (-not $markerCheck) { throw "La base v7 existante ne devient pas saine : impossible de verifier le marqueur de migration." }
        $markerCount = (& docker compose --env-file $envPath exec -T db psql -U $dbUser -d $dbName -At -c "SELECT count(*) FROM narchi_ops.migration_markers WHERE step='v6_to_v7';" 2>$null)
        if ($LASTEXITCODE -eq 0 -and "$markerCount".Trim() -eq "1") {
            Write-Host "[OK] Marqueur present : migration v6 - v7 deja effectuee, rien a faire." -ForegroundColor Green
            Write-DeploymentEvent -Code "DB_MIGRATION_SKIPPED" -Message "marqueur v6_to_v7 present en base"
            return
        }
        Write-Host "  [INFO] Volume v7 SANS marqueur de fin = reste d'un essai interrompu." -ForegroundColor Yellow
        Write-Host "         Reconstruction propre : le v7 partiel est supprime (il ne contient" -ForegroundColor Yellow
        Write-Host "         encore aucune donnee reelle) puis la migration complete recommence." -ForegroundColor Yellow
        Write-Host "         Le volume v6 avec vos donnees reste intact." -ForegroundColor Yellow
        Write-DeploymentEvent -Code "DB_MIGRATION_PARTIAL_V7_WIPED" -Level "WARNING" -Message "v7 sans marqueur : volume partiel reconstruit"
        Invoke-Compose -ComposeArgs @("stop", "db")
        & docker compose --env-file $envPath rm -f -s db 2>&1 | Out-String | Out-Null
        $v7Name = [string]$v7[0]
        $rmOut = (& docker volume rm $v7Name 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Impossible de supprimer le volume v7 partiel ($rmOut). Supprimez-le manuellement : docker volume rm $v7Name puis relancez."
        }
    }

    Write-Step "[5/8] Migration automatique des donnees PostgreSQL v6 - v7 (pgvector/glibc)..."
    Write-Host "  Volume legacy detecte : $v6Name (lecture seule - jamais modifie)." -ForegroundColor Yellow
    Write-DeploymentEvent -Code "DB_MIGRATION_STARTED" -Message "volume=$v6Name"
    $dumpHost = Join-Path $deploymentLogDir "narchi-v6-export-$deploymentStamp.dump"

    # ---- [1/4] Export de la base legacy (pg_dump) ----
    Write-Host "  [1/4] Export de l'ancienne base (pg_dump)..." -ForegroundColor Yellow
    # [55] L'export utilise l'image NARCHI locale (construite au [4/8]) :
    # plus AUCUNE dependance a l'image alpine externe - cause exacte de l'echec
    # remonte le 07/08 ("No such image" sur l'image alpine). Lecture d'un
    # cluster cree par l'image musl depuis l'image glibc : pg_dump serialise
    # les VALEURS (pages de donnees = octets identiques musl/glibc), jamais
    # l'ordre d'index (l'export ne lit pas les index ; ils sont rebatis a
    # la restauration) - voie "dump & restore" preconisee quand les
    # collations systeme changent.
    $exportImage = "narchi-postgres:16-pgvector-pgbackrest"
    & docker image inspect $exportImage *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ECHEC] Image $exportImage introuvable : le build [4/8] a ete saute ?" -ForegroundColor Red
        Write-DeploymentEvent -Code "DB_MIGRATION_IMAGE_MISSING" -Level "ERROR" -Message "image $exportImage absente"
        throw "Image $exportImage absente : relancez sans -SkipBuild (le build [4/8] est indispensable)."
    }
    & docker rm -f narchi-v6-export *> $null
    $runOut = (& docker run -d --name narchi-v6-export --entrypoint docker-entrypoint.sh -v "${v6Name}:/var/lib/postgresql/data" $exportImage postgres 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ECHEC] docker run : $runOut" -ForegroundColor Red
        Write-DeploymentEvent -Code "DB_MIGRATION_RUN_FAILED" -Level "ERROR" -Message "$runOut"
        throw "Demarrage du conteneur d'export v6 impossible (cause ci-dessus). Volume v6 intact."
    }
    Write-Host "        Attente de la base legacy (maximum 120 s)..." -ForegroundColor DarkGray
    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
        & docker exec narchi-v6-export pg_isready -U $dbUser -d $dbName *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true } else { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) {
        $logTail = (& docker logs --tail 20 narchi-v6-export 2>&1 | Out-String).Trim()
        & docker rm -f narchi-v6-export *> $null
        Write-Host "  [ECHEC] La base legacy ne repond pas. Journal du conteneur :" -ForegroundColor Red
        Write-Host $logTail -ForegroundColor DarkRed
        Write-DeploymentEvent -Code "DB_MIGRATION_LEGACY_NOT_READY" -Level "ERROR" -Message ($logTail -replace "[^\x20-\x7E]", " ")
        throw "Base legacy v6 muette apres 120 s (journal ci-dessus). Volume v6 intact, rien supprime."
    }
    $dumpOut = (& docker exec narchi-v6-export pg_dump -U $dbUser -d $dbName -Fc -f /tmp/narchi_v6.dump 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        & docker rm -f narchi-v6-export *> $null
        Write-Host "  [ECHEC] pg_dump : $dumpOut" -ForegroundColor Red
        Write-DeploymentEvent -Code "DB_MIGRATION_DUMP_FAILED" -Level "ERROR" -Message "$dumpOut"
        throw "pg_dump v6 en echec (cause ci-dessus). Volume v6 intact, aucun v7 cree."
    }
    & docker cp "narchi-v6-export:/tmp/narchi_v6.dump" $dumpHost *> $null
    & docker rm -f narchi-v6-export *> $null
    if (-not (Test-Path $dumpHost)) { throw "Copie du dump vers l'hote impossible : $dumpHost" }
    $dumpSize = [math]::Round((Get-Item $dumpHost).Length / 1MB, 1)
    Write-Host "  [OK] Export v6 conserve ($dumpSize Mo) : $dumpHost" -ForegroundColor Green
    Write-DeploymentEvent -Code "DB_MIGRATION_DUMP_OK" -Message "dump=$dumpHost size_mb=$dumpSize"

    # ---- [2/4] Premiere montee de la NOUVELLE image sur un v7 vierge ----
    Write-Host "  [2/4] Demarrage de la nouvelle base v7 (image pgvector)..." -ForegroundColor Yellow
    Invoke-Compose -ComposeArgs @("up", "-d", "db")
    if (-not (Wait-DbHealthy)) { throw "La nouvelle base v7 n'est pas devenue saine. Dump conserve : $dumpHost" }

    # ---- [3/4] Restauration des donnees + marqueur de fin ----
    Write-Host "  [3/4] Restauration des donnees (pg_restore)..." -ForegroundColor Yellow
    Invoke-Compose -ComposeArgs @("cp", $dumpHost, "db:/tmp/narchi_v6_import.dump")
    $restoreOut = (& docker compose --env-file $envPath exec -T db pg_restore -U $dbUser -d $dbName --exit-on-error /tmp/narchi_v6_import.dump 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ECHEC] pg_restore : $restoreOut" -ForegroundColor Red
        Write-DeploymentEvent -Code "DB_MIGRATION_RESTORE_FAILED" -Level "ERROR" -Message "$restoreOut"
        throw "pg_restore vers v7 en echec (cause ci-dessus). Dump conserve : $dumpHost ; volume v6 intact."
    }
    # MARQUEUR [54] : la fin de migration vit EN BASE (survit aux restaurations).
    $markerSql = "CREATE SCHEMA IF NOT EXISTS narchi_ops; CREATE TABLE IF NOT EXISTS narchi_ops.migration_markers (step text PRIMARY KEY, done_at timestamptz NOT NULL DEFAULT now()); INSERT INTO narchi_ops.migration_markers (step) VALUES ('v6_to_v7') ON CONFLICT (step) DO NOTHING;"
    & docker compose --env-file $envPath exec -T db psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -c $markerSql *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-DeploymentEvent -Code "DB_MIGRATION_MARKER_FAILED" -Level "WARNING" -Message "marqueur non ecrit : la migration sera re-verifiee au prochain lancement"
        Write-Host "  [INFO] Marqueur de fin non ecrit (non bloquant, re-verifie au prochain lancement)." -ForegroundColor Yellow
    }
    $tableCount = (& docker compose --env-file $envPath exec -T db psql -U $dbUser -d $dbName -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null)
    Write-Host "  [OK] Donnees restaurees dans v7 ($tableCount tables publiques)." -ForegroundColor Green
    Write-DeploymentEvent -Code "DB_MIGRATION_RESTORE_OK" -Message "tables_publiques=$tableCount"

    # ---- [4/4] Premiere sauvegarde pgBackRest immediate ----
    Write-Host "  [4/4] Premiere sauvegarde pgBackRest (base migree protegee)..." -ForegroundColor Yellow
    $backupDone = $false
    for ($i = 0; $i -lt 4 -and -not $backupDone; $i++) {
        & docker compose --env-file $envPath exec -T db su -s /bin/bash postgres -c "/usr/local/bin/narchi-backup-job.sh full" *> $null
        if ($LASTEXITCODE -eq 0) { $backupDone = $true } else { Start-Sleep -Seconds 15 }
    }
    if ($backupDone) {
        Write-Host "  [OK] Premiere sauvegarde pgBackRest complete effectuee." -ForegroundColor Green
        Write-DeploymentEvent -Code "DB_MIGRATION_FIRST_BACKUP_OK" -Message "sauvegarde full immediate reussie"
    } else {
        Write-Host "  [INFO] Sauvegarde immediate differee : le cron dim. 03:30 fera la premiere (ou lancez scripts\SAUVEGARDER_LA_BASE_MAINTENANT.bat)." -ForegroundColor Yellow
        Write-DeploymentEvent -Code "DB_MIGRATION_FIRST_BACKUP_DEFERRED" -Message "stanza pas encore prete ; cron reprendra"
    }
    } finally {
        $ErrorActionPreference = $previousEap
    }
}

function Test-DockerDaemon {
    # Echec reel du 07/08/2026 : daemon Docker arrete -> le stderr natif
    # (npipe introuvable) devenait une erreur TERMINANTE sous EAP=Stop et
    # court-circuitait tout controle $LASTEXITCODE. La sonde impose Continue
    # dans la zone native et restaure ensuite (lecon [55] generalisee).
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker info *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousEap
    }
}

function Test-DockerComposePlugin {
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker compose version *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousEap
    }
}

function Ensure-DockerDaemon {
    # Docker Desktop non demarre etait la cause la plus frequente d'ecran
    # d'erreur pour un non-informaticien : on tente le demarrage automatique
    # puis on patiente jusqu'a 180 s. Tout message d'echec doit etre 100 %
    # actionnable (menu Demarrer, mention Engine running, relance du meme fichier).
    if (Test-DockerDaemon) { return }
    Write-Host "[INFO] Docker Desktop ne repond pas : tentative de demarrage automatique..." -ForegroundColor Yellow
    Write-DeploymentEvent -Code "DOCKER_AUTOSTART_ATTEMPT" -Level "WARN" -Message "daemon absent au lancement, tentative de demarrage automatique"
    $candidates = @()
    if ($Env:ProgramFiles) { $candidates += (Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe") }
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if ($programFilesX86) { $candidates += (Join-Path $programFilesX86 "Docker\Docker\Docker Desktop.exe") }
    $dockerDesktopExe = $null
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { $dockerDesktopExe = $candidate; break }
    }
    if (-not $dockerDesktopExe) {
        throw "Docker Desktop n'est pas demarre et son executable est introuvable dans les dossiers standards. Lancez Docker Desktop manuellement (menu Demarrer > Docker Desktop), attendez la mention 'Engine running', puis double-cliquez a nouveau sur ce fichier."
    }
    try {
        Start-Process -FilePath $dockerDesktopExe -ErrorAction Stop | Out-Null
    } catch {
        throw "Impossible de lancer automatiquement '$dockerDesktopExe' : $($_.Exception.Message). Lancez Docker Desktop manuellement (menu Demarrer > Docker Desktop), attendez 'Engine running', puis relancez ce fichier."
    }
    Write-Host "[INFO] Attente du moteur Docker (jusqu'a 180 s, ne fermez pas la fenetre)..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerDaemon) {
            Write-Host ""
            Write-Host "[OK] Docker Desktop est demarre, le moteur repond." -ForegroundColor Green
            Write-DeploymentEvent -Code "DOCKER_AUTOSTART_OK" -Message "moteur disponible apres demarrage automatique"
            return
        }
        Write-Host "." -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Seconds 3
    }
    Write-Host ""
    throw "Docker Desktop a ete lance automatiquement mais le moteur ne repond toujours pas apres 180 s. Ouvrez Docker Desktop, attendez 'Engine running', puis relancez ce fichier. Si le blocage persiste, redemarrez le PC puis recommencez."
}

trap {
    if (-not $script:handlingDeploymentFailure) {
        $script:handlingDeploymentFailure = $true
        $failureMessage = $_.Exception.Message
        Write-DeploymentEvent -Code "DEPLOY_FAILED" -Level "ERROR" -Message $failureMessage
        Write-Host ""
        Write-Host "[CAUSE] $failureMessage" -ForegroundColor Red
        Write-Host ""
        Write-Host "[DIAGNOSTIC] Creation automatique du ZIP de diagnostic..." -ForegroundColor Yellow
        $collector = Join-Path $root "COLLECT_DIAGNOSTICS.ps1"
        if (Test-Path $collector) {
            & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
                -File $collector -Quiet -SkipAuthTest
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[OK] Le ZIP est disponible dans logs\diagnostics." -ForegroundColor Green
            } else {
                Write-Host "[WARNING] La collecte automatique a egalement echoue." -ForegroundColor Yellow
            }
        } else {
            Write-Host "[WARNING] COLLECT_DIAGNOSTICS.ps1 est introuvable." -ForegroundColor Yellow
        }
    }
    exit 1
}

Write-DeploymentEvent -Code "DEPLOY_STARTED" -Message "reset_data=$ResetData reset_owner_password=$ResetOwnerPassword no_cache=$NoCache skip_build=$SkipBuild"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI V5 - SECURE REBUILD ET DEPLOIEMENT" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable sur ce poste. Installez Docker Desktop puis relancez ce fichier."
}
Ensure-DockerDaemon
if (-not (Test-DockerComposePlugin)) {
    throw "Le plugin 'docker compose' est indisponible. Mettez Docker Desktop a jour puis relancez ce fichier."
}

Write-Step "[1/8] Initialisation securisee du fichier .env..."
$envInfo = & $initializer -EnvPath $envPath
$seedOnThisRun = $envInfo.SeedRequested -or $ResetData
if ($seedOnThisRun) {
    Set-DotEnvValue "NARCHI_SEED_DEFAULT_ADMINS" "true"
}
Write-Host "[OK] Variables obligatoires presentes dans $envPath" -ForegroundColor Green
Write-DeploymentEvent -Code "DEPLOY_ENV_READY" -Message "Fichier .env initialise et controle; valeurs non journalisees"
$flowerHostPort = Select-FreeFlowerPort

Write-Step "[2/8] Validation de la configuration Docker Compose..."
Invoke-Compose -ComposeArgs @("config", "--quiet")
Write-Host "[OK] Configuration Compose valide." -ForegroundColor Green

Write-Step "[3/8] Arret des services (volumes conserves par defaut)..."
if ($ResetData) {
    Write-Host "[ATTENTION] -ResetData supprime PostgreSQL v7, les sauvegardes pgBackRest, Redis et Grafana." -ForegroundColor Red
    Write-Host "[INFO] L'archive legacy postgres_v6_data (si presente) n'est PAS touchee." -ForegroundColor Yellow
    Invoke-Compose -ComposeArgs @("down", "-v", "--remove-orphans")
} else {
    Invoke-Compose -ComposeArgs @("down", "--remove-orphans")
}

if (-not $SkipBuild) {
    Write-Step "[4/8] Construction des images avec cache BuildKit..."
    $env:DOCKER_BUILDKIT = "1"
    if ($NoCache) {
        Invoke-Compose -ComposeArgs @("build", "--no-cache")
    } else {
        Invoke-Compose -ComposeArgs @("build")
    }
} else {
    Write-Step "[4/8] Build ignore (-SkipBuild)."
}

# [51] - Migration automatique v6 -> v7 si un volume legacy est detecte
# (no-op complet sur une installation neuve ou deja migree).
Invoke-V6ToV7DataMigration

Write-Step "[6/8] Demarrage de la pile NARCHI (9 services durables + 2 one-shot)..."
try {
    Invoke-Compose -ComposeArgs @("up", "-d", "--force-recreate")
} catch {
    Write-Host "[DIAGNOSTIC] Logs redis / migrate / db :" -ForegroundColor Red
    & docker compose --env-file $envPath logs --no-color --tail=80 redis migrate pgbouncer db
    $failMsg = $_.Exception.Message
    if ($failMsg -match "redis") {
        Write-Host "[INFO] Redis est un cache (Celery, rate-limit). On recycle UNIQUEMENT le volume redis_v5_data." -ForegroundColor Yellow
        Write-Host "       PostgreSQL, fichiers et comptes restent intacts (pas 4_TOUT_EFFACER)." -ForegroundColor Yellow
        $previousEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & docker compose --env-file $envPath stop redis *> $null
            & docker compose --env-file $envPath rm -f -s redis *> $null
            $vols = @(& docker volume ls --format "{{.Name}}" 2>$null | Where-Object { $_ -like "*redis_v5_data" })
            foreach ($v in $vols) {
                Write-Host "  [INFO] docker volume rm $v" -ForegroundColor DarkGray
                & docker volume rm $v *> $null
            }
        } finally {
            $ErrorActionPreference = $previousEap
        }
        Write-Host "[INFO] Second essai docker compose up (apres Redis vierge)..." -ForegroundColor Yellow
        Invoke-Compose -ComposeArgs @("up", "-d", "--force-recreate")
    } else {
        throw
    }
}

Write-Step "[7/8] Verification de sante (delai maximal: 240 secondes)..."
$healthy = $false
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/api/health" -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 5
    }
}

if (-not $healthy) {
    Write-DeploymentEvent -Code "DEPLOY_HEALTHCHECK_FAILED" -Level "ERROR" -Message "Application indisponible apres 240 secondes"
    Write-Host "[ERROR] NARCHI n'est pas devenu sain dans le delai imparti." -ForegroundColor Red
    & docker compose --env-file $envPath ps
    & docker compose --env-file $envPath logs --tail=150 backend migrate frontend
    throw "Echec du healthcheck. Consultez les logs ci-dessus."
}

Write-DeploymentEvent -Code "DEPLOY_HEALTHCHECK_OK" -Message "GET /api/health a retourne HTTP 200"

try {
    foreach ($runtimeAsset in @(
        "/vendor/manifest.json",
        "/vendor/three.module-0.185.1-narchi-v2.js",
        "/vendor/three.core-0.185.1-narchi-v2.js",
        "/ifc/fragments-worker.mjs"
    )) {
        $assetResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -Method Head `
            -Uri ("http://localhost:8080" + $runtimeAsset) `
            -TimeoutSec 10
        if ($assetResponse.StatusCode -ne 200) {
            throw "$runtimeAsset HTTP $($assetResponse.StatusCode)"
        }
    }
    Write-DeploymentEvent -Code "DEPLOY_FRONTEND_RUNTIME_OK" -Message "Three module/core versionnes et worker Fragments disponibles"
} catch {
    Write-DeploymentEvent -Code "DEPLOY_FRONTEND_RUNTIME_FAILED" -Level "ERROR" -Message $_.Exception.Message
    throw "Le runtime frontend 3D est incomplet. Le deploiement est refuse pour eviter une boucle apres connexion."
}

Write-Step "[8/8] Verification du compte owner et du cookie de session..."
if ($ResetOwnerPassword) {
    Write-Host "[INFO] Reinitialisation explicite du mot de passe owner..." -ForegroundColor Yellow
    Invoke-Compose -ComposeArgs @(
        "exec", "-T", "backend",
        "python", "-m", "app.scripts.reset_owner_password"
    )
}
try {
    $authSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $loginResponse = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "http://localhost:8080/api/v5/auth/token" `
        -Method Post `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ username = $envInfo.OwnerEmail; password = $envInfo.OwnerPassword } `
        -WebSession $authSession `
        -TimeoutSec 15
    if ($loginResponse.StatusCode -ne 200) { throw "Login owner HTTP $($loginResponse.StatusCode)" }

    $meResponse = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "http://localhost:8080/api/v5/auth/me" `
        -Method Get `
        -WebSession $authSession `
        -TimeoutSec 15
    if ($meResponse.StatusCode -ne 200) { throw "Session owner HTTP $($meResponse.StatusCode)" }
    $loginRequestId = [string]$loginResponse.Headers["X-Narchi-Request-ID"]
    $meRequestId = [string]$meResponse.Headers["X-Narchi-Request-ID"]
    Write-Host "[OK] Authentification owner et cookie de session valides." -ForegroundColor Green
    Write-DeploymentEvent -Code "DEPLOY_AUTH_VALIDATED" -Message "login_request_id=$loginRequestId me_request_id=$meRequestId"
} catch {
    Write-Host "[ERROR] Le test automatique de connexion owner a echoue: $($_.Exception.Message)" -ForegroundColor Red
    Write-DeploymentEvent -Code "DEPLOY_AUTH_FAILED" -Level "ERROR" -Message $_.Exception.Message
    & docker compose --env-file $envPath logs --no-color --tail=150 backend frontend
    throw "Le deploiement fonctionne mais l'authentification owner n'est pas validee."
}

Invoke-Compose -ComposeArgs @("ps")

# Le provisioning est one-shot. Les comptes existants ne sont jamais modifies,
# mais on desactive le flag pour les redemarrages suivants.
if ($seedOnThisRun) {
    Set-DotEnvValue "NARCHI_SEED_DEFAULT_ADMINS" "false"
}
Write-DeploymentEvent -Code "DEPLOY_SUCCEEDED" -Message "NARCHI V5 sain; authentification owner et cookie valides"

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  [SUCCESS] NARCHI V5 EST DEPLOYE" -ForegroundColor Green
Write-Host "  Application : http://localhost:8080" -ForegroundColor White
Write-Host "  Grafana     : http://127.0.0.1:3001" -ForegroundColor White
Write-Host "  Flower      : http://127.0.0.1:$flowerHostPort" -ForegroundColor White
if ($seedOnThisRun -or $ResetOwnerPassword) {
    Write-Host ""
    Write-Host "  COMPTE OWNER VALIDE" -ForegroundColor Yellow
    Write-Host "  Email       : $($envInfo.OwnerEmail)" -ForegroundColor White
    Write-Host "  Mot de passe: $($envInfo.OwnerPassword)" -ForegroundColor White
    Write-Host "  Conservez-le dans un gestionnaire de mots de passe." -ForegroundColor Yellow
} else {
    Write-Host "  Compte owner: identifiants existants inchanges." -ForegroundColor White
}
Write-Host "============================================================================" -ForegroundColor Cyan
