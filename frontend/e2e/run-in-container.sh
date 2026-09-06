#!/bin/bash
# §194 — lanceur E2E DANS l'image Playwright (jamais parse par cmd.exe).
# ASCII only. Appele par scripts/TEST_E2E_DOCKER.bat.
set -u
cd /app
npm install --no-package-lock --no-audit --no-fund
chown -R pwuser:pwuser /app/node_modules
su pwuser -c "npx playwright test"
RC=$?
echo
echo "=== DETAILS ERREUR (error-context) ==="
if [ -d /app/test-results ]; then
  find /app/test-results -name error-context.md -print | while read -r f; do
    echo "----- $f -----"
    head -80 "$f"
  done
fi
exit "$RC"
