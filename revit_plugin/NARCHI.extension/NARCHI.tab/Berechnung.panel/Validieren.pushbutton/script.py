"""
NARCHI · Validate-Button

Führt die IDS-style Validierung auf dem aktiven Revit-Modell aus,
um sicherzustellen dass es für die DIN-276-Auswertung geeignet ist.

Wird automatisch VOR jeder Kostenermittlung empfohlen.
"""
from pyrevit import revit, forms, script

output = script.get_output()

try:
    from narchi_revit import revit_reader, runner, ui
    runner._add_narchi_to_path()
    from narchi.ids_validation import validate_for_din276, konsolenbericht
except ImportError as e:
    forms.alert(f"narchi nicht gefunden:\n{e}", title="NARCHI · Fehler", warn_icon=True)
    script.exit()


def main():
    doc = revit.doc
    if doc is None:
        forms.alert("Kein aktives Revit-Dokument!", title="NARCHI", warn_icon=True)
        return

    output.print_md("### 🔍 NARCHI Validierung läuft …")
    with ui.progress_window("Modell wird analysiert …"):
        df = revit_reader.read_active_document(doc)
    if df.empty:
        forms.alert("Keine Bauteile im Modell gefunden!", title="NARCHI", warn_icon=True)
        return

    output.print_md(f"### 📊 {len(df)} Bauteile gefunden")
    erg = validate_for_din276(df)

    # Im Output-Panel volltextliches Reporting
    output.print_md(f"## Score: {erg.score_pct}%")
    output.print_md(f"- Errors: **{len(erg.errors)}**")
    output.print_md(f"- Warnings: **{len(erg.warnings)}**")
    output.print_md("---")
    for r in erg.regeln:
        icon = "✅" if r.bestanden else ("❌" if r.schweregrad == "ERROR" else "⚠️")
        output.print_md(f"{icon} **{r.name}** : {r.actual_value} (erwartet: {r.expected})")
        if r.empfehlung and not r.bestanden:
            output.print_md(f"  - 💡 {r.empfehlung}")

    # WPF-Hauptdialog mit Zusammenfassung
    ui.show_validation_report(erg)


main()
