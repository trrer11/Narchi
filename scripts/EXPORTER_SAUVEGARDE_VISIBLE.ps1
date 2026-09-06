# etape 113 - Export VISIBLE de la base (copie " parachute " dans .\sauvegardes).
# Complement du etape 51 : pgBackRest sauvegarde chaque nuit DANS un volume
# Docker (invisible, detruit avec la base si le disque lache ou si
# 4_TOUT_EFFACER tourne). Ici : un vrai fichier .sql.gz lisible partout,
# pose dans un dossier que vous VOYEZ et pouvez COPIER (cle USB, autre PC).
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - EXPORT VISIBLE DE LA BASE (copie externe etape 113)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Principe : un dump PostgreSQL complet et compresse est pose dans" -ForegroundColor Yellow
Write-Host "   .\sauvegardes\  - dossier REEL que vous voyez dans l'Explorateur." -ForegroundColor Yellow
Write-Host "   Aucune donnee active n'est modifiee. Duree : quelques secondes a minutes." -ForegroundColor Yellow
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable. Demarrez-le puis relancez."
}
$dbId = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
if (-not $dbId -or ((& docker inspect --format '{{.State.Running}}' $dbId 2>$null) -ne "true")) {
    throw "Le conteneur 'db' n'est pas demarre. Lancez d'abord 1_DEMARRER_NARCHI.bat."
}

# Les montures etape 113 n'existent que sur un conteneur db (re)cree APRES
# cette livraison : si elles manquent, on recree db UNE fois - meme
# volume de donnees = AUCUNE perte, c'est juste un conteneur neuf.
$mountsOk = $true
& docker compose --env-file $envPath exec -T db test -d /narchi-backup 2>$null
if ($LASTEXITCODE -ne 0) { $mountsOk = $false }
if (-not $mountsOk) {
    Write-Host "Montures de sauvegarde absentes : recreation UNIQUE du conteneur db (donnees conservees)..." -ForegroundColor Yellow
    & docker compose --env-file $envPath up -d --no-deps db | Out-Null
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 3
        $st = (& docker inspect --format '{{.State.Health.Status}}' $dbId 2>$null)
        $dbId = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
        if ($dbId) { $st = (& docker inspect --format '{{.State.Health.Status}}' $dbId 2>$null) }
    } while ($st -ne "healthy" -and (Get-Date) -lt $deadline)
    if ($st -ne "healthy") { throw "Le conteneur db n'est pas 'healthy' apres recreation. Lancez 3_REPARER_NARCHI_SANS_PERTE.bat puis relancez." }
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "sauvegardes") | Out-Null

Write-Host "Export en cours (dump logique + gzip + epreuve d'integrite)..." -ForegroundColor Cyan
& docker compose --env-file $envPath exec -T db bash /narchi-backup/export-sauvegarde-visible.sh
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[OK] Copie externe creee. Verite terrain (dernier enregistrement) :" -ForegroundColor Green
    & docker compose --env-file $envPath exec -T db cat /sauvegardes/dernier_export.json 2>$null
    Write-Host ""
    Write-Host "IMPORTANT - une copie sur le MEME disque ne protege pas d'une panne disque :" -ForegroundColor Yellow
    Write-Host "  copiez le dossier  sauvegardes\  sur une cle USB, un autre PC ou un NAS," -ForegroundColor Yellow
    Write-Host "  par exemple une fois par semaine (glisser-deplacer dans l'Explorateur suffit)." -ForegroundColor Yellow
} else {
    Write-Host "[ECHEC] L'export a retourne le code $rc. Verite terrain :" -ForegroundColor Red
    & docker compose --env-file $envPath exec -T db cat /sauvegardes/dernier_export.json 2>$null
    Write-Host ""
    Write-Host "Envoyez ce message. Aucune donnee n'a ete modifiee." -ForegroundColor Yellow
    exit $rc
}
