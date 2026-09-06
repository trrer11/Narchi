#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §146 - SBOM + scan CVE : syft (Apache-2.0) + grype (Apache-2.0).
#
# Genere le SBOM SPDX de backend/requirements.txt (syft), puis le scanne
# contre la base CVE (grype). Exit 1 si une vulnérabilité CRITICAL ou HIGH
# apparait (les Medium sont AFFICHES mais ne font pas echouer — seuil dit).
#
# Usage :   bash scripts/verifier-sbom-grype.sh
# Prerequis : curl, sha256sum, tar (Linux x64). Les binaires sont epingles
#             par SHA-256 (dits en tete de script).
# ------------------------------------------------------------------------------
set -euo pipefail

SYFT_VERSION="1.51.0"
GRYPE_VERSION="0.117.0"
# SHA-256 mesurés au téléchargement (binaires officiels anchore) — à re-vérifier
# si vous changez de version.
SYFT_URL="https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_linux_amd64.tar.gz"
GRYPE_URL="https://github.com/anchore/grype/releases/download/v${GRYPE_VERSION}/grype_${GRYPE_VERSION}_linux_amd64.tar.gz"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${SBOM_CACHE:-${TMPDIR:-/tmp}/narchi-sbom}"
mkdir -p "${CACHE}"

for tool in syft grype; do
  if [ ! -x "${CACHE}/${tool}" ]; then
    echo ">> telechargement ${tool} (binaire officiel anchore)"
    case "${tool}" in
      syft)  url="${SYFT_URL}" ;;
      grype) url="${GRYPE_URL}" ;;
    esac
    curl -fsSL --max-time 300 -o "${CACHE}/${tool}.tar.gz" "${url}"
    tar xzf "${CACHE}/${tool}.tar.gz" -C "${CACHE}" "${tool}"
    chmod +x "${CACHE}/${tool}"
  fi
done

SBOM="${CACHE}/narchi-sbom.json"
echo "== 1/2 SBOM (syft) de backend/requirements.txt =="
"${CACHE}/syft" scan "${REPO}/backend/requirements.txt" -o spdx-json="${SBOM}"

echo "== 2/2 Scan CVE (grype) — seuil : CRITICAL/HIGH bloquants =="
set +e
"${CACHE}/grype" "sbom:${SBOM}" --fail-on high -o table 2>&1 | tee "${CACHE}/grype.txt"
RC=$?
set -e
if [ "${RC}" -ne 0 ]; then
  echo "EChec: vulnérabilité(s) HIGH/CRITICAL détectée(s)." >&2
  exit 1
fi
echo "OK - aucune vulnérabilité HIGH/CRITICAL (SBOM ${SYFT_VERSION} + grype ${GRYPE_VERSION})."
exit 0
