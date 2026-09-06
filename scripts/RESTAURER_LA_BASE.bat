@echo off
setlocal
TITLE NARCHI - RESTAURER LA BASE (sauvegarde pgBackRest)
COLOR 0C
pushd "%~dp0\.."

echo ============================================================================
echo   NARCHI - RESTAURER LA BASE (sauvegarde pgBackRest)
echo ============================================================================
echo.
echo   ATTENTION : operation DESTRUCTRICE pour les donnees recentes.
echo   La base actuelle sera remplacee par une sauvegarde.
echo   Deux confirmations en MAJUSCULES seront demandees.
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell est introuvable sur ce poste Windows.
    popd
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0RESTAURER_LA_BASE.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [RESULTAT] La restauration n'est pas allee au bout ^(code %RC%^).
) else (
    echo [RESULTAT] Restauration terminee avec succes.
)
popd
pause
exit /b %RC%
