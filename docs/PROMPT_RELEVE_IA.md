# Relève IA — prompt à coller tel quel (§122, 13 août 2026)

**Mode d'emploi :** la **source de vérité** n'est plus ce fichier (daté
13/08). Lire d'abord **`README.md` section « 0. REPRISE IMMÉDIATE »** +
`git log -8` + dernière section de `CHANGELOG_NARCHI_V6.md` +
`docs/ROADMAP_NARCHI_2027.md`.

Le bloc ci-dessous reste utile pour le **style** et les **interdits**.
Les compteurs 508/661 et HEAD `3ad7f11` sont **périmés**.

> ⚠️ **5/09/2026 :** ne pas utiliser les HEAD/compteurs de ce fichier.
> Vérité = `README.md` §0 **REPRISE IMMÉDIATE** + `git log -1` + dernière
> section `CHANGELOG_NARCHI_V6.md`. Téléphone officiel abandonné (§206).
> Jamais push. Jamais `4_`. Pas Manifold / Peppol AP / Grafana / Agent-Reach.

---
---

## COPIER À PARTIR D'ICI (message pour la prochaine IA)

Tu prends la relève du dépôt **NARCHI** (monorepo `narchi/`, branche
`narchi-v6-security-german-market`). Ton prédécesseur a travaillé 121
itérations (« § ») ; tu continues dans **exactement** les mêmes règles. Lis
ce message en entier AVANT de toucher quoi que ce soit.

### 1. Le produit, en une minute

NARCHI est un logiciel **BTP pour les petits Architekturbüros allemands**
(1-15 personnes) : estimation coûts **DIN 276**, honoraires **HOAI 2021**,
**GAEB** X31/X83, indice officiel **Destatis 61261**, maquettes **IFC**
(web-ifc WASM local, zéro CDN), page chantier (**Baustelle** : photos/vidéos,
Mängel), **E-Rechnung** (XRechnung/ZUGFeRD, compteurs GoBD §116), synchro
inter-appareils (§115→§119 : Mängel → serveur, Projets, médias, HTTPS local
mkcert). Auto-hébergé chez le client (DSGVO-friendly). Stack : **FastAPI +
PostgreSQL + Redis** (backend/), **React/Vite + TS** (frontend/), nginx,
Docker Compose. **L'interface produit est en ALLEMAND** ; tu communiques avec
le client en **FRANÇAIS**.

### 2. Le client — lis ça deux fois

Non-expert technique, paranoïaque des **FAUX écrans et FAUSSES fonctions** :
il a pété les plombs (CAPS) chaque fois qu'il s'est senti berné. Il pardonne
une panne **dite immédiatement avec sa cause exacte** ; il ne pardonne
jamais un maquillage. Règle de cadrage permanente (§90) : **« l'essentiel
d'abord, avec excellence et fiabilité ; les bonus après »**. Le bluff est
VÉRIFIABLE : toute valeur non mesurée porte un marqueur (RICHTWERT/INCONNU).
Style attendu : français simple, exemples de vraie vie, chiffres exacts,
tables de validation ✅, commandes copiables.

### 3. Règles de la maison (inviolables)

1. **Un commit propre et testé par tâche**, message détaillé en français
   (les aveux y figurent — c'est la tradition depuis §110).
2. **`CHANGELOG_NARCHI_V6.md` : une section par commit, écrite AVANT
   `git add`** (regarde les sections §119→§121 pour le ton).
3. **README.md à jour à chaque commit** : compteurs, série de commits,
   gates attendus, section allemande si concerné.
4. **Aveu immédiat** de toute erreur avec la cause exacte ; si un test
   « passait » grâce à une simulation, dis-le et rends-le réel.
5. **Jamais** de push GitHub, **jamais** d'archives/ZIP, jamais de secret
   dans git (.pem, .env… — .gitignore verrouillé, test qui le prouve).
6. Grep anonymat avant commit : `grep -rn "OpenConstruction""ERP\|datadriven""construction\|data""2drive" frontend/src frontend/e2e backend/app backend/tests README.md docs CHANGELOG_NARCHI_V6.md` → **RC=1 exigé**
   (les 3 chaînes sont écrites ici en deux tronçons concaténés — le shell
   les rejoint telles quelles — précisément pour que CE fichier reste
   invisible à sa propre règle ; collée telle quelle, la commande cherche
   les bons noms).
7. Identité git à refaire chaque tour (elle s'évapore) :
   `git config user.name "NARCHI DevOps"` + `git config user.email "devops@narchi.de"`.
8. Après tout build : `git checkout -- frontend/public/ifc/` (le build
   retouche les wasm) ; après recyclage sandbox : `chmod +x infra/backups/*.sh`.

### 4. Gates OBLIGATOIRES avant chaque commit (strictement séquentiels)

```bash
cd backend  && rm -f test.db && python -m pytest tests -q     # 508/508 attendus (489 + 6 KoSIT §123 + 13 purge médias §125)
cd frontend && npx tsc --noEmit                                # 0 erreur
cd frontend && npx vitest run                                  # 661/661 (89 fichiers)
cd frontend && npm run build                                   # RC=0, 44 jsFiles
```

Preuve E-Rechnung §123 : les octets acceptés par le validateur OFFICIEL
KoSIT vivent dans `backend/tests/fixtures/xrechnung_kosit/` — un test les
compare OCTET PAR OCTET ; toute retouche du service XRechnung impose une
revalidation mesurée (`bash scripts/valider-xrechnung-kosit.sh`, URLs et
SHA-256 épinglés) AVANT de rafraîchir la fixture. E2E §121 : 5/5, 30,0 s,
rejoué au §123 après changement d'écran Rechnungen.

Point de vigilance hérité (§122) : `test_office_prices.py::test_delete_
batch_x31_reel_comme_dans_l_incident` a sauté UNE fois sans cause
élucidée (8 runs verts depuis). S'il re-saute : `--tb=short` SANS `tail`,
lire l'assert, traiter la cause — jamais relancer jusqu'au vert.

Gate **E2E séparé** (§121 — stack démarrée requise, navigateurs pas
partout : documenté, pas dans les 4 gates) : chez le client
`1_DEMARRER_NARCHI.bat` puis `cd frontend && npx playwright install chromium`
(1re fois) et `npm run e2e` → **5/5 attendus (~31 s)** ; recette sandbox
Linux complète dans `frontend/e2e/README.md`. Un test E2E rouge ou skippé
maquillé = faute grave : on préfère livrer un volet de moins, DIT.

### 5. Pièges du sandbox (ils ont tous déjà coûté du temps)

- **Le sandbox recycle** (packages pip, node_modules, swap, nginx…). Si une
  commande manque : `pip install -q "fastapi==0.141.1" httpx pydantic-settings "pyjwt==2.13.0" "python-multipart==0.0.32" "alembic==1.19.0" redis boto3 celery stripe sentry_sdk ezdxf==1.4.4 ifcopenshell==0.8.5 fakeredis "pycrdt==0.14.2" psycopg2-binary uvicorn` puis `cd frontend && npm ci --no-audit --no-fund`.
- **Build vite OOM (exit 137) si ≤ 2 Go RAM** : créer/activer un swap 5 G
  (`fallocate`, `/sbin/mkswap`, `/sbin/swapon` — chemins complets).
- Sans node_modules, `npx tsc` télécharge un FAKE (« tsc@2.0.4 — This is not
  the tsc command you are looking for ») → **toujours `npm ci` d'abord**.
- `python -m alembic` depuis `backend/` est **ombré** par le dossier local
  `backend/alembic/` → utiliser le **binaire** `alembic` (cd backend &&
  alembic upgrade head).
- Postgres sandbox : extension **pgvector** requise par les migrations →
  `apt install postgresql-17-pgvector` puis `CREATE EXTENSION IF NOT EXISTS
  vector` **en superuser** (le rôle applicatif n'a pas le droit — la
  migration devient no-op ensuite).
- Seed bootstrap : il faut `NARCHI_SEED_DEFAULT_ADMINS=1` ET les DEUX mots
  de passe (`NARCHI_ADMIN_PASSWORD` **et** `NARCHI_OWNER_PASSWORD`, ≥ 16
  caractères) sinon démarrage en erreur (il le dit en clair).
- `pgrep -f <nom>` se matche LUI-MÊME → vérifier les ports avec une socket
  Python, pas pgrep.
- Playwright sandbox : Chromium dans `~/.cache` (évapore au recyclage →
  `npx playwright install chromium` à refaire), stack locale = nginx
  pointant `frontend/dist` + uvicorn + PG/Redis, `E2E_BASE_URL=http://127.0.0.1:8080`.

### 6. Environnement du CLIENT (ne pas l'oublier)

Windows + PowerShell + Docker Desktop WSL2. App : http://localhost:8080.
**Le code est CUIT dans les images** → tout nouveau code exige
`3_REPARER_NARCHI_SANS_PERTE.bat` puis Ctrl+F5. Scripts livrés : **.bat en
ASCII-7 pur sans BOM, CRLF** ; .ps1 LF dans l'arbre sandbox avec
`.gitattributes eol=crlf` ; **garde §52** : 1 test ASCII/BOM par fichier
script, auto-découverte (backend/tests les épinglent). HTTPS local
(téléphone) : `8_ACTIVER_HTTPS_LOCAL.bat` (mkcert, SHA-256 épinglé) /
`9_RETIRER_HTTPS_LOCAL.bat`.

### 7. Conventions de code à respecter

- Routeur **maison par hash** (`window.location.hash`, routes `#/app/<id>`) ;
  `RouteSynchronizer` dans `src/store/AppStore.ts`. Ne pas « moderniser ».
- Tests backend : SQLite in-memory, tables explicites, SimpleNamespace,
  `db.info["tenant_id"]`, pas de pytest-asyncio.
- Tests frontend : vitest (happy-dom), `vi.hoisted` + `vi.mock("@/auth/SecuritySanitizer")`.
- UI allemande ; restes FR connus et constatés (bouton « Nouveau projet »,
  « Créer & Initialiser », quelques libellés nav) = jalon cosmétique
  séparé, ne pas corriger au milieu d'un chantier métier.
- Synchro : lois §117/§118 (curseur serveur, garés comptés, **loi du
  curseur honnête §121** : garé = curseur gelé ; rejeu instantané via
  `retryParkedIssues` à la sortie de `pullProjects`).

### 8. Où en est le projet (au 13/08/2026)

- Sécurité V6, viewer IFC 2D/3D, DIN 276/HOAI/GAEB/Destatis, E-Rechnung
  §116, présence/chat/CRDT, sauvegardes §113 (pg_dump + volume fichiers =
  rappel dit), HTTPS local §119 — plan synchro §103 **terminé 4/4**.
- §118 : synchro photos/vidéos + Projets (la plainte « invisible sur
  l'autre compte »). §120 : **guide téléphone pas à pas** +
  **rapport beta/marché/prix** réel (beta-readiness ~70 % = GO ENCADRÉ 3-5
  bureaux amis ; prix recommandé : beta 0 € contre feedback écrit, licence
  bureau 1 790 €/an TTC ou 3 900 € + 690 €/an).
- §121 : **suite E2E navigateur réel** (5 volets Playwright, 31 s) — elle
  a attrapé et fait réparer une **vraie course de premier démarrage**
  (Mangel « garé » invisible à vie) : lis `docs/SYNCHRO_MANGELS.md` §121.
- Historique complet : `CHANGELOG_NARCHI_V6.md` (sections § par §, avec
  tous les aveux — c'est ta mémoire) ; état client : `docs/RAPPORT_GENERAL_NARCHI.md`.

### 9. Prochaines étapes ORDONNANCÉES (issues du rapport §120, pas négociable sans ordre du client)

1. **LUI (le client)** : essai synchro sur son téléphone physique, 30 min,
  `docs/GUIDE_TELEPHONE_PAS_A_PAS.md`. Ni E2E ni Chromium ne le remplacent
  (Safari iOS ≠ Chromium ; son Wi-Fi ≠ sandbox). Si la synchro note était
  55 % → §121 l'a portée à **70 %**, le reste attend CET essai.
2. ~~TOI : passage validateur KoSIT~~ **FAIT §123 (13/08)** — 6 défauts
  trouvés et corrigés, verdict « ACCEPTABLE » mesuré, preuves et règle d'or
  dans `backend/tests/fixtures/xrechnung_kosit/README.md`. Reste du lot
  KoSIT : brancher un job CI hébergé sur le script §123 (jamais exécuté
  depuis GitHub Actions — ne pas le prétendre), puis UBL/Peppol, PDF/A-3,
  Versand. Ce job CI pourra embarquer **floci** (émulateur AWS, MIT) :
  vérifié MESURÉ au §124 (`docs/OUTIL_FLOCI_S3.md`, PoC 7/7 rejouable via
  `scripts/poc-floci-s3.py`) pour le chemin S3 SaaS — décision : dev/CI
  seulement, jamais dans le produit auto-hébergé ; épingler la version,
  smoke test R2 réel obligatoire avant livraison SaaS (non fait).
3. **TOI+LUI** : 1 page de **contrat beta** + choix des 2 premiers bureaux
  pilotes (le rapport §120 donne les critères).
4. Ensuite seulement : page de présentation + **prix publiés**.
5. Backlog déjà dit (le reprendre tel quel, dans l'ordre utile) : ~~purge
  des médias orphelins~~ **FAIT §125** (`python -m app.services.media_purge`,
  simulation par défaut, 13 tests, horizon 30 j DIT) ; sauvegarde `.bat` du
  volume fichiers ; cible d'émulation **Safari/iPhone** dans la suite E2E ;
  pentest externe = INCONNU à chiffrer ; juridique 50 % (AGB/CGU, AVV DSGVO) ;
  ops 40 % (monitoring, runbooks). Notes de readiness détaillées : addendum
  §121 du rapport beta. Quota workspace 128 Mo : **jamais de gros
  téléchargements d'outillage sous /home/user** (.m2/.cache Maven/Chromium
  ont fait sauter la sauvegarde fin §124 — commit perdu, fichiers intacts,
  recréé `23147f3`) : gros builds dans /tmp uniquement.

### 10. Interdits absolus (rappel en une liste)

Pas de push distant, pas d'archives, pas de secret versionné, pas de test
désactivé/skippé pour faire vert, pas de retry magique en E2E, pas de
`waitForTimeout` dans les specs, pas de chiffre sans mesure immédiate,
pas de « ça marche » sans l'avoir **exécuté**, pas de refactor opportuniste
en plein chantier métier, pas de changement de langue UI sans ordre, pas de
suppression/réécriture du CHANGELOG existant, pas de « petite amélioration »
non demandée sur les scripts Windows sans rejouer leurs tests §52.

### 11. Ton premier tour — checklist avant de répondre

1. `git log --oneline -5` + `git status` → confirme HEAD (attendu
   `3ad7f11` au 13/08, ou plus récent = lis les sections CHANGELOG
   manquantes) et un arbre propre.
2. Réponds AU DEMANDEUR en français simple ; annonce ce que tu vas faire,
   fais-le, montre les chiffres mesurés, termine par ce que ça prouve et
   ce que ça ne prouve pas.
3. Si on te dit « GO » sans précision : prends l'étape **la plus haute**
   de la section 9 qui te revient (jamais celle du client à sa place),
   et exécute-la entièrement avec les gates.
4. Avant chaque commit : section CHANGELOG écrite, README à jour, grep
   anonymat RC=1, wasm restaurés, +x des .sh, identité git.

Bonne relève. La maison ne bluffe pas : elle prouve, ou elle dit qu'elle
ne sait pas encore.

## FIN DU BLOC À COPIER
