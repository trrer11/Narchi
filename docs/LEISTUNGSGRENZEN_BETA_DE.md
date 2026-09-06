# NARCHI Beta — Leistungsgrenzen (Stand 26.08.2026)

Dieses Blatt ist die **amtliche Wahrheit für das Büro**. Was hier „nein“
steht, ist in der Software **nicht** eingebaut. Kein Verkaufsversprechen.

| Thema | In dieser Beta | Was das Büro stattdessen tut |
|---|---|---|
| **Clash Mesh / Manifold** | **Nein.** Radar = achsenausgerichtete Hüllkörper (AABB) aus IFC-`bbox`. Kein Dreiecks-Mesh, kein Soft-Clash. | Kollisionen im Autorenwerkzeug (Revit/Solibri) nachziehen, wenn die Hülle zu grob ist. |
| **WebGPU** | **Nein.** 3D = That Open + Three.js **WebGL**. | Edge/Chrome mit WebGL reicht. WebGPU ist kein Lieferstand. |
| **Speckle** | **Nein.** Kein Connector, kein Stream. | IFC-Datei importieren. Kein Cloud-BIM-Bus. |
| **EnergyPlus / TEASER** | **Nein.** GEG-Seite = Kennwerte/Regeln aus dem Modell, keine dynamische Gebäudesimulation. | Nachweis nach GEG beim Energieberater / EnEV-Software. |
| **Peppol Access Point** | **Nein.** UBL 2.1 wird erzeugt und KoSIT-geprüft. **Kein Versand** ins Peppol-Netz. | XML/UBL herunterladen oder `.eml` im Mailprogramm senden. AP später, wenn ein Büro ihn bezahlt. |
| **Agent-Reach / Scraping** | **Nein.** Kein Social-Web im Produkt. | Preise und Normen aus amtlichen/eigenen Quellen. |

## Haftung (kurz)

NARCHI ist ein **Hilfsmittel**. Mengen, Honorare, Clash, GEG-Kennwerte und
Rechnungs-XML sind **vom Büro zu prüfen**, bevor sie nach außen gehen.
Messung / Richtwert / Regel bleibt die Herkunftsmarke.

## Warum nicht „einfach einbauen“

Mesh-Clash, WebGPU-Renderer, Speckle-Connector, EnergyPlus und ein
Peppol-AP sind jeweils **eigene Produkte** (Monate, Lizenzen, Betrieb).
Sie in einer Beta vorzutäuschen wäre unseriös.

Siehe auch: `docs/PEPPOL.md`, `docs/ROADMAP_NARCHI_2027.md`, Oberfläche
**Grenzen & Recht**.
