@echo off
setlocal
TITLE NARCHI - 6 VERIFIER LA RESTAURATION (preuve)
COLOR 0A

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 6_VERIFIER_RESTAURATION (une sauvegarde n'est bonne que
echo   si elle se RESTAURE : ici on le PROUVE, sans toucher la production)
echo ============================================================================
echo.
echo La copie la plus recente de  sauvegardes\  est restauree dans une base
echo JETABLE, puis comparee table par table a la vraie (tables + lignes).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\VERIFIER_RESTAURATION.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ERREUR ou VIDE] Code %RC% - lisez le verdict ci-dessus.
) else (
    echo [OK] La sauvegarde est BONNE - verdict detaille ci-dessus.
)
popd
pause
exit /b %RC%
