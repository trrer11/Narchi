# Suite E2E navigateur réel (§121)

Des tests qui pilotent **un vrai Chromium** contre la **vraie stack NARCHI**
(nginx → FastAPI → PostgreSQL → Redis). Aucun écran n'est simulé : chaque
test clique, tape et attend comme un utilisateur — et tout ce qu'ils
vérifient sur un « second appareil » n'a pu y arriver QUE par le serveur
(contexte navigateur neuf : IndexedDB vide, zéro cookie).

## Sans Node sur le PC : 100 % Docker (§184)

Vous ne voulez rien installer ? Double-cliquez **`1_DEMARRER_NARCHI.bat`**
(la stack), puis **`scripts\TEST_E2E_DOCKER.bat`** : la suite tourne dans un
conteneur Playwright jetable (Node + Chromium inclus), les dépendances vont
dans un volume Docker (`narchi-e2e-node_modules`) — le PC reste vierge.
Nettoyage : `docker volume rm narchi-e2e-node_modules` +
`docker rmi mcr.microsoft.com/playwright:v1.61.1-jammy`.

## Lancer chez vous (Windows, la stack Docker)

```powershell
# 1) Une seule fois : installer le navigateur de test
cd frontend
npx playwright install chromium

# 2) Démarrer NARCHI normalement et attendre la page de connexion
#    sur http://localhost:8080 (double-clic 1_DEMARRER_NARCHI.bat)

# 3) Lancer la suite (durée mesurée : ~30 s)
npm run e2e
```

Si la stack n'est pas démarrée, la suite REFUSE de tourner et le dit
(`global-setup`) — un faux résultat ne sert à personne.

## Les 5 volets (tous en allemand, comme vos clients)

| # | Volet | Preuve |
|---|-------|--------|
| 1 | `01-anmeldung.spec.ts` | Création de compte via le formulaire ; mauvais mot de passe refusé **à l'écran** ; bon mot de passe = cockpit |
| 2 | `02-projekt-synchronisation.spec.ts` | Projet créé au bureau **visible sur un 2e appareil** sans rien ressaisir (tirage serveur §118) |
| 3 | `03-mangel-foto-synchronisation.spec.ts` | Mangel **avec photo** saisi sur un appareil → visible sur l'autre, photo **réellement décodée** (`naturalWidth > 0` = les octets JPEG du serveur) |
| 4 | `04-offline-warteschlange.spec.ts` | Mode avion automatisé : saisie hors-ligne OK, badge qui DIT « Offline — N warten », rattrapage au retour réseau, vérifié côté serveur sur appareil frais |
| 5 | `05-ifc-import.spec.ts` | Vrai fichier IFC (`examples/simple_house_efh.ifc`) parsé par web-ifc WASM dans le navigateur : Mengenliste remplie (murs, KG DIN 276, m³, €, CO₂) |

## Lois de la maison (matérialisées dans playwright.config.ts)

- **Zéro retry** : un test qui a besoin d'une seconde chance cache un bug.
- **Aucun `waitForTimeout`** : chaque attente cite ce qu'elle attend.
- **1 worker** : les tests partagent UNE base serveur (comme deux appareils
  d'un bureau) ; chaque test crée son propre compte/tenant Trial via l'UI
  (e-mail unique horodaté) → isolement réel, pas d'effet de bord.
- Le test 5 a une échéance large : le premier parsing WASM à froid sur une
  machine modeste a été mesuré jusqu'à ~90 s (ensuite ~3 s). C'est dit.

## Ce que cette suite PROUVE — et ce qu'elle ne prouve pas

**Prouvé** (re-mesuré à chaque run) : le produit complet fonctionne dans un
navigateur réel contre le serveur réel — compte, session, projets, Mängel,
photos (versement + pull-through), file hors-ligne honnête, import IFC.

**Pas prouvé** : votre téléphone physique (Safari iOS ≠ Chromium ; le réseau
local + HTTPS mkcert du guide §120 reste l'exercice à faire une fois, 30 min).
Cette suite est l'assurance que **le logiciel tient ses promesses** ;
l'essai téléphone reste l'assurance que **votre matériel** les reçoit.

## Bug réel trouvé par cette suite (§121)

Au premier démarrage d'un appareil, le tirage des Mängel pouvait battre
celui des Projets de quelques millisecondes : le Mangel était « garé » et,
le curseur ayant déjà avancé, **il ne revenait jamais** (le test unitaire
§117 simulait un renvoi serveur que le delta strict ne produit pas — aveu
repris et corrigé). Correctif : copie mémoire des garés + **loi du curseur
honnête** (tant qu'un enregistrement du tirage est garé, le curseur ne
bouge pas) + rejeu instantané quand le miroir Projets livre le projet.
Épinglé par 4 tests unitaires (`issueSync.test.ts`, bloc §121) et par les
volets 3 et 4 ci-dessus.

## Recette sandbox/CI (hors Docker, Linux)

La stack y est assemblée avec les mêmes composants, substitutions **dites** :
chemins conteneur → chemins locaux dans une COPIE de `frontend/nginx.conf`
(`/etc/nginx`→racine harnais, `/usr/share/nginx/html`→`frontend/dist`,
journaux `/dev/stdout`→fichiers), hôte `backend`→`127.0.0.1` (compose : nom
de service), `uvicorn` + PostgreSQL 17 (extension pgvector créée par le
superuser — droits production) + Redis. Adresse d'appel via
`E2E_BASE_URL=http://127.0.0.1:8080`. Les produits livrés (`bat`, compose)
ne sont PAS modifiés pour la CI.
