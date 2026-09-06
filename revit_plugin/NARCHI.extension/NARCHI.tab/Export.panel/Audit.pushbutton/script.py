"""NARCHI · JSON Audit-Trail prüfbar nach HOAI § 6."""
from pyrevit import forms, script

try:
    from narchi_revit import runner, ui
    runner._add_narchi_to_path()
    from narchi.audit import save_audit
except ImportError as e:
    forms.alert(f"narchi nicht gefunden:\n{e}", title="NARCHI", warn_icon=True)
    script.exit()


def main():
    import pyrevit
    erg = pyrevit.script.read_session_storage("narchi_last_result", default=None)
    if erg is None:
        forms.alert("Bitte zuerst 'Kostenermittlung' ausführen.", title="NARCHI", warn_icon=True)
        return

    include_rows = forms.alert(
        "Soll der vollständige IFC-Auszug (100 erste Bauteile) angehängt werden?\n"
        "→ Größere Datei aber bessere Audit-Spur.",
        title="NARCHI · Audit-Optionen",
        options=["Mit Rohdaten (empfohlen)", "Ohne Rohdaten"],
    )
    rows = include_rows == "Mit Rohdaten (empfohlen)"

    base = erg.projektname.replace(" ", "_").replace("/", "_")
    json_path = ui.ask_export_path(f"NARCHI_{base}_audit", "json")
    if not json_path:
        return

    save_audit(erg, json_path, include_ifc_rows=rows)
    forms.alert(
        f"✅ Audit-Trail JSON erstellt :\n\n  {json_path}\n\n"
        f"Enthält :\n"
        f"  • Alle Eingangsparameter\n"
        f"  • Alle BKI-Kennwerte verwendet\n"
        f"  • Alle Mapping-Regeln + Confidence\n"
        f"  • Konfidenzintervalle pro KG\n"
        f"  • SHA-256 Integritäts-Hash\n"
        f"  • Normgrundlagen\n\n"
        f"Prüfbar nach HOAI § 6 — Anrechenbare Kosten",
        title="NARCHI · Audit Export"
    )


main()
