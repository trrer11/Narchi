"""
NARCHI · Kostenermittlung-Button (v2.5 — robuste)

Verwendet jetzt safe_runner für vollständige Fehlerbehandlung :
  - JAMAIS de crash de pyRevit même avec inputs absurdes
  - Messages user-friendly avec recovery steps
  - Severity levels pour différencier les types d'erreurs
"""
from pyrevit import revit, script, forms

logger = script.get_logger()
output = script.get_output()

try:
    from narchi_revit import ui, safe_runner
except ImportError as e:
    forms.alert(
        f"NARCHI-Plugin nicht korrekt installiert :\n\n{e}\n\n"
        "Bitte überprüfen :\n"
        "  1. pyRevit Reload\n"
        "  2. Verzeichnis lib/narchi_revit/ existiert\n"
        "  3. pip install narchi",
        title="NARCHI · Installation-Fehler", warn_icon=True
    )
    script.exit()

doc = revit.doc


def show_safe_result_error(result):
    """Affiche un message d'erreur user-friendly basé sur SafeResult."""
    icon_map = {
        safe_runner.ErrorSeverity.USER_ERROR:   "⚠️ ",
        safe_runner.ErrorSeverity.SYSTEM_ERROR: "🔧 ",
        safe_runner.ErrorSeverity.BUG:          "🐛 ",
        safe_runner.ErrorSeverity.WARNING:      "⚠️ ",
    }
    icon = icon_map.get(result.severity, "ℹ️ ")
    title = f"NARCHI · {result.severity.value.replace('_', ' ').title()}"

    msg = [f"{icon} {result.user_message}", ""]
    if result.recovery_steps:
        msg.append("Lösungsvorschläge :")
        for step in result.recovery_steps:
            msg.append(f"  → {step}")
    if result.technical_details and result.severity == safe_runner.ErrorSeverity.BUG:
        msg.append("")
        msg.append("Technische Details (für Issue) :")
        msg.append(result.technical_details[:600])

    forms.alert("\n".join(msg), title=title, warn_icon=True)


def main():
    # 1. Récupérer infos projet pour Default
    try:
        from narchi_revit import runner
        proj_info = runner.get_revit_project_info(doc) if doc else {}
    except Exception as e:
        logger.warning(f"Project-Info-Read fehlgeschlagen: {e}")
        proj_info = {}
    default_name = proj_info.get("name", "Unbenanntes Projekt")

    # 2. Wizard pour les params
    params = ui.ask_calculation_params(default_projektname=default_name)
    if not params:
        return  # User a annulé

    # 3. Berechnung avec safe_runner (jamais de crash)
    output.print_md("### 🔄 NARCHI Berechnung läuft …")
    output.print_md(f"- Projekt: **{params['projektname']}**")
    output.print_md(f"- Gebäudeart: {params['gebaeudeart']}")
    output.print_md(f"- Standort: {params['bundesland']}"
                    + (f" / {params['grossstadt']}" if params['grossstadt'] else ""))

    with ui.progress_window("NARCHI berechnet …"):
        result = safe_runner.safe_run_calculation(doc, **params)

    # 4. Gestion du résultat
    if not result.success:
        show_safe_result_error(result)
        output.print_md(f"### ❌ {result.user_message}")
        return

    # 5. Succès — afficher les résultats
    ergebnis = result.ergebnis
    output.print_md("### ✅ Berechnung abgeschlossen")
    output.print_md(f"- **Summe netto**: {ergebnis.summe_netto:,.0f} €".replace(",", "."))
    output.print_md(f"- **Bauwerkskosten KG 300+400**: "
                    f"{ergebnis.bauwerkskosten_300_400():,.0f} €".replace(",", "."))
    if ergebnis.konfidenz_gesamt:
        output.print_md(f"- **Konfidenz 80%**: "
                        f"{ergebnis.konfidenz_gesamt.unter_80:,.0f} – "
                        f"{ergebnis.konfidenz_gesamt.ober_80:,.0f} €".replace(",", "."))

    # Si verified_costs disponible (petits projets résidentiels), afficher comparaison
    if hasattr(ergebnis, 'verified_kostenermittlung') and ergebnis.verified_kostenermittlung:
        vc = ergebnis.verified_kostenermittlung
        output.print_md(f"- **VERIFIZIERTE Kosten** (Destatis 2024): "
                        f"{vc.bauwerkskosten_netto_eur:,.0f} € "
                        f"(Fourchette {vc.bauwerkskosten_unten_eur:,.0f} – "
                        f"{vc.bauwerkskosten_oben_eur:,.0f})".replace(",", "."))

    # Warnings collectées
    if result.warnings_collected:
        output.print_md("### ⚠️ Plausibilitätshinweise")
        for w in result.warnings_collected[:10]:
            output.print_md(f"- {w}")

    # 6. Hauptdialog
    ui.show_result_summary(ergebnis)

    # 7. Speichern für andere Buttons
    import pyrevit
    pyrevit.script.write_session_storage("narchi_last_result", ergebnis)
    pyrevit.script.write_session_storage("narchi_last_warnings", result.warnings_collected)


main()
