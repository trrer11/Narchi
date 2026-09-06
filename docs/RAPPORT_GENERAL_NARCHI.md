# NARCHI — Rapport général & diagnostic

**Date : 11 août 2026 · Branche `narchi-v6-security-german-market` · HEAD `1d9a957` (§111)**
**Public : le patron. Écrit en langage simple. Chaque chiffre a été re-mesuré le jour même.**

---

## 1. La réponse en trois phrases

**Ça fonctionne**, et ce n'est pas une impression : 982 tests automatisés passent au vert *aujourd'hui* (400 côté serveur, 582 côté écran — rejoués le 11 août). **Ce n'est pas « fini »** : un logiciel de chantier n'est jamais « fini », il y a une feuille de route honnête plus bas. **C'est prêt pour un usage réel dans VOTRE bureau**, à condition de respecter deux gestes : rebuild après chaque livraison (`.bat` n°3) + sauvegardes de la base (chantier P0 ci-dessous). Ce n'est **pas encore** un produit vendable « clé en main » à d'autres bureaux — et je vous dis exactement ce qui manque.

---

## 2. Vérifiez vous-même en 10 minutes (aucune compétence technique requise)

Après `3_REPARER_NARCHI_SANS_PERTE.bat` + **Ctrl+F5** sur http://localhost:8080 :

| # | Geste | Ce que vous devez voir |
|---|---|---|
| 1 | Ouvrir **Baustelle** | Si aucun projet : cadre jaune avec un champ « nom » → tapez un nom → bouton bleu → **l'import est libéré** |
| 2 | Glisser **une photo + une vidéo** MP4 de votre téléphone | « 1 Foto + 1 Video importiert », groupées au **jour du tournage** (source affichée : EXIF / Video-Metadaten / nom) |
| 3 | Cocher le jour, créer un **Mangel** | Il apparaît dans « Offene Mängel » avec la date réelle et le compteur photo+vidéo |
| 4 | **Nachrichten** : écrire un message d'équipe | Il part ; clic droit (owner/admin) → renommer, archiver, **supprimer** (canal qui ne renaît plus) |
| 5 | Regarder **en bas à droite** | **UNE** bulle noire avec le total des non lus — plus de rangée de bulles, plus de bouton « 70 % » en haut |

Si un de ces 5 points échoue : capture d'écran, et je corrige. C'est notre méthode depuis le début.

---

## 3. Ce qui existe VRAIMENT (inventaire mesuré)

Chaque ligne ci-dessous est du **code réel, testé**, pas une promesse de plaquette.

### Votre métier au quotidien
- **Baustellendoku** (votre idée) : photos **et vidéos** du téléphone → bureau ; groupées par **vraie date de tournage** (EXIF pour les photos, métadonnées MP4 pour les vidéos — lecteur écrit maison, 60 lignes, 7 tests) ; séances découpées ; **Mangel** créé avec preuves ; **rien ne quitte l'appareil** (IndexedDB locale, dit partout).
- **Projets & structure DIN 276**, classification, éléments IFC (moteur 3D That Open Engine / Three.js), quantités (takeoff), estimation des coûts, énergie, **HOAI 2021**, **prix Destatis 2021→2026 épinglés** (129,75 en 2024 → 140,30 en 2026), export **GAEB**.
- **Mängel / Issues** : gravité, zone, commentaire, photos+videos, statut.
- **PDF marque blanche** (§77) : vos documents portent VOTRE logo.

### Le travail d'équipe
- **Chat temps réel** complet : canal équipe, canaux par projet, messages privés ; renommer / archiver / **supprimer** (owner & admin uniquement — un canal supprimé ne renaît JAMAIS grâce aux « pierres tombales » §110) ; présence & verrous ; **co-édition de notes en direct** (CRDT §81) avec **historique de versions** et restauration (§86).
- **Team** : hiérarchie 3 niveaux (§80), avatars servis par le serveur (§82–§84), invités au besoin (§88).
- **Cockpit** : chiffres calculés de vos données (jamais d'indicateur décoratif).

### La sécurité (prouvée par tests, pas par affirmations)
- Chaque bureau est **cloisonné** : les tests vérifient qu'un bureau A obtient **403/404** sur les données du bureau B.
- Sessions qui tiennent la journée (renouvellement silencieux §87), mots de passe hachés, secrets **hors du dépôt** (aucune clé réelle dans le code — vérifié par grep à chaque commit).
- **Zéro envoi de vos données vers un quelconque cloud** : tout tourne chez vous en Docker.

---

## 4. Les chiffres exacts (mesurés le 11 août 2026)

| Mesure | Valeur | Comment vérifier |
|---|---|---|
| Tests serveur (pytest) | **400/400** | `cd backend && python -m pytest tests -q` |
| Tests écran (vitest) | **582/582 — 83 fichiers** | `cd frontend && npx vitest run` |
| Erreurs TypeScript | **0** | `npx tsc --noEmit` |
| Build production | **RC=0, 44 fichiers JS** | `npm run build` |
| Commits propres sur la branche | **114** | `git log --oneline` |
| Migrations de base de données | **15** (toutes additives, jamais destructrices) | `ls backend/alembic/versions` |
| Code écran | **288 fichiers · 57 282 lignes** (TS/TSX) | mesure `wc -l` |
| Code serveur | **120 fichiers · 19 041 lignes** + 7 755 lignes de tests | mesure `wc -l` |
| Pages du cockpit | **36** | `ls frontend/src/pages/dashboard` |

---

## 5. Diagnostic honnête — les points faibles, sans maquillage

C'est la partie la plus importante. Un rapport qui ne dit que du bien ne vaut rien.

| # | Point faible | Gravité | Verdict |
|---|---|---|---|
| a | **Sauvegardes** PostgreSQL (chat, comptes) | 🟢 **LIVRÉ §113** | **Corrigendum §112** : l'automatique pgBackRest *existait* (§51, full dimanche + incrémental + WAL — mon « absent » était inexact) ; le vrai trou = tout était prisonnier du volume Docker. §113 ajoute l'export VISIBLE `sauvegardes\` (`5_SAUVEGARDE_EXTERNE.bat`), la planification hebdo (`7_…bat`), et la **preuve de restauration** (`6_VERIFIER_RESTAURATION.bat`) — éprouvée sur un vrai PostgreSQL (voir `docs/SAUVEGARDES_NARCHI.md`). Reste à vous : copier le dossier sur clé USB/NAS chaque semaine. |
| b | **Photos & Mängel restent sur l'appareil** (IndexedDB) : pas de synchro téléphone ↔ bureau | 🟢 **PLAN TERMINÉ (4/4)** | « GO » reçu, plan §103 **complet** : **étape 1 §115** (API Mängel : vérité partagée, LWW au verdict écrit, tombstones, résurrection) + **étape 2 §117** (moteur navigateur : file hors-ligne persistante, badge sincère) + **étape 3 §118** (FICHIERS photo/vidéo voyagent — versement auto, pull à l'affichage, octets vérifiés serveur, plafonds 25/300 Mio dits — **et PROJETS synchronisés**, plainte « invisible sur l'autre compte » traitée) + **étape 4 §119 : HTTPS local mkcert** (`8_ACTIVER_HTTPS_LOCAL.bat`, téléchargement épinglé SHA-256, pare-feu privé seul, succès PROUVÉ par requêtes, retrait `9_` propre ; 8080 inchangé mesuré). Reste à vous : les 3 gestes d'activation (`docs/HTTPS_LOCAL.md`). Plan : `docs/SYNCHRO_MANGELS.md`. |
| c | **E-Rechnung (XRechnung/ZUGFeRD)** | 🟢 utilisable | **LIVRÉ §116** (chaîne complète de bout en bout, sur votre demande « finis d'abord la E-Rechnung ») : fondations §114 (`services/xrechnung.py`, XML CII/EN 16931 maison, zéro valeur inventée) + **registre de factures persisté** (table `invoices`, écran AGENCY OPS → Rechnungen, aperçu au centime) + **cycle GoBD** (brouillon modifiable → émission avec numéro RE-AAAA-NNNN et date serveur, figée → storno avec numéro conservé, chaîne sans trou possible) + téléchargement XML profil **XRechnung 3.0**. **§123 (13/08) : validateur officiel KoSIT PASSÉ** (XRechnung 3.0.2, verdict « ACCEPTABLE » sur les 2 profils + chemin API complet, rejouable par `scripts/valider-xrechnung-kosit.sh`, 6 défauts trouvés et corrigés — voir `docs/RAPPORT_BETA_MARCHE_PRIX.md` addendum §123). Restent : job CI hébergé branché sur ce script, UBL/Peppol, PDF/A-3 (ZUGFeRD), envoi intégré — notés dans `docs/E_RECHNUNG.md`. Échéance légale émission **2027/2028** : Narchi est en avance. |
| d | Pas de tests **navigateur réel** (type Playwright) : 582 tests jsdom excellents mais simulés | 🟡 moyenne | Ajouter ~20 tests bout-en-bout navigateur sur vos 5 gestes du §2. |
| e | **Pas de HTTPS local** (Docker Desktop en http://localhost) | 🟢 **LIVRÉ §119** | Acceptable en mono-poste (8080 inchangé, mesuré sans régression) ; pour le téléphone : pack mkcert prêt et éprouvé (`8_`/`9_`, CA manuelle par téléphone dite). |
| f | Ancien PDF marketing « calcul certifié » encore en circulation | 🟡 moyenne | Formulation sur-vendeuse à corriger/retirer (backlog). |
| g | Landing marketing FR absente ; séries Destatis « Büro/gewerblich » (§98) ; DA11 non branché | 🟢 faible | Bonus connus, aucun ne bloque votre usage. |
| h | Jamais de **pentest externe** | 🟡 moyenne | Recommandé avant toute ouverture à d'autres bureaux. |
| i | Monitoring des erreurs minimal au quotidien | 🟢 faible | sentry_sdk est câblé ; brancher un tableau de bord quand le volume le justifie. |

**Lecture :** aucun point faible ne menace votre usage actuel en monoposte **si (a) est fait**. Les points (b), (c), (d) conditionnent l'étape suivante (multi-appareils, facturation légale 2027, confiance industrielle).

---

## 6. « Améliorer avec un projet open source de GitHub ? » — la réponse franche

### Ce que Narchi utilise DÉJÀ (et c'est bien ainsi)
Narchi n'a jamais réinventé la roue : le dépôt repose sur des dizaines de projets open source vérifiables — **React, FastAPI, Zustand, Tailwind, That Open Engine + Three.js, web-ifc, PostgreSQL, Redis, Celery, Alembic, pycrdt, ezdxf, ifcopenshell, Vitest, Pytest…** C'est exactement ça, la bonne façon d'utiliser l'open source : des **fondations éprouvées** sous un **métier écrit sur mesure**.

### Ce que je déconseille — et pourquoi (les 5 raisons)
Intégrer un **gros logiciel BTP open source complet** (un ERP, un « clone » de logiciel de chantier) serait une **fausse bonne idée** :

1. **Licence** : beaucoup sont en copyleft (GPL/AGPL) → ça peut vous obliger à publier TOUT votre code, y compris votre métier.
2. **Sécurité** : un gros projet = souvent **des centaines de dépendances** à surveiller. Chaque dépendance est une porte. Notre règle actuelle (peu de dépendances, chacune choisie) est un **luxe de sécurité**.
3. **Maintenance** : si le projet est abandonné demain (fréquent), il devient **votre** patate chaude — des milliers de lignes écrites par d'autres.
4. **Notre méthode a fait ses preuves** : quand une brique manque, on écrit **60 lignes testées** plutôt que d'importer 100 000 lignes. Exemple réel : le lecteur de date vidéo MP4 (§110) = 60 lignes + 7 tests, zéro dépendance, pour toujours.
5. **Votre diference est le sur-mesure** : greffer un produit générique ferait de Narchi… un produit générique.

### Ce que je recommande — des briques spécialisées, au bon moment
| Besoin | Quand | Approche |
|---|---|---|
| **E-Rechnung ZUGFeRD/XRechnung** | 2026 (obligation émission 2027/28) | Petite librairie Python dédiée (licence permissive) + **validateur officiel KoSIT** pour prouver la conformité |
| Tests navigateur réel | trimestre prochain | **Playwright** (standard industriel, MIT) |
| Sauvegardes | tout de suite | pas de projet GitHub : 20 lignes `pg_dump` planifié suffisent |

**Règle d'adoption que je propose (et que j'applique)** : licence MIT/BSD/Apache uniquement · projet maintenu (activité < 12 mois) · surface réduite · et **jamais** pour un cœur déjà écrit et testé.

---

## 7. « C'est fini ? » — la feuille de route honnête

**P0 — fiabilisation de production**
1. ~~Sauvegardes~~ → **LIVRÉ §113** (export visible + planification + preuve de restauration) ; il reste *votre* geste : lancer `7_PROGRAMMER_SAUVEGARDE_HEBDO.bat` une fois et copier `sauvegardes\` sur un autre support chaque semaine.
2. Votre smoke test 10 minutes (§2) après rebuild — **fait, validé par vous**.

**P1 — votre décision, puis je code**
3. Synchro Mängel/Projets/médias inter-appareils → **PLAN 4/4 TERMINÉ** : étapes 1 (API §115), 2 (moteur §117), 3 (fichiers + PROJETS §118) et 4 (**HTTPS local §119**, pack mkcert éprouvé). Il ne reste que VOS 3 gestes d'activation le jour où vous voulez le téléphone (`docs/HTTPS_LOCAL.md`).
4. ~~E-Rechnung~~ → **LIVRÉE §116** (registre + écran + XML XRechnung, voir ligne c du tableau) ; ~~jalon restant : validateur officiel KoSIT~~ → **PASSÉ §123 (13/08)**.
5. Ancien PDF « calcul certifié » : corrigé ou retiré.

**P2 — bonus (confiance industrielle / vente à d'autres bureaux)**
6. ~20 tests Playwright navigateur réel.
7. Landing marketing FR.
8. Séries Destatis « Büro/gewerblich » (§98), DA11.
9. Pentest externe avant toute ouverture multi-bureaux.

**Traduction en une phrase :** le moteur tourne, la carrosserie est solide ; il manque le système de sauvegarde (P0-a), et chaque étape suivante est **votre choix**, explicitement listé, rien ne se fera en cachette.

---

## 8. Ce que je vous recommande MAINTENANT

1. **Rebuild + test des 5 gestes** (§2) avec photos **et une vidéo** — fait, validé.
2. ~~Sauvegardes~~ → **livrées §113** ; lancez `7_PROGRAMMER_SAUVEGARDE_HEBDO.bat` une fois, et copiez `sauvegardes\` sur clé USB chaque semaine.
3. ~~Synchro~~ → **TERMINÉE §115/§117/§118/§119** (Mängel, PROJETS, photos/vidéos, HTTPS local pour le téléphone). Pour l'activer : double-cliquez `8_ACTIVER_HTTPS_LOCAL.bat` puis une confiance à poser par téléphone — `docs/HTTPS_LOCAL.md` (3 gestes, tableau de preuves).

Le reste attendra votre décision. Comme toujours : **l'essentiel d'abord, prouvé par des chiffres, rien de caché.**
