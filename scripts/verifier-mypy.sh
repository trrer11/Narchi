#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §147 - Typage statique mypy (MIT) sur le CŒUR MÉTIER MONÉTAIRE.
#
# Gate SÉPARÉ (lent, comme l'E2E §121) — jamais dans la suite normale. Vérifie
# en mode STRICT les 6 fichiers monétaires (§114 xrechnung, §130 ubl, §131
# versand, §145 money + offer_compare/lv_positions). Le typage de TOUT le
# backend est une dette héritée (chantier dédié, dit dans le CHANGELOG).
#
# POURQUOI un par un : passés TOUS ensemble, mypy remonte la chaîne d'imports
# app.* et devient pathologique. POURQUOI --no-incremental : le cache
# incrémental .mypy_cache sature la RAM du sandbox (processus zombie ~1 Go
# observé §147) — on désactive le cache, reproductible partout.
# Résultat strict : 0 erreur sur les 6 (mesuré).
#
# Usage :   bash scripts/verifier-mypy.sh
# Prerequis : mypy==1.19.1 (dans requirements-dev.txt).
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../backend"

FICHIERS=(
  app/services/money.py
  app/services/xrechnung.py
  app/services/ubl.py
  app/services/versand.py
  app/services/offer_compare.py
  app/services/lv_positions.py
)

echo "== mypy strict sur le cœur monétaire (${#FICHIERS[@]} fichiers, un par un) =="
for f in "${FICHIERS[@]}"; do
  echo "-- ${f}"
  mypy \
    --no-incremental \
    --explicit-package-bases \
    --ignore-missing-imports \
    --follow-imports=skip \
    --strict \
    "${f}"
done
echo "OK - ${#FICHIERS[@]} fichiers monétaires : typage strict, 0 erreur."
