@echo off
REM NARCHI - optional KoSIT sidecar (official JAR). ASCII + CRLF.
REM Does NOT start Grafana. Does NOT send Peppol.
setlocal
cd /d "%~dp0"
title NARCHI - KoSIT sidecar

echo.
echo ============================================================
echo  NARCHI - KoSIT validator (optional profile)
echo ============================================================
echo.
echo  First run downloads the official JAR (SHA pinned).
echo  Then Rechnungen - KoSIT pruefen uses that JAR.
echo  Without this profile the button returns HTTP 503 (honest).
echo.

docker compose version >NUL 2>&1
if errorlevel 1 (
  echo [STOP] docker compose not found. Start Docker Desktop.
  pause
  exit /b 1
)

docker compose -f docker-compose.yml -f docker-compose.kosit.yml --profile kosit up -d --build
if errorlevel 1 (
  echo [STOP] compose failed.
  pause
  exit /b 1
)

echo.
echo Recreate backend so KOSIT_SIDECAR_URL=http://kosit:18080 is set.
docker compose -f docker-compose.yml -f docker-compose.kosit.yml up -d backend
echo.
echo Wait until http://127.0.0.1:18080/health shows ready=true
echo then open Rechnungen and click KoSIT pruefen.
echo.
pause
