# Outils « stack hébergée » — PRÉPARÉS, non exécutés (P2 + DAST)

> Document d'analyse (fr). Écrit le 16/08/2026 (§148), suite du
> `docs/OUTILS_OPEN_SOURCE_ELEVATION.md` §5. Ces outils exigent une **stack
> démarrée** (Docker + les services NARCHI) — impossible à exécuter dans le
> sandbox. Tout ici est **PRÉPARÉ** (snippets compose + scripts exacts),
> jamais prétendu « livré ». À activer dès que le client a une stack beta
> (son PC, ou un VPS Hetzner selon `docs/BETA_TEST_GUIDE.md`).

---

## 1. OWASP ZAP (DAST) — Apache-2.0

Scan dynamique de l'API tournante (injection, en-têtes de sécurité, CORS).
**Honnête : un scan automatique ≠ un pentest humain** (le rapport §120 garde
le pentest externe en INCONNU assumé).

```bash
# Sur la machine où la stack tourne (http://localhost:8080) :
docker run --rm -v "$(pwd)/zap-reports:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://localhost:8080 -r zap-baseline.html
# Verdict : exit 1 si des alertes HIGH/CRITICAL ; le rapport HTML est
# consultable dans ./zap-reports/zap-baseline.html.
```

Ce que ça couvre : OWASP Top 10 (injection, XSS, broken auth, misconfig
sécurité). À lancer en gate séparé, PAS dans la suite normale (nécessite la
stack + ~10 min).

---

## 2. VictoriaLogs (logs centralisés) — Apache-2.0

Les logs NARCHI sont aujourd'hui en `json-file` par conteneur (illisibles à
distance). VictoriaLogs les agrège. **Loki est AGPL-3.0 → on préfère
l'alternative permissive** (cohérent avec la doctrine §114).

```yaml
# docker-compose.yml — service à ajouter :
  victorialogs:
    image: victoriametrics/victoria-logs:v1.20.0-victorialogs
    restart: unless-stopped
    expose: ["9428"]
    volumes:
      - victorialogs_v5_data:/victoria-logs-data
    command: ["-storageDataPath=/victoria-logs-data", "-httpListenAddr=:9428"]

# volumes: (ajouter en bas)
  victorialogs_v5_data:
```

Chaque service NARCHI envoie alors ses logs via le driver `fluentd` ou un
sidecar Vector — étape de câblage documentée ici, pas encore faite (le choix
du collector fait partie du chantier « monitoring » du rapport §120, ops 50 %).

---

## 3. Uptime Kuma (heartbeat + alertes) — MIT

« Je ne savais pas que c'était down » — le moniteur qui alerte le bureau.

```yaml
# docker-compose.yml — service à ajouter :
  uptime-kuma:
    image: louislam/uptime-kuma:1.23.16
    restart: unless-stopped
    expose: ["3001"]
    volumes:
      - uptime_kuma_v5_data:/app/data

# volumes:
  uptime_kuma_v5_data:
```

Puis, dans l'UI (http://localhost:3001) : un monitor HTTP
`http://localhost:8080/health` (le endpoint de santé backend existe déjà) +
un monitor `http://localhost:8080/` (le frontend), avec alerte e-mail/Webhook.
Durée : 10 minutes, zéro code.

---

## 4. pgBadger (analyse des logs PostgreSQL) — licence PostgreSQL

Rapporte les requêtes lentes, erreurs, checkpoints depuis les logs PG — SANS
connexion à la base vivante (sûr en production).

```bash
# Script rejouable (scripts/verifier-pgbadger.sh à créer) — une fois la
# stack démarrée :
docker compose exec -T db bash -c \
  "pgbadger /var/log/postgresql/postgresql-*.log -o /sauvegardes/pgbadger-report.html"
# Le rapport HTML apparaît dans ./sauvegardes/pgbadger-report.html
```

Prérequis : activer `log_min_duration_statement` dans la config PG (§51 déjà
paramètre `wal_level`/`archive_mode` ; ajouter le logging des requêtes lentes).

---

## État d'ensemble (honnête)

| Outil | Licence | État |
|---|---|---|
| ZAP (DAST) | Apache-2.0 | PRÉPARÉ (commande exacte), exige stack + ~10 min |
| VictoriaLogs | Apache-2.0 | PRÉPARÉ (snippet compose), câblage collector à décider |
| Uptime Kuma | MIT | PRÉPARÉ (snippet compose), 10 min de config UI |
| pgBadger | licence PostgreSQL | PRÉPARÉ (commande exacte), exige activation logging |

**Aucun de ces 4 outils n'a été exécuté** — le sandbox n'a pas de stack.
C'est le lot « monitoring / ops » qui fera passer la rubrique ops (§120)
de 50 % vers 60 %+ une fois un bureau beta en production réelle, et qu'on
ne peut pas maquiller en « livré » sans l'avoir lancé.
