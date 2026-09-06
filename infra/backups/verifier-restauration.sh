#!/usr/bin/env bash
# §113 — PREUVE de restauration : rejoue une sauvegarde dans une base
# JETABLE et compare le contenu restauré au MANIFESTE d'export (tables
# + lignes exactes)... pas à la base vivante — celle-ci bouge en
# permanence, comparer à elle donnerait des faux « ÉCHEC ».
# Une sauvegarde jamais rejouée n'est qu'un espoir — ici elle est
# éprouvée pour de vrai, sans toucher une seule ligne de production.
#
# usage : verifier-restauration.sh [fichier.sql.gz]   (défaut : la plus récente)
# codes : 0 = VERDICT OK (contenu IDENTIQUE au manifeste) ·
#         66 = aucune sauvegarde/manifeste · 65 = archive corrompue ·
#         1 = restauration/comparaison en échec.
set -uo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGSUPERUSER="${PGSUPERUSER:-postgres}"
OUT_DIR="${OUT_DIR:-/sauvegardes}"
TMPDB="${TMPDB:-_narchi_verif_restauration}"

FILE="${1:-}"
if [ -z "${FILE}" ]; then
  FILE="$(ls -1t "${OUT_DIR}"/narchi-*.sql.gz 2>/dev/null | head -n 1 || true)"
fi
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "ÉCHEC : aucune sauvegarde trouvée dans ${OUT_DIR}." >&2
  exit 66
fi
META="${FILE}.meta.json"
if [ ! -f "${META}" ]; then
  echo "ÉCHEC : manifeste absent pour $(basename "${FILE}") — refaites un export (5_)." >&2
  exit 66
fi
# Lecture du manifeste (JSON simple écrit par nous, un « nombre: nombre »
# par ligne pseudo-clé — extraction volontairement sans jq).
EXP_T=$(grep -o '"tables":[0-9]*' "${META}" | cut -d: -f2)
EXP_R=$(grep -o '"lignes":[0-9]*' "${META}" | cut -d: -f2)
case "${EXP_T:-}${EXP_R:-}" in
  ""|*[!0-9|]*) echo "ÉCHEC : manifeste illisible (« ${META} »)." >&2; exit 66 ;;
esac

ADMIN="psql -h ${PGHOST} -p ${PGPORT} -U ${PGSUPERUSER} -d postgres -At -v ON_ERROR_STOP=1"
START_TS=$(date +%s)

cleanup () {
  psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d postgres -qAt \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TMPDB}'" >/dev/null 2>&1 || true
  psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d postgres -qc \
    "DROP DATABASE IF EXISTS \"${TMPDB}\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! gzip -t "${FILE}" 2>/dev/null; then
  echo "VERDICT : CORROMPU — $(basename "${FILE}") n'est pas un gzip lisible. NE PAS compter dessus." >&2
  exit 65
fi

echo "== Restauration de $(basename "${FILE}") dans la base jetable « ${TMPDB} » (attendu : ${EXP_T} tables, ${EXP_R} lignes)…"
${ADMIN} -c "DROP DATABASE IF EXISTS \"${TMPDB}\"" >/dev/null
if ! ${ADMIN} -c "CREATE DATABASE \"${TMPDB}\"" >/dev/null; then
  echo "ÉCHEC : impossible de créer la base jetable." >&2
  exit 1
fi
if ! zcat "${FILE}" | psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d "${TMPDB}" -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  echo "VERDICT : ÉCHEC — le dump ne se REJOUE pas proprement (psql en erreur)." >&2
  exit 1
fi

DST_T=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d "${TMPDB}" -At \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") \
  || { echo "ÉCHEC : base restaurée illisible." >&2; exit 1; }
DST_R=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d "${TMPDB}" -At -c \
  "SELECT coalesce(sum(c),0) FROM (SELECT (xpath('/row/cnt/text()', query_to_xml( \
   format('select count(*) as cnt from %I.%I', schemaname, tablename), false, true, '')) \
   )[1]::text::bigint AS c FROM pg_tables WHERE schemaname='public') s") \
  || { echo "ÉCHEC : comptage restauré impossible." >&2; exit 1; }
DUREE=$(( $(date +%s) - START_TS ))

if [ "${EXP_T}" = "${DST_T}" ] && [ "${EXP_R}" = "${DST_R}" ] && [ "${EXP_T}" != "0" ]; then
  echo "VERDICT : OK — restauration complète et contenu IDENTIQUE au manifeste (${DST_T} tables, ${DST_R} lignes, ${DUREE}s)."
  exit 0
fi
echo "VERDICT : ÉCHEC — restauré ${DST_T} tables / ${DST_R} lignes, attendu ${EXP_T} / ${EXP_R}. Copie douteuse." >&2
exit 1
