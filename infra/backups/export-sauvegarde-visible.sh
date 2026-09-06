#!/usr/bin/env bash
# §113 — Export VISIBLE de la base (copie externe « parachute »).
#
# Pourquoi ce script existe alors que pgBackRest (§51) sauvegarde déjà
# chaque nuit : les archives pgBackRest vivent DANS un volume Docker
# nommé (pgbackrest_v1_data) — invisibles dans l'Explorateur Windows,
# impossibles à copier sur une clé USB, et DÉTRUITES en même temps que
# la base si le disque lâche ou si un « docker compose down -v » part.
# Une sauvegarde sur le même support que les données n'est PAS une
# sauvegarde. Ce script pose une copie LOGIQUE (pg_dump | gzip) dans le
# dossier ./sauvegardes que le client VOIT et peut copier ailleurs.
#
# À côté de chaque .sql.gz, un manifeste .meta.json note le contenu
# EXACT au moment de l'export (tables + total de lignes, comptage
# exact) : verifier-restauration.sh s'y réfère — la preuve ne dépend
# donc JAMAIS d'une comparaison avec une base vivante qui bouge.
#
# Philosophie identique au §51 : après CHAQUE tentative (succès ou
# échec), un dernier_export.json de vérité est écrit de façon atomique —
# jamais un « sauvegardé » muet si quelque chose a planté.
#
# Surchargeable par variables d'environnement (c'est ainsi que le script
# est TESTÉ hors Docker, sur un vrai PostgreSQL) :
#   PGHOST PGPORT PGSUPERUSER PGDATABASE OUT_DIR KEEP MIN_BYTES
set -uo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGSUPERUSER="${PGSUPERUSER:-postgres}"
PGDATABASE="${PGDATABASE:-narchi_v3}"
OUT_DIR="${OUT_DIR:-/sauvegardes}"
KEEP="${KEEP:-60}"            # copies conservées (≈ 15 mois à 1/sem.)
MIN_BYTES="${MIN_BYTES:-1024}" # un dump réel ne fait JAMAIS < 1 Ko

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${OUT_DIR}/narchi-${STAMP}.sql.gz"
META="${FILE}.meta.json"
TMP_FILE="${FILE}.part"
STATUS="${OUT_DIR}/dernier_export.json"
STATUS_TMP="${STATUS}.tmp"

PSQL_SRC="psql -h ${PGHOST} -p ${PGPORT} -U ${PGSUPERUSER} -d ${PGDATABASE} -At -v ON_ERROR_STOP=1"

write_status () { # $1=exit_code $2=fichier $3=octets $4=tables $5=lignes
  printf '{"type":"export-logique","fichier":"%s","octets":%s,"tables":%s,"lignes":%s,"fin_utc":"%s","exit_code":%d}\n' \
    "$2" "$3" "$4" "$5" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >"${STATUS_TMP}" \
    && mv "${STATUS_TMP}" "${STATUS}"
}

fail () { # $1=code $2=message
  echo "$2" >&2
  rm -f "${TMP_FILE}" "${META}"
  write_status "$1" "" 0 0 0
  exit "$1"
}

mkdir -p "${OUT_DIR}"
echo "== Export de « ${PGDATABASE} » (${PGHOST}:${PGPORT}) → ${FILE}"

# 1) Mesure du contenu AVANT le dump (comptage EXACT, pas une estimation
#    de statistiques) : ce manifeste sera la référence de la preuve.
TABLES=$(${PSQL_SRC} -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") \
  || fail 1 "ÉCHEC : base source illisible."
ROWS=$(${PSQL_SRC} -c \
  "SELECT coalesce(sum(c),0) FROM (SELECT (xpath('/row/cnt/text()', query_to_xml( \
   format('select count(*) as cnt from %I.%I', schemaname, tablename), false, true, '')) \
   )[1]::text::bigint AS c FROM pg_tables WHERE schemaname='public') s") \
  || fail 1 "ÉCHEC : comptage des lignes impossible."

# 2) Dump logique complet, routé via gzip (un seul flux, pas de .sql
#    intermédiaire géant). plain + no-owner = restaurable sur n'importe
#    quel PostgreSQL ≥ version source, sans pgBackRest.
pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGSUPERUSER}" -d "${PGDATABASE}" \
  --format=plain --no-owner --no-privileges --quote-all-identifiers \
  | gzip -9 >"${TMP_FILE}"
rc=${PIPESTATUS[0]}
if [ "${rc}" -ne 0 ]; then
  fail "${rc}" "ÉCHEC pg_dump (code ${rc}) — rien n'est publié."
fi

# 3) Épreuve d'intégrité AVANT de déclarer la copie bonne : gzip lisible
#    + première ligne = en-tête d'un dump PostgreSQL + taille plausible.
if ! gzip -t "${TMP_FILE}" 2>/dev/null; then
  fail 65 "ÉCHEC intégrité : le gzip est corrompu — copie écartée."
fi
# bannière « PostgreSQL database dump » = ligne 2 d'un dump réel
# (ligne 1 = « -- ») : 1er jet du contrôle la cherchait en ligne 1 et
# écartait un dump VALIDE — attrapé par le test réel, corrigé (head -n 3).
BANNER="$(zcat "${TMP_FILE}" 2>/dev/null | head -n 3 || true)"
case "${BANNER}" in
  *"PostgreSQL database dump"*) ;;
  *) fail 65 "ÉCHEC intégrité : bannière PostgreSQL absente — copie écartée." ;;
esac
BYTES=$(stat -c %s "${TMP_FILE}" 2>/dev/null || wc -c <"${TMP_FILE}")
if [ "${BYTES}" -lt "${MIN_BYTES}" ]; then
  fail 65 "ÉCHEC intégrité : ${BYTES} octets (< ${MIN_BYTES}) — dump suspect, copie écartée."
fi

printf '{"tables":%s,"lignes":%s,"exporte_utc":"%s"}\n' \
  "${TABLES}" "${ROWS}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${META}"
mv "${TMP_FILE}" "${FILE}"

# 4) Rotation : on garde les KEEP plus récentes (+ leur manifeste), le
#    reste part.
count="$(ls -1t "${OUT_DIR}"/narchi-*.sql.gz 2>/dev/null | wc -l)"
removed=0
if [ "${count}" -gt "${KEEP}" ]; then
  removed=$((count - KEEP))
  ls -1t "${OUT_DIR}"/narchi-*.sql.gz | tail -n "+$((KEEP + 1))" \
    | while read -r old; do rm -f "${old}" "${old}.meta.json"; done
fi

write_status 0 "$(basename "${FILE}")" "${BYTES}" "${TABLES}" "${ROWS}"
echo "OK : ${FILE} (${BYTES} octets, ${TABLES} tables, ${ROWS} lignes) · ${count} présentes, ${removed} anciennes supprimées (garde ${KEEP})."
echo "INFO : cette copie est sur LE MÊME DISQUE que la base — copiez le dossier sauvegardes sur une clé USB / autre PC."
exit 0
