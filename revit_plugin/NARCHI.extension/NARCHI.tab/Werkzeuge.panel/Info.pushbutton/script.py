"""NARCHI · Info & Hilfe-Button."""
from pyrevit import forms, script

try:
    from narchi_revit import runner
    runner._add_narchi_to_path()
    from narchi import __version__ as narchi_version
    from narchi.extract import available_converters
    cv = available_converters()
    cv_lines = [f"  {k:<15s}  {v}" for k, v in cv.items()]
except ImportError as e:
    narchi_version = "?"
    cv_lines = [f"❌ narchi nicht geladen : {e}"]

forms.alert(
    f"NARCHI · BIM-zu-DIN276 Plattform\n"
    f"════════════════════════════════════════\n"
    f"  Version : {narchi_version}\n"
    f"  Plugin  : NARCHI.extension v2.4.0\n"
    f"  Lizenz  : MIT (Open Source)\n"
    f"\n"
    f"  Module verfügbar :\n"
    f"    📐 DIN 276 Kostenermittlung\n"
    f"    🌍 CO₂-Bilanz ÖKOBAUDAT\n"
    f"    ⚡ GEG 2024 Konformitätscheck\n"
    f"    💰 KfW + BAFA Förderprogramme\n"
    f"    📊 Sensitivitätsanalyse\n"
    f"    🔍 Soll/Ist-Vergleich\n"
    f"    📋 GAEB X83 Export\n"
    f"    📜 Audit-Trail HOAI § 6\n"
    f"\n"
    f"  Externe Konverter (für RVT/DWG außerhalb Revit) :\n"
    + "\n".join(cv_lines) + "\n"
    f"\n"
    f"  Dokumentation : github.com/narchi-projekt/narchi/docs/\n"
    f"  Issues       : github.com/narchi-projekt/narchi/issues\n",
    title="NARCHI · Info"
)
