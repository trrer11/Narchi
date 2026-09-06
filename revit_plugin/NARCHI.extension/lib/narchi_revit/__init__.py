"""
narchi_revit · Brücke zwischen Revit-API und NARCHI-Engine

Liest direkt das laufende Revit-Modell (ohne IFC-Export-Umweg) und übergibt
einen NARCHI-kompatiblen pandas-DataFrame an die `narchi.engine.kalkulieren()`.

Vorteile gegenüber IFC-Export+CLI:
  - 100% der Revit-Daten verfügbar (auch Custom Parameters)
  - Live-Berechnung bei jeder Modell-Modifikation
  - Bidirektional: NARCHI kann DIN-276-KG-Code in Revit zurückschreiben
  - 10x schneller (kein IFC-Export-Roundtrip)
  - Funktioniert auch ohne IfcOpenShell
"""
from __future__ import annotations
__version__ = "2.4.0"
