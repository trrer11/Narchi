#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §140 - Preuve de charge Locust (MIT) contre la stack REELLE de Narchi.
#
# Ce script NE S'EXECUTE PAS sans stack : il est PREPARE, pas encore joue
# (regle de la maison : on ne pretend pas avoir mesure ce qu'on n'a pas lance).
# Prerequis : la stack est demarree (chez le client : 1_DEMARRER_NARCHI.bat),
# puis :
#   cd loadtest && python -m venv .venv && .venv/bin/pip install locust
#   bash ../scripts/charge-locust.sh
#
# Seuils de NON-REGRESSION proposes (a ajuster apres la PREMIERE mesure reelle,
# jamais avant) : la « formule waw » cote serveur (estimation/quick) doit
# tenir p95 < 2 s pour 50 utilisateurs simultanes, ZERO erreur 5xx.
# ------------------------------------------------------------------------------
set -euo pipefail

HOST="${NARCHI_HOST:-http://localhost:8080}"
USERS="${NARCHI_USERS:-50}"
DURATION="${NARCHI_DURATION:-60s}"

cd "$(dirname "$0")/../loadtest"

echo "== Preuve de charge Locust (${USERS} utilisateurs, ${DURATION}) contre ${HOST} =="
echo "   (ceci n'est PAS un test unitaire : il mesure la VRAIE stack)"

exec .venv/bin/locust \
  --host "${HOST}" \
  --users "${USERS}" \
  --spawn-rate 5 \
  --run-time "${DURATION}" \
  --headless \
  --only-summary \
  -f locustfile.py
