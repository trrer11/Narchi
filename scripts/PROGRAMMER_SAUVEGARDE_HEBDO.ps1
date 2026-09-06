# etape 113 - Planifie l'export visible : tache Windows hebdomadaire
# (dimanche 05:00, juste apres la sauvegarde interne pgBackRest de 03:30).
# Limite honnete : la tache ne tourne que si le PC est ALLUME et votre
# session OUVERTE - c'est le fonctionnement standard du Planificateur
# de taches, je le dis plutot que de promettre l'invisible.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "NARCHI\ExportSauvegardeHebdo"
$target = Join-Path $root "scripts\EXPORTER_SAUVEGARDE_VISIBLE.ps1"

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - PROGRAMMER L'EXPORT HEBDOMADAIRE (dimanche 05:00)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

& schtasks /Create /F /TN $taskName /SC WEEKLY /D SUN /ST 05:00 `
    /TR "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$target`"" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Echec de creation de la tache (code $LASTEXITCODE). Relancez ce fichier en administrateur si besoin."
}

Write-Host "[OK] Tache creee. Verification honnete (ce que Windows a vraiment enregistre) :" -ForegroundColor Green
& schtasks /Query /TN $taskName /V /FO LIST | Select-String -Pattern "ta|TaskName|Next Run|Prochaine|Schedule|Planifi|Status|tat|Statut"
Write-Host ""
Write-Host "Rappel des fichiers :" -ForegroundColor Yellow
Write-Host "  5_SAUVEGARDE_EXTERNE.bat   = export maintenant (dossier sauvegardes\) " -ForegroundColor Yellow
Write-Host "  6_VERIFIER_RESTAURATION.bat = prouve qu'une copie se restaure vraiment" -ForegroundColor Yellow
Write-Host "  Pour SUPPRIMER la tache :   schtasks /Delete /TN `"$taskName`" /F" -ForegroundColor DarkGray
