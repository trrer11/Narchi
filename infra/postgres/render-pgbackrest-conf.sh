#!/usr/bin/env bash
# §51 — Rend la configuration pgBackRest depuis le template (paramétrable par
# les variables d'environnement officielles postgres du conteneur).
# Appelé par l'entrypoint au démarrage ET par le script de restauration
# (RESTORE_NARCHI_DB.ps1) qui lance un conteneur one-shot sans entrypoint.
set -Eeuo pipefail

: "${POSTGRES_USER:=narchi}"
: "${POSTGRES_DB:=narchi_v3}"

sed -e "s|__POSTGRES_USER__|${POSTGRES_USER}|g" \
    -e "s|__POSTGRES_DB__|${POSTGRES_DB}|g" \
    /etc/pgbackrest/pgbackrest.conf.template > /etc/pgbackrest/pgbackrest.conf
chmod 0644 /etc/pgbackrest/pgbackrest.conf
