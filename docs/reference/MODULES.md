# Référence des modules NARCHI

Vue d'ensemble des 23 modules Python de NARCHI v2.4.

## 🧭 Carte mentale

```
                          ┌──────────────────────────┐
                          │     cli.py (19 cmds)     │
                          └────────┬─────────────────┘
                                   │
                          ┌────────▼─────────────────┐
                          │      engine.py           │
                          │   (Orchestrator)         │
                          └────────┬─────────────────┘
            ┌──────────────────────┼──────────────────────────┐
            │                      │                          │
   ┌────────▼─────────┐  ┌─────────▼────────┐    ┌────────────▼─────────┐
   │   EXTRACTION     │  │   CALCULATION    │    │    OUTPUT            │
   ├──────────────────┤  ├──────────────────┤    ├──────────────────────┤
   │ extract.py       │  │ mapping_din276.py│    │ report.py            │
   │ ifc_extract.py   │  │ bki.py           │    │ gaeb_export.py       │
   │ dwg_dxf_extract  │  │ regional.py      │    │ audit.py             │
   │ rvt_extract.py   │  │ baupreisindex.py │    │                      │
   │ cad2data_bridge  │  │ konfidenz.py     │    └──────────────────────┘
   │ multi_model.py   │  │ risiko.py        │
   │ ids_validation   │  │ geometry.py      │    ┌──────────────────────┐
   └──────────────────┘  │ co2.py           │    │  ADVANCED FEATURES   │
                          │ geg_check.py    │    ├──────────────────────┤
                          │ foerderung.py   │    │ sensitivity.py       │
                          │ leistungstexte  │    │ vergleich.py         │
                          └─────────────────┘    │ cache.py             │
                                                 │ i18n.py              │
                                                 │ installer.py         │
                                                 └──────────────────────┘

    Données : data/*.json (bki, regional, baupreisindex, omniclass, oekobaudat, geg, foerderung, dbd)
```

## 📦 Modules par catégorie

### 1. EXTRACTION (entrées CAO/BIM → DataFrame)

| Module | Lignes | Rôle |
|---|---|---|
| `extract.py` | 100 | Dispatcher universel : auto-detect IFC/DXF/DWG/RVT/DGN |
| `ifc_extract.py` | 350 | IFC → DataFrame via IfcOpenShell |
| `dwg_dxf_extract.py` | 290 | DXF natif via ezdxf + DWG via BYOC converter |
| `rvt_extract.py` | 130 | RVT via BYOC : pyRevit / cad2data / Autodesk |
| `cad2data_bridge.py` | 220 | Bridge legal et auto vers les .deb cad2data Linux/Windows |
| `multi_model.py` | 230 | Fusion Architektur + Tragwerk + TGA |
| `ids_validation.py` | 200 | IDS-style validation IFC pour DIN 276 |

### 2. CLASSIFICATION (DataFrame → KG DIN 276)

| Module | Lignes | Rôle |
|---|---|---|
| `classify_ddc.py` | 150 | Building vs Drawing (logique cad2data portée en Python) |
| `aggregate_ddc.py` | 100 | Aggregation sum/mean/first selon header |
| `din276.py` | 200 | Catalogue complet DIN 276:2018-12 (100 KG) |
| `mapping_din276.py` | 250 | Regel-Engine IFC → KG + OmniClass + heuristiques |

### 3. CALCULATION (KG + Mengen → € + Konfidenz)

| Module | Lignes | Rôle |
|---|---|---|
| `geometry.py` | 350 | DIN 277 BGF/BRI/NUF/KGF correctement |
| `bki.py` | 80 | Chargement BKI 2025 Kennwerte |
| `regional.py` | 70 | 16 Bundesländer + 15 Großstädte |
| `baupreisindex.py` | 100 | Destatis 61261 + lineare Trendprognose |
| `konfidenz.py` | 100 | BAYESIAN-BKI Lognormal-Konfidenz |
| `risiko.py` | 50 | AHO Heft 9 + Sonderrisiken |
| `co2.py` | 250 | ÖKOBAUDAT GWP A1-A3 + DGNB-Klasse |
| `geg_check.py` | 200 | GEG 2024 Konformitätsprüfung |
| `foerderung.py` | 250 | KfW/BAFA Förderprogramme-Matcher |
| `leistungstexte.py` | 130 | STLB-Bau/DBD-BIM Light Texte |

### 4. ADVANCED FEATURES

| Module | Lignes | Rôle |
|---|---|---|
| `sensitivity.py` | 200 | Was-wäre-wenn Standard/Stichtag/Standort |
| `vergleich.py` | 220 | Soll/Ist Vergleich avec kritische Abweichungen |
| `cache.py` | 130 | Hash-basierter Berechnungs-Cache |
| `i18n.py` | 100 | DE / EN / FR Übersetzungen |
| `installer.py` | 200 | Auto-Install scripts pour cad2data/ODA/pyRevit |

### 5. ORCHESTRATION + OUTPUT

| Module | Lignes | Rôle |
|---|---|---|
| `engine.py` | 400 | Hauptorchestrator — verknüpft alles |
| `report.py` | 400 | Excel 6 Sheets + HTML responsive |
| `gaeb_export.py` | 200 | GAEB XML X83 + CSV pour AVA-Software |
| `audit.py` | 200 | JSON Audit-Trail mit SHA-256 |
| `cli.py` | 350 | 19 Kommandozeilen-Befehle (click) |

## 🔗 Dépendances entre modules

- `extract.py` dépend de tous les `*_extract.py` + `multi_model`, `ids_validation`, `cad2data_bridge`
- `engine.py` dépend de tous les modules CALCULATION + `extract`
- `cli.py` dépend uniquement de `engine` + modules feature (sensitivity, vergleich, …)
- `report.py` ne dépend que de `engine.NarchiErgebnis`

Cette architecture en couches permet :
- Tester chaque module isolément (62 tests)
- Remplacer facilement un module (par ex. brancher une autre source de prix que BKI)
- Ajouter un nouveau format (par ex. SAF/SketchUp) sans toucher au reste

## 📊 Statistiques globales

- **23 modules** Python
- **~6500 lignes** de code
- **7 fichiers de données** JSON/CSV (1500+ lignes de configurations)
- **62 tests** automatisés
- **0 dépendance LLM/cloud** (100 % offline)

## Voir aussi

- [DATA.md](DATA.md) — référence des fichiers de données
- [NORMS.md](NORMS.md) — normes et standards référencés
- [`docs/api/`](../api/) — référence API Python détaillée
