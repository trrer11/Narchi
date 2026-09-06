@echo off
setlocal
TITLE NARCHI - 7 PROGRAMMER LA SAUVEGARDE HEBDOMADAIRE
COLOR 0A

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 7_PROGRAMMER_SAUVEGARDE_HEBDO (dimanche 05:00, une fois)
echo ============================================================================
echo.
echo Double-cliquez UNE FOIS : Windows lancera ensuite l'export visible tout
echo seul chaque dimanche a 05:00 (tache du Planificateur).
echo Limite honnete : le PC doit etre ALLUME et votre session OUVERTE a ce
echo moment-la ; sinon l'export est simplement saute (aucune perte, l'export
echo suivant reprendra).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\PROGRAMMER_SAUVEGARDE_HEBDO.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ERREUR] La planification a echoue (code %RC%). Lisez la cause ci-dessus.
) else (
    echo [OK] Planification enregistree - rien d'autre a faire.
)
popd
pause
exit /b %RC%
