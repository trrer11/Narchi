"""NARCHI · Soll/Ist Vergleich mit einer gespeicherten Audit-Datei."""
from pyrevit import forms, script
import json

try:
    from narchi_revit import runner
    runner._add_narchi_to_path()
    from narchi.vergleich import compare, konsolenbericht
except ImportError as e:
    forms.alert(f"narchi nicht gefunden:\n{e}", title="NARCHI", warn_icon=True)
    script.exit()

output = script.get_output()


def main():
    import pyrevit
    ist = pyrevit.script.read_session_storage("narchi_last_result", default=None)
    if ist is None:
        forms.alert(
            "Bitte zuerst eine aktuelle 'Kostenermittlung' ausführen, "
            "die als 'Ist'-Stand verwendet wird.",
            title="NARCHI", warn_icon=True
        )
        return

    # Charger un audit JSON existant comme "Soll"
    json_path = forms.pick_file(file_ext="json", title="Soll-Stand wählen (NARCHI Audit JSON)")
    if not json_path:
        return

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            soll_audit = json.load(f)
    except Exception as e:
        forms.alert(f"Konnte JSON nicht lesen:\n{e}", title="NARCHI", warn_icon=True)
        return

    # Wir bauen ein Pseudo-NarchiErgebnis aus der Audit-Datei
    # (vereinfacht — pour le vrai comparison il faudrait sauver le pickle complet)
    output.print_md("### 🔄 Vergleich Soll/Ist")
    output.print_md(f"**Soll** (audit JSON) : {soll_audit['projekt']['name']} · "
                    f"{soll_audit['totalsummen_eur']['summe_netto']:,.0f} €")
    output.print_md(f"**Ist**  (aktuell)    : {ist.projektname} · "
                    f"{ist.summe_netto:,.0f} €")
    delta = ist.summe_netto - soll_audit['totalsummen_eur']['summe_netto']
    pct = delta / max(soll_audit['totalsummen_eur']['summe_netto'], 1) * 100
    sign = "+" if delta >= 0 else ""
    output.print_md(f"**Delta** : {sign}{delta:,.0f} € ({sign}{pct:.1f}%)".replace(",", "."))

    forms.alert(
        f"Vergleich:\n\n"
        f"  Soll : {soll_audit['totalsummen_eur']['summe_netto']:,.0f} €\n"
        f"  Ist  : {ist.summe_netto:,.0f} €\n"
        f"  Δ    : {sign}{delta:,.0f} € ({sign}{pct:.1f}%)\n\n"
        f"Details siehe pyRevit Output-Konsole.",
        title="NARCHI · Vergleich"
    )


main()
