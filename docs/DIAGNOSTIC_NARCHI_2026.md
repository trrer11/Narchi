# 🔍 Diagnostic complet de NARCHI — état réel, failles, plan « waw »

_Document interne (août 2026). Rédigé sans complaisance : chaque point est
vérifié dans le code ou sourcé depuis des forums/enquêtes d'architectes.
Objectif : transformer NARCHI de « démo sympa » en outil **indispensable**
pour un Architekturbüro professionnel._

---

## A. Ce qui est réellement solide aujourd'hui ✅

| Domaine | Preuve |
|---|---|
| Import IFC + parsing worker + indexation des éléments | `ifc_routes.py`, worker watchdog, 1 814 éléments indexés sur ta capture |
| Estimation DIN 276 structurée KG + badge DIN + année de prix choisie | `estimation_routes.py`, cache Redis, carte « Kostenschätzung nach DIN 276 » |
| Charta « kein Preis ohne Herkunft » (§36, badges Messung/Richtwert/Regel) | doctrine appliquée dans l'UI |
| Preisbibliothek : import CSV/GAEB X31 avec aperçu avant intégration | `Preisbibliothek.tsx`, routes prix |
| Sécurité : XSS sanitizer, CSP stricte, cookies HttpOnly, rate limiting 6 endpoints (§60) | tests `ChatSecurity`, `test_rate_limiter` (15) |
| Multi-tenant réel avec intercepteur (fuite impossible, testé) | `tenant_interceptor.py` |
| Messenger d'équipe calibré pixel-perfect (§61-63) | `FloatingChat.tsx`, 390 tests front |
| Archivage doux des canaux, jamais de suppression (§59) | migration `20260808_05` |
| 206 tests backend + 390 tests frontend à chaque commit | CHANGELOG §51-§65 |

## B. Ce qui ne va PAS bien — la vérité ❌

### P0 — Mensonges involontaires de l'interface (dangereux pour ta crédibilité)
1. **« IFC/DWG hochladen » est faux à 50 %.** Le backend ACCEPTE `.dwg`,
   `.dxf`, `.rvt` (`_ALLOWED_EXTENSIONS`) mais ne PARSE que `.ifc/.step`
   (ligne 317 de `ifc_routes.py`). Un architecte qui dépose un DWG ne
   reçoit rien. → Le premier testeur allemand tombera dessus en 5 minutes.
2. **« Crew Agents — 6 KI-Experten »** : si `OPENAI_API_KEY` n'est pas
   configurée, que montre l'écran ? À vérifier/verrouiller : jamais de
   réponse simulée. Dégradation honnête obligatoire.
3. **Prix de référence BKI absents** : la Preisbibliothek ne vit que des
   prix importés par l'utilisateur. Les Richtwerte affichés doivent tous
   avoir une année + une source visibles (charta §36) — audit à faire
   page par page.

### P1 — Le produit s'arrête avant le « moment waw »
4. **Aucun livrable client** : une Kostenschätzung reste à l'écran. Le
   « waw » d'un architecte = un **PDF imprimable, avec son logo**, prêt à
   envoyer au Bauherr. Aujourd'hui : rien.
5. **Pas de collaboration temps réel** (les forums le demandent :
   « real-time, multi-user collaboration with clear traceability »).
6. **Lecture seule sur chantier/tablette** non pensée (ORCA aussi est
   faible là-dessus = opportunité).
7. **DWG/Revit** : 90 % des petits bureaux sont sur AutoCAD/Revit, pas
   sur IFC-first. Sans eux, l'entonnoir d'essai se bouche.

### P2 — Dettes de fond
8. **HOAI-Novelle 2026** : la HOAI 2021 référence encore DIN 276-1:2008 ;
   la nouvelle HOAI (attendue 2026) rendra la DIN 276:2018 contraignante.
   Prévoir le **basculeur de version normative** maintenant = avance
   marketing gratuite (« déjà prêt pour la HOAI 2026 »).
9. **Pas d'invitation par lien** : inviter un testeur = créer un compte à
   la main (voir guide bêta). Un token d'invitation par e-mail serait le
   standard SaaS.
10. **Monoposte** : tout tourne sur ton PC. Pour tester à plusieurs →
    VPS (voir guide).
11. **XRechnung / e-Rechnung** : obligatoire en réception pour beaucoup
    d'acheteurs publics ; à prévoir dans le module HOAI/facturation.

## C. Ce que disent les architectes (recherche forums/réseaux — août 2026)

Sources : forum Allplan (campus.allplan.com), r/Architects, r/bim,
r/estimators, tests ORCA AVA (ki-syndikat.de), enquêtes
Bundesingenieurkammer / BAK 2024.

1. **« Kompliziert und benutzerunfreundlich »** — un utilisateur Allplan
   explose : données gigantesques (100 Mo là où une DWG fait 4 Mo), VPN
   qui met des minutes, licence bloquée si on oublie de se déconnecter au
   bureau. → **NARCHI = navigateur, zéro installation, zéro licence
   machine.** C'est ton argument n°1.
2. **ORCA AVA** (le standard AVA allemand) : « Desktop-First ist ein
   echtes Komfortproblem », pas de vraie solution navigateur, viewer
   mobile en lecture seule, périmètre complet seulement en édition
   Enterprise chère, **pas de gestion de projet ni de communication
   d'équipe**. → NARCHI couvre déjà communication + projet ; battre ORCA
   = être **plus rapide, dans le navigateur, moins cher**.
3. **Reddit r/Architects** : « I expect this from free software, not
   something that costs thousands! » — la lenteur (« snappy like 2024,
   not hourglass like 1997 ») est un grief majeur des outils de gestion
   de cabinet. → Garder NARCHI **instantané** (cache Redis, pagination
   keyset) : c'est un avantage concurrentiel mesurable.
4. **Reddit r/bim + r/estimators** — les vraies douleurs coût :
   - prix et specs éparpillés dans plusieurs fichiers ;
   - des heures à réparer des formules Excel ;
   - « presque tout le monde finit dans Excel pour l'assemblage final » ;
   - le goulot = **Phase 2→3 : transformer l'estimation en proposition
     client** (PDF, mise en page) ;
   - historique des prix qui se perd (sous-traitants, marché) ;
   - **mapping WBS ↔ classification** (Uniclass/Omniclass) : un système
     « plug & play » est explicitement demandé.
   → Chacune de ces phrases est une fonctionnalité NARCHI à vendre.
5. **Enquêtes BAK/bIngK** : seuls ~28 % des bureaux utilisent BIM ;
   freins : non exigé par les clients (59-64 %), pas de Mehrwert visible
   (61 %), **coût d'entrée — « pour les petits bureaux financièrement
   inabordable »** (29 %, surtout < 10 salariés), manque de guides.
   → Segmentation claire : **viser d'abord les bureaux de 1 à 10
   personnes**, avec un discours « BIM sans investissement ».

## D. Comment rendre NARCHI indispensable — plan priorisé

### Vague 1 (2 semaines) — honnêteté + « waw » immédiat
| # | Tâche | Techno | Effort |
|---|---|---|---|
| 1 | Corriger le mensonge DWG : soit parser DXF/DWG, soit afficher « bientôt » et refuser proprement | **ezdxf** (pur Python) pour DXF ; **ODA File Converter** (gratuit) DWG→DXF en amont Celery | 2-3 j |
| 2 | **Export PDF Kostenschätzung** : DIN 276 + logo du bureau + badges d'origine des prix + date | **WeasyPrint** (HTML→PDF, déjà du CSS maison) | 2 j |
| 3 | Verrou « pas de clé IA » : Crew Agents affiche l'état réel (« nicht konfiguriert ») jamais de simulation | existant | 0,5 j |
| 4 | Page d'accueil : bouton « Beispielprojekt laden » (petit IFC démo livré) pour essai sans fichier | asset + route | 1 j |

### Vague 2 (1-2 mois) — différenciation
| # | Tâche | Techno | Effort |
|---|---|---|---|
| 5 | exports GAEB **X83** (LV) + **DA11** en plus de X31 | `gaeb` XML (Python, lxml) | 4 j | ✅ **LIVRÉ §90/§91/§92/§93 (10 août 2026)** : X31 export du LV co-édité (ohne/mit Preise), import offres entrantes (parseur à refus motivés, centimes), Angebotsvergleich (verdict parmi les complètes), **émission X83 (DP=83) de l'Angebot retenu** depuis les prix vérifiés. DA11 (catalogue articles) : non entamé, énoncé. |
| 6 | Historique de prix par position + graphique d'évolution + alerte « prix > 12 mois » | schéma existant + recharts | 3 j |
| 7 | Collaboration temps réel sur quantités/notes (curseurs, verrous doux) | **Yjs** (CRDT) via WebSocket Redis existant | 1 sem | ✅ **ÉTAPES 1+2 faites (§78/§81)** : présence + verrous doux (REST honnête) puis co-édition texte CRDT live (Yjs↔pycrdt/yrs, persistance PG, pont Redis inter-workers). Reliquat vague 3 : curseurs dans le texte, co-édition des quantités structurées
| 8 | Bascule DIN 276:2008 ↔ 2018 + drapeau « HOAI-Novelle 2026 ready » | mapping KG (déjà deux mondes dans les forums) | 2 j |
| 9 | Invitations par e-mail (token signé, expiration 72 h, rejoindre le tenant) | JWT (déjà PyJWT) + SMTP | 2 j |
| 10 | Mode chantier : socle PWA (bureau) + page photos de chantier avec tri intelligent (idée client) | responsive + PWA | 3 j | ✅ **LIVRÉ §101+§103+§104 (10 août 2026)** : socle PWA **poste de bureau** (installable localhost, icônes PNG réelles, SW écrit main, /api/ jamais caché, pastille « nouvelle version » persistante — vérif honnête : pas de SW sur téléphone en simple HTTP local). Voie « tout sur téléphone » §102 supprimée §103 (nettoyage demandé par le client). Page « Baustelle » **§104, idée client** : import JPEG au bureau (glisser-déposer), tri par vraie date EXIF (parseur maison littlé/big endian testé, repli nom puis date fichier, source toujours affichée), groupes « Besuch » + séances > 10 min, sélection → Mangel réel daté du jour de la photo la plus ancienne, photos en blobs IDB (cockpit incl.), balayage des orphelines ; **§105** : multi-format JPEG/PNG/WebP/GIF/BMP (EXIF aussi depuis PNG eXIf et WebP RIFF), HEIC refusé expliqué (réglage iPhone donné), pass visuel premium. **Pas** d'analyse de contenu (« keine Bilderkennung », dit à l'écran), **pas** de synchro inter-appareils (pas d'API Issues — décision produit, pas un bug). |

### Vague 3 (trimestre) — profondeur marché
| # | Tâche | Techno | Effort |
|---|---|---|---|
| 11 | Base de prix de référence licenciée (BKI ou alternative ouverte type SIRADOS) avec badge « Lizenz » | accord licence + ETL | délai licence |
| 12 | BCF (BIM Collaboration Format) import/export des issues | open standard BCF-XML | 3 j |
| 13 | XRechnung/ZUGFeRD pour les factures HOAI | `factur-x`/`mustangproject` côté génération PDF | 3 j |
| 14 | Analytique rentabilité bureau (PracticeMgmt existe : l'alimenter en données réelles facturables) | existant + reporting | 1 sem |

### Ce qui rendra NARCHI « waw » (formule)
**« IFC déposé → 60 secondes → Kostenschätzung DIN-276 avec sources →
PDF client avec mon logo. »** Aucun concurrent allemand ne fait ça dans
un navigateur à un prix de petit bureau. Tout le reste (IQ, twin, LCA)
est du bonus.

## E. Risques à surveiller
- **Responsabilité** : badges et disclaimers sur chaque chiffre (déjà
  §36) — un architecte reste responsable de ses Schätzungen (±20-30 %
  tolérance usuelle LPH 2 : l'afficher = crédibilité juridique).
- **Licences de prix** : ne jamais embarquer de données BKI sans licence.
- **DSGVO** : hébergement DE obligatoire pour le SaaS (Hetzner
  Falkenstein/Nürnberg), DPA à préparer, registre des traitements.
- **AGB/Datenschutzerklärung** : à rédiger avant la moindre bêta publique.

---
_Prochaine étape recommandée : lire `docs/BETA_TEST_GUIDE.md` puis
lancer la Vague 1 (tâches 1-4)._
