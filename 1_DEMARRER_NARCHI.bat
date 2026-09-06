@echo off
setlocal
TITLE NARCHI - 1 DEMARRER (installation et mises a jour)
COLOR 0A

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 1_DEMARRER_NARCHI (USAGE QUOTIDIEN)
echo ============================================================================
echo.
echo C'est le fichier normal a double-cliquer : premiere installation et
echo mises a jour apres re-telechargement du projet.
echo.
echo   - Vos donnees sont CONSERVEES (base, projets, maquettes IFC).
echo   - Les donnees d'un ancien volume postgres v6 (avant pgvector) sont
echo     migrees automatiquement si presentes (lecture seule, jamais effacees).
echo   - Les sauvegardes pgBackRest planifiees restent actives.
echo.
echo Autres fichiers utiles :
echo   2_REDEMARRER_NARCHI_RAPIDE.bat  . apres un redemarrage du PC
echo   3_REPARER_NARCHI_SANS_PERTE.bat . si NARCHI se comporte bizarrement
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell est introuvable sur ce poste Windows.
    popd
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEPLOY_PROD.ps1" %*
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" (
    echo.
    echo [ERROR] Le deploiement NARCHI V5 a echoue ^(code %DEPLOY_EXIT%^).
    echo Lisez la ligne [CAUSE] en rouge ci-dessus : elle donne l'erreur exacte.
    echo Cause frequente : Docker Desktop non demarre. Ouvrez le menu Demarrer,
    echo lancez Docker Desktop, attendez 'Engine running', puis double-cliquez
    echo a nouveau sur ce fichier.
    if exist "logs\diagnostics\NARCHI_DIAGNOSTIC_*.zip" (
        echo Un ZIP de diagnostic est disponible dans logs\diagnostics :
        echo envoyez le fichier NARCHI_DIAGNOSTIC_*.zip le plus recent.
    ) else (
        echo Aucun ZIP n'a pu etre cree : envoyez logs\deployment\deployment-latest.log
    )
    popd
    pause
    exit /b %DEPLOY_EXIT%
)

echo.
echo [OK] Le deploiement est termine.
popd
pause
exit /b 0
