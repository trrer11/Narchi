"""
runner · Bindet revit_reader an narchi.engine.

Dieses Modul ist der zentrale Adapter zwischen der Revit-API und der NARCHI-Engine.
"""
from __future__ import annotations
import sys
import os
from pathlib import Path
from typing import Any, Dict, Optional


def _add_narchi_to_path():
    """
    Stelle sicher, dass das narchi-Paket im PYTHONPATH ist.

    pyRevit installiert NARCHI typischerweise unter:
      %APPDATA%/pyRevit/Extensions/NARCHI.extension/lib/narchi/
    oder der User hat narchi via `pip install narchi` global installiert.
    """
    # 1. Try direct import (si installé via pip)
    try:
        import narchi  # noqa
        return
    except ImportError:
        pass

    # 2. Try : narchi est dans lib/ à côté de narchi_revit/
    here = Path(__file__).parent.parent
    narchi_path = here / "narchi"
    if narchi_path.exists():
        sys.path.insert(0, str(here))
        return

    # 3. Try : un dossier 'narchi-core' à côté de l'extension
    ext_root = Path(__file__).resolve().parents[3]
    narchi_core = ext_root / "narchi-core"
    if narchi_core.exists():
        sys.path.insert(0, str(narchi_core))
        return

    raise ImportError(
        "narchi-Paket nicht gefunden.\n\n"
        "Lösung:\n"
        "  1. pip install narchi    (global)\n"
        "  2. Oder kopiere das Verzeichnis narchi/ in:\n"
        f"     {here}\n"
        "  3. Oder klone das narchi-Repo neben der pyRevit-Extension"
    )


def run_calculation(
    doc,
    projektname: str,
    gebaeudeart: str,
    standard: str = "standard_mittel",
    bundesland: str = "NW",
    grossstadt: Optional[str] = None,
    stichtag: str = "2026-Q2",
    leistungsphase: int = 3,
    sonderrisiken: Optional[list] = None,
    mode: str = "hybrid",
    bgf_override: Optional[float] = None,
) -> "Any":
    """
    Führt die komplette NARCHI-Pipeline auf dem aktiven Revit-Modell aus.

    Returns
    -------
    NarchiErgebnis (siehe narchi.engine)
    """
    _add_narchi_to_path()

    from narchi import engine, mapping_din276
    from .revit_reader import read_active_document

    # 1. Revit-Modell → DataFrame
    df = read_active_document(doc)
    if df.empty:
        raise ValueError(
            "Keine extrahierbaren Bauteile im aktiven Revit-Modell gefunden. "
            "Bitte sicherstellen dass das Modell Bauteile enthält und nicht leer ist."
        )

    # 2. Mapping DIN 276
    df_mapped = mapping_din276.map_dataframe(df)

    # 3. NARCHI Engine direkt (ohne IFC-Datei)
    # Wir patchen vorübergehend engine.ifc_extract um unseren DataFrame zu liefern
    import narchi.engine as eng

    # Workaround : on appelle directement les phases internes
    from narchi import (bki, regional as _regional, baupreisindex,
                        konfidenz, risiko, din276, classify_ddc, geometry,
                        co2 as co2_mod, geg_check, foerderung as _foerd)
    from datetime import datetime

    # Setup factor
    geb_info = bki.GEBAEUDEARTEN[gebaeudeart]
    bki_kw = bki.hole_kennwerte(gebaeudeart, standard)
    rf = _regional.get_faktor(bundesland, grossstadt)
    bki_stichtag = bki.META["stichtag"]
    kategorie = baupreisindex.GEBAUDE_ZUR_KATEGORIE.get(gebaeudeart, "wohn")
    idx = baupreisindex.hochrechnungsfaktor(bki_stichtag, stichtag, kategorie)

    erg = eng.NarchiErgebnis(
        projektname=projektname,
        erstellt_am=datetime.now().strftime("%Y-%m-%d %H:%M"),
        gebaeudeart=gebaeudeart,
        gebaeudeart_label=geb_info["label"],
        standard=standard, bundesland=bundesland, grossstadt=grossstadt,
        stichtag=stichtag, leistungsphase=leistungsphase, mode=mode,
        regionalfaktor=rf, indexfaktor=idx, bki_stichtag=bki_stichtag,
        ifc_pfad=f"<Revit Live: {projektname}>",
    )

    # Building filter
    building, drawing, log_df = classify_ddc.split_building_vs_drawing(df)
    erg.ifc_df = df
    erg.ifc_df_mapped = df_mapped
    erg.klassifikation_log = log_df
    erg.kg_summary = mapping_din276.kg_summary(df_mapped)

    # Géometrie DIN 277 (vraies valeurs depuis Revit)
    mengen = geometry.calculate_din277(building)
    erg.bgf = bgf_override if bgf_override else mengen.bgf
    erg.bri = mengen.bri
    erg.nuf = mengen.nuf
    erg.geschosszahl = mengen.n_geschosse
    erg.warnungen.extend(mengen.warnungen)

    # Positionen — top-down + bottom-up Mix (mode "hybrid")
    positionen = []
    if mode in ("bottomup", "hybrid"):
        prefixes = ("3",) if mode == "hybrid" else ("3", "4", "6")
        positionen.extend(eng._bottomup_positionen(
            erg.ifc_df_mapped, rf, idx, leistungsphase,
            ifc_only_kg_prefixes=prefixes,
        ))
    if mode in ("topdown", "hybrid"):
        for kg_key, kw in bki_kw.items():
            kg_nr = kw.kg
            if mode == "hybrid" and kg_nr.startswith("3"):
                continue
            positionen.append(eng._topdown_position(kg_nr, erg.bgf, kw, rf, idx, leistungsphase))
    positionen.sort(key=lambda p: p.kg)
    erg.positionen = positionen
    erg.summe_netto = round(sum(p.summe_netto for p in positionen), 2)
    erg.summe_mwst = round(sum(p.mwst for p in positionen), 2)
    erg.summe_brutto = round(erg.summe_netto + erg.summe_mwst, 2)

    # Risiko + Konfidenz
    erg.risiko = risiko.berechnen(leistungsphase, sonderrisiken or [])
    erg.risikobetrag = round(erg.bauwerkskosten_300_400() * erg.risiko.prozent_gesamt, 2)
    erg.konfidenz_gesamt = konfidenz.aggregiere([p.konfidenz for p in positionen])

    # CO2 + GEG + Förderung
    try:
        erg.co2 = co2_mod.berechne_co2(df_mapped, bgf=erg.bgf)
    except Exception as e:
        erg.warnungen.append(f"CO2-Bilanz fehlgeschlagen: {e}")
    try:
        erg.geg_check = geg_check.check(df_mapped)
    except Exception as e:
        erg.warnungen.append(f"GEG-Check fehlgeschlagen: {e}")
    try:
        erg.foerderung = _foerd.analyze(erg, geg=erg.geg_check, co2=erg.co2)
    except Exception as e:
        erg.warnungen.append(f"Förderung-Analyse fehlgeschlagen: {e}")

    return erg


def get_revit_project_info(doc) -> Dict[str, Any]:
    """Sammelt Projekt-Metadaten aus Revit (für Default-Wert in UI)."""
    try:
        info = doc.ProjectInformation
        return {
            "name":         info.Name or doc.Title or "Unbenanntes Projekt",
            "number":       info.Number,
            "address":      info.Address,
            "building_name":info.BuildingName,
            "client":       info.ClientName,
            "status":       info.Status,
        }
    except Exception:
        return {"name": doc.Title if hasattr(doc, "Title") else "Unbekannt"}
