#!/usr/bin/env bash
# §51 — Tâche de sauvegarde planifiée (appelée par cron) ou manuelle
# (scripts/BACKUP_NARCHI_NOW). Écrit /var/lib/pgbackrest/last_backup.json
# après CHAQUE tentative, succès ou échec : le diagnostic backend le lit et
# l'affiche tel quel — jamais un « sauvegardé » muet si la tâche a planté.
set -uo pipefail

TYPE="${1:-}"
case "${TYPE}" in
  full|incr) ;;
  *) echo "usage: narchi-backup-job.sh <full|incr>" >&2; exit 64 ;;
esac

STANZA="narchi"
OUT="/var/lib/pgbackrest/last_backup.json"
TMP_OUT="${OUT}.tmp"

pgbackrest "--stanza=${STANZA}" --type="${TYPE}" backup
rc=$?

# Écriture atomique (renomme) : un lecteur ne voit jamais un JSON tronqué.
printf '{"stanza":"%s","type":"%s","finished_at":"%s","exit_code":%d}\n' \
  "${STANZA}" "${TYPE}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${rc}" >"${TMP_OUT}" \
  && mv "${TMP_OUT}" "${OUT}"

exit ${rc}
