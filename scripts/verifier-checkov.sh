#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §143 - Scan IaC Checkov (Apache-2.0) des Dockerfiles Narchi.
#
# Verifie les Dockerfiles (backend, frontend, infra/postgres, monorepo) contre
# les bonnes pratiques de securite conteneur. exit 1 si un finding FAILED.
#
# Skips DOCUMENTES (pas masques) :
#   - CKV_DOCKER_2 (HEALTHCHECK) : les healthchecks sont declares au niveau
#     docker-compose.yml (services db/backend/redis/...), pas dans les images
#     de base (postgres/nginx n'ont pas curl) — design assume, dit ici.
#   - CKV_DOCKER_8 (USER root) sur infra/postgres : skip INLINE dans le
#     Dockerfile lui-meme (root requis a l'init, drop ensuite sur postgres).
#
# Usage :   bash scripts/verifier-checkov.sh
# Prerequis : checkov (pip install checkov) ou l'image bridgecrew/checkov.
# ------------------------------------------------------------------------------
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Scan Checkov des Dockerfiles =="
if command -v checkov >/dev/null 2>&1; then
  checkov --directory "${REPO}" --framework dockerfile --skip-check CKV_DOCKER_2
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "${REPO}:/src:ro" bridgecrew/checkov \
    --directory /src --framework dockerfile --skip-check CKV_DOCKER_2
else
  echo "EChec: checkov (ou docker) est requis." >&2
  exit 2
fi
