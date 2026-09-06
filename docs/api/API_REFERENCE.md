# Référence API Python NARCHI

Utilisez NARCHI comme une bibliothèque Python dans vos propres scripts.

## Imports principaux

```python
# Module principal (orchestrator)
from narchi import engine

# Calcul standard
from narchi.engine import kalkulieren, NarchiErgebnis, konsolenbericht

# Modules de feature
from narchi import (
    co2, geg_check, foerderung,        # analyse
    geometry, ids_validation,            # qualité
    vergleich, sensitivity,              # workflows
    multi_model,                         # multi-IFC
    gaeb_export, audit, report,          # export
    cache, i18n,                         # utilitaires
)
```

## `engine.kalkulieren()`

La fonction centrale. Calcule une Kostenermittlung complète.

```python
def kalkulieren(
    projektname: str,
    gebaeudeart: str,                                # "wohngebaeude_mfh" etc.
    standard: str = "standard_mittel",               # einfach / mittel / hoch
    bundesland: str = "NW",                          # code 2 lettres
    grossstadt: Optional[str] = None,                # "Muenchen", "Berlin", etc.
    stichtag: str = "2026-Q2",                       # format "YYYY-Qn"
    leistungsphase: int = 3,                         # HOAI 1..8
    sonderrisiken: Optional[List[str]] = None,       # ["bauen_im_bestand", ...]
    # Entrée :
    ifc_pfad: Optional[str | Path] = None,           # OU
    bgf_manuell: Optional[float] = None,
    bri_manuell: Optional[float] = None,
    nuf_manuell: Optional[float] = None,
    geschosse_manuell: Optional[int] = None,
    mode: str = "hybrid",                            # topdown / bottomup / hybrid
) -> NarchiErgebnis
```

### Exemple

```python
from narchi.engine import kalkulieren

erg = kalkulieren(
    projektname="MFH Pankow",
    ifc_pfad="modell.ifc",
    gebaeudeart="wohngebaeude_mfh",
    standard="standard_mittel",
    bundesland="BE",
    grossstadt="Berlin",
    stichtag="2026-Q4",
    leistungsphase=3,
    sonderrisiken=["innerstaedtisch_eng"],
    mode="hybrid",
)

print(f"Summe netto: {erg.summe_netto:,.0f} €")
print(f"Bauwerkskosten KG 300+400: {erg.bauwerkskosten_300_400():,.0f} €")
print(f"CO2: {erg.co2.gwp_total_kg/1000:.1f} t")
print(f"GEG Konformität: {erg.geg_check.konformitaet_pct}%")
print(f"Förderpotenzial: {erg.foerderung.gesamt_foerderpotenzial_eur:,.0f} €")
```

## `NarchiErgebnis` (dataclass)

```python
@dataclass
class NarchiErgebnis:
    # Metadata
    projektname: str
    erstellt_am: str
    gebaeudeart: str
    gebaeudeart_label: str
    standard: str
    bundesland: str
    grossstadt: Optional[str]
    stichtag: str
    leistungsphase: int
    mode: str

    # Facteurs
    regionalfaktor: float
    indexfaktor: float
    bki_stichtag: str

    # IFC
    ifc_pfad: Optional[str]
    ifc_df: Optional[pd.DataFrame]
    ifc_df_mapped: Optional[pd.DataFrame]
    klassifikation_log: Optional[pd.DataFrame]
    kg_summary: Optional[pd.DataFrame]

    # Géométrie
    bgf: float
    bri: float
    nuf: float
    geschosszahl: int

    # Résultats
    positionen: List[KGPosition]
    risiko: Optional[Risikoaufschlag]
    risikobetrag: float
    summe_netto: float
    summe_mwst: float
    summe_brutto: float
    konfidenz_gesamt: Optional[Konfidenz]
    warnungen: List[str]

    # Analyses ajoutées v2.4+
    co2: Optional[CO2Ergebnis]
    geometrie_din277: Optional[GebaudeMengen]
    geg_check: Optional[GEGCheckErgebnis]
    foerderung: Optional[FoerderungAnalyse]

    # Méthodes
    def bauwerkskosten_300_400(self) -> float
    def herstellungskosten_200_700(self) -> float
```

## Modules de feature

### `co2`

```python
from narchi.co2 import berechne_co2, konsolenbericht

co2_erg = berechne_co2(df_mapped, bgf=1200.0, betrachtungszeitraum=50)
print(f"GWP total: {co2_erg.gwp_total_kg:.0f} kg CO2eq")
print(f"DGNB: {co2_erg.dgnb_klasse}")
```

### `geg_check`

```python
from narchi.geg_check import check

geg_erg = check(df_mapped)
print(f"Konformität: {geg_erg.konformitaet_pct}%")
for p in geg_erg.positionen:
    print(f"  {p.verdict} {p.label}")
```

### `foerderung`

```python
from narchi.foerderung import analyze

f = analyze(erg, geg=erg.geg_check, co2=erg.co2)
print(f"Total: {f.gesamt_foerderpotenzial_eur:,.0f} €")
for m in f.eligible_programme:
    print(f"  - {m.name}: {m.geschaetzte_foerdersumme_eur:,.0f} €")
```

### `vergleich`

```python
from narchi.vergleich import compare, konsolenbericht

soll = kalkulieren(...)
ist = kalkulieren(...)

v = compare(soll, ist, toleranz_pct=10.0, schwelle_kritisch_pct=25.0)
print(v.verdict)
for kt in v.kostentreiber:
    print(f"+ {kt.kg}: +{kt.delta_eur:,.0f} € ({kt.delta_pct:+.1f}%)")
```

### `sensitivity`

```python
from narchi.sensitivity import full_analysis, konsolenbericht

baseline = kalkulieren(...)
results = full_analysis(baseline)
# results = {"standard": ..., "stichtag": ..., "standort": ...}
print(konsolenbericht(results))
```

### `multi_model`

```python
from narchi.multi_model import FachmodellInput, fuse_models, auto_detect_fachmodell

inputs = [
    FachmodellInput(pfad="Architektur.ifc", typ="architektur"),
    FachmodellInput(pfad="Tragwerk.ifc",    typ="tragwerk"),
    FachmodellInput(pfad="TGA_HLS.ifc",     typ="tga_hls"),
]
result = fuse_models(inputs, dedup=True)
print(f"{len(result.df_fused)} Bauteile, {result.n_doublons_resolus} doublons résolus")
```

### `gaeb_export`

```python
from narchi.gaeb_export import export_gaeb_x83, export_gaeb_summary

erg = kalkulieren(...)
export_gaeb_x83(erg, "mein_projekt.x83")
export_gaeb_summary(erg, "mein_projekt.gaeb.csv")
```

### `audit`

```python
from narchi.audit import save_audit, generate_audit

# Sauvegarde fichier
save_audit(erg, "projekt.audit.json", include_ifc_rows=True)

# Comme dict Python
audit_data = generate_audit(erg)
print(audit_data["@integrity_sha256"])
```

### `cache`

```python
from narchi import cache

# Cache automatique
result = cache.calc_with_cache(
    "modell.ifc",
    {"gebaeudeart": "wohngebaeude_mfh", "bundesland": "BY"},
    lambda: engine.kalkulieren(ifc_pfad="modell.ifc", ...)
)

# Gestion
print(cache.stats())   # {"n_entries": 12, "total_size_mb": 4.3}
cache.clear()          # vide tout
```

### `i18n`

```python
from narchi import i18n

i18n.t("kostenermittlung", "de")  # "Kostenermittlung"
i18n.t("kostenermittlung", "en")  # "Cost estimation"
i18n.t("kostenermittlung", "fr")  # "Estimation des coûts"

# Changement global
i18n.set_lang("en")
```

### `report`

```python
from narchi.report import schreibe_excel, schreibe_html

schreibe_excel(erg, "rapport.xlsx")   # 6 feuilles
schreibe_html(erg, "rapport.html")    # responsive, imprimable
```

## Modules d'extraction (rarement utiles directement)

```python
from narchi import extract

# Auto-detect + extraction normalisée
df, fmt = extract.to_dataframe("mon_fichier.ifc")
# df est un pandas.DataFrame normalisé

# Check des converters disponibles
print(extract.available_converters())
```

## Pattern complet : pipeline custom

```python
from narchi import engine, vergleich, audit, gaeb_export, report

def workflow_complet(ifc_path: str, **kwargs):
    """Pipeline complète custom : calcul + GAEB + audit + reports."""
    erg = engine.kalkulieren(ifc_pfad=ifc_path, **kwargs)
    
    # Reports
    report.schreibe_excel(erg, f"{erg.projektname}.xlsx")
    report.schreibe_html(erg, f"{erg.projektname}.html")
    
    # AVA-Export
    gaeb_export.export_gaeb_x83(erg, f"{erg.projektname}.x83")
    
    # Audit prüfbar HOAI § 6
    audit.save_audit(erg, f"{erg.projektname}.audit.json", include_ifc_rows=True)
    
    return erg

# Utilisation
erg = workflow_complet(
    ifc_path="modell.ifc",
    projektname="MFH Pankow LP3",
    gebaeudeart="wohngebaeude_mfh",
    bundesland="BE", grossstadt="Berlin",
    stichtag="2026-Q4", leistungsphase=3,
)
```

## Pattern : Web API avec FastAPI

```python
from fastapi import FastAPI, UploadFile
from narchi import engine, report
import tempfile, shutil

app = FastAPI()

@app.post("/calculate")
async def calculate(file: UploadFile, gebaeudeart: str, bundesland: str = "NW"):
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        ifc_path = tmp.name
    
    erg = engine.kalkulieren(
        projektname=file.filename, ifc_pfad=ifc_path,
        gebaeudeart=gebaeudeart, bundesland=bundesland,
    )
    return {
        "summe_netto": erg.summe_netto,
        "bauwerkskosten": erg.bauwerkskosten_300_400(),
        "co2_total_kg": erg.co2.gwp_total_kg if erg.co2 else None,
        "geg_konform_pct": erg.geg_check.konformitaet_pct if erg.geg_check else None,
        "foerderpotenzial_eur": erg.foerderung.gesamt_foerderpotenzial_eur if erg.foerderung else None,
    }
```
