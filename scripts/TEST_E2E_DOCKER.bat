@echo off
REM ============================================================================
REM NARCHI - Suite E2E Playwright, 100% DANS DOCKER
REM Version 9 (s197) : ASCII + CRLF.
REM Chromium mappe TOUT *.localhost vers 127.0.0.1 DU CONTENEUR
REM (narchi.localhost = ERR_CONNECTION_REFUSED, preuve run 7).
REM On utilise host.docker.internal (connexion prouvee run 5/6).
REM Cookie : cookie_adapter LOCAL_HOSTS inclut host.docker.internal
REM   -> il FAUT avoir reconstruit le backend (3_REPARER).
REM ============================================================================

setlocal
title NARCHI - Test E2E (Docker)

cd /d "%~dp0.."
set "FRONTEND=%CD%\frontend"

echo.
echo ============================================================
echo  NARCHI - Suite E2E dans Docker 5 volets
echo ============================================================
echo.

curl -s -o NUL http://localhost:8080/api/health
if errorlevel 1 (
  echo [ARRET] Aucune stack NARCHI joignable sur http://localhost:8080
  echo.
  echo   1. double-cliquez 1_DEMARRER_NARCHI.bat
  echo   2. attendez que http://localhost:8080 affiche la page de connexion
  echo   3. relancez ce script
  echo.
  pause
  exit /b 1
)

echo [OK] La stack NARCHI repond. Lancement des tests...
echo Premier lancement : telechargement des dependances, 2-4 min.
echo.
echo Si le message cookie / localhost apparait encore :
echo   3_REPARER_NARCHI_SANS_PERTE.bat   puis ce script.
echo.

if not exist "%FRONTEND%\e2e\run-in-container.sh" (
  echo [ARRET] Fichier manquant : frontend\e2e\run-in-container.sh
  pause
  exit /b 1
)

docker run --rm --ipc=host ^
  --add-host=host.docker.internal:host-gateway ^
  -v "%FRONTEND%:/app" ^
  -v narchi-e2e-node_modules:/app/node_modules ^
  -w /app ^
  -e E2E_BASE_URL=http://host.docker.internal:8080 ^
  --user 0 ^
  mcr.microsoft.com/playwright:v1.61.1-jammy ^
  bash -c "sed -i 's/\r$//' /app/e2e/run-in-container.sh; bash /app/e2e/run-in-container.sh"

set "CODE=%errorlevel%"

echo.
echo ============================================================
if "%CODE%"=="0" (
  echo  [SUCCES] Les 5 volets sont passes : 5 lignes VERTES passed.
  echo          Tout fonctionne.
) else (
  echo  [ECHEC] Code de sortie = %CODE%
  echo          Un test est ROUGE. Copiez la ligne failed + le message
  echo          d'erreur juste en dessous, et montrez-les-moi.
)
echo ============================================================
echo.
echo Nettoyage optionnel :
echo   docker volume rm narchi-e2e-node_modules
echo   docker rmi mcr.microsoft.com/playwright:v1.61.1-jammy
echo.
pause
endlocal
