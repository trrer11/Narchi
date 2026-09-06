# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# §51 — Image PostgreSQL NARCHI : pgvector (RAG dans PostgreSQL, remplace le
# serveur vectoriel externe) + pgBackRest (sauvegardes physiques quotidiennes).
#
# Base : pgvector/pgvector (postgres:16 officiel Debian + extension vector
# précompilée — projet open source, licence PostgreSQL/MIT).
# On y ajoute pgBackRest (package Debian bookworm) et cron, plus un
# entrypoint WRAPPER qui :
#   1. rend la config pgbackrest depuis le template (variables d'env) ;
#   2. démarre postgres via l'entrypoint officiel (PID 1) ;
#   3. en tâche de fond : attend que la base réponde, crée/vérifie la stanza
#      (idempotent), puis lance cron pour les sauvegardes planifiées.
# ATTENTION : image Debian (glibc). Un volume créé par postgres:16-alpine
# (musl) ne doit PAS être remonté tel quel (collations d'index différentes)
# — DEPLOY_PROD.ps1 migre automatiquement les données v6 → v7 par dump.
# ---------------------------------------------------------------------------
FROM pgvector/pgvector:0.8.6-pg16

# checkov:skip=CKV_DOCKER_8:ROOT requis à l'INIT (chown /var/lib/postgresql)
# — l'entrypoint officiel postgres bascule ensuite sur l'utilisateur « postgres »
# avant de lancer le serveur (drop de privilèges, pas d'exécution root du SGBD).
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest cron \
 && rm -rf /var/lib/apt/lists/*

COPY pgbackrest.conf.template /etc/pgbackrest/pgbackrest.conf.template
COPY render-pgbackrest-conf.sh /usr/local/bin/render-pgbackrest-conf.sh
COPY backup-job.sh /usr/local/bin/narchi-backup-job.sh
COPY backup-crontab /etc/cron.d/narchi-backup
COPY entrypoint-narchi-db.sh /usr/local/bin/entrypoint-narchi-db.sh

# /var/log/pgbackrest : requis par pgbackrest (log-path par défaut), sinon
# stanza-create échoue au premier démarrage.
RUN chmod 0644 /etc/cron.d/narchi-backup \
 && chmod 0755 /usr/local/bin/render-pgbackrest-conf.sh \
              /usr/local/bin/narchi-backup-job.sh \
              /usr/local/bin/entrypoint-narchi-db.sh \
 && mkdir -p /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/spool/pgbackrest /var/log/pgbackrest

ENTRYPOINT ["/usr/local/bin/entrypoint-narchi-db.sh"]
# archive_mode=on + archive-push continu → restauration point-in-time (PITR)
# possible entre deux sauvegardes planifiées. archive_timeout=300 borne la
# perte maximale de données à 5 minutes.
CMD ["postgres", "-c", "wal_level=replica", "-c", "archive_mode=on", "-c", "archive_timeout=300", "-c", "archive_command=pgbackrest --stanza=narchi archive-push %p"]
