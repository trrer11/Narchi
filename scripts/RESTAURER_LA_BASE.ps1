[CmdletBinding()]
param(
    # Restauration point-in-time optionnelle (UTC) : "2026-08-07 12:30:00"
    # Sans ce parametre : restauration de la derniere sauvegarde complete.
    [string]$TargetTime = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - RESTAURATION DE LA BASE POSTGRESQL (pgBackRest)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Cette operation REMPLACE le contenu actuel de la base par une sauvegarde." -ForegroundColor Red
if ($TargetTime) {
    Write-Host "  Cible demandee : etat le plus proche AVANT '$TargetTime' (UTC, PITR)." -ForegroundColor Yellow
} else {
    Write-Host "  Cible : derniere sauvegarde disponible." -ForegroundColor Yellow
}
Write-Host "  Les donnees plus recentes que la sauvegarde choisie seront PERDUES." -ForegroundColor Red
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable. Demarrez-le puis relancez."
}

# Apercu honnete de ce qui existe AVANT de demander confirmation.
$dbId = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
$dbRunning = $false
if ($dbId) { $dbRunning = ((& docker inspect --format '{{.State.Running}}' $dbId 2>$null) -eq "true") }
if ($dbRunning) {
    Write-Host "Sauvegardes reellement disponibles (pgbackrest info) :" -ForegroundColor Cyan
    & docker compose --env-file $envPath exec -T db su -s /bin/bash postgres -c "pgbackrest --stanza=narchi info"
    Write-Host ""
} else {
    Write-Host "[INFO] Le conteneur db est arrete : l'inventaire des sauvegardes sera verifie pendant l'operation." -ForegroundColor Yellow
}

$confirm1 = Read-Host "Tapez RESTAURER en majuscules pour continuer"
if ($confirm1 -ne "RESTAURER") { Write-Host "Annule. Aucune donnee modifiee." -ForegroundColor Yellow; exit 0 }
$confirm2 = Read-Host "Derniere confirmation : les donnees recentes seront perdues. Tapez OUI"
if ($confirm2 -ne "OUI") { Write-Host "Annule. Aucune donnee modifiee." -ForegroundColor Yellow; exit 0 }

Write-Host ""
Write-Host "[1/4] Arret des services qui touchent la base (backend, worker, pgbouncer)..." -ForegroundColor Yellow
& docker compose --env-file $envPath stop backend worker flower pgbouncer migrate db-password-sync db 2>&1 | Out-Null

Write-Host "[2/4] Restauration pgBackRest (--delta : seuls les blocs modifies sont recopies)..." -ForegroundColor Yellow
# Conteneur one-shot sur l'image db SANS entrypoint postgres : la base reste
# eteinte pendant la restauration (exigence pgBackRest). Le script
# render-pgbackrest-conf.sh re-rend la config dans ce conteneur jetable.
$restoreCmd = "render-pgbackrest-conf.sh && chown -R postgres:postgres /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest && su -s /bin/bash postgres -c 'pgbackrest --stanza=narchi --delta restore"
if ($TargetTime) {
    $restoreCmd += " --type=time --target=""$TargetTime"""
}
$restoreCmd += "'"
& docker compose --env-file $envPath run --rm --no-deps --entrypoint bash db -lc "$restoreCmd"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ECHEC] pgBackRest a retourne le code $LASTEXITCODE." -ForegroundColor Red
    Write-Host "La base N'EST PAS dans un etat coherent garanti : ne redemarrez pas aveuglement." -ForegroundColor Red
    Write-Host "Envoyez le message ci-dessus avec un diagnostic (COLLECT_DIAGNOSTICS.bat)." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host "[3/4] Redemarrage complet de la pile (les migrations Alembic rattrapent si besoin)..." -ForegroundColor Yellow
& docker compose --env-file $envPath up -d 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Le redemarrage apres restauration a echoue (code $LASTEXITCODE)." }

Write-Host "[4/4] Verification de sante (delai maximal : 240 secondes)..." -ForegroundColor Yellow
$healthy = $false
$deadline = (Get-Date).AddSeconds(240)
while ((Get-Date) -lt $deadline -and -not $healthy) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8080/api/health" -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $healthy = $true }
    } catch {
        Start-Sleep -Seconds 5
    }
}
if (-not $healthy) {
    Write-Host "[ATTENTION] Base restauree mais l'application n'est pas encore saine." -ForegroundColor Yellow
    Write-Host "Consultez : docker compose logs backend migrate" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  [OK] BASE RESTAUREE ET APPLICATION SAINE" -ForegroundColor Green
Write-Host "  Application : http://localhost:8080" -ForegroundColor White
Write-Host "  Pensez a verifier quelques projets recents dans l'interface." -ForegroundColor Yellow
Write-Host "============================================================================" -ForegroundColor Cyan
exit 0
