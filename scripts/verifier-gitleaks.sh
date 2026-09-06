#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §141 - Verrou « jamais de secret versionné » : scan gitleaks du dépôt.
#
# Telecharge le binaire gitleaks (MIT) EPINGLE par SHA-256, puis scanne le
# dépôt (sans git) avec la config .gitleaks.toml (allowlists documentees).
# Sortie : exit 0 = aucun secret reel ; exit 1 = au moins un finding
# (lire le rapport JSON).
#
# Usage :   bash scripts/verifier-gitleaks.sh
# Attendu : « no leaks found », exit 0. Tout finding = exit 1 + rapport.
#
# Prerequis : curl, sha256sum, tar (Linux x64). Windows client : Git Bash/WSL.
# ------------------------------------------------------------------------------
set -euo pipefail

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
GITLEAKS_URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${GITLEAKS_CACHE:-${TMPDIR:-/tmp}/narchi-gitleaks}"
BIN="${CACHE}/gitleaks"

mkdir -p "${CACHE}"

if [ ! -x "${BIN}" ]; then
  echo ">> telechargement gitleaks v${GITLEAKS_VERSION} (SHA-256 epingle)"
  curl -fsSL --max-time 300 -o "${CACHE}/gitleaks.tar.gz" "${GITLEAKS_URL}"
  mesure="$(sha256sum "${CACHE}/gitleaks.tar.gz" | awk '{print $1}')"
  [ "${mesure}" = "${GITLEAKS_SHA256}" ] || {
    echo "EChec: empreinte differente ${mesure} (attendu ${GITLEAKS_SHA256})" >&2
    exit 1
  }
  tar xzf "${CACHE}/gitleaks.tar.gz" -C "${CACHE}" gitleaks
  chmod +x "${BIN}"
  echo "   empreinte OK"
fi

RAPPORT="${CACHE}/rapport.json"
echo "== Scan gitleaks du dépôt (config .gitleaks.toml) =="
set +e
"${BIN}" detect --source "${REPO}" --no-git --config "${REPO}/.gitleaks.toml" \
  --report-format json --report-path "${RAPPORT}" --exit-code 0 2>&1
set -e

NB="$(python3 -c "import json;print(len(json.load(open('${RAPPORT}'))))" 2>/dev/null || echo 0)"
if [ "${NB}" -gt 0 ]; then
  echo "EChec: ${NB} secret(s) potentiel(s) détecté(s) — rapport: ${RAPPORT}" >&2
  python3 -c "
import json
for f in json.load(open('${RAPPORT}')):
    print(f\"  [{f['RuleID']}] {f['File']}:{f['StartLine']} → {str(f['Secret'])[:60]}\")
"
  exit 1
fi
echo "OK - aucun secret versionné (gitleaks v${GITLEAKS_VERSION})."
exit 0
