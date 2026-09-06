@echo off
setlocal
TITLE NARCHI - 9 RETIRER HTTPS LOCAL (retour au 8080 seul)

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 9_RETIRER_HTTPS_LOCAL (inverse propre du 8_)
echo ============================================================================
echo.
echo Retire le bloc https 8443 et la regle de pare-feu, relance le serveur,
echo puis PROUVE le resultat : http://localhost:8080 repond, 8443 ne repond
echo plus.
echo.
echo CONSERVE (dit honnetement) :
echo  - les certificats dans infra\tls\certs\ (re-activation = 8_ACTIVER_HTTPS_LOCAL.bat)
echo  - la confiance CA mkcert installee dans Windows.
echo    Pour la retirer aussi : PowerShell en administrateur, puis  mkcert -uninstall
echo    (manuel expres : on ne retire pas une confiance sans vous).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\RETIRER_HTTPS_LOCAL.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ERREUR] Retrait echoue (code %RC%). Lisez la cause ci-dessus ^(rouge^).
) else (
    echo [OK] HTTPS local retire. Narchi = http://localhost:8080 comme avant.
)
popd
pause
exit /b %RC%
