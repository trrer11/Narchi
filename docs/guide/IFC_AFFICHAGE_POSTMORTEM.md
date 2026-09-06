# Affichage IFC — post-mortem complet

> Document d'ingénierie. Objectif : permettre à **toute personne** lisant ce
> dépôt de comprendre **où étaient les pannes d'affichage IFC**, **pourquoi
> elles étaient si difficiles à identifier**, et **comment elles ont été
> résolues**. Aucune connaissance préalable du projet n'est requise.
>
> Période couverte : juillet – août 2026. Cinq vagues de panne, une seule
> famille de causes : la dépendance aveugle aux *Web Workers* et de faux
> diagnostics mémoire.

---

## 1. Résumé en deux minutes

| # | Ce que voyait l'utilisateur | Vraie cause | Correctif |
|---|-----------------------------|-------------|-----------|
| 1 | « Crash fatal du Worker IFC » à l'import de tout fichier | Boucle infinie du tokenizer sur entrée malformée + pic mémoire (fichier lu d'un bloc + WASM ouvert en même temps) → OOM silencieux du Worker | Tokenizer anti-boucle, parsing *streaming* par blocs de 4 Mo, architecture 2 phases (métrés **avant** validation WASM) |
| 2 | « …dernière étape : DEMARRAGE, fichier : 0.2 Mo » | Le script du Worker importait `web-ifc` (3,5 Mo) **statiquement** au démarrage ; dès que ce téléchargement échouait, le Worker mourait avant son premier message → `ErrorEvent` vide, traduit à tort en « dépassement mémoire » | `web-ifc` en import **dynamique** (Worker : 3,5 Mo → **58 Ko**), poignée de main `WORKER_READY`, 1 re-tentative automatique à l'amorçage |
| 3 | Échec **identique** après vidage du cache et navigation privée | L'environnement utilisateur (web-shield antivirus / extension / navigateur) bloque **100 % des Web Workers** — le script, pourtant sain, n'était jamais exécuté | **Repli automatique sur le thread principal** : le même parseur s'exécute sans Worker (`importIfcResilient`) — l'import aboutit toujours |
| 4 | Badge « Fallback WebGL », « 1650 boîtes analytiques », écran de chargement de 90 s, besoin de recharger | La visionneuse premium convertissait l'IFC **dans un Worker** — bloqué dans le même environnement ; au rechargement, l'URL blob était périmée → affichage de boîtes englobantes (« cubes ») au lieu du vrai modèle | **Cascade à trois moteurs 3D** : Fragments → géométrie réelle web-ifc sur thread principal → boîtes ; mémoire d'environnement (sessionStorage) : plus de détour de 90 s ni de rechargement |
| 5 | « Le niveau 0.00 du projet n'est pas celui du programme — mon niveau 5 est au niveau 0 de la visionneuse » | `COORDINATE_TO_ORIGIN` ignorait le point de base du projet, **et** web-ifc livre ses sommets en **Y-up** (hauteur = y, pas z) — la normalisation lisait le mauvais axe | Ancre = élévation du niveau le plus bas (chaîne `IfcLocalPlacement`), recentrage explicite, badge « ±0,00 ↔ ‹niveau› » visible à l'écran |

---

## 2. Contexte : comment l'affichage IFC fonctionne chez NARCHI

Deux chaînes indépendantes traitent un fichier `.ifc` (format texte STEP,
souvent 5–100 Mo) :

```
Fichier IFC (ArrayBuffer)
│
├── Chaîne A — MÉTRÉS / estimation DIN 276
│   └── Worker "ifcParser" (parseur texte maison, streaming)
│       → takeoff : quantités, surfaces, volumes, niveaux (IfcBuildingStorey)
│       → tableau des métrés + estimation Kostengruppen
│
└── Chaîne B — VISIONNEUSE 3D
    └── moteur Fragments (Worker) ─ ou ─ web-ifc (WASM, thread principal)
        → géométrie triangulée + couleurs → rendu WebGL (three.js)
```

Points fragiles structurels :

1. **Web Workers** : scripts séparés, téléchargés et évalués par le
   navigateur. Si ce téléchargement/évaluation échoue, le navigateur ne
   rapporte qu'un `ErrorEvent` **vide** — aucune pile, aucun message.
2. **web-ifc** : portage WASM d'Open CASCADE. Le binaire fait ~3,5 Mo ;
   son évaluation est coûteuse et sa mémoire plafonnée.
3. **CSP** stricte (`worker-src 'self' blob:`) : un Worker dont le script ne
   vient pas de la bonne origine est tué sans explication visible.
4. **Repères de coordonnées** : IFC/Revit raisonnent en *Z-up* (z =
   hauteur), three.js/web-ifc rendent en *Y-up* (y = hauteur). Toute
   conversion d'axe erronée « décale les étages ».

---

## 3. Panne n°1 — crash silencieux du Worker à l'import

**Symptôme** : tout import échouait avec un crash « non rapporté par le
navigateur », sans log exploitable.

**Diagnostic** : deux défauts cumulés.

1. **Boucle infinie du tokenizer** : sur une entrée malformée (parenthèse
   orpheline, chaîne non fermée), un chemin du tokenizer n'avançait pas le
   curseur. Le Worker tournait à 100 % CPU jusqu'à être tué par
   l'environnement d'exécution — mort sans message erreur.
2. **Pic mémoire** : le fichier était lu **en entier** en une seule String,
   *pendant* que le modèle WASM web-ifc (validation) était ouvert. Fichier de
   50 Mo → String UTF-16 ~100 Mo + WASM ~300 Mo → dépassement du quota
   Worker → OOM silencieux.

**Correctifs** :

- Tokenizer réécrit avec **garantie de progression** (chaque itération
  consomme au moins un caractère ou lève une `PARSE_ERROR` localisée) ;
- **Parsing streaming** : lecture par blocs de 4 Mo, états du tokenizer
  persistants entre blocs, gestion des frontières de chaînes/commentaires.
  Pic mémoire divisé par ~3, indépendant de la taille du fichier ;
- **Architecture 2 phases** : le takeoff (métrés, valeur métier) est calculé
  et **envoyé** avant même d'ouvrir le WASM ; la validation croisée web-ifc
  devient un bonus *best effort* après coup, avec budget de 64 Mo
  (`MAX_WASM_VALIDATION_BYTES`). Le WASM ne coexiste plus jamais avec le
  texte complet en mémoire ;
- **Fil d'Ariane d'étapes** dans les erreurs (`stage: DEMARRAGE | PARSING |
  VALIDATION …`) pour que tout crash futur nomme l'étape fautive.

**Fichiers** : `frontend/src/lib/ifcParser.ts`,
`frontend/src/workers/ifcParser.worker.ts`.

---

## 4. Panne n°2 — « dernière étape : DEMARRAGE, 0.2 Mo »

**Symptôme** : après le correctif n°1, échec systématique **avant le début
du parsing**, même sur un fichier de 0,2 Mo, sans aucune ligne
`[IFC Worker]` en console. Le fil d'Ariane montrait : crash en DEMARRAGE.

**Diagnostic** : le script du Worker n'était **jamais évalué**. Il contenait
un **import statique** de `web-ifc` : le navigateur devait télécharger et
évaluer 3,5 Mo de WASM-glue *avant* d'exécuter la moindre ligne, donc avant
l'installation du gestionnaire de messages. Si ce téléchargement était
réinitialisé (`net::ERR_CONNECTION_RESET`, fréquent sous réseau
virtualisé/antivirus) ou si l'évaluation levait une exception, le Worker
mourrait **avant sa naissance**. Le watchdog ne recevait qu'un `ErrorEvent`
vide et concluait à tort : « dépassement mémoire sur fichier volumineux » —
alors que le fichier faisait 0,2 Mo et n'avait même pas été ouvert.

**Correctifs** (`frontend/src/workers/ifcParser.worker.ts`,
`frontend/src/bim/WorkerWatchdog.ts`) :

1. **web-ifc devient un import dynamique** : le script du Worker passe de
   3,5 Mo à **58 Ko** de logique pure. Même si le chunk web-ifc est
   illivrable, l'import réussit (seule la validation croisée se dégrade).
2. **Poignée de main `WORKER_READY`** : le Worker annonce explicitement la
   fin de son évaluation. Le pool attend cette preuve de vie (10 s) avant
   tout envoi ; un Worker mort-né est détecté en 10 s avec un message qui
   nomme la vraie cause (chunk perdu, cache obsolète, CSP) au lieu du faux
   diagnostic mémoire.
3. **Une seule re-tentative automatique** d'amorçage avec Worker neuf
   (absorbe les resets réseau transitoires) ; la fabrique de buffer relit le
   fichier à chaque tentative — aucun `ArrayBuffer` détaché n'est relu. Un
   échec *de parsing* (fichier corrompu), lui, n'est jamais relancé.

**Preuves** : harnais Node `frontend/scripts/smoke-ifc-worker.mjs` (build
réel esbuild du Worker) — scénarios NORMAL / MALFORMÉ / QUARANTAINE (chunk
web-ifc renommé) : 3/3 PASS.

---

## 5. Panne n°3 — le Worker ne démarre JAMAIS, cache vidé ou non

**Symptôme** : échec d'amorçage **100 % déterministe** chez l'utilisateur —
2 tentatives, cache vidé, navigation privée, même résultat — alors que le
bundle servi était démontré sain.

**Diagnostic** : le chunk de production réel (58 Ko, URL absolue correcte,
aucun import statique) a été rejoué dans le harnais Node : `WORKER_READY` +
takeoff livré. **Le code était innocent ; l'environnement était coupable** :
couche de filtrage web (antivirus « web-shield », extension de sécurité,
navigateur sans Workers ES modules) bloquant systématiquement les Workers.

Décision d'architecture : **ne plus demander la permission à
l'environnement.**

**Correctif** (`frontend/src/bim/ifcImport.ts` — `importIfcResilient`) :

1. Worker d'abord (chemin normal, supervisé, validation WASM en bonus) ;
2. si et seulement si `IfcWorkerBootError` (mort-né après les 2 tentatives) :
   **le même parseur streaming s'exécute sur le thread principal** — sans
   Worker, sans WASM, sans fetch de chunk. Sur très gros fichier, courte
   pause d'UI possible, mais **l'import aboutit toujours** ;
3. un échec de parsing ne rebascule jamais (la même erreur se reproduirait).
4. **Mémoire d'environnement** (`frontend/src/bim/workerEnv.ts`) : dès le
   premier blocage prouvé, la session marque `narchi:workers-blocked` en
   `sessionStorage` et saute directement au moteur viable — plus de double
   tentative ni d'attente.

**Preuves** : 4 tests du repli (takeoff réel du fichier exemple, fichier
corrompu, non-repli d'un échec de parsing).

---

## 6. Panne n°4 — « cubes analytiques », écran de 90 s, rechargement

**Symptômes** (capture utilisateur, `meuble final.ifc`, 7,4 Mo, Revit 2026,
1650 éléments) :

1. après import, écran « Chargement… » prisonnier jusqu'au watchdog de 90 s ;
   seul un **rechargement** affichait quelque chose ;
2. ce quelque chose était **« 1650 boîtes analytiques issues des quantités
   IFC »** (badge « Fallback WebGL ») — des parallélépipèdes bleus/verts,
   pas le vrai modèle.

**Diagnostic** : même famille que les pannes 2–3, mais dans la **chaîne B**.
La visionneuse premium convertissait l'IFC **dans un Web Worker**
(`/ifc/fragments-worker.mjs`). Environnement anti-Worker → conversion
morte-née, écran de chargement figé jusqu'au watchdog de 90 s. Au
rechargement, l'URL blob du fichier était **périmée** → bascule immédiate
sur l'ultime filet : les *boîtes englobantes* reconstruites depuis les
BaseQuantities du takeoff (chaîne A, qui, elle, fonctionnait grâce au
correctif n°3). D'où les « cubes » : ce n'était **pas** un rendu dégradé du
modèle, mais une visualisation d'appoint des métadonnées.

**Correctif — cascade à trois moteurs 3D** (`ModelImport.tsx`,
champ `viewerEngine`) :

1. **Fragments** (chemin premium, Workers) — inchangé quand ils marchent ;
2. **Nouveau : géométrie réelle web-ifc sur thread principal**
   (`frontend/src/lib/ifcMeshLoader.ts` +
   `frontend/src/components/WebIfcMainThreadViewer.tsx`) : vraies formes
   (murs, dalles, ouvertures, mobilier) avec **couleurs IFC**, cadrage auto,
   budgets (≤ 3 M sommets, ≤ 60 000 meshes), cession périodique à l'UI,
   mémoire WASM libérée — **zéro Worker** : le module ESM est chargé depuis
   l'asset statique `/ifc/web-ifc-api.js` déjà présent dans l'image ;
3. **Boîtes analytiques** — dernier filet (fichier sans géométrie
   triangulable, budgets dépassés, WebGL indisponible).

La mémoire d'environnement (panne n°3) fait sauter la session directement au
moteur viable : **plus de détour de 90 s ni de rechargement**.

Optimisation build associée : web-ifc sorti du graphe Rollup principal
(`import(/* @vite-ignore */ assetURL)`) + `maxParallelFileOps: 20` — pic
mémoire de build supprimé (utile aussi sous Docker Desktop/WSL2).

---

## 7. Panne n°5 — le ±0,00 du projet décalé

**Signalement utilisateur** : « le niveau 0.00 du projet n'est pas le même
que celui du programme — le niveau 5 du projet est au niveau 0 du
programme ». Visuellement : le modèle flottait par rapport à son propre
point de base Revit.

**Diagnostic — deux causes combinées, prouvées sur matrices web-ifc
réelles** :

1. `COORDINATE_TO_ORIGIN: true` recentrait la géométrie selon les règles
   internes de web-ifc, en ignorant les offsets de la chaîne
   `IfcSite → IfcBuilding → IfcBuildingStorey` (le point de base du projet) ;
2. **web-ifc livre ses sommets en repère Y-up** : `x = x IFC (plan)`,
   `y = z IFC (HAUTEUR)`, `z = −y IFC`. Vérifié empiriquement : une dalle
   IFC à z=3 sort avec `translation.y ≈ 3,12`. Toute logique « z = hauteur »
   lisait simplement le mauvais axe (la première normalisation était fausse
   **d'un axe**).

**Correctifs** :

- `frontend/src/lib/ifcStoreyZero.ts` : résolution de **l'ancre** = Z absolu
  du placement du niveau le plus bas, en remontant sa chaîne de
  `IfcLocalPlacement` (le géoréférencement NN est exclu intentionnellement) ;
  repli : point bas de la géométrie ;
- `ifcMeshLoader` : `COORDINATE_TO_ORIGIN: false` + recentrage explicite —
  plan x/z = centre de la boîte englobante, **hauteur y = ancre ±0,00
  projet** ; le niveau de référence du projet repose exactement sur le plan
  z=0 de la scène ;
- la visionneuse affiche un badge **« ±0,00 ↔ ‹nom du niveau›
  (IFC-Projektdatum) »** : la correspondance est lisible à l'écran.

**Preuves** : test dédié reproduisant le cas exact de l'utilisateur
(placement du bâtiment à +5 m → boîte englobante qui commence à 0, sommets
décalés de −5 sur l'axe hauteur), plus fixture
`examples/simple_house_efh.ifc` enrichie de géométries IFC2X3 réelles
(extrusions + placements + couleurs) validées par web-ifc réel en test Node.

---

## 8. Leçons structurantes (à relire avant toute évolution de la chaîne IFC)

1. **Un Worker qui meurt avant l'évaluation de son script ne laisse aucune
   trace.** Sans poignée de main explicite (`WORKER_READY`), la seule
   information est un `ErrorEvent` vide. Toute boucle de diagnostic doit
   distinguer *amorçage* et *traitement* (DEMARRAGE ≠ mémoire).
2. **Jamais d'import statique lourd dans un Worker critique.** Le seuil
   n'est pas la taille : c'est « tout ce dont l'évaluation n'est pas
   indispensable au premier message ». 3,5 Mo → 58 Ko a transformé la
   fiabilité d'amorçage.
3. **Ne jamais transformer un échec d'infrastructure en diagnostic
   applicatif.** « Dépassement mémoire » a masqué trois causes distinctes.
   Les messages d'erreur doivent être *conscients de l'étape*.
4. **L'environnement utilisateur peut être hostile de façon déterministe**
   (antivirus web-shield, extensions, réseau virtualisé). Un module critique
   doit posséder un chemin **sans Worker** prouvant la même valeur métier :
   le Worker est une optimisation, jamais une condition.
5. **Un repli ne doit pas dégrader silencieusement la promesse produit.** Le
   badge (« Fragments » / « WebGL direkt » / « Fallback WebGL ») dit
   toujours quel moteur rend, pourquoi, et ce qui est affiché (géométrie
   réelle ≠ boîtes analytiques).
6. **Mémoire d'environnement** : un échec prouvé une fois ne doit pas être
   re-subi à chaque action de la session (sessionStorage → saut direct au
   moteur viable).
7. **Ne jamais faire confiance aux conventions d'axes d'un moteur** : les
   prouver sur matrices réelles (Y-up web-ifc) avant d'écrire la
   normalisation ; couvrir le cas utilisateur exact par un test.
8. **Les budgets de ressources font partie de l'architecture** (streaming
   4 Mo, ≤ 64 Mo WASM, ≤ 3 M sommets, cession à l'UI) : une chaîne qui
   fonctionne « quand ça passe » ne fonctionne pas.
9. **Chaque correctif est livré avec sa preuve** : harnais E2E
   (`smoke-ifc-worker.mjs`), tests vitest (113/113 à ce jour), tsc propre,
   build Vite de production vert. Un correctif non prouvé localement n'a
   jamais été annoncé comme résolu.
10. **Un comportement connu et assumé** : après un rechargement complet de
    la page, seules les boîtes analytiques ré-apparaissent (le fichier
    source n'est pas persisté) ; la ré-importation du fichier restaure le
    modèle réel immédiatement, sans délai, grâce aux points 4 et 6.

---

## 9. Comment diagnostiquer un problème IFC aujourd'hui

1. **Lire le badge de la visionneuse** (haut de la vue 3D) :
   - « Fragments » : moteur premium, Workers fonctionnels ;
   - « WebGL direkt » : géométrie réelle web-ifc sur thread principal —
     comportement normal dans un environnement anti-Workers ;
   - « Fallback WebGL » : seules les boîtes analytiques ont pu être
     reconstruites (fichier sans géométrie, budgets dépassés ou WebGL HS).
2. **Lire le fil d'Ariane d'étape** dans le message d'erreur
   (DEMARRAGE / PARSING / VALIDATION) et le libellé « ±0,00 ↔ … ».
3. **Console (F12)** : `WORKER_BOOT_ERROR`, `net::ERR_CONNECTION_RESET` sur
   `/assets/*.js` ou `/ifc/fragments-worker.mjs` indiquent un blocage
   environnemental — le repli thread principal a dû s'activer seul.
4. **Rejouer le build hors navigateur** :
   `node frontend/scripts/smoke-ifc-worker.mjs` (3 scénarios) et la suite
   `npm run test` (dont les tests mesh loader sur WASM réel).
5. **Capture utilisateur** demander systématiquement : message exact, badge
   visible, console F12, onglet Réseau.

---

## 10. Cartographie des fichiers

| Rôle | Fichier |
|------|---------|
| Parseur IFC streaming (tokenizer anti-boucle) | `frontend/src/lib/ifcParser.ts` |
| Worker de parsing (web-ifc dynamique, WORKER_READY) | `frontend/src/workers/ifcParser.worker.ts` |
| Supervision Worker (preuve de vie, re-tentative, erreurs d'étape) | `frontend/src/bim/WorkerWatchdog.ts` |
| Import résilient (Worker → repli thread principal) | `frontend/src/bim/ifcImport.ts` |
| Mémoire d'environnement anti-Workers | `frontend/src/bim/workerEnv.ts` |
| Chargeur de géométrie réelle (web-ifc, thread principal, budgets, Y-up) | `frontend/src/lib/ifcMeshLoader.ts` |
| Résolution de l'ancre ±0,00 (chaîne de placements) | `frontend/src/lib/ifcStoreyZero.ts` |
| Visionneuse géométrie réelle (three.js) | `frontend/src/components/WebIfcMainThreadViewer.tsx` |
| Visionneuse premium Fragments | `frontend/src/components/RealIfcViewer.tsx` |
| Visionneuse boîtes analytiques (dernier filet) | `frontend/src/components/ModelViewer.tsx` |
| Orchestration de la cascade 3 moteurs | `frontend/src/pages/dashboard/ModelImport.tsx` |
| Harnais E2E du Worker (3 scénarios) | `frontend/scripts/smoke-ifc-worker.mjs`, `ifc-worker-harness.mjs` |
| Fixture IFC2X3 de test (géométrie réelle) | `examples/simple_house_efh.ifc` |
| Journal détaillé des itérations | `CHANGELOG_NARCHI_V6.md` (§13 à §16) |

---

*Dernière mise à jour : 2026-08-05 — tête de branche `147e515`, suite de
tests 113/113, build de production vert.*
