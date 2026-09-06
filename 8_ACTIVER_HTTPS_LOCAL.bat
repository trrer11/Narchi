@echo off
setlocal
TITLE NARCHI - 8 ACTIVER HTTPS LOCAL (telephone)

pushd "%~dp0"

echo ============================================================================
echo   NARCHI - 8_ACTIVER_HTTPS_LOCAL (cadenas https pour le telephone)
echo ============================================================================
echo.
echo Pourquoi : un telephone REFUSE la photo par appareil photo, le mode
echo hors-ligne et le chiffrement sur http://192.168.x.x - il exige un cadenas
echo https avec un certificat de confiance. Ce script fabrique cette confiance
echo LOCALEMENT (mkcert), sans domaine ni autorite payante.
echo.
echo Ce qu'il fait : installe mkcert si absent (telechargement verifie par
echo empreinte), cree le certificat pour ce PC et ses adresses reseau, active
echo le port https 8443 d'Narchi, ouvre le pare-feu (reseau prive seulement),
echo puis PROUVE le resultat par de vraies requetes.
echo.
echo Rien d'autre ne change : http://localhost:8080 fonctionne comme avant.
echo Une demande de droits administrateur Windows va apparaitre : c'est normal
echo (installation du certificat de confiance + pare-feu).
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ACTIVER_HTTPS_LOCAL.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
    echo [ERREUR] Activation echouee (code %RC%). Lisez la cause ci-dessus ^(rouge^).
    echo Remede frequent : lancez d'abord 3_REPARER_NARCHI_SANS_PERTE.bat ^(image a jour^)
    echo puis relancez ce fichier.
) else (
    echo [OK] HTTPS local actif. Sur le telephone : installez le certificat CA
    echo        infra\tls\certs\narchi-CA-POUR-TELEPHONE.pem ^(dit a l'ecran^),
    echo        puis ouvrez https://ADRESSE_IP_DU_PC:8443
    echo Inverse complet : 9_RETIRER_HTTPS_LOCAL.bat
)
popd
pause
exit /b %RC%
