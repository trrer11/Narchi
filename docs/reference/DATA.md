# Référence des fichiers de données

NARCHI utilise 7 fichiers de données structurées dans `data/`.
Tous sont éditables : pas besoin de modifier le code pour mettre à jour.

## 1. `bki_kennwerte_2025.json`

**Contenu** : 12 Gebäudearten × 3 Standards × 6 KG = 216 entrées
**Format** : `[mittelwert, untergrenze, obergrenze]` en €/m² BGF (netto)
**Source** : BKI Baukosten 2025 Bundesdurchschnitt (publication mars 2025)
**Mise à jour** : annuelle — chaque nouveau jahrgang BKI

Exemple :
```json
"wohngebaeude_mfh": {
  "label": "Mehrfamilienhaus / Mehrgeschossiger Wohnungsbau",
  "din276_code": "1200",
  "typische_bgf_min": 400,
  "typische_bgf_max": 8000,
  "kennwerte": {
    "standard_mittel": {
      "KG200": [55, 35, 90],
      "KG300": [2230, 1880, 2610],
      "KG400": [610, 470, 790],
      ...
    }
  }
}
```

## 2. `regionalfaktoren_2025.json`

**Contenu** : 16 Bundesländer + 15 Großstädte
**Format** : facteur multiplicatif (1.00 = moyenne fédérale)
**Source** : BKI Regionalfaktoren-Tabelle 2025

Exemple :
```json
"BY": {"name": "Bayern", "faktor": 1.10}
"Muenchen": 1.12  // multiplicatif : 1.10 × 1.12 = 1.232
```

## 3. `baupreisindex_destatis.csv`

**Contenu** : Index Destatis Reihe 61261 par trimestre depuis 2015
**Colonnes** : `jahr,quartal,index_wohngebaeude,index_buerogebaeude,index_gewerbe,quelle`
**Source** : Statistisches Bundesamt (Destatis)
**Base 100** : 2015

## 4. `omniclass_din276_mapping.json`

**Contenu** : 255 entrées OmniClass / Uniclass / DIN 276 natifs → DIN 276 KG
**Sous-tables** :
- Table 21 (Elements) : 21-01 à 21-08
- Table 22 (Work Results) legacy : 23-13 à 23-39
- DIN 276 natifs : 100 à 800

Exemple :
```json
"23-25 40": "342"  // Interior Non-Bearing Walls → KG 342
```

## 5. `oekobaudat_extract.json`

**Contenu** : 26 matériaux + DGNB-Benchmark + Defaults pro KG
**Format** : GWP en kg CO₂-eq pour Modul A1-A3 (cradle-to-gate)
**Source** : ÖKOBAUDAT (BMWSB), version 2024-I

Exemple :
```json
"beton_c25_30": {"label": "Beton C25/30", "gwp_per_m3": 197, "einheit": "m3"}
```

DGNB-Benchmark :
```json
"dgnb_benchmark": {
  "minimum_kgco2_per_m2_year":  4.5,
  "median_kgco2_per_m2_year":   8.8,
  "p90_kgco2_per_m2_year":     12.5
}
```

## 6. `geg_2024_grenzwerte.json`

**Contenu** : Höchstwerte U-Werte selon GEG 2024 Anlage 1 + Effizienzhaus-Klassen KfW
**Norme** : GEG vom 1. Januar 2024 (Heizungsgesetz-Novelle)

Exemple :
```json
"aussenwand": {
  "max": 0.24,
  "kg_din276": ["331","332"],
  "label": "Außenwände gegen Außenluft"
}
```

Effizienzhaus :
```json
"EH_40_NH": {
  "primaerenergie_max_pct": 40,
  "tilgungszuschuss_pct": 25
}
```

## 7. `foerderprogramme_2026.json`

**Contenu** : 8 programmes (KfW 297/261/BAFA) avec conditions et montants
**Source** : KfW.de + BAFA.de (état 2026)

Exemple :
```json
"kfw_297_neubau_kn": {
  "name": "KfW 297 Klimafreundlicher Neubau (KFN)",
  "zinssatz_pct": 1.92,
  "tilgungszuschuss_pct": 0,
  "max_kredit_eur_we": 100000,
  "voraussetzungen": [
    "Effizienzhaus 40",
    "Treibhausgasemissionen ≤ 24 kgCO2e/m²·a (LCA)",
    "Heizung erneuerbar (≥ 65% EE)"
  ]
}
```

## 8. `dbd_stlb_texte.json`

**Contenu** : 18 Leistungstexte STLB-Bau Light + Leistungsbereich-Mapping
**Source** : VOB/C (DIN 18299 ff.) — Mustertexte konsolidiert

Exemple :
```json
"342": {
  "kurztext": "Nichttragende Innenwand Metallständerwerk (Trockenbau)",
  "langtext": "Nichttragende Innenwand W112 (Knauf-System o. glw.), Metallständer CW 75/0,6, beidseitig 1× Gipskartonplatte 12,5 mm GKB nach DIN 18180. Hohlraumfüllung Mineralwolle WLG 040, Stärke 60 mm. Verspachtelung Qualitätsstufe Q2.",
  "einheit": "m²",
  "leistungsbereich_stlb": "LB 023"
}
```

---

## Comment mettre à jour les données

1. **Modifier directement le fichier JSON/CSV** (pas besoin de recompiler)
2. **Lancer les tests** : `python tests/test_all.py`
3. **Si tout est vert** : commit + push

### Cas typiques

| Cas | Fichier à modifier |
|---|---|
| Nouveau jahrgang BKI 2026 | `bki_kennwerte_2025.json` (renommer en `_2026`) |
| Subventions KfW modifiées | `foerderprogramme_2026.json` |
| Nouveau matériau ÖKOBAUDAT | `oekobaudat_extract.json` |
| Nouveau Bundesland Faktor | `regionalfaktoren_2025.json` |
| Index Destatis Q+1 | `baupreisindex_destatis.csv` |
| Mauvais mapping OmniClass | `omniclass_din276_mapping.json` |

### Override par utilisateur

Si vous voulez utiliser vos propres prix (par ex. sirAdos régional) sans modifier
les fichiers NARCHI, créez un dossier `~/.narchi/data/` avec vos propres versions.
NARCHI v3.0 (en préparation) supportera nativement cet override.
