# Diagnostic NARCHI V5 — mode d'emploi simple

## En cas de problème

1. Ne supprimez aucune donnée et ne lancez pas de commande manuelle.
2. Double-cliquez sur **`DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat`** à la racine
   de NARCHI (anciennement `COLLECT_DIAGNOSTICS.bat`, renommé en §53).
3. Attendez le message **`[OK] DIAGNOSTIC TERMINE`**.
4. L'Explorateur Windows sélectionne automatiquement un fichier :
   `logs\diagnostics\NARCHI_DIAGNOSTIC_AAAAMMJJ-HHMMSS.zip`.
5. Transmettez ce ZIP complet avec une phrase décrivant ce que vous faisiez.

La collecte est en lecture seule : elle ne supprime ni projet, ni volume Docker,
ni ligne PostgreSQL. Il ne faut pas lancer `3_REPARER_NARCHI_SANS_PERTE.bat`
(et encore moins `4_TOUT_EFFACER_ET_REDEMARRER.bat`) pour obtenir des logs.

## Protection des secrets

Le ZIP ne contient jamais le fichier `.env` brut. Avant compression, le script
masque les mots de passe, clés API, secrets, DSN, cookies, JWT, en-têtes Bearer,
adresses e-mail configurées et URL contenant des identifiants. Le test de
connexion utilise le compte owner en mémoire mais n'écrit que les statuts HTTP,
les noms des cookies et les identifiants de diagnostic.

## Ce qui est collecté

- version de Windows, PowerShell, Docker et Compose ;
- état et healthcheck des services NARCHI (§51 : Qdrant retiré de la pile) ;
- derniers journaux de chaque service dans des fichiers séparés ;
- code de sortie et état de santé des conteneurs ;
- test HTTP de l'application et de chaque asset référencé par `index.html` ;
- test `login -> cookie HttpOnly -> /auth/me` ;
- diagnostic interne PostgreSQL, Alembic, Redis, pgvector et compte owner ;
- vérité sur les sauvegardes pgBackRest (`backup-last-run.txt`,
  `backup-repo-info.txt`, journal cron) — succès ET échecs affichés ;
- derniers jalons du déploiement ;
- empreintes SHA-256 des fichiers critiques ;
- résumé automatique des codes d'erreur rencontrés.

Les logs Docker tournent automatiquement : 5 fichiers de 10 Mo maximum par
service. Ils restent donc exploitables sans remplir progressivement le disque.

## Corrélation d'un problème

Chaque requête reçoit un en-tête `X-Narchi-Request-ID`. Lorsqu'une connexion est
refusée, l'écran affiche par exemple :

```text
code diagnostic : 3d16c8d9bece4aaeb5e9139097a1155
```

Ce même code apparaît dans :

- `services/frontend.log` sous `request_id` ;
- `services/backend.log` sous `request_id` ;
- `authentication-test.txt` lors du test automatique.

Il permet de suivre une seule action à travers Nginx, FastAPI, PostgreSQL et le
navigateur sans enregistrer le mot de passe ni le jeton.

## Codes importants

| Code | Signification / première action |
|---|---|
| `MIGRATION_FAILED` | Erreur Alembic/SQL exacte dans `services/migrate.log`. |
| `DATABASE_STARTUP_FAILED` | PostgreSQL ou schéma indisponible au démarrage. |
| `AUTH_ACCOUNT_NOT_FOUND` | L'e-mail saisi ne correspond à aucun compte. |
| `AUTH_PASSWORD_INVALID` | Le compte existe mais le mot de passe est incorrect. |
| `AUTH_ACCOUNT_INACTIVE` | Le mot de passe est valide mais le compte est désactivé. |
| `AUTH_LOGIN_SUCCEEDED` | Mot de passe validé, JWT créés et cookies émis. |
| `AUTH_COOKIE_EMITTED` | Indique `Secure`, `SameSite` et si la requête est locale. |
| `AUTH_SESSION_MISSING` | `/auth/me` n'a reçu aucun cookie ni Bearer. |
| `AUTH_TOKEN_INVALID` | Cookie présent mais expiré ou signature invalide. |
| `AUTH_PASSWORD_STAMP_MISMATCH` | Ancienne session invalidée après changement du mot de passe. |
| `AUTH_USER_TENANT_MISMATCH` | Le tenant du compte ne correspond pas au JWT signé. |
| `FRONTEND_AUTH_COOKIE_PROBE_FAILED` | Le navigateur a refusé/perdu le cookie après le login. |
| `FRONTEND_CHUNK_LOAD_FAILED` | Module dynamique ou dépendance vendor absente/404. |
| `FRONTEND_CHUNK_RECOVERY_ABORTED` | Une deuxième actualisation en 30 s a été bloquée pour éviter une boucle. |
| `FRONTEND_OPERATIONAL_ERROR` | Erreur React, Worker IFC, WebGL ou stockage navigateur. |
| `HTTP_REQUEST_EXCEPTION` | Exception backend non gérée avec traceback et request_id. |
| `CELERY_TASK_FAILED` | Échec d'une tâche IFC/PDF, avec task_id et type d'erreur. |
| `NGINX_ACCESS` | Statut, durée et request_id d'un accès frontend/API. |

## Correctif de boucle après connexion

Si `frontend.log` contient `GET /vendor/three.core.js ... 404`, télécharger le
workspace corrigé puis double-cliquer sur `REPAIR_FRONTEND_LOGIN_LOOP.bat`.
Ce script reconstruit uniquement le frontend, conserve PostgreSQL et les volumes,
puis exige HTTP 200 pour `three.module.js`, `three.core.js`, `/api/health`, le
login owner et `/auth/me` avant d'annoncer le succès.

## Déploiement

`DEPLOY_PROD.ps1` écrit uniquement des jalons non sensibles dans
`logs\deployment\deployment-latest.log`. Si le déploiement échoue, il lance
automatiquement la collecte et crée un ZIP dans `logs\diagnostics`.

Un déploiement ne doit être considéré comme terminé qu'après :

```text
[OK] Authentification owner et cookie de session valides.
[SUCCESS] NARCHI V5 EST DEPLOYE
```
