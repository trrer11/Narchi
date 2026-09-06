"""
NARCHI · DIN276-Codes in Revit zurückschreiben

Nach der Berechnung schreibt NARCHI die ermittelten DIN-276-Kostengruppen
als benutzerdefiniertes Parameter `DIN276` in jedes Bauteil zurück.

Voraussetzungen :
  - Vorher die "Kostenermittlung" gelaufen
  - Im Revit-Projekt der Parameter `DIN276` (Text, Bauteile) existiert
    (kann via "Projektparameter hinzufügen" angelegt werden)
"""
from pyrevit import revit, forms, script

output = script.get_output()

try:
    from narchi_revit import revit_reader, runner
    runner._add_narchi_to_path()
except ImportError as e:
    forms.alert(f"narchi nicht gefunden:\n{e}", title="NARCHI", warn_icon=True)
    script.exit()


def main():
    doc = revit.doc
    if doc is None:
        forms.alert("Kein aktives Revit-Dokument!", title="NARCHI", warn_icon=True)
        return

    # Hole letztes Ergebnis aus der Session
    import pyrevit
    erg = pyrevit.script.read_session_storage("narchi_last_result", default=None)
    if erg is None or erg.ifc_df_mapped is None:
        forms.alert(
            "Keine vorherige Berechnung gefunden.\n\n"
            "Bitte zuerst 'Kostenermittlung' ausführen.",
            title="NARCHI", warn_icon=True
        )
        return

    # Confirmation
    n = len(erg.ifc_df_mapped)
    ok = forms.alert(
        f"DIN-276-Codes für {n} Bauteile in das Modell schreiben?\n\n"
        f"Der Parameter 'DIN276' (Text) muss im Projekt existieren.\n"
        f"Diese Aktion wird im Undo-Stack gespeichert.",
        title="NARCHI · DIN276 schreiben",
        options=["Ja, schreiben", "Abbrechen"]
    )
    if ok != "Ja, schreiben":
        return

    try:
        n_written = revit_reader.write_din276_to_elements(doc, erg.ifc_df_mapped)
    except Exception as e:
        forms.alert(f"Fehler beim Schreiben:\n{e}", title="NARCHI", warn_icon=True)
        return

    output.print_md(f"### ✅ {n_written} / {n} Bauteile aktualisiert")
    forms.alert(
        f"✅ {n_written} von {n} Bauteilen aktualisiert.\n\n"
        f"Tipp : Filter im Projekt-Browser anlegen nach 'DIN276 = 331' "
        f"um alle tragenden Außenwände zu sehen.",
        title="NARCHI · Erfolg"
    )


main()
