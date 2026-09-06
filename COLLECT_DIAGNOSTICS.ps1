[CmdletBinding()]
param(
    [ValidateRange(100, 10000)][int]$Tail = 1500,
    [switch]$SkipAuthTest,
    [switch]$Quiet
)

# Compatible Windows PowerShell 5.1. Ce script ne modifie ni les volumes ni les donnees.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$diagnosticsRoot = Join-Path $root "logs\diagnostics"
$bundleName = "NARCHI_DIAGNOSTIC_$stamp"
$workPath = Join-Path $diagnosticsRoot $bundleName
$zipPath = Join-Path $diagnosticsRoot "$bundleName.zip"
$summaryPath = Join-Path $workPath "00_LIRE_EN_PREMIER.txt"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:secretValues = New-Object System.Collections.Generic.List[string]
$script:summaryLines = New-Object System.Collections.Generic.List[string]
$script:dockerAvailable = $false
$script:composeAvailable = $false
$script:backendHealthy = $false
$script:authResult = "NON TESTE"
$script:staticResult = "NON TESTE"

New-Item -ItemType Directory -Path $workPath -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $workPath "services") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $workPath "deployment") -Force | Out-Null

function Write-Ui([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

function Add-Summary([string]$Line) {
    $script:summaryLines.Add($Line) | Out-Null
}

function Write-TextFile([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-DotEnvValues {
    $values = @{}
    if (-not (Test-Path $envPath)) { return $values }
    foreach ($line in Get-Content -Path $envPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) { continue }
        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $values[$name] = $value
        if ($name -match '(?i)PASSWORD|PASSWD|SECRET|KEY|TOKEN|AUTH|DSN|URL|EMAIL' -and
            $value.Length -ge 6) {
            $script:secretValues.Add($value) | Out-Null
        }
    }
    return $values
}

$envValues = Get-DotEnvValues

function Protect-Text([string]$Text) {
    if ($null -eq $Text) { return "" }
    $safe = $Text
    foreach ($secret in ($script:secretValues | Sort-Object Length -Descending -Unique)) {
        if ($secret -and $secret.Length -ge 6) {
            $safe = $safe.Replace($secret, "[REDACTED]")
        }
    }
    $safe = [regex]::Replace(
        $safe,
        '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}',
        'Bearer [REDACTED]'
    )
    $safe = [regex]::Replace(
        $safe,
        '\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b',
        '[REDACTED_JWT]'
    )
    $safe = [regex]::Replace($safe, '(://[^\s:/@]+:)([^\s@]+)(@)', '$1[REDACTED]$3')
    $safe = [regex]::Replace(
        $safe,
        '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',
        '[REDACTED_EMAIL]'
    )
    $safe = [regex]::Replace(
        $safe,
        '(?i)(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)(\s*[=:]\s*)(?!(?:CONFIGURED|MISSING|TRUE|FALSE|NONE|NULL)\b)([^\s,;&]+)',
        '$1$2[REDACTED]'
    )
    return $safe
}

function Invoke-Capture([string]$RelativePath, [scriptblock]$Command) {
    $destination = Join-Path $workPath $RelativePath
    $parent = Split-Path -Parent $destination
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = & $Command 2>&1 | Out-String -Width 4096
        $ErrorActionPreference = $previousPreference
        Write-TextFile $destination (Protect-Text $output)
    } catch {
        Write-TextFile $destination (Protect-Text ("COLLECT_ERROR: " + $_.Exception.Message))
    }
}

function Get-HttpFailureStatus($ErrorRecord) {
    try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { return 0 }
}

function Get-HttpFailureRequestId($ErrorRecord) {
    try { return [string]$ErrorRecord.Exception.Response.Headers["X-Narchi-Request-ID"] } catch { return "" }
}

Write-Ui "============================================================================" Cyan
Write-Ui "  NARCHI V5 - COLLECTE AUTOMATIQUE DES DIAGNOSTICS" Green
Write-Ui "============================================================================" Cyan
Write-Ui "Cette operation est en lecture seule et ne supprime aucune donnee." Yellow
Write-Ui ""

Add-Summary "NARCHI V5 - RAPPORT DE DIAGNOSTIC AUTOMATIQUE"
Add-Summary "Generation locale : $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))"
Add-Summary "Identifiant du paquet : $bundleName"
Add-Summary ""
Add-Summary "CONFIDENTIALITE"
Add-Summary "- Les mots de passe, cles, jetons, cookies, DSN et URL avec identifiants sont masques."
Add-Summary "- Le script ne copie jamais le fichier .env brut."
Add-Summary "- Le script ne modifie ni la base PostgreSQL ni les volumes Docker."
Add-Summary ""

Write-Ui "[1/8] Informations Windows et configuration non sensible..." Yellow
$systemLines = New-Object System.Collections.Generic.List[string]
$systemLines.Add("CollectedAt=$((Get-Date).ToString('o'))") | Out-Null
$systemLines.Add("PowerShell=$($PSVersionTable.PSVersion)") | Out-Null
$systemLines.Add("OSVersion=$([Environment]::OSVersion.VersionString)") | Out-Null
$systemLines.Add("Process64Bit=$([Environment]::Is64BitProcess)") | Out-Null
$systemLines.Add("Machine64Bit=$([Environment]::Is64BitOperatingSystem)") | Out-Null
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $systemLines.Add("WindowsCaption=$($os.Caption)") | Out-Null
    $systemLines.Add("WindowsBuild=$($os.BuildNumber)") | Out-Null
    $systemLines.Add("OSArchitecture=$($os.OSArchitecture)") | Out-Null
    $systemLines.Add("MemoryTotalKB=$($os.TotalVisibleMemorySize)") | Out-Null
    $systemLines.Add("MemoryFreeKB=$($os.FreePhysicalMemory)") | Out-Null
} catch {
    $systemLines.Add("CimInfo=unavailable") | Out-Null
}
try {
    $drive = Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($root).Substring(0, 1))
    $systemLines.Add("WorkspaceDriveFreeBytes=$($drive.Free)") | Out-Null
} catch {}
Write-TextFile (Join-Path $workPath "system.txt") (($systemLines -join "`r`n") + "`r`n")

$requiredNames = @(
    "POSTGRES_PASSWORD", "SECRET_KEY", "LEGACY_SHA256_SALT",
    "FLOWER_BASIC_AUTH", "GRAFANA_ADMIN_PASSWORD", "NARCHI_OWNER_EMAIL",
    "NARCHI_OWNER_PASSWORD", "DATABASE_URL", "LOG_LEVEL", "ENVIRONMENT"
)
$envStatus = New-Object System.Collections.Generic.List[string]
$envStatus.Add("Le contenu des variables n'est volontairement jamais affiche.") | Out-Null
foreach ($name in $requiredNames) {
    $configured = $envValues.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$envValues[$name])
    $statusValue = $(if ($configured) { "CONFIGURED" } else { "MISSING" })
    $envStatus.Add($name + "=" + $statusValue) | Out-Null
}
Write-TextFile (Join-Path $workPath "environment-status.txt") (($envStatus -join "`r`n") + "`r`n")
Add-Summary ("- Fichier .env : " + $(if (Test-Path $envPath) { "PRESENT" } else { "ABSENT" }))

Write-Ui "[2/8] Etat de Docker Desktop et de Compose..." Yellow
if (Get-Command docker -ErrorAction SilentlyContinue) {
    # Echec reel du 07/08/2026 (ci-dessus, ex-ligne 183) : daemon arrete +
    # EAP=Stop -> le stderr natif devenait une erreur TERMINANTE qui tuait
    # la collecte entiere (aucun ZIP). La collecte DOIT rester possible sans
    # Docker : c'est justement le cas de panne a documenter. Continue dans la
    # zone native, restauration en finally.
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker version *> $null
        $script:dockerAvailable = $LASTEXITCODE -eq 0
        & docker compose version *> $null
        $script:composeAvailable = $LASTEXITCODE -eq 0
    } catch {
        $script:dockerAvailable = $false
        $script:composeAvailable = $false
    } finally {
        $ErrorActionPreference = $previousEap
    }
}
Add-Summary ("- Docker Desktop : " + $(if ($script:dockerAvailable) { "DISPONIBLE" } else { "INDISPONIBLE" }))
Add-Summary ("- Docker Compose : " + $(if ($script:composeAvailable) { "DISPONIBLE" } else { "INDISPONIBLE" }))
if (-not $script:dockerAvailable) {
    # Sans daemon, 'docker compose version' peut quand meme reussir (le
    # plugin repond sans moteur) : les sondes conteneurs planteraient plus
    # loin. On desactive donc compose et on ecrit la marche a suivre exacte.
    $script:composeAvailable = $false
    $daemonNoteLines = @(
        "Docker Desktop est ARRETE ou ne repond pas : aucun journal de conteneur n'a pu etre collecte.",
        "",
        "Cause la plus probable de l'echec d'origine : Docker Desktop n'etait pas demarre.",
        "",
        "Marche a suivre :",
        "1. Lancez Docker Desktop (menu Demarrer > Docker Desktop).",
        "2. Attendez que la fenetre indique 'Engine running' (icone baleine stable).",
        "3. Double-cliquez a nouveau sur 1_DEMARRER_NARCHI.bat.",
        "4. Si le blocage persiste, redemarrez le PC puis recommencez a l'etape 1.",
        "",
        "Note : 1_DEMARRER_NARCHI.bat tente desormais de demarrer Docker Desktop",
        "tout seul et patiente jusqu'a 180 s avant d'abandonner."
    )
    Write-TextFile (Join-Path $workPath "00_DOCKER_DESKTOP_ARRETE.txt") (($daemonNoteLines -join "`r`n") + "`r`n")
    Add-Summary "- CAUSE LA PLUS PROBABLE : Docker Desktop n'etait pas demarre (voir 00_DOCKER_DESKTOP_ARRETE.txt)."
}

if ($script:dockerAvailable) {
    Invoke-Capture "docker-version.txt" { & docker version }
    Invoke-Capture "docker-info.txt" {
        & docker info --format 'ServerVersion={{.ServerVersion}} OS={{.OperatingSystem}} OSType={{.OSType}} Architecture={{.Architecture}} CPUs={{.NCPU}} TotalMemory={{.MemTotal}} Driver={{.Driver}}'
    }
    Invoke-Capture "docker-disk-usage.txt" { & docker system df }
}

$composeEnvArgs = @()
if (Test-Path $envPath) { $composeEnvArgs = @("--env-file", $envPath) }
if ($script:composeAvailable) {
    Invoke-Capture "compose-services.txt" { & docker compose @composeEnvArgs config --services }
    Invoke-Capture "compose-images.txt" { & docker compose @composeEnvArgs images }
    Invoke-Capture "compose-ps.txt" { & docker compose @composeEnvArgs ps -a }
    Invoke-Capture "compose-ps.json" { & docker compose @composeEnvArgs ps -a --format json }
    Invoke-Capture "docker-stats.txt" { & docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' }
}

Write-Ui "[3/8] Journaux separes des services NARCHI..." Yellow
# [51] - Qdrant retire de la pile : le RAG vit dans PostgreSQL (pgvector).
$services = @("db", "pgbouncer", "redis", "migrate", "backend", "worker", "flower", "frontend", "prometheus", "grafana")
if ($script:composeAvailable) {
    foreach ($service in $services) {
        Write-Ui "       - $service" DarkGray
        Invoke-Capture "services\$service.log" {
            & docker compose @composeEnvArgs logs --no-color --timestamps --tail=$Tail $service
        }
        Invoke-Capture "services\$service-state.json" {
            $ids = @(& docker compose @composeEnvArgs ps -aq $service)
            if ($ids.Count -eq 0) { Write-Output '{"state":"container-not-created"}' }
            else { & docker inspect --format '{{json .State}}' @ids }
        }
    }
    Invoke-Capture "all-services-tail.log" {
        & docker compose @composeEnvArgs logs --no-color --timestamps --tail=300
    }
} else {
    Write-TextFile (Join-Path $workPath "services\NOT_COLLECTED.txt") "Docker Compose indisponible.`r`n"
}

Write-Ui "[4/8] Diagnostic interne base, Redis, pgvector, migrations, owner et sauvegardes..." Yellow
if ($script:composeAvailable) {
    $backendId = (& docker compose @composeEnvArgs ps -q backend 2>$null | Select-Object -First 1)
    $backendRunning = $false
    if ($backendId) {
        $backendRunning = ((& docker inspect --format '{{.State.Running}}' $backendId 2>$null) -eq "true")
    }
    if ($backendRunning) {
        Invoke-Capture "runtime-diagnostics.json" {
            & docker compose @composeEnvArgs exec -T backend python -m app.scripts.runtime_diagnostics
        }
        Invoke-Capture "alembic-current.txt" {
            & docker compose @composeEnvArgs exec -T backend alembic current
        }
    } else {
        Write-TextFile (Join-Path $workPath "runtime-diagnostics.json") '{"status":"backend-not-running"}'
        Write-TextFile (Join-Path $workPath "alembic-current.txt") "Backend non demarre; consulter services\migrate.log.`r`n"
    }
    # [51] - Statut pgBackRest : la verite sur la derniere sauvegarde, lue
    # directement dans le volume de sauvegarde (jamais devinee).
    $dbId = (& docker compose @composeEnvArgs ps -q db 2>$null | Select-Object -First 1)
    $dbRunning = $false
    if ($dbId) {
        $dbRunning = ((& docker inspect --format '{{.State.Running}}' $dbId 2>$null) -eq "true")
    }
    if ($dbRunning) {
        Invoke-Capture "backup-last-run.txt" {
            & docker compose @composeEnvArgs exec -T db sh -c 'if [ -f /var/lib/pgbackrest/last_backup.json ]; then cat /var/lib/pgbackrest/last_backup.json; else echo AUCUNE-SAUVEGARDE-ENREGISTREE; fi'
        }
        Invoke-Capture "backup-repo-info.txt" {
            & docker compose @composeEnvArgs exec -T db su -s /bin/bash postgres -c 'pgbackrest --stanza=narchi info'
        }
        Invoke-Capture "backup-cron.log" {
            & docker compose @composeEnvArgs exec -T db sh -c 'if [ -f /var/lib/pgbackrest/cron.log ]; then tail -n 200 /var/lib/pgbackrest/cron.log; else echo AUCUN-JOURNAL-CRON; fi'
        }
    } else {
        Write-TextFile (Join-Path $workPath "backup-last-run.txt") "Conteneur db non demarre.`r`n"
    }
}

Write-Ui "[5/8] Test de l'application et des fichiers frontend..." Yellow
$httpLines = New-Object System.Collections.Generic.List[string]
try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/api/health" -TimeoutSec 8
    $healthRequestId = [string]$health.Headers["X-Narchi-Request-ID"]
    $script:backendHealthy = $health.StatusCode -eq 200
    $httpLines.Add("HealthStatus=$($health.StatusCode)") | Out-Null
    $httpLines.Add("HealthRequestId=$healthRequestId") | Out-Null
} catch {
    $httpLines.Add("HealthStatus=$(Get-HttpFailureStatus $_)") | Out-Null
    $httpLines.Add("HealthError=$($_.Exception.Message)") | Out-Null
}
try {
    $indexResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/" -TimeoutSec 8
    $httpLines.Add("IndexStatus=$($indexResponse.StatusCode)") | Out-Null
    $assets = [regex]::Matches($indexResponse.Content, '(?:src|href)="(/assets/[^"]+)"') |
        ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique -First 30
    $assetFailures = 0
    $runtimeAssets = @(
        "/vendor/manifest.json",
        "/vendor/three.module-0.185.1-narchi-v2.js",
        "/vendor/three.core-0.185.1-narchi-v2.js",
        "/ifc/fragments-worker.mjs",
        "/ifc/web-ifc.wasm"
    )
    $allAssets = @($assets) + $runtimeAssets | Select-Object -Unique
    foreach ($asset in $allAssets) {
        try {
            $assetResponse = Invoke-WebRequest -UseBasicParsing -Method Head -Uri ("http://localhost:8080" + $asset) -TimeoutSec 8
            $httpLines.Add("Asset=$asset Status=$($assetResponse.StatusCode)") | Out-Null
            if ($assetResponse.StatusCode -ne 200) { $assetFailures++ }
        } catch {
            $assetFailures++
            $httpLines.Add("Asset=$asset Status=$(Get-HttpFailureStatus $_)") | Out-Null
        }
    }
    $script:staticResult = $(if ($assetFailures -eq 0) { "OK" } else { "ECHEC ($assetFailures asset(s))" })
} catch {
    $httpLines.Add("IndexStatus=$(Get-HttpFailureStatus $_)") | Out-Null
    $httpLines.Add("IndexError=$($_.Exception.Message)") | Out-Null
    $script:staticResult = "ECHEC"
}
Write-TextFile (Join-Path $workPath "http-tests.txt") (Protect-Text (($httpLines -join "`r`n") + "`r`n"))
Add-Summary ("- Healthcheck application : " + $(if ($script:backendHealthy) { "OK" } else { "ECHEC" }))
Add-Summary "- Fichiers frontend references par index.html : $script:staticResult"

Write-Ui "[6/8] Test securise de la connexion owner..." Yellow
$authLines = New-Object System.Collections.Generic.List[string]
if ($SkipAuthTest) {
    $script:authResult = "IGNORE A LA DEMANDE"
    $authLines.Add("AuthTest=SKIPPED") | Out-Null
} elseif (-not $script:backendHealthy) {
    $script:authResult = "IMPOSSIBLE (application indisponible)"
    $authLines.Add("AuthTest=BACKEND_UNAVAILABLE") | Out-Null
} elseif (-not $envValues.ContainsKey("NARCHI_OWNER_EMAIL") -or
          -not $envValues.ContainsKey("NARCHI_OWNER_PASSWORD") -or
          [string]::IsNullOrWhiteSpace([string]$envValues["NARCHI_OWNER_PASSWORD"])) {
    $script:authResult = "IMPOSSIBLE (identifiants owner absents du .env)"
    $authLines.Add("AuthTest=OWNER_ENV_MISSING") | Out-Null
} else {
    try {
        $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $login = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri "http://localhost:8080/api/v5/auth/token" `
            -Method Post `
            -ContentType "application/x-www-form-urlencoded" `
            -Body @{ username = $envValues["NARCHI_OWNER_EMAIL"]; password = $envValues["NARCHI_OWNER_PASSWORD"] } `
            -WebSession $webSession `
            -TimeoutSec 15
        $loginRequestId = [string]$login.Headers["X-Narchi-Request-ID"]
        $authLines.Add("LoginStatus=$($login.StatusCode)") | Out-Null
        $authLines.Add("LoginRequestId=$loginRequestId") | Out-Null
        $cookieNames = @($webSession.Cookies.GetCookies("http://localhost:8080") | ForEach-Object { $_.Name })
        $authLines.Add("CookieNames=$($cookieNames -join ',')") | Out-Null
        $me = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri "http://localhost:8080/api/v5/auth/me" `
            -Method Get `
            -WebSession $webSession `
            -TimeoutSec 15
        $meRequestId = [string]$me.Headers["X-Narchi-Request-ID"]
        $authLines.Add("MeStatus=$($me.StatusCode)") | Out-Null
        $authLines.Add("MeRequestId=$meRequestId") | Out-Null
        if ($login.StatusCode -eq 200 -and $me.StatusCode -eq 200 -and $cookieNames -contains "narchi_session") {
            $script:authResult = "OK (login + cookie + /auth/me)"
        } else {
            $script:authResult = "ECHEC (session incomplete)"
        }
    } catch {
        $status = Get-HttpFailureStatus $_
        $requestId = Get-HttpFailureRequestId $_
        $authLines.Add("AuthFailureStatus=$status") | Out-Null
        $authLines.Add("AuthFailureRequestId=$requestId") | Out-Null
        $authLines.Add("AuthFailureType=$($_.Exception.GetType().Name)") | Out-Null
        $script:authResult = "ECHEC HTTP $status (request_id=$requestId)"
    }
}
Write-TextFile (Join-Path $workPath "authentication-test.txt") (Protect-Text (($authLines -join "`r`n") + "`r`n"))
Add-Summary "- Authentification owner automatique : $script:authResult"

Write-Ui "[7/8] Historique du deploiement, empreintes et analyse des erreurs..." Yellow
$deploymentSource = Join-Path $root "logs\deployment"
if (Test-Path $deploymentSource) {
    Get-ChildItem -Path $deploymentSource -File | Sort-Object LastWriteTime -Descending | Select-Object -First 10 |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $workPath "deployment") -Force }
}
$keyFiles = @(
    "docker-compose.yml", "DEPLOY_PROD.ps1", "COLLECT_DIAGNOSTICS.ps1",
    "backend\app\main.py", "backend\app\core\logging.py",
    "backend\app\api\auth_routes.py", "frontend\src\core\telemetry.ts",
    "frontend\src\store\AuthStore.tsx", "frontend\nginx.conf"
)
$hashLines = New-Object System.Collections.Generic.List[string]
foreach ($relative in $keyFiles) {
    $path = Join-Path $root $relative
    if (Test-Path $path) {
        $hash = (Get-FileHash -Algorithm SHA256 -Path $path).Hash
        $hashLines.Add("$hash  $relative") | Out-Null
    } else {
        $hashLines.Add("MISSING  $relative") | Out-Null
    }
}
Write-TextFile (Join-Path $workPath "key-files-sha256.txt") (($hashLines -join "`r`n") + "`r`n")

# Nettoyage final de chaque fichier texte avant l'analyse et la compression.
Get-ChildItem -Path $workPath -Recurse -File | ForEach-Object {
    try {
        $content = [System.IO.File]::ReadAllText($_.FullName)
        Write-TextFile $_.FullName (Protect-Text $content)
    } catch {}
}

$logText = ""
Get-ChildItem -Path (Join-Path $workPath "services") -Filter "*.log" -File | ForEach-Object {
    try { $logText += [System.IO.File]::ReadAllText($_.FullName) + "`n" } catch {}
}
$errorCount = ([regex]::Matches($logText, '(?im)"level"\s*:\s*"(?:ERROR|CRITICAL)"|\b(?:ERROR|CRITICAL|FATAL)\b|Traceback')).Count
$warningCount = ([regex]::Matches($logText, '(?im)"level"\s*:\s*"WARNING"|\bWARN(?:ING)?\b')).Count
$eventCounts = @{}
foreach ($match in [regex]::Matches($logText, '"event_code"\s*:\s*"([A-Z][A-Z0-9_]{2,63})"')) {
    $code = $match.Groups[1].Value
    if (-not $eventCounts.ContainsKey($code)) { $eventCounts[$code] = 0 }
    $eventCounts[$code]++
}
$importantEvents = $eventCounts.GetEnumerator() |
    Where-Object { $_.Name -match 'FAILED|ERROR|INVALID|MISSING|MISMATCH|INACTIVE|REJECTED|EXCEPTION|FALLBACK' } |
    Sort-Object -Property @{ Expression = "Value"; Descending = $true }, @{ Expression = "Name"; Descending = $false } |
    Select-Object -First 30
Add-Summary ""
Add-Summary "ANALYSE AUTOMATIQUE"
Add-Summary "- Occurrences erreur/critique/traceback dans les extraits : $errorCount"
Add-Summary "- Occurrences warning dans les extraits : $warningCount"
if ($importantEvents) {
    Add-Summary "- Codes d'evenement importants trouves :"
    foreach ($item in $importantEvents) { Add-Summary "  * $($item.Name) : $($item.Value)" }
} else {
    Add-Summary "- Aucun code d'evenement d'echec structure n'a ete trouve dans les extraits."
}
Add-Summary ""
Add-Summary "OU REGARDER EN PREMIER"
Add-Summary "1. authentication-test.txt : resultat login/cookie/auth-me, sans mot de passe."
Add-Summary "2. runtime-diagnostics.json : PostgreSQL, Alembic, Redis, pgvector et coherence owner."
Add-Summary "3. backup-last-run.txt + backup-repo-info.txt : verite sur les sauvegardes pgBackRest."
Add-Summary "4. services/migrate.log : erreur SQL exacte si la migration bloque."
Add-Summary "5. services/backend.log : codes AUTH_*, HTTP_* et FRONTEND_* avec request_id."
Add-Summary "6. services/frontend.log : acces Nginx et request_id correspondant au backend."
Add-Summary "7. compose-ps.txt et services/*-state.json : conteneur arrete, exit code et healthcheck."
Add-Summary ""
Add-Summary "Pour demander une correction, transmettre uniquement le ZIP complet :"
Add-Summary "$zipPath"
Write-TextFile $summaryPath (($script:summaryLines -join "`r`n") + "`r`n")

Write-Ui "[8/8] Masquage final et creation du ZIP..." Yellow
# Le resume ne contient pas de secret mais passe par la meme barriere par prudence.
Write-TextFile $summaryPath (Protect-Text ([System.IO.File]::ReadAllText($summaryPath)))
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $workPath "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
$zipHash = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash
Write-TextFile (Join-Path $diagnosticsRoot "$bundleName.sha256.txt") "$zipHash  $bundleName.zip`r`n"
Remove-Item $workPath -Recurse -Force

# Conservation des 10 paquets les plus recents pour eviter de remplir le disque.
Get-ChildItem -Path $diagnosticsRoot -Filter "NARCHI_DIAGNOSTIC_*.zip" -File |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | ForEach-Object {
        $oldBase = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        Remove-Item $_.FullName -Force
        $oldHash = Join-Path $diagnosticsRoot "$oldBase.sha256.txt"
        if (Test-Path $oldHash) { Remove-Item $oldHash -Force }
    }

Write-Ui ""
Write-Ui "============================================================================" Cyan
Write-Ui "  [OK] DIAGNOSTIC TERMINE" Green
Write-Ui "  Fichier a transmettre :" White
Write-Ui "  $zipPath" Yellow
Write-Ui "  SHA-256 : $zipHash" DarkGray
Write-Ui "============================================================================" Cyan

if (-not $Quiet) {
    try { Start-Process explorer.exe -ArgumentList "/select,`"$zipPath`"" } catch {}
}
Write-Output $zipPath
exit 0
