#!/usr/bin/env bash
# §51 — Entrypoint composite : postgres officiel + initialisation pgBackRest
# + cron de sauvegarde. Postgres reste PID 1 via l'entrypoint officiel ;
# stanza-create est idempotent (une stanza existante est seulement vérifiée)
# et retenté en boucle : un échec transitoire ne casse jamais le boot.
set -Eeuo pipefail

: "${POSTGRES_USER:=narchi}"
: "${POSTGRES_DB:=narchi_v3}"

# 1) Rendu de la config pgBackRest (mutualisé avec le script de restauration).
render-pgbackrest-conf.sh
chown -R postgres:postgres /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest

# 2) En tâche de fond : attendre la base, créer/vérifier la stanza, puis
#    démarrer cron (planification : /etc/cron.d/narchi-backup).
(
  for _ in $(seq 1 90); do
    if pg_isready -h 127.0.0.1 -p 5432 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  stanza_ready=0
  for _ in $(seq 1 6); do
    if su -s /bin/bash postgres -c "pgbackrest --stanza=narchi stanza-create" >/dev/null 2>&1; then
      stanza_ready=1
      break
    fi
    sleep 5
  done
  if [ "${stanza_ready}" = "1" ]; then
    echo "[backup] stanza « narchi » prête (créée ou vérifiée)"
  else
    # Jamais bloquant : postgres fonctionne ; le prochain démarrage retentera
    # et le planificateur échouera de façon visible dans last_backup.json.
    echo "[backup] ATTENTION : stanza « narchi » non initialisée — sauvegardes en échec visible" >&2
  fi

  if [ "${NARCHI_BACKUP_CRON_ENABLED:-true}" = "true" ]; then
    cron
    echo "[backup] cron actif (plein dim. 03:30, incr. lun.-sam. 03:30, TZ=${TZ:-UTC})"
  fi
) &

# 3) Délègue à l'entrypoint postgres officiel (PID 1 = postgres).
exec docker-entrypoint.sh "$@"
