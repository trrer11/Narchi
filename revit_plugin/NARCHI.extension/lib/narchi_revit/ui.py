"""
ui · WPF Forms für NARCHI-Plugin

Verwendet pyRevit's forms framework — generiert echte WPF-Fenster,
nicht nur Konsolenausgaben.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional

try:
    from pyrevit import forms, script
    HAS_PYREVIT = True
except ImportError:
    HAS_PYREVIT = False
    forms = script = None


# === Listen, die in den Dialogen angezeigt werden ===
GEBAEUDEARTEN = [
    ("wohngebaeude_efh",         "Einfamilienhaus (freistehend)"),
    ("wohngebaeude_dhh_rh",      "Doppel-/Reihenhaus"),
    ("wohngebaeude_mfh",         "Mehrfamilienhaus / MFH"),
    ("buero_verwaltung",         "Büro- und Verwaltungsgebäude"),
    ("schule_grundschule",       "Grundschule"),
    ("kita",                     "Kindertagesstätte"),
    ("krankenhaus",              "Krankenhaus"),
    ("hotel",                    "Hotel"),
    ("sporthalle",               "Sporthalle"),
    ("produktion_lager",         "Produktions-/Lagergebäude"),
    ("parkhaus_tiefgarage",      "Parkhaus / Tiefgarage"),
    ("bestand_sanierung_wohn",   "Altbausanierung Wohngebäude"),
]

STANDARDS = [
    ("standard_einfach", "Einfach"),
    ("standard_mittel",  "Mittel"),
    ("standard_hoch",    "Hoch"),
]

BUNDESLAENDER = [
    ("BW", "Baden-Württemberg"), ("BY", "Bayern"), ("BE", "Berlin"),
    ("BB", "Brandenburg"), ("HB", "Bremen"), ("HH", "Hamburg"),
    ("HE", "Hessen"), ("MV", "Mecklenburg-Vorpommern"), ("NI", "Niedersachsen"),
    ("NW", "Nordrhein-Westfalen"), ("RP", "Rheinland-Pfalz"), ("SL", "Saarland"),
    ("SN", "Sachsen"), ("ST", "Sachsen-Anhalt"), ("SH", "Schleswig-Holstein"),
    ("TH", "Thüringen"),
]

GROSSSTAEDTE = [
    "(keine)", "Muenchen", "Stuttgart", "Frankfurt_Main", "Hamburg",
    "Berlin", "Duesseldorf", "Koeln", "Hannover", "Leipzig", "Dresden",
    "Nuernberg", "Bremen", "Mainz", "Karlsruhe", "Augsburg",
]

MODES = [
    ("hybrid",  "Hybrid (LP 3 empfohlen)"),
    ("topdown", "Top-down (BKI × BGF)"),
    ("bottomup","Bottom-up (aus IFC-Mengen)"),
]

SONDERRISIKEN = [
    "bauen_im_bestand", "denkmalschutz", "komplexe_tiefgruendung",
    "schadstoffsanierung", "hochwasserlage", "baugrund_unsicher",
    "innerstaedtisch_eng",
]


def ask_calculation_params(default_projektname: str = "Mein Projekt") -> Optional[Dict[str, Any]]:
    """
    Zeigt einen Multi-Step-WPF-Dialog für die Parameter der Berechnung.
    Returns None wenn der User abbricht.
    """
    if not HAS_PYREVIT:
        return None

    # Step 1 : Projektname
    projektname = forms.ask_for_string(
        default=default_projektname,
        prompt="Wie soll dieses Projekt heißen?",
        title="NARCHI · Schritt 1/6 · Projektname"
    )
    if not projektname:
        return None

    # Step 2 : Gebäudeart
    gebaeudeart_label = forms.SelectFromList.show(
        sorted([lbl for _, lbl in GEBAEUDEARTEN]),
        title="NARCHI · Schritt 2/6 · Gebäudeart",
        prompt="Welcher Gebäudetyp?",
        button_name="Weiter"
    )
    if not gebaeudeart_label:
        return None
    gebaeudeart = next(k for k, lbl in GEBAEUDEARTEN if lbl == gebaeudeart_label)

    # Step 3 : Standard
    standard_label = forms.SelectFromList.show(
        [lbl for _, lbl in STANDARDS],
        title="NARCHI · Schritt 3/6 · Standard",
        prompt="Welcher Ausstattungs-/Ausführungsstandard?",
        button_name="Weiter"
    )
    if not standard_label:
        return None
    standard = next(k for k, lbl in STANDARDS if lbl == standard_label)

    # Step 4 : Bundesland
    bundesland_label = forms.SelectFromList.show(
        [f"{k} — {n}" for k, n in BUNDESLAENDER],
        title="NARCHI · Schritt 4/6 · Standort (Bundesland)",
        prompt="In welchem Bundesland?",
        button_name="Weiter"
    )
    if not bundesland_label:
        return None
    bundesland = bundesland_label.split(" — ")[0]

    # Step 5 : Großstadt (optional)
    grossstadt = forms.SelectFromList.show(
        GROSSSTAEDTE,
        title="NARCHI · Schritt 5/6 · Großstadt-Zuschlag",
        prompt="Falls in einer Großstadt mit Zuschlag — wählen, sonst (keine)",
        button_name="Weiter"
    )
    if grossstadt == "(keine)":
        grossstadt = None

    # Step 6 : Mode + LP
    mode_label = forms.SelectFromList.show(
        [lbl for _, lbl in MODES],
        title="NARCHI · Schritt 6/6 · Berechnungsmodus",
        prompt="Welcher Berechnungsmodus?",
        button_name="Berechnung starten"
    )
    if not mode_label:
        return None
    mode = next(k for k, lbl in MODES if lbl == mode_label)

    return {
        "projektname": projektname,
        "gebaeudeart": gebaeudeart,
        "standard":    standard,
        "bundesland":  bundesland,
        "grossstadt":  grossstadt,
        "mode":        mode,
        "leistungsphase": 3,
        "stichtag":    "2026-Q4",
        "sonderrisiken": [],
    }


def show_result_summary(ergebnis) -> None:
    """Zeigt die Hauptergebnisse in einem schönen WPF-Fenster."""
    if not HAS_PYREVIT:
        print("WPF-Forms nicht verfügbar — Konsolenausgabe:")
        print(f"Summe netto: {ergebnis.summe_netto:,.0f} €")
        return

    eur = lambda v: f"{v:,.0f}".replace(",", ".")

    msg_lines = [
        f"📊 NARCHI Kostenermittlung · {ergebnis.projektname}",
        "═" * 60,
        f"   Gebäudeart      : {ergebnis.gebaeudeart_label}",
        f"   Standard        : {ergebnis.standard}",
        f"   Standort        : {ergebnis.bundesland}"
        + (f" / {ergebnis.grossstadt}" if ergebnis.grossstadt else ""),
        f"   Stichtag        : {ergebnis.stichtag} (HOAI LP {ergebnis.leistungsphase})",
        f"   Bauteile (Revit): {len(ergebnis.ifc_df)}",
        f"   BGF / BRI / NUF : {ergebnis.bgf:,.0f} m² / {ergebnis.bri:,.0f} m³ / {ergebnis.nuf:,.0f} m²"
        .replace(",", "."),
        "─" * 60,
        f"   💰 Bauwerkskosten KG 300+400 : {eur(ergebnis.bauwerkskosten_300_400())} €",
        f"   💰 Herstellungskosten 200-700: {eur(ergebnis.herstellungskosten_200_700())} €",
        f"   💰 Summe netto               : {eur(ergebnis.summe_netto)} €",
        f"   💰 MwSt 19%                  : {eur(ergebnis.summe_mwst)} €",
        f"   💰 Summe brutto              : {eur(ergebnis.summe_brutto)} €",
        f"   💰 + Risiko AHO9             : {eur(ergebnis.risikobetrag)} €",
        f"   💰 Gesamt inkl. Risiko netto : {eur(ergebnis.summe_netto + ergebnis.risikobetrag)} €",
        "─" * 60,
        f"   🎯 Konfidenz 80%KI           : {eur(ergebnis.konfidenz_gesamt.unter_80)} – {eur(ergebnis.konfidenz_gesamt.ober_80)} €",
    ]
    if ergebnis.co2 and ergebnis.co2.gwp_total_kg > 0:
        msg_lines.extend([
            "─" * 60,
            f"   🌍 CO₂ A1-A3                  : {ergebnis.co2.gwp_total_kg/1000:.1f} t CO₂eq",
            f"   🌍 pro m² BGF·Jahr             : {ergebnis.co2.gwp_pro_m2_a:.2f} kg/m²·a",
            f"   🌍 DGNB                        : {ergebnis.co2.dgnb_klasse}",
        ])
    if ergebnis.geg_check and ergebnis.geg_check.positionen:
        msg_lines.extend([
            "─" * 60,
            f"   ⚡ GEG-Konformität            : {ergebnis.geg_check.konformitaet_pct}%",
            f"   ⚡ Effizienzhaus-Einstufung   : {ergebnis.geg_check.effizienzhaus_einstufung}",
        ])
    if ergebnis.foerderung and ergebnis.foerderung.gesamt_foerderpotenzial_eur > 0:
        msg_lines.extend([
            "─" * 60,
            f"   💸 Förderpotenzial KfW+BAFA  : {eur(ergebnis.foerderung.gesamt_foerderpotenzial_eur)} €",
        ])
    if ergebnis.warnungen:
        msg_lines.extend(["─" * 60, "   ⚠️ Plausibilitätshinweise:"])
        for w in ergebnis.warnungen[:5]:
            msg_lines.append(f"      • {w[:80]}")

    forms.alert(
        "\n".join(msg_lines),
        title="NARCHI · Ergebnis",
        ok=True, warn_icon=False
    )


def ask_export_path(default_name: str, extension: str = "xlsx") -> Optional[str]:
    """Datei-Dialog für Export-Pfad."""
    if not HAS_PYREVIT:
        return None
    f = forms.save_file(
        file_ext=extension,
        default_name=default_name,
        title=f"NARCHI · Speichern als .{extension}"
    )
    return f


def show_validation_report(ids_ergebnis) -> None:
    """Zeigt das IDS-Validierungs-Ergebnis als WPF-Dialog."""
    if not HAS_PYREVIT:
        return

    lines = [
        f"📋 NARCHI Validierung",
        "═" * 60,
        f"   Score: {ids_ergebnis.score_pct}%",
        f"   Errors: {len(ids_ergebnis.errors)}    "
        f"Warnings: {len(ids_ergebnis.warnings)}",
        "─" * 60,
    ]
    for r in ids_ergebnis.regeln:
        if r.bestanden:
            icon = "✅"
        elif r.schweregrad == "ERROR":
            icon = "❌"
        elif r.schweregrad == "WARNING":
            icon = "⚠️"
        else:
            icon = "ℹ️"
        lines.append(f"  {icon} {r.name:<35} → {r.actual_value}")
        if r.empfehlung and not r.bestanden:
            lines.append(f"        ↳ {r.empfehlung[:80]}")
    lines.append("─" * 60)
    if ids_ergebnis.is_usable:
        lines.append("✅ Revit-Modell ist für NARCHI auswertbar.")
    else:
        lines.append("❌ Modell hat blockierende Probleme — bitte prüfen.")

    forms.alert("\n".join(lines), title="NARCHI · Validierung", ok=True)


def progress_window(title: str = "NARCHI berechnet …"):
    """Context-Manager pour anzeigen einer Fortschrittsanzeige."""
    if not HAS_PYREVIT:
        class _Noop:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def update_progress(self, *a, **kw): pass
        return _Noop()
    return forms.ProgressBar(title=title, indeterminate=True)
