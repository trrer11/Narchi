@echo off
setlocal EnableExtensions EnableDelayedExpansion
TITLE NARCHI - 3 REPARER (sans perte de donnees)
COLOR 0B

rem ============================================================================
rem NARCHI - 3_REPARER_NARCHI_SANS_PERTE.bat
rem
rem A utiliser quand NARCHI plante ou se comporte bizarrement :
rem reconstruction COMPLETE des images Docker SANS cache (--no-cache).
rem
rem VOS DONNEES SONT CONSERVEES : PostgreSQL v7, sauvegardes pgBackRest,
rem Redis et Grafana ne sont jamais supprimes par ce fichier.
rem
rem Duree : nettement plus longue qu'un demarrage normal (tout est rebati).
rem ============================================================================

pushd "%~dp0"
set "ROOT=%CD%"

where docker.exe >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Docker Desktop est introuvable.
    echo Demarrez Docker Desktop puis relancez ce fichier.
    goto FAIL
)
where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] PowerShell est introuvable.
    goto FAIL
)
if not exist "%ROOT%\DEPLOY_PROD.ps1" (
    echo [ERREUR] DEPLOY_PROD.ps1 est introuvable.
    goto FAIL
)
if not exist "%ROOT%\1_DEMARRER_NARCHI.bat" (
    echo [ERREUR] 1_DEMARRER_NARCHI.bat est introuvable.
    goto FAIL
)

echo.
echo ============================================================================
echo NARCHI - REPARATION SANS PERTE DE DONNEES
echo ============================================================================
echo Les conteneurs seront arretes puis toutes les images reconstruites
echo SANS cache (correctif des problemes persistants).
echo.
echo CONSERVE : PostgreSQL (donnees v7), sauvegardes pgBackRest, Redis,
echo Grafana et l'archive legacy v6 si presente.
echo.
choice /C ON /N /M "Lancer la reparation complete ? [O]ui / [N]on : "
if errorlevel 2 (
    echo Operation annulee.
    goto OK
)

echo.
echo [1/2] Arret propre, reconstruction sans cache et redemarrage...
call "%ROOT%\1_DEMARRER_NARCHI.bat" -NoCache
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo ============================================================================
    echo [ECHEC] La reparation a echoue. Code : %RC%
    echo ============================================================================
    echo Consultez : logs\deployment\deployment-latest.log
    echo Et transmettez un diagnostic : DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat
    goto FAIL_NO_PAUSE
)

echo.
echo ============================================================================
echo [2/2] Verification du worker IFC (type MIME)...
echo ============================================================================
curl.exe -sS -I http://localhost:8080/ifc/fragments-worker.mjs | findstr /I "HTTP/ Content-Type:"
echo.
echo [OK] Reparation terminee. Application : http://localhost:8080
echo IMPORTANT : dans le navigateur, faire Ctrl+Shift+R (cache vide) puis
echo tester un import IFC.
goto OK

:FAIL
set "RC=1"
:FAIL_NO_PAUSE
popd
pause
exit /b %RC%

:OK
popd
pause
exit /b 0
