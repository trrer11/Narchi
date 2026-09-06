# NARCHI für Revit — pyRevit Extension

> **NARCHI direkt im Revit-Ruban: Kostenermittlung + CO₂ + GEG + Förderung mit einem Klick**
> Kompatibel mit Revit 2021–2026 · 100 % Open Source MIT · Offline-fähig

## 🎯 Was das Plugin macht

Statt einen IFC-Export-Umweg zu fahren, **liest NARCHI direkt die Bauteile aus dem aktiven Revit-Modell** über die Revit-API.
Resultat: Berechnung in 3-5 Sekunden statt 30 Sekunden, mit 100 % der Revit-Daten (auch Custom Parameters).

## 📦 Was ist enthalten

Ein Tab **"NARCHI"** im Revit-Ribbon mit 3 Panels und 8 Buttons :

### Panel "Berechnung"
| Button | Funktion |
|---|---|
| 📊 **Kostenermittlung** | Komplette Pipeline DIN 276 + CO₂ + GEG + Förderung |
| 🔍 **Modell validieren** | IDS-Check ob Modell für NARCHI auswertbar |
| ✍️ **DIN276 Codes in Modell** | Bidirektional: schreibt KG-Codes zurück in die Bauteile |

### Panel "Export"
| Button | Funktion |
|---|---|
| 📑 **Excel Bericht** | 6-Blatt Excel + HTML-Bericht prüffähig HOAI § 6 |
| 🏗️ **GAEB X83 für AVA** | LV-Export für RIB iTWO / California.pro / ORCA AVA |
| 📜 **JSON Audit-Trail** | Prüfbar mit SHA-256 Integritäts-Hash |

### Panel "Werkzeuge"
| Button | Funktion |
|---|---|
| ℹ️ **Info / Hilfe** | Version, Lizenz, verfügbare Module, Doku-Links |
| 🔄 **Soll/Ist Vergleich** | Aktueller Stand gegen einen früheren Audit-JSON vergleichen |

## 🚀 Installation in 3 Schritten

### Schritt 1 : pyRevit installieren

1. https://github.com/eirannejad/pyRevit/releases herunterladen
2. Installer ausführen (wählen Sie Ihre Revit-Versionen)
3. Revit starten — der **pyRevit-Tab** sollte erscheinen

### Schritt 2 : NARCHI-Engine installieren

**Option A : via pip (empfohlen)**
```powershell
# In Windows PowerShell als Admin
pip install narchi
```

**Option B : Repo klonen**
```powershell
git clone https://github.com/narchi-projekt/narchi.git
cd narchi
pip install -e .
```

### Schritt 3 : NARCHI-Extension in pyRevit registrieren

**Option A : via pyRevit-CLI**
```powershell
pyrevit extend ui NARCHI https://github.com/narchi-projekt/narchi.git --branch=main
```

**Option B : manuell**
1. Den Ordner `revit_plugin\NARCHI.extension\` aus diesem Repo kopieren
2. In `%APPDATA%\pyRevit\Extensions\` einfügen
3. In Revit : pyRevit-Tab → **« Reload »** klicken
4. Der **NARCHI-Tab** erscheint im Ribbon !

## 🎓 Erste Schritte

### 1. Modell öffnen

Öffnen Sie eines Ihrer Revit-Modelle.
Test-Empfehlung : ein **Beispielprojekt 2023 racbasicsampleproject.rvt** von Autodesk (mit cad2data-Repo geliefert).

### 2. Validierung

Klicken Sie auf **"Modell validieren"** (Tab NARCHI → Panel Berechnung).

Das Plugin analysiert Ihr Modell und gibt einen **Score 0–100 %** zurück mit konkreten Vorschlägen :
- ✅ Anzahl Bauteile : 502
- ⚠️ Pset_WallCommon vorhanden : Nein → Pset_WallCommon.IsExternal aktivieren
- ✅ Geometriedaten : 92 %
- ...

### 3. Kostenermittlung

Klicken Sie auf **"Kostenermittlung"**.

6-Schritt-Wizard :
1. **Projektname** (Default = Revit Projektinformationen)
2. **Gebäudeart** (12 Typen: EFH, MFH, Büro, Schule, Krankenhaus, …)
3. **Standard** (einfach / mittel / hoch)
4. **Bundesland** (16 deutsche Länder + Regionalfaktor)
5. **Großstadt** (optionaler Zuschlag)
6. **Berechnungsmodus** (hybrid empfohlen für LP 3)

Berechnung läuft mit Fortschrittsanzeige (3–5 Sekunden), dann ein WPF-Fenster mit allen Ergebnissen.

### 4. Export

Nach der Berechnung können Sie :
- **Excel Bericht** → für Bauherrenmeeting
- **GAEB X83** → für AVA-Software-Import
- **JSON Audit** → für HOAI § 6 Prüfung

### 5. Bidirectional : Codes zurückschreiben

Wenn Ihr Revit-Projekt einen Parameter `DIN276` hat (Text, Bauteile), klicken Sie auf **"DIN276 Codes in Modell"**.

Jedes Bauteil bekommt seinen DIN-276-Code direkt im Modell !
→ Sie können dann Filter anlegen : « alle Elemente mit DIN276 = 331 » = alle tragenden Außenwände.

## 🧪 Test ohne Revit

Die Plugin-Module sind **mock-getestet** — sie funktionieren auch ohne Revit installed (z.B. CI Linux) :

```bash
PYTHONPATH=. python tests/test_revit_plugin.py
# → 14/14 tests ✅
```

## 📁 Plugin-Struktur

```
revit_plugin/
└── NARCHI.extension/
    ├── extension.json                    ← Manifest pyRevit
    ├── lib/
    │   └── narchi_revit/                ← Brücke Revit-API ↔ narchi
    │       ├── __init__.py
    │       ├── revit_reader.py          ← Liest Bauteile aus Revit-API
    │       ├── runner.py                ← Adapter zu narchi.engine
    │       └── ui.py                    ← WPF-Dialoge (forms)
    └── NARCHI.tab/                      ← Der Tab im Ribbon
        ├── bundle.yaml
        ├── Berechnung.panel/
        │   ├── Kostenermittlung.pushbutton/
        │   ├── Validieren.pushbutton/
        │   └── Schreiben.pushbutton/
        ├── Export.panel/
        │   ├── Excel.pushbutton/
        │   ├── GAEB.pushbutton/
        │   └── Audit.pushbutton/
        └── Werkzeuge.panel/
            ├── Info.pushbutton/
            └── Vergleich.pushbutton/
```

## 🆘 Troubleshooting

| Problem | Lösung |
|---|---|
| **NARCHI-Tab erscheint nicht** | pyRevit Reload (kleines Icon dans le tab pyRevit) ; Revit neu starten |
| **"narchi nicht gefunden"** | `pip install narchi` oder narchi/ in `lib/` kopieren |
| **U-Wert wird nicht erkannt** | Im Revit-Material den Parameter "Heat Transfer Coefficient (U)" pflegen |
| **IsExternal falsch erkannt** | Type-Parameter "Function" auf "Exterior" oder "Interior" setzen |
| **Doppelzählung Tragwerk** | Im Tragwerk-Modell den `DIN276` Parameter auf "351" für Decken setzen |
| **GAEB import in iTWO funktioniert nicht** | Den `.gaeb.csv` Fallback verwenden (gleicher Speicherort) |

## 🛠️ Erweitern / Anpassen

### Ein neues Panel hinzufügen
```
NARCHI.tab/MeinPanel.panel/
├── bundle.yaml
└── MeinButton.pushbutton/
    ├── bundle.yaml
    └── script.py    ← Ihr Python-Code
```

### Eigene Logik in script.py
```python
from pyrevit import revit, forms, script
from narchi_revit import runner

doc = revit.doc
erg = runner.run_calculation(doc, projektname="...", gebaeudeart="...", ...)
# → tout narchi est disponible
```

## 📜 Lizenz

MIT — siehe `../LICENSE`. Das pyRevit-Framework selbst ist GPLv3 (separates Projekt).
