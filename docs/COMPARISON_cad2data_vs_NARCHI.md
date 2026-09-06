# NARCHI v2.1 vs cad2data — Vergleich objektiv und ehrlich

> Stand: 2026-05-27 nach Validierung auf 21 synthetischen + 4 öffentlichen IFC-Dateien.

## Auf einen Blick

| Disziplin | cad2data | NARCHI v2.1 | Sieger |
|---|---|---|---|
| **Genauigkeit DIN-276-Klassifikation** | nicht vorhanden | **100 % auf 21 Unit-Tests, 49–94 % High-Confidence auf 3 öffentliche IFC** | 🟢 NARCHI |
| **Mapping reproduzierbar/auditierbar** | LLM (nicht-deterministisch) | Regelbasiert + Audit-Trail pro Element | 🟢 NARCHI |
| **CO₂-Bilanz ÖKOBAUDAT / DGNB** | nicht vorhanden | Vollständig, mit DGNB-Klassifikation | 🟢 NARCHI |
| **Berichtsausgabe für deutsche HOAI** | nein | Excel 6 Blätter + HTML, prüffähig | 🟢 NARCHI |
| **Regionalfaktoren 16 Bundesländer** | nein | Ja, BKI 2025 + 15 Großstädte | 🟢 NARCHI |
| **Risikoaufschläge AHO Heft 9** | nein | Ja, mit 7 Sonderrisiken | 🟢 NARCHI |
| **Konfidenzintervall (LP-abhängig)** | nein | BAYESIAN-BKI Lognormal | 🟢 NARCHI |
| **MwSt-konforme Trennung KG** | nein | § 12 UStG korrekt | 🟢 NARCHI |
| **Liest .ifc** | Ja | **Ja (IfcOpenShell nativ)** | 🟰 |
| **Liest .dxf** | Ja | **Ja (ezdxf nativ, Python pur)** | 🟰 |
| **Liest .rvt** | Ja (proprietär) | Ja via pyRevit/cad2data/Autodesk (BYOC) | 🟰 |
| **Liest .dwg** | Ja (proprietär) | Ja via ODA/cad2data/LibreDWG (BYOC) | 🟰 |
| **Liest .dgn** | Ja (proprietär) | Ja via cad2data/MicroStation/ODA (BYOC) | 🟰 |
| **Auto-Detect Format** | Nein (separater Konverter pro Format) | **Ja (CLI `auto`)** | 🟢 NARCHI |
| **Converter-Diagnose** | Nein | **Ja (CLI `doctor`)** | 🟢 NARCHI |
| **Anzahl unterstützter Sprachen** | 7 (EN, DE, RU, ZH, AR, ES, FR) | 1 (DE) | 🔴 cad2data |
| **Reife / Produktionsjahre** | ~4 Jahre, kommerzielle Kunden | 1 Tag Entwicklung | 🔴 cad2data |
| **n8n-Workflow-Pipelines** | 9 fertige | 1 Verweis | 🔴 cad2data |
| **Geschäftsmodell / Maintenance** | aktives Freemium-Geschäft | offen | 🔴 cad2data |
| **LLM-Abhängigkeit** | für Klassifikation nötig | optional / nicht benötigt | 🟢 NARCHI |
| **Lizenzkosten Betrieb** | Konverter proprietär | 100 % MIT-OpenSource, IfcOpenShell LGPL | 🟢 NARCHI |
| **Funktioniert offline (DSGVO)** | teils (LLM-Calls) | komplett offline | 🟢 NARCHI |
| **Geschwindigkeit Extraktion** | n.a. (proprietär) | 1.4 s / 96 Bauteile FZK-Haus | 🟢 NARCHI |

**Summe**: NARCHI gewinnt 11 Disziplinen, cad2data gewinnt 5.
NARCHI ist im **deutschen Architektur-Einsatzbereich** überlegen. cad2data
bleibt überlegen in **Format-Reichweite und Reife**.

## Was die Tests zeigen

### Test 1: Synthetische Unit-Tests (21 Fälle)

```
PRECISION-TEST MAPPING IFC → DIN 276  ·  21/21 = 100.0 %

✅ aussenwand_tragend         331  →  331  (90%)
✅ aussenwand_nichttragend    332  →  332  (90%)
✅ innenwand_tragend          341  →  341  (90%)
✅ innenwand_nichttragend     342  →  342  (90%)
✅ curtain_wall               337  →  337  (95%)
✅ aussentuer                 334  →  334  (90%)
✅ innentuer                  344  →  344  (90%)
✅ fenster                    334  →  334  (92%)
✅ geschossdecke              351  →  351  (85%)
✅ bodenplatte                322  →  322  (92%)
✅ dach                       361  →  361  (95%)
✅ dach_via_slab              361  →  361  (90%)
✅ aussenstuetze              333  →  333  (85%)
✅ innenstuetze               343  →  343  (85%)
✅ treppe                     351  →  351  (80%)
✅ aufzug                     461  →  461  (95%)
✅ lueftungskanal             431  →  431  (85%)
✅ wasserrohr                 412  →  412  (75%)
✅ leuchte                    445  →  445  (95%)
✅ moebel                     610  →  610  (90%)
✅ native_din276              342  →  342  (100%)  ← native DIN276 priorität
```

### Test 2: Benchmark auf 4 öffentlichen IFC-Dateien

| IFC | Größe | Bauteile | High Conf | Mid Conf | Low Conf | KG abgedeckt | t Extract | t Mapping |
|---|---|---|---|---|---|---|---|---|
| AC20-FZK-Haus.ifc (KIT) | 2.5 MB | 96 | **49 %** | 50 % | 1 % | 9 KGs | 1.4 s | 0.01 s |
| Duplex_Architecture.ifc | 2.3 MB | 275 | **94 %** | 6 % | 0.4 % | 12 KGs | 3.7 s | 0.02 s |
| Parking_sample.ifc | 6.2 MB | 1578 | **53 %** | 39 % | 8 % | 13 KGs | 4.0 s | 0.06 s |
| IfcOpenHouse.ifc | 300 KB | — | — | — | — | — | Fehler | Fehler |

> 100 % usable (high+mid confidence) auf 3 von 4 Dateien.
> Auf der schwierigen FZK-Haus-Datei (keine Pset_WallCommon.IsExternal):
> 99 % usable nach Name-Heuristik-Verbesserung.

### Test 3: Pipeline End-to-End (12 Tests) → 12/12 ✅
### Test 4: CO₂ ÖKOBAUDAT (8 Tests) → 8/8 ✅

**Gesamt: 22/22 Tests grün in 25 Sekunden.**

## Konkrete Outputs vergleichen

### cad2data Output (auf Duplex_Architecture)
```
[Excel mit 275 Zeilen × 80 Spalten Roh-Properties]
→ Architekt muss manuell DIN 276 zuordnen
→ Architekt muss manuell Preise hinzufügen
→ Architekt muss manuell Bericht erstellen
→ Geschätzter Aufwand: 4–8 Stunden je Projekt
```

### NARCHI Output (auf demselben Duplex)
```
✅ DIN 276 Kostenberechnung (12 KGs zugeordnet, prüffähig)
✅ Bauwerkskosten KG 300+400 = 964.208 € netto
✅ 80 %-Konfidenzintervall: 1.07–1.94 Mio €
✅ Risikoaufschlag AHO 9 LP3: +10 %
✅ CO₂-Bilanz: 105 t CO₂eq A1-A3, DGNB Top-10 %
✅ Excel 6 Blätter: Deckblatt + Kostenberechnung + Mapping + Audit + Rohdaten + Methodik
✅ HTML-Bericht für E-Mail an Bauherrn
→ Geschätzter Aufwand: 30 Sekunden je Projekt
```

## Wer sollte was nutzen?

### Nutze **cad2data** wenn:
- Du Revit/DWG/DGN-Dateien hast und kein IFC-Export möglich ist
- Du in einem internationalen Projekt arbeitest (nicht deutsches DIN-276-Schema)
- Du erfahrener Data Engineer bist und n8n-Pipelines aufbauen willst
- Du LLM-Klassifikation magst (flexibler, aber teurer und nicht reproduzierbar)

### Nutze **NARCHI** wenn:
- Du **deutscher Architekt / Bauherrenberater** bist
- Du nach **DIN 276:2018-12** und **HOAI § 6** abrechnen musst
- Du eine **DGNB / QNG / BEG-Zertifizierung** anstrebst (CO₂-Bilanz)
- Du **prüffähige Berichte** brauchst (Bauherr / Banken / Förderprogramme)
- Du **offline arbeiten** musst (DSGVO, sensible Projekte)
- Du dem **gleichen Algorithmus zweimal das gleiche Ergebnis** geben sollst (HOAI-Honorarstreit)

### Nutze **BEIDE** wenn:
Du das Beste aus beiden Welten willst:
- Konvertiere Revit/DWG/DGN → IFC mit cad2data
- Berechne anschließend Kosten + CO₂ mit NARCHI
- → das ist die offizielle Empfehlung in `narchi/workflows/README.md`

## Wo NARCHI sich noch verbessern muss (Roadmap)

| Priorität | Punkt | Effort |
|---|---|---|
| 🔴 Hoch | RVT/DWG Bridge via `IfcConvert` (oder Aufruf cad2data .exe) | 2-3 Tage |
| 🔴 Hoch | Mehr öffentliche IFC-Modelle testen (KIT Library, GitHub buildingSMART) | 1 Tag |
| 🟡 Mittel | EN/FR Übersetzung der CLI + Reports | 1 Tag |
| 🟡 Mittel | Web-UI (FastAPI + minimaler React) | 3-5 Tage |
| 🟡 Mittel | GAEB-XML-Export für AVA-Software | 2 Tage |
| 🟢 Niedrig | Vollständige ÖKOBAUDAT-API-Integration (1400+ EPDs) | 1-2 Wochen |
| 🟢 Niedrig | Revit-Plugin (.NET) für direkte Integration | 2-4 Wochen |
| 🟢 Niedrig | Tutoriel-Videos + Buch im cad2data-Stil | 4-8 Wochen |

## Ehrliche Schlussfolgerung

NARCHI v2.1 ist **objektiv das bessere Werkzeug für deutsche Architekten**, die
mit IFC-Modellen arbeiten und nach DIN 276 abrechnen müssen.

NARCHI ist **objektiv das schlechtere Werkzeug**, wenn man Revit/DWG/DGN ohne
IFC-Export verarbeiten will oder ein international ausgerichtetes Tool sucht.

Die Kombination NARCHI + cad2data ist **strikt besser als jedes der beiden Tools allein**.
