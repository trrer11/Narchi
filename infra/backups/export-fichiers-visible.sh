#!/usr/bin/env bash
# §133 — Export VISIBLE des FICHIERS (photos/vidéos de chantier) — copie
# externe « parachute », complément de l'export base §113.
#
# Pourquoi ce script existe : l'export §113 sauvegarde la BASE (pg_dump),
# mais PAS le volume `narchi_storage` — les photos/vidéos de la Baustelle
# (§118) vivent là, HORS de la base. Un bureau qui restaure sa base mais
# perd le volume perd toutes ses preuves de chantier. Ce script archive
# le contenu du volume dans le MÊME dossier ./sauvegardes visible.
#
# Philosophie identique au §113/§51 : manifeste du contenu EXACT au moment
# de l'export (nombre de fichiers + dossiers), vérification d'intégrité du
# tar AVANT de déclarer la copie bonne, statut de vérité atomique après
# CHAQUE tentative (jamais un « sauvegardé » muet), rotation.
#
# Surchargeable par variables d'environnement (c'est ainsi que le script
# est TESTÉ hors Docker, sur un vrai dossier) :
#   STORAGE_DIR OUT_DIR KEEP MIN_BYTES
set -uo pipefail

STORAGE_DIR="${STORAGE_DIR:-/app/storage}"
OUT_DIR="${OUT_DIR:-/sauvegardes}"
KEEP="${KEEP:-60}"             # copies conservées (≈ 15 mois à 1/sem.)
MIN_BYTES="${MIN_BYTES:-512}"  # une archive réelle ne fait JAMAIS < 512 o

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${OUT_DIR}/narchi-fichiers-${STAMP}.tar.gz"
META="${FILE}.meta.json"
TMP_FILE="${FILE}.part"
STATUS="${OUT_DIR}/dernier_export_fichiers.json"
STATUS_TMP="${STATUS}.tmp"

write_status () { # $1=exit_code $2=fichier $3=octets_gz $4=nb_fichiers $5=nb_dossiers
  printf '{"type":"export-fichiers","fichier":"%s","octets_gz":%s,"fichiers":%s,"dossiers":%s,"fin_utc":"%s","exit_code":%d}\n' \
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

if [ ! -d "${STORAGE_DIR}" ]; then
  # Volume absent = rien à sauvegarder : ce n'est PAS un échec (un bureau
  # sans médias n'a pas de volume), mais on le DIT dans le statut.
  write_status 0 "" 0 0 0
  echo "INFO : volume « ${STORAGE_DIR} » absent — aucun fichier à exporter."
  exit 0
fi

echo "== Export des fichiers de « ${STORAGE_DIR} » → ${FILE}"

# 1) Mesure du contenu AVANT l'archive : nombre de fichiers (comptage EXACT)
#    et nombre de dossiers (sous-arborescence, structure §118 par bureau).
FICHIERS=$(find "${STORAGE_DIR}" -type f 2>/dev/null | wc -l | tr -d ' ')
DOSSIERS=$(find "${STORAGE_DIR}" -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

# 2) Archive tar.gz atomique (flux unique, pas d'intermédiaire géant).
tar -czf "${TMP_FILE}" -C "${STORAGE_DIR}" . 2>/dev/null
rc=$?
if [ "${rc}" -ne 0 ]; then
  fail "${rc}" "ÉCHEC tar (code ${rc}) — rien n'est publié."
fi

# 3) Épreuve d'intégrité AVANT de déclarer la copie bonne :
#    le tar doit se LISTER proprement et contenir EXACTEMENT le nombre de
#    fichiers mesuré à l'étape 1 (un tar tronqué en contiendrait moins).
LISTE=$(tar -tzf "${TMP_FILE}" 2>/dev/null) \
  || fail 65 "ÉCHEC intégrité : le tar.gz est illisible — copie écartée."
DANS_TAR=$(printf '%s\n' "${LISTE}" | sed '/^$/d' | wc -l | tr -d ' ')
# un tar.gz d'un dossier NON VIDE contient au moins les entrées « ./ » : on
# compare les FICHIERS (entrées sans « / » final), pas les répertoires.
DANS_TAR_FICHIERS=$(printf '%s\n' "${LISTE}" | grep -v '/$' | wc -l | tr -d ' ')
BYTES_GZ=$(wc -c <"${TMP_FILE}" | tr -d ' ')
if [ "${BYTES_GZ}" -lt "${MIN_BYTES}" ]; then
  fail 65 "ÉCHEC intégrité : ${BYTES_GZ} octets (< ${MIN_BYTES}) — archive suspecte, copie écartée."
fi
if [ "${DANS_TAR_FICHIERS}" -ne "${FICHIERS}" ]; then
  fail 65 "ÉCHEC intégrité : le tar contient ${DANS_TAR_FICHIERS} fichiers, attendu ${FICHIERS} — copie écartée."
fi

printf '{"fichiers":%s,"dossiers":%s,"exporte_utc":"%s"}\n' \
  "${FICHIERS}" "${DOSSIERS}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${META}"
mv "${TMP_FILE}" "${FILE}"

# 4) Rotation : on garde les KEEP plus récentes (+ leur manifeste).
count="$(ls -1t "${OUT_DIR}"/narchi-fichiers-*.tar.gz 2>/dev/null | wc -l)"
removed=0
if [ "${count}" -gt "${KEEP}" ]; then
  removed=$((count - KEEP))
  ls -1t "${OUT_DIR}"/narchi-fichiers-*.tar.gz | tail -n "+$((KEEP + 1))" \
    | while read -r old; do rm -f "${old}" "${old}.meta.json"; done
fi

write_status 0 "$(basename "${FILE}")" "${BYTES_GZ}" "${FICHIERS}" "${DOSSIERS}"
echo "OK : ${FILE} (${BYTES_GZ} octets compressés, ${FICHIERS} fichiers, ${DOSSIERS} dossiers) · ${count} présentes, ${removed} anciennes supprimées (garde ${KEEP})."
echo "INFO : cette copie est sur LE MÊME DISQUE que les données — copiez le dossier sauvegardes sur une clé USB / autre PC."
exit 0
