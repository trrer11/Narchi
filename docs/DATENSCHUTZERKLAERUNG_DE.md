# NARCHI — Datenschutzerklärung (Entwurf, zur anwaltlichen Prüfung)

> **Hinweis (DE, für den Inhaber):** Dieses Dokument ist ein **Entwurf** —
> **keine Rechtsberatung**. Eine Datenschutzerklärung ist nach **Art. 13 / 14
> DSGVO** verpflichtend, sobald personenbezogene Daten verarbeitet werden.
> Sie muss **vor dem öffentlichen Launch** durch einen Anwalt geprüft und die
> Platzhalter `[…]` ersetzt werden. Die Struktur folgt der üblichen Praxis.

---

# Datenschutzerklärung

## 1. Verantwortlicher

Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:

**[Name des Inhabers / Firmenname]**\
[Anschrift]\
**E-Mail:** [E-Mail-Adresse]

*(Kontakt Datenschutz: siehe § 10.)*

## 2. Überblick

**NARCHI** ist eine Software für Architekturbüros (BIM → Kostenschätzung nach
DIN 276, HOAI, GAEB, Baustellen-Dokumentation, E-Rechnung XRechnung/ZUGFeRD,
CO₂-Bilanz). NARCHI wird **auf der Infrastruktur des Büros betrieben**
(Selbst-Hosting, Windows + Docker Desktop).

> **Wichtige Abgrenzung:** Für die **Projekt- und Kundendaten** eines
> Architekturbüros ist **das Büro selbst** der datenschutzrechtlich
> Verantwortliche (es entscheidet über Zwecke und Mittel der Verarbeitung
> seiner Kunden-/Projektdaten). NARCHI stellt hierfür die **Software** bereit.
> Soweit der NARCHI-Inhaber selbst personenbezogene Daten verarbeitet
> (z. B. Vertragsdaten des Büros als Kunde), ist er Verantwortlicher nach
> dieser Erklärung.

## 3. Hosting und Infrastruktur

Die Anwendung und ihre Datenbanken (PostgreSQL, Redis) laufen **auf Servern
des Büros** (lokal oder in einer vom Büro gewählten Umgebung). Der
NARCHI-Inhaber hat **keinen Zugriff** auf diese Daten, außer zur
Fehlerbehebung mit ausdrücklicher Zustimmung des Büros (siehe AVV,
`docs/AGB_AVV_ENTWURF.md`).

## 4. Verarbeitete Datenkategorien

| Kategorie | Beispiele | Zweck |
|---|---|---|
| **Vertragsdaten** | Name, Anschrift, E-Mail des Büros als Kunde | Vertragserfüllung, Rechnungsstellung |
| **Projekt- & Kundendaten** (des Büros) | Kundennamen, Adressen, Projektbeschreibungen | Planung, Kostenschätzung, Rechnung |
| **Modelldaten (IFC)** | Geometrie, Bauteile, Mengen, Materialien | BIM-Auswertung, DIN 276, CO₂-Bilanz |
| **Baustellen-Dokumentation** | Fotos, Mängel, Befunde | Qualitätssicherung, Nachweisführung |
| **Beschäftigtendaten** (des Büros) | Namen, Initialen, Rollen | Benutzerkonten, Zuweisungen |
| **Technische Daten** | Logs, Zeitstempel, Geräteinformationen | Betriebssicherheit, Fehlerbehebung |

## 5. Rechtsgrundlagen (Art. 6 DSGVO)

- **Art. 6 Abs. 1 lit. b DSGVO** — Vertragserfüllung (Bereitstellung der
  Software, Rechnungsstellung);
- **Art. 6 Abs. 1 lit. c DSGVO** — gesetzliche Pflichten (z. B. Aufbewahrung
  von Rechnungen nach § 147 AO / HGB);
- **Art. 6 Abs. 1 lit. f DSGVO** — berechtigtes Interesse (Betriebssicherheit,
  Fehlerbehebung, Missbrauchsabwehr).

Für die vom **Büro** verarbeiteten Projekt-/Kundendaten trägt das Büro die
Verantwortung für die Rechtsgrundlage (typischerweise Art. 6 Abs. 1 lit. b
DSGVO gegenüber seinen Kunden).

## 6. Empfänger und Auftragsverarbeitung

Soweit der NARCHI-Inhaber Daten verarbeitet, erfolgt dies ausschließlich im
Rahmen eines **Auftragsverarbeitungsvertrags (AVV)** nach Art. 28 DSGVO
(siehe `docs/AGB_AVV_ENTWURF.md`, Teil 2). Eine Übermittlung in Drittländer
findet nicht statt, sofern das Büro keine eigene Infrastruktur außerhalb der
EU/des EWR wählt.

## 7. Speicherdauer und Löschung

- **Vertragsdaten** werden für die Dauer der Vertragsbeziehung und der
  gesetzlichen Aufbewahrungsfristen (Steuer-/Handelsrecht, i. d. R. 6–10 Jahre)
  gespeichert und danach gelöscht.
- **Projekt-/Kundendaten des Büros** liegen in der Verantwortung des Büros;
  NARCHI stellt Löschfunktionen bereit (Projekt-Löschung mit Kaskade, siehe
  Löschkonzept in `docs/RUNBOOK_BETRIEB_DE.md`).
- **Sicherungen** werden nach dem in `docs/SAUVEGARDES_NARCHI.md`
  beschriebenen Zeitplan rotiert.

## 8. Rechte der betroffenen Personen

Sie haben das Recht auf **Auskunft** (Art. 15), **Berichtigung** (Art. 16),
**Löschung** (Art. 17), **Einschränkung** (Art. 18), **Datenübertragbarkeit**
(Art. 20) und **Widerspruch** (Art. 21). Zur Ausübung wenden Sie sich an die
Kontaktadresse in § 1. Zudem besteht ein **Beschwerderecht** bei einer
Datenschutz-Aufsichtsbehörde.

## 9. Datensicherheit

NARCHI setzt technische und organisatorische Maßnahmen (Art. 32 DSGVO) um:
Verschlüsselung im Transport (TLS/HTTPS), rollenbasierte Zugriffskontrolle,
Mandantentrennung (Tenant-Scoping), Passwort-Hashing und Protokollierung.
Details: `docs/RUNBOOK_BETRIEB_DE.md` und `docs/SAUVEGARDES_NARCHI.md`.

## 10. Kontakt Datenschutz

**[Name / Funktion]**\
[E-Mail-Adresse]\
[Anschrift]

---

## Checkliste vor dem Launch

- [ ] Verantwortlicher (§ 1) vollständig und mit erreichbarer E-Mail.
- [ ] Abgrenzung Büro ↔ Inhaber (§ 2) an das konkrete Angebot angepasst
      (Selbst-Hosting vs. spätere Hosted-Variante).
- [ ] AVV (`docs/AGB_AVV_ENTWURF.md`, Teil 2) mit dem Büro abgeschlossen,
      **bevor** der Inhaber Zugriff auf deren Daten erhält.
- [ ] Löschkonzept umgesetzt (Aufbewahrungsfristen § 147 AO beachten).
- [ ] Datenschutzerklärung von jeder Seite aus verlinkt (Footer).

> **Rechtlicher Stand:** Entwurf, Stand 17/08/2026. Ersetzt keine
> anwaltliche Prüfung.
