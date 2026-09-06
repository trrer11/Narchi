# NARCHI — Bedienungsanleitung für Ihr Architekturbüro

> **Für die Mitarbeitenden der Beta-Büros.** Stand: 16. August 2026 (§134).
> Diese Anleitung beschreibt NUR, was wirklich existiert und getestet ist —
> kein Absatz über eine Funktion, die es nicht gibt. Wo etwas noch nicht
> möglich ist, steht es hier ehrlich.
>
> Die Bildschirmtexte sind teils noch nicht vollständig auf Deutsch
> (einige Menüpunkte wie „Vue d'ensemble“ oder „Maquette 3D“ erscheinen
> noch auf Französisch). Das ist ein bekannter, rein kosmetischer Punkt —
> er ändert nichts an der Funktion. Die Menüpunkte dieser Anleitung nennen
> deshalb den WEG zum Ziel (deutscher Funktionsname), nicht das exakte
> Etikett.

---

## 1. Erste Schritte

1. Öffnen Sie NARCHI im Browser: `http://localhost:8080` (oder die
   HTTPS-Adresse, wenn Ihr Büro Schritt 4 aktiviert hat).
2. **„Noch kein Konto? Registrieren“** — Sie legen Ihren eigenen,
   abgeschotteten Büroraum an (Trial-Mandant). Niemand außerhalb Ihres
   Büros sieht Ihre Daten; Sie sehen die anderer Büros nie.
3. Nach dem Einloggen landen Sie im Cockpit. Links das Menü, in vier
   Bereichen: **Strategic Hub**, **Expert Engines**, **Team &
   Kommunikation**, **Agency Ops**.

**Ehrlich gesagt:** es gibt KEINE echten Testdaten vorab. Ein Projekt
entsteht erst, wenn Sie eines anlegen. Keine Sorge — die Anleitung führt
Sie Schritt für Schritt.

---

## 2. Modell importieren (IFC) — das „Wow“ in 60 Sekunden

1. Menü **Maquette 3D** (Import) öffnen.
2. Eine **IFC-Datei** hochladen (auch IFCZIP, IFCXML, STEP). Die Datei
   bleibt lokal im Browser (Web-Worker), nichts lädt in die Cloud.
3. Ergebnis in ca. 60 Sekunden: eine 3D-Ansicht + die Übersicht der
   indexierten Bauteile (z. B. „1.814 Bauteile indexiert“), durchsuchbar
   nach Typ, Material, Ebene und Menge.

**Was Ihnen NARCHI hier ehrlich sagt:** die Datei wird geprüft
(Magic-Byte, Größenlimit). Wird etwas abgelehnt, steht der Grund dabei —
nie ein stilles „Fehler“.

---

## 3. Kostenschätzung nach DIN 276

1. Menü **Estimation DIN 276** öffnen (ein Projekt vorausgewählt).
2. NARCHI zieht die Mengen automatisch aus dem Modell und ordnet sie den
   **Kostengruppen der DIN 276** zu.
3. Jeder Kennwert trägt eine **Herkunfts-Marke** (das ist die Charta der
   Ehrlichkeit, §36):
   - **Messung** = aus Ihrem Modell gemessen,
   - **Richtwert** = Kennwert mit benannter Quelle und Jahr,
   - **Regel** = normativ begründete Annahme.
4. Ergebnis als **PDF** (mit Ihrem Büro-Logo, wenn hinterlegt).

**Kein Preis ohne Herkunft** — das ist das Kernversprechen. Ein Wert ohne
Quelle wird als solcher markiert, nie still erfunden.

---

## 4. Preisbibliothek (eigene Preise)

- Importieren Sie Ihre eigene Preisliste als **CSV** (Format
  `oz;kurztext;einheit;ep;[jahr]`) oder **GAEB X31** — mit Vorschau vor
  der Übernahme.
- Ihre Büro-Preise werden gespeichert und wiederverwendet: **jede
  Schätzung macht die nächste besser.**
- Neu (§95–§99): echte Preise aus Angeboten (GAEB) fließen über den
  Knopf „→ Bibliothek“ zurück in Ihre Bibliothek — mit **Min/Median/Max**
  je Position (ab 2 Beobachtungen, Ausreißer ziehen die Schätzung nicht
  mehr schief).

---

## 5. Honorare nach HOAI 2021

Menü **Honoraires HOAI** — die anrechenbaren Kosten (aus der DIN-276-
Schätzung) werden transparent hergeleitet. Die Seite beantwortet die
Fragen, die in HOAI-Foren wöchentlich diskutiert werden (welche KG ist
anrechenbar?).

---

## 6. Rechnungen & E-Rechnung (AGENCY OPS → Rechnungen)

Das vollständige, getestete Rechnungsbuch. **5 Schritte:**

1. **„+ Neue Rechnung“** — Kunde + Ihr Büro eintragen. Pflichtangaben
   (Leitweg-ID für Behörden, USt-IdNr, Leistungsdatum ODER Zeitraum,
   Bankverbindung/IBAN, Kontakt, E-Mail-Adressen) werden **nicht**
   erfunden: fehlt etwas, nennt NARCHI es genau.
2. **Leistungen** eintragen (Menge, Einheit, Preis netto, 19 % oder 7 %).
   Die Vorschau rechnet mit **exakt denselben Regeln wie der Server** —
   auf den Cent.
3. **„Entwurf speichern“** — frei änderbar, ohne Nummer.
4. **„Ausstellen“** — der Server vergibt Nummer (`RE-2026-0001`) und
   Datum und friert die Rechnung ein (GoBD). Eine ausgestellte Rechnung
   wird **nie** geändert oder gelöscht — Fehler? **„Stornieren“** mit
   Grund, die Nummer bleibt reserviert (kein Loch in der Kette).
5. **Herunterladen** — vier Formate stehen bereit:
   - **XML (XRechnung 3.0)** — vom offiziellen KoSIT-Validator bestanden.
   - **PDF/A-3 (ZUGFeRD)** — ein PDF, das Sie lesen UND das die Maschine
     Ihres Kunden ausliest (XML eingebettet). PDF/A-3-konform (Mustang).
   - **UBL (Peppol)** — dieselbe Rechnung in der Peppol-Syntax, KoSIT-
     validiert.
   - **E-Mail-Entwurf (.eml)** — öffnet sich in Ihrem Mail-Programm mit
     dem PDF/A-3 als Anhang; Sie drücken nur noch „Senden“.

**Ehrlich gesagt:** der Versand über das Peppol-Netz ist noch nicht
angeschlossen (braucht einen Zugangspunkt/„Access Point“) — das PDF/A-3
und der E-Mail-Entwurf decken den B2B-Alltag heute ab. Details:
`docs/E_RECHNUNG.md`, `docs/PEPPOL.md`.

---

## 7. Energie & LCA (GEG 2024)

Menü **Énergie & LCA** — Energiebilanz-Prüfung nach GEG 2024 aus den
Modelldaten, CO₂-Bilanz (graue Emissionen) über das Portfolio.

---

## 8. QC & Planprüfung

Menü **QC & Conformité** — Modell-Gesundheitscheck, Konformitäts-
übersicht, Issues mit Verlauf. Der **Haftungsradar** zeigt Fluchtweg &
Brandschutz (§ 34 MBO / DIN 4102), Barrierefreiheit (DIN 18040), GEG und
Kostensicherheit (DIN 276) — mit klarer „Risiko / geschützt“-Aussage je
Thema.

---

## 9. Team & Nachrichten

- **Nachrichten**: Projekt-Kanäle und Direktnachrichten, mit
  Ungelesen-Anzeige (eine schwarze Blase mit der Gesamtzahl; der
  Detailstand pro Unterhaltung im Panel „Unterhaltungen“).
- **Team**: Mitglieder und Rollen (Owner / Admin / Architekt). Kanäle
  verwalten Sie per Rechtsklick (Umbenennen, endgültig Löschen — nur für
  Owner/Admin, der Server erzwingt es).
- **Echte Abgeschlossenheit**: der Server filtert jede Abfrage nach Ihrem
  Büro — kein Kanal, kein Projekt eines anderen Büros ist auch nur lesbar
  (durch Tests bewiesen).

---

## 10. Baustelle (Fotos, Videos, Mängel)

Menü **Baustelle**:

1. Ein Projekt wählen (ohne Projekt ist der Import gesperrt — und sagt es;
   existiert gar kein Projekt, legt NARCHI das erste direkt mit an).
2. **Fotos und Videos** vom Handy ins Büro importieren (JPEG/PNG/WebP/
   GIF/BMP; Videos MP4/WebM/MOV). **HEIC wird abgelehnt und erklärt**
   (der Browser kann es nicht anzeigen — stellen Sie am iPhone auf
   „Maximale Kompatibilität“).
3. Die Fotos werden nach **echtem Aufnahmedatum** sortiert (EXIF bzw.
   Video-Metadaten; die Quelle wird immer angezeigt) und in Besuche
   („Besuch vom TT.MM.JJJJ“) gruppiert.
4. Ausgewählte Fotos werden zu einem **Mangel** mit Datum (Tag der
   ältesten Foto) und Beweisdateien.

**Ehrlich gesagt:** NARCHI macht **keine Bilderkennung** (der Bildschirm
sagt es) — die Sortierung stützt sich auf die Metadaten, nie auf den
Inhalt.

---

## 11. Synchronisation zwischen Geräten

Mängel, Projekte und Fotos/Videos wandern über den Server zwischen den
Geräten des Büros:

- **Offline?** NARCHI merkt sich alles in einer Warteschlange und holt
  nach, sobald es wieder online ist. Das Badge sagt ehrlich „Offline —
  N warten“ statt still zu schweigen.
- **Mehrere Geräte?** Ein hier angelegtes Projekt erscheint auf den
  anderen Geräten; Fotos/Videos wandern mit (bis 25 MiB Foto / 300 MiB
  Video, serverseitig geprüft).
- Für die Nutzung **am Telefon** (per LAN) aktivieren Sie einmalig
  `8_ACTIVER_HTTPS_LOCAL.bat` (Anleitung: `docs/HTTPS_LOCAL.md`).

**Ehrlich gesagt:** die Synchronisation ist automatisiert getestet
(Playwright, echter Browser), aber der allererste Test **auf Ihrem echten
Telefon** steht noch aus — genau dafür sind Sie als Beta-Büro da.
Schritt-für-Schritt: `docs/GUIDE_TELEPHONE_PAS_A_PAS.md`.

---

## 12. NARCHI IQ (KI)

Menü **NARCHI IQ** — KI-Antworten sind an Ihre Daten und an zitierte
Herkunft gebunden; es werden keine Kennwerte erfunden. Der Schlüssel
bleibt ausschließlich auf dem Server.

---

## 13. Ihre Daten und die Sicherung

- **Alle Daten bleiben bei Ihnen** (Selbst-Hosting, DSGVO-freundlich).
- **Sicherungen** (doppelt):
  - `5_SAUVEGARDE_EXTERNE.bat` — Kopie der **Datenbank** in
    `sauvegardes\`, mit Beweis der Wiederherstellbarkeit
    (`6_VERIFIER_RESTAURATION.bat`).
  - `scripts\SAUVEGARDER_LES_FICHIERS.bat` — Kopie der **Fotos/Videos**
    (Volumen) in `sauvegardes\` (neu §133).
- **Goldene Regel:** eine Kopie auf demselben Rechner schützt nicht vor
  Festplattenschaden. Kopieren Sie den Ordner `sauvegardes\` regelmäßig
  auf einen USB-Stick / ein anderes Gerät. Details:
  `docs/SAUVEGARDES_NARCHI.md`.

---

## 14. Hilfe & Rückmeldung

- Knopf **„Feedback hinterlassen“** auf der Startseite — Ihre Bemerkung
  landet direkt im System (die offizielle Beta-Schleife).
- **Beta-Vereinbarung:** als Beta-Büro nutzen Sie NARCHI kostenlos gegen
  einen kurzen wöchentlichen Erfahrungsbericht. Das ist die Gegenleistung
  für die kostenlose Nutzung (`docs/CONTRAT_BETA.md`).

---

## 15. Was NARCHI heute NOCH NICHT kann (ehrlich)

- Versand über das **Peppol-Netz** (Access Point nötig) — B2B heute via
  PDF/A-3 + E-Mail-Entwurf.
- **HEIC**-Import (iPhone-Standard) — bitte „Maximale Kompatibilität“.
- Automatischer **SMTP-Versand** — der E-Mail-Entwurf wird in Ihrem
  Mail-Programm gesendet.
- Vollständig **deutsche Menütexte** — noch teils französisch (kosmetisch).

Diese Punkte sind dokumentiert, nicht verschwiegen. Sie sind die Liste
der nächsten Schritte, nicht der Fehler.
