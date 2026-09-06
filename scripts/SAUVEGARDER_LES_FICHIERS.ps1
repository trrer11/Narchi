# etape 133 - Export VISIBLE des FICHIERS (photos/videos de chantier) -
# copie externe " parachute ", complement de l'export base etape 113.
#
# L'export base (SAUVEGARDER_LA_BASE_MAINTENANT) sauvegarde la base SQL,
# mais PAS le volume narchi_storage : les photos/videos de la Baustelle
# (etape 118) vivent la, HORS de la base. Ce script archive le volume dans
# .\sauvegardes\ - dossier REEL que vous voyez et pouvez COPIER.
#
# Fonctionne EXACTEMENT comme l'export base : manifeste du contenu exact,
# verite atomique apres CHAQUE tentative, rotation (60 copies).
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - EXPORT VISIBLE DES FICHIERS (photos/videos etape 133)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Principe : le contenu du volume de fichiers (photos/videos de chantier)" -ForegroundColor Yellow
Write-Host "   est archive (tar.gz) dans .\sauvegardes\ - dossier REEL, visible," -ForegroundColor Yellow
Write-Host "   copiable sur une cle USB ou un autre PC. Aucune donnee modifiee." -ForegroundColor Yellow
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable. Demarrez-le puis relancez."
}
$apiId = (& docker compose --env-file $envPath ps -q backend 2>$null | Select-Object -First 1)
if (-not $apiId -or ((& docker inspect --format '{{.State.Running}}' $apiId 2>$null) -ne "true")) {
    throw "Le conteneur 'backend' n'est pas demarre. Lancez d'abord 1_DEMARRER_NARCHI.bat."
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "sauvegardes") | Out-Null

Write-Host "Export en cours (archive tar.gz + manifeste + epreuve d'integrite)..." -ForegroundColor Cyan
& docker compose --env-file $envPath exec -T backend bash /narchi-backup/export-fichiers-visible.sh
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[OK] Copie externe creee. Verite terrain (dernier enregistrement) :" -ForegroundColor Green
    & docker compose --env-file $envPath exec -T backend cat /sauvegardes/dernier_export_fichiers.json 2>$null
    Write-Host ""
    Write-Host "IMPORTANT - une copie sur le MEME disque ne protege pas d'une panne disque :" -ForegroundColor Yellow
    Write-Host "  copiez le dossier  sauvegardes\  sur une cle USB, un autre PC ou un NAS." -ForegroundColor Yellow
} else {
    Write-Host "[ECHEC] L'export a retourne le code $rc. Verite terrain :" -ForegroundColor Red
    & docker compose --env-file $envPath exec -T backend cat /sauvegardes/dernier_export_fichiers.json 2>$null
    Write-Host ""
    Write-Host "Envoyez ce message. Aucune donnee n'a ete modifiee." -ForegroundColor Yellow
    exit $rc
}
