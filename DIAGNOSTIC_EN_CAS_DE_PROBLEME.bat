@echo off
setlocal
TITLE NARCHI - DIAGNOSTIC EN CAS DE PROBLEME
COLOR 0B
pushd "%~dp0"

echo ============================================================================
echo   NARCHI - DIAGNOSTIC EN CAS DE PROBLEME (collecte automatique)
echo ============================================================================
echo.
echo Ce fichier collecte les journaux et cree un ZIP sans modifier vos donnees :
echo services, base, sauvegardes pgBackRest, sante applicative.
echo Les mots de passe, cles, cookies et jetons sont automatiquement masques.
echo Envoyez le ZIP genere pour obtenir une correction.
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell est introuvable sur ce poste Windows.
    popd
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0COLLECT_DIAGNOSTICS.ps1"
set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
    echo.
    echo [ERROR] La collecte a rencontre une erreur ^(code %RESULT%^).
    echo Aucun volume et aucune donnee NARCHI n'ont ete modifies.
    popd
    pause
    exit /b %RESULT%
)

echo.
echo [OK] Envoyez le fichier NARCHI_DIAGNOSTIC_*.zip qui vient de s'ouvrir.
popd
pause
exit /b 0
