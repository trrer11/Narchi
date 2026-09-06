# NARCHI · Niveaux de précision réels

> **Document de transparence honnête** : ce que NARCHI peut et NE peut PAS garantir.

## 🎯 Philosophie

Un prix exact n'existe pas en construction. Ce qui existe :
- Un **prix médian** (le plus probable)
- Une **fourchette honnête** (où le vrai prix tombera avec 80 % de probabilité)
- Une **traçabilité des sources** pour chaque chiffre

NARCHI vise la **précision honnête** : meilleure que les outils gratuits, transparente sur ses limites.

## 📊 Niveaux de précision par type de bâtiment

### 🟢 NIVEAU HIGH — Précision validée Destatis 2024

**Concerne** : EFH, DHH/RH, MFH (= 80 % des projets d'un bureau d'architecte allemand)

| Aspect | Précision typique | Source |
|---|---|---|
| **Bauwerkskosten** (€/m² Wohnfläche) | **±20 % (fourchette P10-P90)** | Destatis 61261 + LBS 2024 |
| **Régionalisation Bundesland** | ±5 % | Destatis ventilation par Land |
| **Großstadt-Zuschlag** | ±10 % | ARGE Q4/2024 + RegioKontext |
| **Indexation temporelle** | ±2 % | Destatis 61261 trimestriel |
| **Répartition KG (200/300/400/500/600/700)** | ±15 % | Profirechner + branche standard |

**Validation tests** : 28 tests automatisés vérifient que les chiffres restent dans les fourchettes Destatis réelles 2024.

**Exemple concret** : EFH 150 m² à Bayern, NARCHI dit :
- Bauwerkskosten médian : 433.000 €
- Fourchette P10-P90 : **342.000 € – 533.000 €**
- Cette fourchette **CONTIENT 80 % des projets réels** de cette taille en Bavière selon Destatis.

### 🟡 NIVEAU MEDIUM — Précision estimée BKI-orientée

**Concerne** : Büro, Schule, Kita, Krankenhaus, Hotel, Sporthalle, Parkhaus

| Aspect | Précision typique |
|---|---|
| **Bauwerkskosten** | ±30 % (fourchette plus large) |
| **Régionalisation** | ±10 % |
| **Répartition KG** | ±20 % |

**Pourquoi moins précis** : Destatis ne publie pas de ventilation détaillée par type de bâtiment non-résidentiel. NARCHI utilise des **BKI-Schätzwerte** issus de leseproben publics + extrapolations.

**Recommandation** : pour ces projets, NARCHI = bon outil d'**estimation initiale (LP 2/3)**, mais pour LP 6+ (Kostenanschlag), passer à un calcul détaillé avec licence BKI officielle ou sirAdos.

### 🔴 NIVEAU LOW — À utiliser avec prudence

**Concerne** : Produktion, Logistik, Industrie, Sondergebäude

| Aspect | Précision typique |
|---|---|
| **Bauwerkskosten** | ±40 % (fourchette très large) |

**Pourquoi** : ces bâtiments sont uniques par nature. Pas de données statistiques fiables hors étude personnalisée.

## 📈 Méthode Monte-Carlo

Pour les niveaux HIGH et MEDIUM, NARCHI utilise une **simulation Monte-Carlo** sur **1000 échantillons** suivant une distribution **log-normale** calibrée sur la **déviation standard réelle** de chaque type de bâtiment selon Destatis.

```
Distribution :  log(Coût) ~ Normal(μ, σ)
  où σ = ln(1 + écart-type-Destatis%)
  et μ = ln(Median) - σ²/2  (correction de biais)

Quantiles affichés :
  P10 = 10% des projets coûteront MOINS que ce chiffre
  P90 = 90% des projets coûteront MOINS que ce chiffre
  Médian = valeur centrale (= P50)
```

**Reproductibilité** : seed=42 fixé → même input = même output (utile pour comparer 2 versions d'un projet).

## ⚠️ Ce que NARCHI NE PEUT PAS faire avec précision

1. **Prédire un prix exact** — impossible en construction
2. **Garantir un budget** — ne remplace pas l'engagement contractuel d'un Generalunternehmer
3. **Capter les spécificités locales** — ex. coût d'un site difficile d'accès, fondations spéciales
4. **Prévoir les choix tardifs du maître d'ouvrage** — pierre naturelle vs carrelage, etc.
5. **Anticiper l'inflation au-delà de 2 ans** — l'extrapolation au-delà 2027 est très incertaine
6. **Évaluer les Bestand/Sanierungen complexes** — chaque rénovation est unique

## 🔬 Sources utilisées

| Source | Type | Fiabilité | Couverture |
|---|---|---|---|
| **Destatis 61261** Baupreisindex | Officielle publique | ⭐⭐⭐⭐⭐ | Tous Wohngebäude |
| **Destatis Bauwerkskosten** par Land | Officielle publique | ⭐⭐⭐⭐⭐ | Wohngebäude |
| **LBS Research Juli 2024** | Conso. Destatis | ⭐⭐⭐⭐ | Wohngebäude |
| **ARGE Q4/2024** Großstadt-Studie | Recherche privée | ⭐⭐⭐⭐ | MFH Grossstadt |
| **Europace EPX 2024** | Index marché privé | ⭐⭐⭐ | Neubau résidentiel |
| **BBSR Bauforschung** | Officielle | ⭐⭐⭐⭐ | Prognoses |
| **BKI Leseproben publics** | Extraits publics | ⭐⭐⭐ | Tous types |
| **Profirechner / haus.de / Volksbank** | Aggregateurs | ⭐⭐ | Conseils grand public |

Pour les calculs internes, NARCHI **priorise les sources officielles** (Destatis, BBSR) sur les sources privées.

## 🆙 Roadmap précision

| Version | Amélioration prévue |
|---|---|
| **v2.5** (actuelle) | ✅ Destatis 2024 vérifié pour EFH/MFH |
| **v2.6** (2026-Q4) | Intégration officielle ÖKOBAUDAT API (1400+ matériaux) |
| **v2.7** (2027-Q1) | Licence BKI commerciale → précision +15 % sur tous types |
| **v3.0** (2027-Q2) | API sirAdos régional → précision +25 % sur projets régionaux |
| **v3.5** (2027-Q4) | Machine learning sur projets historiques pour auto-calibrage |

## ⚖️ Décharge de responsabilité

NARCHI **fait son maximum pour donner des chiffres réalistes**, mais :
- **L'architecte reste responsable** de la Kostenermittlung HOAI § 6
- **Les fourchettes Monte-Carlo sont indicatives** — pas une garantie
- **Pour la facturation** : double-check avec une source commerciale (BKI, sirAdos)
- **Pour les appels d'offres** : faire faire un Kostenanschlag détaillé par un Quantity Surveyor

NARCHI est **un excellent outil de pré-calcul rapide** pour LP 2/3 et pour les variantes d'études — pas un outil de facturation.
