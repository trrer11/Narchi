"""NARCHI · Excel + HTML Bericht-Export."""
from pyrevit import forms, script
import os

try:
    from narchi_revit import runner, ui
    runner._add_narchi_to_path()
    from narchi.report import schreibe_excel, schreibe_html
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
    xlsx_path = ui.ask_export_path(f"NARCHI_{base}", "xlsx")
    if not xlsx_path:
        return

    schreibe_excel(erg, xlsx_path)
    html_path = xlsx_path.rsplit(".", 1)[0] + ".html"
    schreibe_html(erg, html_path)

    forms.alert(
        f"✅ Berichte erstellt :\n\n"
        f"  • Excel : {xlsx_path}\n"
        f"  • HTML  : {html_path}\n\n"
        f"Excel enthält 6 Blätter :\n"
        f"  1. Deckblatt\n"
        f"  2. Kostenberechnung DIN 276\n"
        f"  3. IFC→DIN276 Mapping\n"
        f"  4. Klassifikations-Audit\n"
        f"  5. Revit-Rohdaten\n"
        f"  6. Methodik & Quellen",
        title="NARCHI · Export erfolgreich"
    )

    # HTML automatisch im Browser öffnen
    try:
        os.startfile(html_path)
    except Exception:
        pass


main()
