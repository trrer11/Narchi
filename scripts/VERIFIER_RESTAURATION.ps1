# etape 113 - Preuve de restauration : la sauvegarde la plus recente est
# REJOUEE dans une base jetable, puis comparee au vrai (tables + lignes).
# Une sauvegarde jamais restauree n'est qu'un espoir - ici elle est
# eprouvee. Aucune donnee de production n'est touchee (base jetable
# creee puis detruite, quoi qu'il arrive).
[CmdletBinding()]
param(
    # Chemin d'un export precis (optionnel ; defaut = le plus recent).
    [string]$Fichier = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - VERIFIER LA RESTAURATION (preuve reelle etape 113)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "La derniere copie de .\sauvegardes est restauree dans une base JETABLE," -ForegroundColor Yellow
Write-Host "puis son contenu est compare au MANIFESTE ecrit au moment de lexport (la base vivante bouge : comparer a elle serait injuste)." -ForegroundColor Yellow
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop est introuvable. Demarrez-le puis relancez."
}
$dbId = (& docker compose --env-file $envPath ps -q db 2>$null | Select-Object -First 1)
if (-not $dbId -or ((& docker inspect --format '{{.State.Running}}' $dbId 2>$null) -ne "true")) {
    throw "Le conteneur 'db' n'est pas demarre. Lancez d'abord 1_DEMARRER_NARCHI.bat."
}

$arg = ""
if ($Fichier -ne "") {
    $name = Split-Path -Leaf $Fichier
    $arg = "/sauvegardes/$name"
}
& docker compose --env-file $envPath exec -T db bash /narchi-backup/verifier-restauration.sh $arg
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[OK] VERDICT : la sauvegarde se restaure et son contenu est IDENTIQUE." -ForegroundColor Green
    Write-Host "Vous pouvez dormir tranquille : ce fichier rendra votre base si besoin." -ForegroundColor Green
} elseif ($rc -eq 66) {
    Write-Host "[VIDE] Aucune copie dans .\sauvegardes : lancez d'abord 5_SAUVEGARDE_EXTERNE.bat." -ForegroundColor Yellow
} else {
    Write-Host "[ECHEC] code $rc - la copie est corrompue ou differente. Refaites un export (5_) et previent-on." -ForegroundColor Red
    exit $rc
}
