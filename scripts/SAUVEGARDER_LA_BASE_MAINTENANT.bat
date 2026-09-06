@echo off
setlocal
TITLE NARCHI - SAUVEGARDER LA BASE MAINTENANT
COLOR 0A
pushd "%~dp0\.."

echo ============================================================================
echo   NARCHI - SAUVEGARDER LA BASE MAINTENANT (pgBackRest)
echo ============================================================================
echo.
echo Lance une sauvegarde complete MAINTENANT, sans attendre le cron de 03:30.
echo Les donnees actives ne sont jamais modifiees par une sauvegarde.
echo Utile avant une demonstration ou apres un import important.
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell est introuvable sur ce poste Windows.
    popd
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0SAUVEGARDER_LA_BASE_MAINTENANT.ps1" -Type full
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ECHEC] La sauvegarde a echoue ^(code %RC%^). Voir message ci-dessus.
) else (
    echo [OK] Sauvegarde terminee et verifiee.
)
popd
pause
exit /b %RC%
