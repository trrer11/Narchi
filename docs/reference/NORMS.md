# Normes et standards référencés par NARCHI

NARCHI implémente ou s'aligne sur les normes suivantes.

## DIN

| Norme | Année | Sujet | Module concerné |
|---|---|---|---|
| **DIN 276** | 2018-12 | Kosten im Bauwesen | `din276.py`, `mapping_din276.py`, `engine.py` |
| **DIN 277-1** | 2021-08 | Grundflächen und Rauminhalte im Bauwesen | `geometry.py` |
| **DIN 277-3** | 2015-04 | Hauptnutzungsarten (NUF1..NUF7) | `geometry.py` |
| **DIN 18299** | 2019-09 | Allgemeine Regelungen für Bauleistungen (VOB/C) | `leistungstexte.py` |
| **DIN 18300–18459** | versch. | Einzelne Leistungsbereiche (Erdbau, Mauerwerk, …) | `leistungstexte.py` |
| **DIN 488** | 2009-08 | Betonstahl | `leistungstexte.py` |
| **DIN V 18550** | 2018-05 | Putz und Putzsysteme | `leistungstexte.py` |
| **DIN 18180** | 2014-09 | Gipsplatten | `leistungstexte.py` |
| **DIN 4108** | versch. | Wärmeschutz / Energieeinsparung in Gebäuden | `geg_check.py` |
| **DIN EN 206-1** | 2001-07 | Beton — Eigenschaften und Konformität | `co2.py`, `leistungstexte.py` |
| **DIN EN 1996** | versch. | Mauerwerksbau (Eurocode 6) | `leistungstexte.py` |
| **DIN EN 1627** | 2011-09 | Einbruchhemmung — Klassen RC1..RC6 | `leistungstexte.py` |
| **DIN EN 81-20/81-50** | 2014 | Aufzüge — Sicherheit | `leistungstexte.py` |
| **DIN EN 13830** | 2015-07 | Vorhangfassade | `leistungstexte.py` |
| **DIN EN 13141** | versch. | Wohnungslüftung | `leistungstexte.py` |
| **DIN EN 1090** | versch. | Stahlbauausführung | `leistungstexte.py` |
| **DIN EN 1991-1-1** | 2010-12 | Lasten auf Tragwerke | impliziert |
| **DIN EN 12464-1** | 2021-11 | Beleuchtung von Arbeitsstätten | `leistungstexte.py` |
| **DIN 18040** | versch. | Barrierefreies Bauen | `leistungstexte.py` |

## DIN EN ISO (Ökobilanz)

| Norme | Année | Sujet | Module |
|---|---|---|---|
| **DIN EN 15978** | 2012-10 | Nachhaltigkeit von Bauwerken — Bewertung der umweltbezogenen Qualität | `co2.py` |
| **DIN EN 15804** | 2022-03 | Nachhaltigkeit — EPDs für Bauprodukte | `co2.py` |
| **DIN EN ISO 14025** | 2011-10 | Umweltkennzeichnungen Typ III (EPDs) | `co2.py` |
| **DIN EN ISO 14040** | 2021-02 | Ökobilanz — Prinzipien und Rahmenbedingungen | `co2.py` |

## HOAI et Honorarordnung

| Référence | Sujet | Module |
|---|---|---|
| **HOAI 2021** | Verordnung über die Honorare für Architekten und Ingenieurleistungen | `engine.py`, `konfidenz.py` |
| **HOAI § 6** | Anrechenbare Kosten und Kostenermittlung | `audit.py` |
| **HOAI § 34** | Leistungsbild Gebäude | impliziert |
| **HOAI § 51** | Leistungsbild Tragwerksplanung | impliziert |
| **HOAI § 55** | Leistungsbild Technische Ausrüstung | impliziert |
| **AHO Heft 9** | Untersuchungen zum Leistungsbild Projektmanagement (Risikoaufschläge) | `risiko.py` |

## Énergétique / GEG

| Référence | Sujet | Module |
|---|---|---|
| **GEG** | Gebäudeenergiegesetz, Stand 1.1.2024 (Heizungsgesetz-Novelle) | `geg_check.py` |
| **GEG Anlage 1** | Höchstwerte U-Werte | `data/geg_2024_grenzwerte.json` |
| **GEG Anlage 2** | Referenzgebäude | impliziert |
| **DIN V 18599** | Energetische Bewertung von Gebäuden | impliziert |
| **VDI 4650** | Berechnung der Jahresarbeitszahl Wärmepumpe | `leistungstexte.py` |

## buildingSMART (BIM-Standards)

| Standard | Année | Sujet | Module |
|---|---|---|---|
| **IFC4 / IFC4.3** | 2024 | Industry Foundation Classes (ISO 16739-1) | `ifc_extract.py` |
| **IFC2x3 TC1** | 2007 | Version historique encore courante | `ifc_extract.py` |
| **IfcClassification + IfcClassificationReference** | — | Mécanisme natif classification | `mapping_din276.py` |
| **IDS** | 2024 | Information Delivery Specification | `ids_validation.py` (style) |
| **bSDD** | 2024 | buildingSMART Data Dictionary | impliziert |
| **OmniClass** | versch. | Tabelle 21 = Elements, 22 = Work Results | `omniclass_din276_mapping.json` |

## Marché allemand AVA

| Référence | Sujet | Module |
|---|---|---|
| **GAEB DA XML 3.2** | Gemeinsamer Ausschuss Elektronik im Bauwesen — Datenaustausch | `gaeb_export.py` |
| **GAEB X83** | Angebotsaufforderung mit Leistungsbeschreibung | `gaeb_export.py` |
| **STLB-Bau** | Standardleistungsbuch Bau | `leistungstexte.py` |
| **DBD-BIM** | Dynamische Baudaten BIM | `leistungstexte.py` |
| **VOB/C** | DIN 18299 ff. — Vertragsbedingungen | `leistungstexte.py` |

## Förderung / Wirtschaft

| Référence | Sujet | Module |
|---|---|---|
| **BEG** | Bundesförderung für effiziente Gebäude (KfW + BAFA) | `foerderung.py` |
| **BEG EM** | Einzelmaßnahmen | `foerderung.py` |
| **BEG WG** | Wohngebäude (KfW 261 / 297) | `foerderung.py` |
| **QNG** | Qualitätssiegel Nachhaltiges Gebäude (Plus, Premium) | `foerderung.py` |
| **Effizienzhaus 40/55/70/85** | Klassifikation Energieeffizienz | `foerderung.py` |

## Statistik

| Référence | Sujet | Module |
|---|---|---|
| **Destatis Reihe 17/4 (61261)** | Baupreisindex Wohngebäude/Bürogebäude/Gewerbe | `baupreisindex.py` |
| **BKI Baukosten 2025** | Kostenkennwerte Bundesdurchschnitt + Regionalfaktoren | `bki.py`, `regional.py` |

## Mehrwertsteuer

| Référence | Sujet | Module |
|---|---|---|
| **§ 12 UStG** | Regelsteuersatz 19 % | `engine.py` |
| **§ 12 Abs. 2 UStG** | Ermäßigter Satz 7 % (z. B. Denkmal in Sonderfall) | impliziert |

## Notes importantes

1. **NARCHI implémente la *logique* de ces normes** — il ne contient pas le texte
   complet, qui reste sous droits d'auteur (Beuth Verlag, DIN, etc.).
2. **Pour un usage en justice ou pour la facturation HOAI**, l'utilisateur doit
   posséder les normes officielles et les comparer aux résultats NARCHI.
3. **Les mises à jour normatives** (par exemple DIN 276:2030 future) ne sont pas
   automatiques — il faudra actualiser les modules concernés.
