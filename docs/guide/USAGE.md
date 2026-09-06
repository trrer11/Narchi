# Guide d'utilisation NARCHI

## Vue d'ensemble des 19 commandes CLI

```bash
python -m narchi.cli --help
```

| Commande | But |
|---|---|
| `auto` | **Pipeline universelle** — détection format + calcul complet |
| `ifc` | Calcul spécifique sur un fichier IFC |
| `demo` | Calcul sans IFC (juste la BGF/BRI manuelles) |
| `extract` | Extraction pure IFC → CSV/Excel sans calcul de coûts |
| `liste` | Liste les Gebäudearten / Standards / Bundesländer disponibles |
| `doctor` | Audit des converters installés sur la machine |
| `diagnose` | Diagnostic système complet (JSON) |
| `recommend` | Recommande un converter pour un format donné |
| `install` | Génère un script d'auto-installation de converter |
| `gaeb` | Export GAEB XML X83 pour AVA-Software |
| `audit` | Export JSON Audit-Trail prüfbar HOAI § 6 |
| `sensitivity` | Analyse de sensibilité Standard/Stichtag/Standort |
| `multi` | Fusion multi-modèles (Architektur+Tragwerk+TGA) |
| `vergleich` | Soll/Ist Vergleich de 2 calculs |
| `validate` | Validation IDS-style de l'IFC avant calcul |
| `leistungstext` | Affiche le STLB-Bau Leistungstext d'une KG |
| `cache` | Gère le cache des calculs |

---

## Cas d'usage typiques

### 1. « J'ai un IFC, je veux une Kostenermittlung complète »

```bash
python -m narchi.cli auto mon_projet.ifc \
    -g wohngebaeude_mfh        # Type de bâtiment
    -s standard_mittel         # Niveau de standard
    -b BY --grossstadt Muenchen  # Régionalité
    --stichtag 2026-Q4         # Date d'effet
    --lp 3                     # Phase HOAI
    --excel projet.xlsx        # Sortie Excel
    --html projet.html         # Sortie HTML
```

### 2. « Je n'ai pas encore d'IFC, juste une BGF estimée »

```bash
python -m narchi.cli demo \
    --bgf 1200 \
    -g buero_verwaltung \
    -s standard_hoch \
    -b NW \
    --excel buero_vorestimate.xlsx
```

### 3. « Je veux importer dans RIB iTWO ou California.pro »

```bash
python -m narchi.cli gaeb mon_projet.ifc \
    -g wohngebaeude_mfh -b BE \
    --lp 3
# → produit mon_projet.x83 (GAEB XML) + mon_projet.gaeb.csv
```

Importer le `.x83` dans votre AVA-Software.

### 4. « Je veux vérifier la conformité GEG »

Le GEG-Check est inclus automatiquement dans `auto`, `ifc`. Pour ne tester que ça :

```bash
python -m narchi.cli ifc mon_projet.ifc \
    -g wohngebaeude_efh -b BW \
    | grep -A 20 "GEG 2024"
```

### 5. « Je veux comparer 2 versions du projet »

```bash
python -m narchi.cli vergleich \
    ancienne_version.ifc \
    nouvelle_version.ifc \
    -g wohngebaeude_mfh -b BY
```

### 6. « Je veux savoir l'impact d'un changement de standard »

```bash
python -m narchi.cli sensitivity mon_projet.ifc \
    -g wohngebaeude_mfh -s standard_mittel -b BY --lp 3
# → analyse Standard / Stichtag / Standort
```

### 7. « J'ai 3 modèles BIM (Archi+Tragwerk+TGA) »

```bash
python -m narchi.cli multi \
    Architektur.ifc \
    Tragwerk.ifc \
    TGA_HKLS.ifc \
    -g wohngebaeude_mfh -b BY
```

### 8. « Mon IFC est-il utilisable par NARCHI ? »

```bash
python -m narchi.cli validate mon_projet.ifc
# → score, errors, warnings, recommandations
```

### 9. « Je veux un Leistungstext STLB-Bau pour KG 342 »

```bash
python -m narchi.cli leistungstext 342
```

### 10. « J'ai besoin d'un audit prüfbar HOAI § 6 »

```bash
python -m narchi.cli audit mon_projet.ifc \
    -g wohngebaeude_mfh -b BY --lp 3 \
    --rows  # inclut les 100 premiers IfcElements pour traçabilité
# → mon_projet.audit.json avec hash SHA-256 d'intégrité
```

---

## Options communes

Toutes les commandes (sauf `liste`, `doctor`, `cache`) acceptent :

| Option | Défaut | Description |
|---|---|---|
| `-p, --projekt` | nom du fichier | Nom du projet |
| `-g, --gebaeudeart` | obligatoire | Type de bâtiment (voir `liste`) |
| `-s, --standard` | `standard_mittel` | `einfach` / `mittel` / `hoch` |
| `-b, --bundesland` | `NW` | Code Bundesland (voir `liste`) |
| `--grossstadt` | aucun | Zuschlag pour grande ville (voir `liste`) |
| `--stichtag` | `2026-Q2` | Date d'effet du calcul (format `YYYY-Q1..4`) |
| `--lp` | `3` | Phase HOAI (1–8) |
| `--mode` | `hybrid` | `topdown` / `bottomup` / `hybrid` |
| `--risiko` | aucun | Sonderrisiken (`bauen_im_bestand`, `denkmalschutz`, …) |
| `--excel` | aucun | Chemin du rapport Excel |
| `--html` | aucun | Chemin du rapport HTML |

---

## Modes de calcul

| Mode | Quand l'utiliser | Comment ça marche |
|---|---|---|
| **`topdown`** | LP 1/2 (Vorplanung), pas d'IFC précis | BKI-Kennwert × BGF pour chaque KG |
| **`bottomup`** | LP 4+ (Ausführung), modèle très détaillé | Pro KG aus IFC-Mengen × KG-3-Einheitskennwert |
| **`hybrid`** (défaut) | LP 3 (Entwurfsplanung) | KG 300 bottomup + reste topdown — best of both |

---

## Variables d'environnement

| Variable | Effet |
|---|---|
| `NARCHI_LANG` | Langue (de/en/fr). Défaut : `de` |
| `NARCHI_NO_CACHE` | Désactive le cache si `=1` |
| `NARCHI_CACHE_DIR` | Dossier custom pour le cache |

---

## Utilisation comme bibliothèque Python

```python
from narchi import engine
from narchi.report import schreibe_excel, schreibe_html

erg = engine.kalkulieren(
    projektname="Mon Projet",
    ifc_pfad="mon_modele.ifc",
    gebaeudeart="wohngebaeude_mfh",
    standard="standard_mittel",
    bundesland="BY",
    grossstadt="Muenchen",
    stichtag="2026-Q3",
    leistungsphase=3,
    mode="hybrid",
)

print(f"Summe netto : {erg.summe_netto:,.0f} €")
print(f"CO₂ : {erg.co2.gwp_total_kg/1000:.1f} t")
print(f"GEG : {erg.geg_check.konformitaet_pct}%")
print(f"Förderung : {erg.foerderung.gesamt_foerderpotenzial_eur:,.0f} €")

schreibe_excel(erg, "rapport.xlsx")
```
