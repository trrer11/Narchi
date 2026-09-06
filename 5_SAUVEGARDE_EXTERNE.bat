@echo off
setlocal
TITLE NARCHI - 5 SAUVEGARDE EXTERNE (copie visible)
COLOR 0A

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 5_SAUVEGARDE_EXTERNE (copie visible dans .\sauvegardes)
echo ============================================================================
echo.
echo Double-cliquez ici pour poser MAINTENANT une copie complete de la base
echo dans le dossier  sauvegardes\  (un vrai fichier .sql.gz que vous voyez
echo dans l'Explorateur et pouvez copier sur cle USB / autre PC).
echo.
echo Les sauvegardes internes pgBackRest (chaque nuit) continuent comme avant :
echo ceci est la COPIE EXTERNE en plus - celle qui survit a une panne disque
echo et a 4_TOUT_EFFACER_ET_REDEMARRER.bat.
echo Aucune donnee active n'est modifiee.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\EXPORTER_SAUVEGARDE_VISIBLE.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ERREUR] L'export a echoue (code %RC%). Lisez la cause ci-dessus ^(rouge^).
) else (
    echo [OK] Export termine - pensez a copier sauvegardes\ sur un autre support.
)
popd
pause
exit /b %RC%
