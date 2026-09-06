#!/usr/bin/env bash
# §133 — PREUVE de restauration des FICHIERS : extrait une archive dans un
# dossier JETABLE et compare le contenu (nombre de fichiers) au MANIFESTE
# d'export — pas au volume vivant (celui-ci bouge). Une sauvegarde jamais
# rejouée n'est qu'un espoir ; ici elle est éprouvée pour de vrai, sans
# toucher un seul octet de production.
#
# usage : verifier-fichiers.sh [fichier.tar.gz]   (défaut : la plus récente)
# codes : 0 = VERDICT OK (nombre de fichiers IDENTIQUE au manifeste) ·
#         66 = aucune archive/manifeste · 65 = archive corrompue ·
#         1 = extraction/comparaison en échec.
set -uo pipefail

OUT_DIR="${OUT_DIR:-/sauvegardes}"
TMPDIR_ROOT="${TMPDIR_ROOT:-/tmp/narchi-verif-fichiers}"

FILE="${1:-}"
if [ -z "${FILE}" ]; then
  FILE="$(ls -1t "${OUT_DIR}"/narchi-fichiers-*.tar.gz 2>/dev/null | head -n 1 || true)"
fi
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "ÉCHEC : aucune archive de fichiers trouvée dans ${OUT_DIR}." >&2
  exit 66
fi
META="${FILE}.meta.json"
if [ ! -f "${META}" ]; then
  echo "ÉCHEC : manifeste absent pour $(basename "${FILE}") — refaites un export." >&2
  exit 66
fi
EXP_F=$(grep -o '"fichiers":[0-9]*' "${META}" | cut -d: -f2)
case "${EXP_F:-}" in
  ""|*[!0-9]*) echo "ÉCHEC : manifeste illisible (« ${META} »)." >&2; exit 66 ;;
esac

# Intégrité : le tar doit se lister proprement (un gzip corrompu échoue ici).
if ! tar -tzf "${FILE}" >/dev/null 2>&1; then
  echo "VERDICT : CORROMPU — $(basename "${FILE}") n'est pas un tar.gz lisible. NE PAS compter dessus." >&2
  exit 65
fi

DEST="${TMPDIR_ROOT}/$(basename "${FILE}" .tar.gz)"
rm -rf "${DEST}" && mkdir -p "${DEST}"

echo "== Extraction de $(basename "${FILE}") dans « ${DEST} » (attendu : ${EXP_F} fichiers)…"
if ! tar -xzf "${FILE}" -C "${DEST}" 2>/dev/null; then
  echo "VERDICT : ÉCHEC — l'archive ne s'extrait pas proprement." >&2
  exit 1
fi

DST_F=$(find "${DEST}" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "${EXP_F}" = "${DST_F}" ]; then
  echo "VERDICT : OK — restauration complète, ${DST_F} fichiers IDENTIQUES au manifeste."
  rm -rf "${DEST}"
  exit 0
fi
echo "VERDICT : ÉCHEC — ${DST_F} fichiers restaurés, attendu ${EXP_F} (manifeste)." >&2
exit 1
