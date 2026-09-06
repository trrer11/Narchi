# Narchi face au réel — beta 3-5 bureaux, concurrents, chances, prix

**Date : 12 août 2026 · §120. Demande exacte : « je veux un rapport
réel, pas de fantaisie ou pour me flatter. » Ce document applique la
règle de la maison : ce qui est mesuré/livré est marqué ✅, ce qui est
une estimation est marqué RICHTWERT (ordre de grandeur), ce que je ne
sais pas est marqué INCONNU. Les prix concurrents cités sont publics
(source et date à chaque ligne) — à revérifier avant tout usage
marketing.**

---

## PARTIE 1 — À combien % Narchi est-il prêt pour une beta 3-5 bureaux ?

### 1.1 La grille (chaque ligne pèse ce qu'elle pèse — la note n'est pas une humeur)

| Dimension | Poids | Note | Pourquoi (preuves à l'appui) |
|---|---:|---:|---|
| **Cœur produit testé** (IFC→DIN 276, GAEB X31/offres/X83, HOAI, E-Rechnung, chat, collab) | 25 % | 90 % | 489 tests backend ✅, 657 tests frontend ✅ au 12/08/2026, chaînes métier bouclées de bout en bout par tests. −10 % : un seul utilisateur a réellement cliqué ces écrans (vous). |
| **Synchro multi-appareils** (le sujet du moment) | 15 % | 55 % → **70 % au §121** (13/08, voir ADDENDUM) | Moteurs éprouvés ✅ (fichiers, projets, Mängel, tombstones, hors-ligne), HTTPS livré §119 ✅, 5 gestes critiques éprouvés en navigateur réel §121 ✅. **MAIS : jamais encore exécuté par vous sur un vrai téléphone** — le guide existe (§120), le premier vrai essai n'a pas eu lieu. C'est LE point rouge actuel. |
| **Fiabilité / données** | 15 % | 85 % | Sauvegardes §113 avec restauration **rejouée sur vrai PostgreSQL** ✅, isolation inter-bureaux testée 404 + clé composite ✅, sessions/pw stables §87 ✅. −15 % : un seul déploiement réel (le vôtre), zéro essai multi-bureaux réel mené. |
| **Sécurité** | 15 % | 75 % | Argon2id, CSP stricte, rate-limit, TLS local §119, guards CI. −25 % : **aucun pentest externe**, aucune revue indépendante — mon auto-évaluation ne vaut pas audit. INCONNU jusqu'à preuve. |
| **Ops & installation chez un tiers** | 15 % | 40 % | Install via .bat documentés ✅, migrations auto ✅, diagnostic ✅. MAIS : Windows + Docker Desktop exigé, installation/MAJ manuelles par bureau, pas d'installateur unique, pas de télémetrie de panne, support = une personne. |
| **Juridique / conformité vente** | 10 % | 35 % → **50 % (§123)** | E-Rechnung : ~~XML pas encore passé au KoSIT~~ → **validateur officiel KoSIT passé §123** (verdict mesuré, rejouable) ; toujours : pas d'AGB/CGV, pas de contrat beta, pas de DPA, page légale absente. |
| **Documentation / onboarding client** | 5 % | 55 % | Docs FR excellentes pour vous ; UI 100 % allemande ✅ ; doc utilisateur final allemande partielle ; formation = bouche-à-oreille. |

**Calcul honnête :** 25×0,90 + 15×0,55 + 15×0,85 + 15×0,75 + 15×0,40 +
10×0,35 + 5×0,55 = **~70 %**

### 1.2 Verdict sans maquillage

> **Narchi est à ~70 % de la beta telle que vous l'imaginez — et c'est
> un « GO encadré », pas un « GO libre ».**

- **GO** pour : 3-5 bureaux **qui connaissent le projet**, sur lesquels
  vous avez la main (vous installez, vous êtes joignable), données NON
  critiques le premier mois, contrat beta écrit qui dit « logiciel en
  essai — tenez votre outil actuel en parallèle ».
- **PAS ENCORE** pour : des bureaux inconnus payants en production
  réelle dont le chiffre d'affaires du mois dépend de Narchi.

### 1.3 Ce qui manque pour passer de ~70 % à 90 %+ (dans l'ordre d'impact)

1. **LE vrai test téléphone chez vous** (guide §120 — 30 min) — sans
   ça, la synchro reste « prouvée en sandbox » : +10 pts directs sur la
   ligne synchro.
2. **2-3 tests navigateur réels** (Playwright) sur les 5 gestes
   critiques — aujourd'hui 0 test bout-en-bout navigateur.
3. **Validateur KoSIT** sur une facture réelle (jalon §116 déclaré) —
   ~~avant toute vente liée à la facturation~~ ✅ **FAIT (§123)** — voir
   addendum : verdict officiel « ACCEPTABLE », 6 défauts réels corrigés.
4. **Installateur unique + procédure de mise à jour** pour les bureaux
   beta (le support manuel ne scale pas à 5 PC).
5. **Contrat beta + CGV + clause données** (indispensable dès qu'une
   donnée d'un TIERS entre dans le produit).
6. Pentest externe quand les premiers bureaux paient (pas avant :
   cher, et le produit bouge encore). INCONNU assumé jusque-là.

---

## PARTIE 2 — Les concurrents réels (prix publics au 12-13/08/2026)

### 2.1 Le terrain est en DEUX pièces — et Narchi est dans les deux

**Pièce A — chantier (Mängel/photos/rapports) :**

| Concurrent | Prix public constaté | Source (date) |
|---|---|---|
| **PlanRadar** (Vienne) | Basic 26 €/mois (1 utilisateur ; 10 plans) · Starter 89 €/mois (≤10 util.) · Pro 129 €/mois (≤10) · Enterprise sur devis · sous-traitants gratuits | ki-syndikat.de, 14/06/2026 [^pr] |
| **Capmo** (Munich) | Prix selon volume de construction, **non publics** ; assistant IA 2025 (Nachträge vs VOB/C) | bau-master.com, 28/04/2026 [^bm] |
| **smino** (Swiss) | Basic **948 CHF/an/utilisateur** (~79 CHF/mois) | capterra.com, 06/2026 [^sm] |
| **BauMaster** (Autriche) | dès 79 €/utilisateur/mois | bau-master.com, 04/2026 [^bm] |
| **123erfasst** | gratuit limité, dès ~10-19 €/mois | planradar.com 03/2025, handwerk-digitalisieren.de 02/2025 [^hd] |
| **Dalux Field** (Danemark) | Basic **gratuit** ; Standard ~7 €/mois (converti) | planradar.com, 03/2025 [^pd] |
| **Fieldwire** (Hilti) | Basic gratuit ; Pro dès 39 €/mois | planradar.com, 03/2025 [^pd] |
| **Gripsware pro-Report** | dès 65 €/utilisateur/mois — **cible exacte : architectes HOAI LP8** | bau-master.com, 04/2026 [^bm] |
| **CENDAS** (Würth) | dès 79 €/utilisateur/mois | bau-master.com, 04/2026 [^bm] |
| **Procore** | sur devis uniquement (volume) — enterprise | bau-master.com, 04/2026 [^bm] |

**Pièce B — coûts/AVA (là où vit le cœur de Narchi) :**

| Concurrent | Prix public constaté | Source (date) |
|---|---|---|
| **BKI Kostenplaner + IFC-Mengenermittler** | pack dès **1 299-1 545 €** (achat, hors TVA) ; données BKI payantes | bki.de, 2026 [^bki] |
| **RIB iTWO** | aucune liste publique ; rollouts 6-18 mois ; coûts annuels réalistes **cinq à six chiffres** (enterprise) | ki-syndikat.de, 06/2026 [^rib] |
| **ORCA AVA**, **Allplan BCM**, **KSD**, **Dr. Schiller** | licences traditionnelles, devis — RICHTWERT : centaines à ~2 000 €/poste/an selon module**s** | connaissance marché — INCONNU exact, à vérifier produit par produit |

**Ce que montre la table, sans romantisme :**
- EN PIÈCE A, tout le monde vend **par utilisateur** sauf PlanRadar en
  packs ≤10. Un bureau de 5 personnes paie ~90-130 €/mois juste pour
  les Mängel.
- EN PIÈCE B, l'entrée est un **achat à 1 300-1 500 €** (BKI) ou un
  gouffre enterprise (iTWO). Le milieu (petit bureau, coûts complets
  sans enterprise) est exactement le trou où NI l'un NI l'autre ne
  sert bien.
- **Personne ne couvre dans UN produit petit-bureau :** IFC→Kosten DIN
  276 + GAEB X31/offre/X83 + HOAI + Mängel-chantier + E-Rechnung.
  Narchi est le seul hybride de cette liste. C'est un fait de périmètre
  (✅ mesuré sur le code livré), pas une garantie de qualité supérieure.

### 2.2 La taille du gâteau (chiffres officiels)

- **~35 000 Architekturbüros** en Allemagne ; **91 % ont moins de 10
  salariés**, 47 % sont des bureaux d'une personne (BAK, 2026) [^bak].
  Umsatz moyen par bureau ≈ 328 000 €/an (Destatis 2019) [^lf].
- Traduction honnête : votre marché naturel = **~20-30 000 petits
  bureaux** dont l'outil moyen est encore Word/Excel + une app de
  chantier. Un prix outil à 1 500-2 000 €/an = ~0,5 % du chiffre
  d'affaires moyen — soutenable pour un outil qui touche aux honoraires.

---

## PARTIE 3 — Dans quelle classe placer Narchi ?

**Classe : « KMU-Bausoftware » — logiciel de bureau d'architecture
complet pour 1-15 personnes, données 100 % chez le client.**

Pas enterprise (iTWO/Procore : vente impossible à ce stade — cycles de
6-18 mois, exigences de sécurité hors de notre portée aujourd'hui).
Pas « app gratuite de chantier » (Dalux Basic/123erfasst : hors-sol
fonctionnellement à côté de la chaîne coûts+HOAI+GAEB).

**Positionnement en une phrase (honnête) :**
> « Ce que BKI fait pour la pièce coûts et PlanRadar pour la pièce
> chantier, Narchi le fait pour les DEUX pièces plus le back-office —
> pour le prix d'une seule des deux, et vos données restent chez vous. »

**Atouts réels (vérifiables dans le livré) :**
1. Chaîne GAEB **complète** X31 → offres entrantes → comparaison → X83
   (§89-§97, testée) — les apps de chantier n'ont rien de tel.
2. Prix **au bureau**, pas à l'utilisateur (modèle inverse du marché).
3. Données **chez le client** (atout DSGVO argumentable en face-à-face).
4. Baignoire de prix **explicable** (Jahrgang, médiane ≥2 observations,
   écart % affiché — §96-§99) : confiance = vente.
5. E-Rechnung prête **avant** l'obligation 2027/28 — argument
   calendaire concret.

**Faiblesses réelles (à dire au client beta avant qu'il ne les trouve) :**
1. **Bus factor 1** : un seul développeur (moi) + un seul pilote (vous).
2. Pas d'app store ; Windows + Docker exigés ; installation manuelle.
3. Aucune certification, aucune référence publique, aucun logo client.
4. Pentest absent ; KoSIT non passé ; contradictoire devant expert
   comptable non éprouvé (GoBD : cycle logiciel testé, mais jamais
   encore discuté avec un Steuerberater réel).
5. Zéro connecteur (DATEV, Outlook, Lexware…) — les bureaux demanderont.

---

## PARTIE 4 — Les chances de percer : réel, pas du cinéma

**Ce qui joue POUR :**
- Obligation calendaire : **émission E-Rechnung 2027/28** — chaque
  bureau devra bouger ; « déjà prêt » est une vraie carte.
- Ras-le-bol documenté des abonnements par utilisateur (les forums
  d'artisans en parlent ; prix ci-dessus parlent d'eux-mêmes).
- 47 % de bureaux solo : sensibles au prix fixe et hébergé chez soi.
- Vous serez **la première référence** — irremplaçable.

**Ce qui joue CONTRE (le plus dur à entendre) :**
- **Inertie** : un bureau change d'outil tous les 10-15 ans. Les
  concurrents ont des années de références et des équipes de vente.
- Le bas du marché est **gratuit** (Dalux Basic, 123erfasst) : beaucoup
  de bureaux « se contentent ».
- Sans référence publique, chaque vente dépend de VOUS en face-à-face :
  ~0 vente passive la première année à prévoir.
- **Estimation franche des chances, en scénarios** (RICHTWERT — mon
  jugement, pas une mesure) :
  - Scénario « beta seule » (5 bureaux amis, rien de plus) : **proche
    de 100 %** d'apprentissage, ~0 €.
  - Scénario 3 ans, effort commercial continu (vous 0,5-1 j/sem) :
    **30-60 bureaux payants** est une fourchette sérieuse ; 150+ exige
    une recrue commerciale ou un partenaire régional.
  - « Percée » style leader de catégorie : **< 5 %** — ne jamais baser
    un plan de trésorerie dessus.
- Le facteur qui fait basculer entre 30 et 60+ : la **vitesse de
  résolution des retours beta**. C'est votre seul avantage sur RIB :
  vous pouvez livrer en une semaine ce qu'ils livrent en un an.

## PARTIE 5 — Le prix recommandé (et pourquoi)

Ancrages mesurés : PlanRadar Starter 89 €/mois (≤10) = **1 068 €/an** ;
smino ~950 CHF/an/**utilisateur** (2 850-4 750 €/an pour 3-5 pers.) ;
BKI coûts seul ~1 299-1 545 € **une fois** ; le bureau moyen encaisse
~330 k€/an.

**Recommandation (modèle par bureau, pas par utilisateur) :**

| Formule | Prix | Contenu |
|---|---:|---|
| **Beta (3 mois, 3-5 bureaux)** | **0 €** | contre un compte-rendu écrit hebdomadaire + droit de citation comme référence (même anonymisée : « bureau de NRW, 6 pers. ») |
| **Licence bureau** | **1 790 €/an** TTC | tout inclus : utilisateurs illimités du bureau, mises à jour, support raisonnable. Se place à ~1,7× PlanRadar Starter **en couvrant 5× plus de périmètre** — l'argument tient en une démo. |
| **Alternative achat unique** | **3 900 € + 690 €/an** de maintenance | pour les bureaux allergiques à l'abonnement (il y en a beaucoup dans cette classe). |

**Ce qu'il ne faut PAS faire (d'expérience de marché, dit franchement) :**
- Pas de « 19 €/mois » : à ce prix, vous êtes le concurrent de Dalux
  gratuit — et vous ne vivrez jamais du support qu'exige un logiciel
  métier.
- Pas d'enterprise « sur devis » : vous n'avez ni les certifications ni
  l'équipe ; un devis perdu = 3 mois brûlés.
- Pas de gratuité sans contrepartie en beta : une beta gratuite SANS
  feedback écrit n'est pas une beta, c'est un cadeau.

## PARTIE 6 — L'ordre des prochaines actions (si vous dites GO)

1. **Vous** : le guide téléphone pas-à-pas (30 min — `docs/GUIDE_TELEPHONE_PAS_A_PAS.md`). Sans ce premier vrai essai, tout le reste est théorie.
2. ~~Moi : 2-3 tests Playwright navigateur réel~~ ✅ **FAIT (§121, 13/08)** — voir addendum ci-dessous.
3. ~~Moi : passage validateur KoSIT + fix éventuel (jalon §116)~~ ✅ **FAIT (§123, 13/08)** — 6 défauts trouvés et corrigés, verdict « ACCEPTABLE » sur les 2 profils + chemin API, voir addendum §123 ci-dessous.
4. Vous+moi : 1 page de contrat beta + choix des 2 premiers bureaux.
5. Ensuite seulement : page de présentation + prix publiés.

---

## ADDENDUM §121 (13/08/2026) — l'action 2 est livrée, chiffres mesurés

Vous avez dit « supposons que ça fonctionne, on essaie après — GO la
prochaine étape ». La voici, terminée : **suite de tests navigateur réel
(Playwright, vrai Chromium, vrai serveur, vraie base)**, 5 volets verts
en **31 s** — rejouable chez vous par `cd frontend` puis `npm run e2e`
(stack démarrée par `1_DEMARRER_NARCHI.bat` ; détails et lois dans
`frontend/e2e/README.md`).

| Volet automatisé | Ce que ça prouve | Mesuré |
|---|---|---|
| Création de compte / connexion (allemand réel) | formulaire + refus visible d'un mauvais mot de passe + entrée au cockpit | 4,8 s |
| Projet créé au bureau vu sur un 2e appareil | tirage serveur §118 (la plainte d'origine) | 6,0 s |
| Mangel **+ photo** vu sur le 2e appareil, photo décodée | versement + pull-through réels | 8,5 s |
| **Mode avion automatisé** | file hors-ligne honnête + rattrapage, vérifiés sur appareil frais | 7,8 s |
| Vraie IFC parsée dans le navigateur | Mengenliste remplie (KG, m³, €, CO₂) | 3,0 s |

**Bonus sérieux : le volet 3 a attrapé un VRAI bug** — au tout premier
démarrage d'un appareil, un Mangel pouvait rester « garé » invisible à
vie (course entre les tirages Mängel/Projets). Corrigé, épinglé par 4
tests unitaires + 2 volets E2E (détails : `docs/SYNCHRO_MANGELS.md` §121).
Genre de panne qu'un test manuel d'une fois ne voyait pas — et qu'un
bureau beta aurait vu à coup sûr.

**Mise à jour de la note « Synchro multi-appareils » (PARTIE 1 : 55 %)** :
je la porte à **70 %**. Ce qui a changé : les 5 gestes critiques passent
désormais en navigateur réel **et en continu** (rejouable à chaque
version, pas une fois). Ce qui N'A PAS changé : vous n'avez toujours pas
fait l'essai sur **votre téléphone physique** (Safari iOS ≠ Chromium ;
votre box/Wi-Fi ≠ mon sandbox). L'action 1 reste la première de la liste.

---

## ADDENDUM §123 (13/08/2026, soir) — l'action 3 est livrée : nos factures VALIDÉES par le logiciel officiel de l'État

Carte blanche renouvelée → j'ai pris l'action 3 de la liste : **passer nos
factures au validateur officiel KoSIT**. C'est le programme que publie
l'Allemagne pour répondre à UNE question : « cette e-facture est-elle
conforme, oui ou non ? ». Verdict mesuré ce jour : **OUI, pour les deux
profils** — et le doute « invendable avant KoSIT » est soldé.

### Ce qui a été exécuté, exactement

- **KoSIT Validator v1.6.2** (JAR officiel, SHA-256 vérifié
  `24497851…79857e`) + **configuration XRechnung 3.0.2 parue le 31/01/2026**
  (SHA-256 `6a5a5911…082704`). URLs et empreintes épinglées dans
  `scripts/valider-xrechnung-kosit.sh` — **rejouable tel quel** (backend
  vert + `bash scripts/valider-xrechnung-kosit.sh`).
- **3 documents générés par NOTRE code** (aucun XML écrit à la main) :
  1. facture profil XRechnung (niveau service),
  2. facture profil EN 16931 (niveau service),
  3. facture du **chemin complet** (création → émission RE-2026-0001 →
     téléchargement, comme un vrai clic).
- Verdict du programme, le 13/08/2026 : *« Acceptance: ACCEPTABLE »* pour
  chacun, *« Acceptable: 3 — Rejected: 0 »*, **« Validation successful! »**.

### Le validateur a trouvé 6 VRAIS défauts — tous corrigés

Notre §114 était solide sur l'arithmétique et les montants, mais il lui
manquait des obligations que seul le logiciel officiel tranche :

| # | Défaut mesuré (message exact du validateur) | Correctif livré |
|---|---|---|
| 1 | « kein Prüfszenario gegriffen » — notre identifiant de profil reprenait l'ancien domaine `xoev-de` | identifiant officiel actuel `…xeinkauf.de:kosit:xrechnung_3.0` |
| 2 | Erreur XSD : élément `City` absent du schéma | nom officiel `CityName` |
| 3 | **BR-DE-1** : paiement (BG-16) obligatoire | champs **IBAN / titulaire / BIC**, émis en virement SEPA, refus honnête sans IBAN (NARCHI-XR-41/42) |
| 4 | **BR-DE-2** : contact vendeur (BG-6) obligatoire | champs **contact nom/téléphone/e-mail**, refus honnête (NARCHI-XR-45) |
| 5 | **Peppol R005** : processus métier (BT-23) obligatoire | valeur canonique PEPPOL proposée par défaut — **DITE**, modifiable (NARCHI-XR-43) |
| 6 | **Peppol R010/R020** : adresses électroniques vendeur/acheteur (BT-34/49) obligatoires | champs **e-mail** des deux côtés, refus honnête (NARCHI-XR-44) |

Conséquence produit visible : l'écran Rechnungen a gagné les blocs
allemands « Kontakt für Rückfragen » et « Bankverbindung » + les e-mails ;
la base gagne 9 colonnes (migration `20260813_18`). Aucun champ n'est
pré-rempli par une valeur inventée : vide = refus poli à l'émission, jamais
de fausse donnée glissée dans une facture officielle.

### Preuves archivées DANS le dépôt (le bac à sable s'évapore)

- `backend/tests/fixtures/xrechnung_kosit/` : les **octets exacts acceptés**
  par le validateur + règle d'or — une retouche qui change 1 octet casse un
  test et impose une **revalidation mesurée** avant toute mise à jour.
- `scripts/valider-xrechnung-kosit.sh` : la preuve complète rejouée en une
  commande (vérifiée ce jour en cours froid : téléchargements, empreintes,
  génération, verdict).
- Backend **495/495** (+6 épingles KoSIT), frontend **661/661** (le test
  existant a gagné les assertions des nouveaux champs ; pas de nouveau
  fichier), tsc 0 erreur, build OK — et l'E2E §121 **rejoué 5/5 en 30,0 s**
  (l'écran Rechnungen a changé → preuve re-mesurée, stack reconstruite) :
  chiffres du commit §123.

### Limites dites — ce que ça ne vend PAS encore

- La revalidation est **rejouable localement et préparée pour la CI**, mais
  aucune pipeline GitHub Actions n'a encore tourné depuis ce dépôt : le
  jalon « validation automatique à chaque version » reste à brancher.
- Le **Versand** (envoi réel par e-mail/Peppol), le PDF/A-3 (ZUGFeRD) et
  l'UBL restent des jalons ouverts, listés dans `docs/E_RECHNUNG.md`.
- La validation porte sur le **XML** : la délivrabilité réelle (plateformes
  ZRE/OZG-RE, Leitweg-ID de test) fera partie de la beta.

**Mise à jour de la note « Juridique / conformité vente » (PARTIE 1 :
35 %)** : je la porte à **50 %** (jugement §123, même échelle). Soldé : la
conformité e-facture prouvée. Reste : contrat beta, CGV, DPA, page
légale — c'est l'action 4, avec vous.

[^pr]: ki-syndikat.de/tools/planradar (consulté 14/06/2026) : Basic 26 €/mois (1 util.), Starter 89 €, Pro 129 € (≤10), sous-traitants gratuits.

[^bm]: bau-master.com/baublog/vergleich-maengelmanagement (28/04/2026) : BauMaster dès 79 €/util./mois, Gripsware pro-Report dès 65 €, CENDAS dès 79 €, Capmo selon volume (non public).
[^sm]: capterra.com/p/238653/smino (06/2026) : Basic CHF 948/an/utilisateur.
[^hd]: handwerk-digitalisieren.de/bausoftware-test (02/2025) : 123erfasst dès 19 €, PlanRadar 29 € (vue 2025), Fieldwire 39 €.
[^pd]: planradar.com « Bau Apps Vergleich » (13/03/2025) : Dalux Basic gratuit / Standard ~7 €, 123erfasst dès 10 €, Fieldwire Pro dès 39 €.
[^bki]: bki.de/bki-kostenplaner (2026) : Kostenplaner + IFC-Mengenermittler, packs dès 1 299-1 545 € HT.
[^rib]: ki-syndikat.de/tools/rib-itwo (06/2026) : pas de liste publique, rollouts 6-18 mois, coûts enterprise 5-6 chiffres/an réalistes.
[^bak]: BAK « Die Vermessung der Branche Architektur » (2026) : ~35 000 bureaux, 91 % < 10 salariés, 47 % solo.
[^lf]: listflix.de / Destatis 2019 : 38 278 bureaux, ~12,6 Mrd €, ~328 k€/bureau.
