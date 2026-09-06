@echo off
setlocal EnableExtensions EnableDelayedExpansion
TITLE NARCHI - 4 TOUT EFFACER (destructeur)
COLOR 0C

rem ============================================================================
rem NARCHI - 4_TOUT_EFFACER_ET_REDEMARRER.bat
rem
rem /!\ ACTION DESTRUCTRICE /!\
rem Ce fichier SUPPRIME les volumes Docker NARCHI :
rem   - PostgreSQL v7 (TOUTES les donnees : projets, utilisateurs, prix)
rem   - les sauvegardes pgBackRest
rem   - Redis et Grafana
rem puis reconstruit tout a neuf (sans cache).
rem
rem L'archive legacy postgres_v6_data (si elle existe) n'est PAS touchee.
rem Deux confirmations en majuscules sont exigees avant toute suppression.
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
if not exist "%ROOT%\1_DEMARRER_NARCHI.bat" (
    echo [ERREUR] 1_DEMARRER_NARCHI.bat est introuvable.
    goto FAIL
)

echo.
echo ============================================================================
echo ATTENTION : SUPPRESSION TOTALE DEMANDEE
echo ============================================================================
echo Cette operation supprimera les volumes Docker NARCHI :
echo   - PostgreSQL v7 (toutes les donnees applicatives)
echo   - Sauvegardes pgBackRest
echo   - Redis
echo   - Grafana
echo L'archive legacy postgres_v6_data, si presente, n'est PAS touchee.
echo.
echo TOUTES LES DONNEES DE CES VOLUMES SERONT PERDUES.
echo.
echo Livraison 113 : le dossier  sauvegardes\ (copies EXTERNES) n'est PAS un volume
echo Docker - il SURVIT a cette operation. Derniere chance d'exporter
echo d'abord une copie lisible partout : 5_SAUVEGARDE_EXTERNE.bat
echo.
choice /C ON /N /M "Confirmer la suppression definitive ? [O]ui / [N]on : "
if errorlevel 2 (
    echo Operation annulee. Aucun volume n'a ete supprime.
    goto OK
)
choice /C ON /N /M "Derniere confirmation : supprimer les volumes ? [O]ui / [N]on : "
if errorlevel 2 (
    echo Operation annulee. Aucun volume n'a ete supprime.
    goto OK
)

echo.
echo Suppression des volumes, reconstruction sans cache et redemarrage...
call "%ROOT%\1_DEMARRER_NARCHI.bat" -ResetData -NoCache
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo ============================================================================
    echo [ECHEC] Le redemarrage apres suppression a echoue. Code : %RC%
    echo ============================================================================
    echo Consultez : logs\deployment\deployment-latest.log
    echo Et transmettez un diagnostic : DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat
    goto FAIL_NO_PAUSE
)

echo.
echo ============================================================================
echo [OK] NARCHI a ete ENTIEREMENT reconstruit (donnees reparties a zero).
echo ============================================================================
echo Application : http://localhost:8080
echo Les identifiants du compte proprietaire sont affiches a la fin du
echo deploiement ; retrouvez-les aussi via AFFICHER_MES_MOTS_DE_PASSE.bat
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
