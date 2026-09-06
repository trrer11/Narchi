@echo off
REM etape 133 - Export visible des FICHIERS (photos/videos de chantier).
REM Copie externe " parachute " du volume de fichiers, dans .\sauvegardes\.
REM Ne touche a aucune donnee active. Complement de l'export base etape 113.
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SAUVEGARDER_LES_FICHIERS.ps1"
if errorlevel 1 (
    echo.
    echo [ECHEC] L'export des fichiers a echoue - voir le message ci-dessus.
    pause
    exit /b 1
)
echo.
echo [OK] Export des fichiers termine. Pensez a copier .\sauvegardes\ ailleurs.
pause
endlocal
