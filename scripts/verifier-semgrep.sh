#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §142 - Scan Semgrep (LGPL-2.1) des regles MAISON Narchi (§60).
#
# Execute les regles semgrep/narchi-rules.yml sur frontend/src + backend/app.
# Comportement : exit 1 si un finding ERROR (ex. narchi-no-dangerously-set-
# inner-html) apparait ; les WARNING (x-forwarded-for audit, float a trier)
# sont AFFICHES mais ne font pas echouer (severites semgrep standard).
#
# Usage :   bash scripts/verifier-semgrep.sh
# Prerequis : semgrep installe (pip install semgrep), ou l'image Docker
#             returntocorp/semgrep (alternative sans Python).
# ------------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
RULES="${REPO}/semgrep/narchi-rules.yml"

echo "== Scan Semgrep (regles maison narchi-rules.yml) =="
if command -v semgrep >/dev/null 2>&1; then
  semgrep --config "${RULES}" "${REPO}/frontend/src" "${REPO}/backend/app"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${REPO}:/src:ro" -v "${RULES}:/rules.yml:ro" \
    returntocorp/semgrep semgrep --config /rules.yml /src/frontend/src /src/backend/app
else
  echo "EChec: semgrep (ou docker) est requis." >&2
  exit 2
fi
