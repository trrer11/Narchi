[CmdletBinding()]
param(
    # full = sauvegarde complete (recommande) ; incr = incrementale depuis la
    # derniere complete (plus rapide, utilisee par le cron en semaine).
    [ValidateSet("full", "incr")][string]$Type = "full"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - SAUVEGARDE POSTGRESQL IMMEDIATE (pgBackRest)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable. Demarrez-le puis relancez."
}
$dbId = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
if (-not $dbId -or ((& docker inspect --format '{{.State.Running}}' $dbId 2>$null) -ne "true")) {
    throw "Le conteneur 'db' n'est pas demarre. Lancez d'abord DEPLOY_PROD.bat."
}

Write-Host "Type demande : $Type - la tache peut durer plusieurs minutes selon le volume." -ForegroundColor Yellow
& docker compose --env-file $envPath exec -T db su -s /bin/bash postgres -c "/usr/local/bin/narchi-backup-job.sh $Type"
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[OK] Sauvegarde terminee. Verite terrain (dernier enregistrement) :" -ForegroundColor Green
    & docker compose --env-file $envPath exec -T db cat /var/lib/pgbackrest/last_backup.json
    Write-Host ""
    & docker compose --env-file $envPath exec -T db su -s /bin/bash postgres -c "pgbackrest --stanza=narchi info"
} else {
    Write-Host "[ECHEC] La sauvegarde a retourne le code $rc." -ForegroundColor Red
    Write-Host "Verite terrain (dernier enregistrement, echec inclus) :" -ForegroundColor Yellow
    & docker compose --env-file $envPath exec -T db cat /var/lib/pgbackrest/last_backup.json
    Write-Host ""
    Write-Host "Pistes : docker compose logs db - puis relancez. Aucune donnee n'a ete modifiee." -ForegroundColor Yellow
    exit $rc
}
