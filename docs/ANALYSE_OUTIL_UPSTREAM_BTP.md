# Analyse de l'outil BTP open source indiqué par le client (§114)

**Date : 12 août 2026 · demande : « vérifie encore une fois cet outil et utilise-le pour améliorer Narchi ».**
**Note d'anonymisation : le nom/l'URL du projet n'apparaissent volontairement nulle part ici — règle d'anonymisation du dépôt Narchi (grep de garde à chaque commit). Je l'appelle « l'outil ».**

---

## 1. Ce que j'ai fait, concrètement

Pas une opinion : j'ai **cloné le dépôt** (8 189 fichiers), lu la licence, le README, le guide des modules, et compté ce qui s'y trouve. Tout ce qui suit est **mesuré sur le code**.

## 2. Ce qu'est l'outil (mesuré, pas cru sur parole)

| Mesure dans le clone | Valeur |
|---|---|
| Modules métier backend | **189** (BOQ/GAEB, takeoff DWG/PDF, BIM, planning 4D, coûts 5D/EVM, appels d'offres, chantier, sécurité, documents/CDE, CRM, IA…) |
| Fichiers de tests backend | **1 431** |
| Fichiers Python backend | 4 152 |
| Packs régionaux | Allemagne (pack Hessen/BIM), France (Batimatech), Brésil (SINAPI), Chine, Australie… |
| Données embarquées | ~78 Mo (catalogues, règles BIM, gabarits) |
| Empaquetage | Docker, `pip install`, et **app de bureau (Tauri + PyInstaller)** .exe/.dmg/.deb |
| Traductions | revendiqué 29 langues |
| Process | CLA, licences tierces documentées, releases signées Sigstore, CodeQL — projet sérieux |

C'est un **bon projet**, vivant, structuré, beaucoup plus large que Narchi en surface. Ma réponse « gros logiciel = danger » du rapport §112 reste vraie **pour l'intégration en masse** — mais votre injunction est juste : il y a de la valeur à en tirer. Voici comment, sans se mentir.

## 3. Le point qui décide tout : la licence

**AGPL-3.0 + licence commerciale sur demande** (© de l'auteur, petite entreprise allemande).

En langage simple : si je **copiais son code** dans Narchi, l'AGPL (§13, « copyleft réseau ») pourrait vous obliger à **publier tout le code de Narchi** — fin du produit propriétaire que vous voulez vendre. Donc :

| Action | Verdict |
|---|---|
| Copier un fichier / fonction de l'outil dans Narchi | ❌ **Interdit** (sauf achat de la licence commerciale — possible, contact public, mais = coût et dépendance à négocier) |
| Étudier son architecture et réécrire proprement à partir du **standard public** | ✅ Autorisé — les idées/standards ne sont pas copyrightables ; c'est ce que j'ai fait au §114 |
| Faire tourner l'outil **tel quel**, à côté de Narchi, en service séparé non modifié | ✅ Légalement propre (pas de lien → pas de contamination) ; option de dernier recours si un jour une fonction géante nous manque |
| Reprendre ses catalogues de données (78 Mo) | ⚠️ Provenance non prouvée → **on ne touche à rien** sans traçabilité de licence chaque fichier |

## 4. Ce que j'en ai pris CETTE FOIS (livrée, testée) : les fondations E-Rechnung

Mon carnet §112 disait : E-Rechnung « cadrage propre requis » (obligation allemande d'**émission 2027/2028**). L'outil possède un module complet (profils par pays, moteur de règles, embarqué PDF). J'en ai étudié **l'architecture**, puis j'ai écrit NOTRE propre fondation, en salle blanche, sur le standard public (EN 16931-1 / CII D16B / identifiants XRechnung KoSIT) :

**`backend/app/services/xrechnung.py`** — constructeur de facture électronique :
- **Aucune valeur inventée** : champ obligatoire manquant = refus d'émettre avec la liste exacte des violations (ex. Leitweg-ID BT-10 obligatoire en XRechnung, date de livraison OU période, USt-IdNr du vendeur) — jamais de numéro de TVA fabriqué ;
- argent en **Decimal** (floats refusés), TVA regroupée par taux avec arrondis **épinglés au centime** par les tests (3 × 33,3350 → 100,01 ; 19 % → 76,00 ; 7 % → 6,13 ; TTC 569,64) ;
- unités UN/ECE Rec 20 en table réduite assumée (unité inconnue = violation, pas de substitution muette) ;
- XML **relu** par les tests (structure, namespaces, échappement `& < >`, format de dates) et **déterministe** (deux constructions = octets identiques) ;
- périmètre DIT : catégorie TVA « S » (normale + réduite) uniquement ; exonérations/autoliquidation = jalon suivant, pas mappées au hasard.

**7 nouveaux tests backend** (suite totale page suivante).

## 5. Ce que l'outil confirme pour la feuille de route (sans copier)

| Capacité vue chez l'outil | État Narchi | Action |
|---|---|---|
| E-Rechnung multi-profils (XRechnung, UBL/Peppol, ZUGFeRD PDF/A-3) | fondations CII §114 + chaîne complète §116 + **validateur officiel KoSIT passé §123** (XRechnung 3.0.2, 13/08/2026, verdict « ACCEPTABLE », rejouable via `scripts/valider-xrechnung-kosit.sh`) | Jalons restants : job CI hébergé branché sur le script §123 → UBL/Peppol → embarqué PDF/A-3 → Versand |
| Moteur de règles de conformité (33 Ko de règles BR-CO/BR-DE) | règles propres NARCHI-XR-… | **Alignement §123 FAIT** au moment promis : les codes officiels BR-DE-1 (BG-16), BR-DE-2 (BG-6), Peppol R005/R010/R020 ont été mesurés par le validateur et sont désormais exigés/refusés honnêtement par notre module |
| Phases GAEB/DA11 complètes | import + export LV/offre GAEB déjà présents (`gaeb_import`, `gaeb_lv_export`, `gaeb_offer_export`) ; DA11 en backlog | P1 backlog confirmé comme demande réelle du marché |
| App de bureau « tout-en-un » (Tauri) | Docker Desktop | Non nécessaire tant que Docker vous convient ; noté option lointaine |
| 4D/planning, marketplace de modules | hors besoin client | **Écartés** (essentiel d'abord) |

## 6. Verdict tenu à jour

§112 disait « non à un gros ERP ». Nuancé par l'inspection réelle : **non à l'intégration**, **oui à l'étude systématique** — à chaque capacité majeure qu'il nous manque, je fais ce que j'ai fait ici : j'analyse son approche, j'écris la nôtre à partir du standard, tests à l'appui, et je vous cite la différence. Ligne rouge incompressible actée : **zéro ligne AGPL dans Narchi** sans licence commerciale signée.
