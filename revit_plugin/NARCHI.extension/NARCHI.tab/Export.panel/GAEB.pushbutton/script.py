"""NARCHI · GAEB XML X83 Export für AVA-Software."""
from pyrevit import forms, script

try:
    from narchi_revit import runner, ui
    runner._add_narchi_to_path()
    from narchi.gaeb_export import export_gaeb_x83, export_gaeb_summary
except ImportError as e:
    forms.alert(f"narchi nicht gefunden:\n{e}", title="NARCHI", warn_icon=True)
    script.exit()


def main():
    import pyrevit
    erg = pyrevit.script.read_session_storage("narchi_last_result", default=None)
    if erg is None:
        forms.alert(
            "Bitte zuerst eine 'Kostenermittlung' ausführen.",
            title="NARCHI", warn_icon=True
        )
        return

    base = erg.projektname.replace(" ", "_").replace("/", "_")
    x83_path = ui.ask_export_path(f"NARCHI_{base}", "x83")
    if not x83_path:
        return

    export_gaeb_x83(erg, x83_path)
    csv_path = x83_path.rsplit(".", 1)[0] + ".gaeb.csv"
    export_gaeb_summary(erg, csv_path)

    forms.alert(
        f"✅ GAEB Export erfolgreich :\n\n"
        f"  • XML X83 : {x83_path}\n"
        f"  • CSV     : {csv_path}\n\n"
        f"Importieren in :\n"
        f"  → RIB iTWO\n"
        f"  → California.pro\n"
        f"  → ORCA AVA\n"
        f"  → G&W ESPRIT",
        title="NARCHI · GAEB Export"
    )


main()
