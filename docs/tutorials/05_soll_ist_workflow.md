# Tutoriel 5 : Workflow Soll/Ist et suivi de projet

Un projet évolue. Comment garder le contrôle des coûts au fil des LP HOAI ?

## Le workflow complet sur un projet réel

### Phase 1 : LP 2 — Kostenschätzung (±30%)

À ce stade, vous n'avez pas encore d'IFC détaillé. Utilisez `demo` :

```bash
python -m narchi.cli demo \
    --bgf 2150 \
    -g wohngebaeude_mfh \
    -s standard_mittel \
    -b BY --grossstadt Muenchen \
    --stichtag 2026-Q4 \
    --lp 2 \
    --excel V01_LP2_Kostenschaetzung.xlsx
```

Sortie : `Summe netto ≈ 5.2 M€  · 80%-KI: [3.9 ; 6.8] M€`

### Phase 2 : LP 3 — Kostenberechnung (±20%)

Vous avez maintenant un Vorentwurf IFC. Lancez :

```bash
python -m narchi.cli ifc V02_LP3_Vorentwurf.ifc \
    -p "MFH Pankow V02" \
    -g wohngebaeude_mfh -s standard_mittel \
    -b BY --grossstadt Muenchen \
    --stichtag 2026-Q4 --lp 3 \
    --excel V02_LP3_Kostenberechnung.xlsx
```

Sortie : `Summe netto = 7.1 M€  · 80%-KI: [5.3 ; 9.7] M€`

Bauherr veut savoir : **pourquoi est-ce passé de 5.2 à 7.1 M€ ?**

### Phase 3 : Vergleich Soll/Ist

```bash
python -m narchi.cli vergleich \
    V01_LP2_estimation_initiale.ifc \
    V02_LP3_Vorentwurf.ifc \
    -g wohngebaeude_mfh -b BY --grossstadt Muenchen --lp 3
```

Sortie :
```
==========================================================================================
  SOLL/IST VERGLEICH — Kostenkontrolle nach DIN 276
==========================================================================================
  Soll : V01_LP2 (LP 2, 2026-Q4)         →   5.200.000 € netto
  Ist  : V02_LP3 (LP 3, 2026-Q4)         →   7.100.000 € netto
  Delta : +1.900.000 €   (+36.5%)
  ❌ Kritisch: Gesamtkosten +36.5% (+1.900.000 €). Dringende Ursachenanalyse...
------------------------------------------------------------------------------------------
  KG   Bezeichnung                    Soll €     Ist €      Δ €         Δ %  Status
  200  Vorbereitende Maßnahmen        70.000     145.000    +75.000    +107%  ❌
  300  Bauwerk Baukonstruktionen   2.800.000   3.950.000  +1.150.000   +41%  ❌
  400  Bauwerk Technische Anlagen  1.260.000   1.730.000   +470.000    +37%  ❌
  500  Außenanlagen                  250.000     320.000    +70.000    +28%  ⚠️
  600  Ausstattung                    65.000      85.000    +20.000    +31%  ⚠️
  700  Baunebenkosten                755.000     870.000   +115.000    +15%  ⚠️
------------------------------------------------------------------------------------------
  TOP-5 Kostentreiber :
    + KG 300 Bauwerk Baukonstruktionen: +1.150.000 € (+41%)
    + KG 400 Bauwerk Technische Anlagen: +470.000 € (+37%)
    + KG 700 Baunebenkosten: +115.000 € (+15%)
```

### Phase 4 : Décision

Maintenant l'architecte peut expliquer concrètement au Bauherr :
- « Nous sommes passés en KG 300 de 2.8 à 3.95 M€ parce que l'IFC détaillé a révélé une vraie surface AWF de 1.380 m² au lieu des 1.100 m² estimés initialement »
- « KG 400 a augmenté de 37 % parce que vous avez demandé une Wärmepumpe + KWL au lieu d'une simple Gasheizung »
- « Recommandation : revenir à un standard mittel sur la KG 300 ou réduire la surface »

### Phase 5 : Itération

```bash
# Architecte modifie le modèle → V03
python -m narchi.cli ifc V03_LP3_optimiert.ifc -g wohngebaeude_mfh ... --excel V03.xlsx

# Vérifie : on est-on revenu dans la cible ?
python -m narchi.cli vergleich V01_LP2_estimation.ifc V03_LP3_optimiert.ifc -g …
```

### Phase 6 : LP 6 — Kostenanschlag (±10%)

Après vergabe, on a les vrais devis. Mettre à jour le calcul avec les prix
réels dans `bki_kennwerte_2025.json` pour ces KG, puis :

```bash
python -m narchi.cli vergleich \
    V03_LP3_optimiert.ifc \
    V04_LP6_nach_vergabe.ifc \
    -g wohngebaeude_mfh ... --lp 6
```

Idéalement : delta < ±5 %.

### Phase 7 : Audit prüfbar pour facturation HOAI

```bash
python -m narchi.cli audit V04_LP6_nach_vergabe.ifc \
    -g wohngebaeude_mfh -b BY --grossstadt Muenchen --lp 6 \
    --rows
# → V04_nach_vergabe.audit.json avec hash d'intégrité SHA-256
```

Ce JSON est le **document prüfbar** au sens HOAI § 6 pour facturer l'architecte.

## Conseils workflow

### Versionnage IFC
Convention recommandée :
```
ProjektA_V01_LP2_2025-12.ifc
ProjektA_V02_LP3_2026-01.ifc
ProjektA_V03_LP3-rev1_2026-02.ifc
ProjektA_V04_LP6_2026-08.ifc
```

### Réutiliser les calculs via le cache
```bash
# Premier calcul (lent : 30 s)
python -m narchi.cli ifc V02.ifc ... 

# Re-calcul du même fichier (instantané grâce au cache)
python -m narchi.cli ifc V02.ifc ...
```

### Vider le cache si besoin
```bash
python -m narchi.cli cache --clear
```

## La règle d'or du suivi de coûts

> **« Recalculer après chaque modification significative. Documenter le delta. Expliquer au Bauherr. »**

NARCHI rend cela faisable en quelques secondes.

→ Voir aussi : [Guide d'utilisation USAGE.md](../guide/USAGE.md)
