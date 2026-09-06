# NARCHI — AGB / CGV & AVV (Entwürfe, zur anwaltlichen Prüfung)

> **Hinweis (DE, für den Inhaber):** Diese Dokumente sind **Entwürfe** —
> keine Rechtsberatung. Die Rubrik „Juristisches“ steht im Beta-Bericht
> (§120) bei ~50 %: KoSIT ist bestanden, aber AGB/CGV, AVV und die
> rechtliche Seite fehlen noch und müssen **vor der ersten Unterschrift
> eines Dritten** durch einen Anwalt geprüft werden. Diese Entwürfe geben
> die **Struktur** vor, die ein Anwalt verfeinert. Platzhalter `[…]`
> sind zu ersetzen.
>
> **Ergänzende Pflichtdokumente (ebenfalls Entwürfe, §170):**
> - Impressum (§ 5 DDG) : `docs/IMPRESSUM_DE.md`
> - Datenschutzerklärung (Art. 13/14 DSGVO) : `docs/DATENSCHUTZERKLAERUNG_DE.md`

---

# Teil 1 — Allgemeine Geschäftsbedingungen (AGB / CGV)

**Anbieter:** [Name des NARCHI-Inhabers], [Anschrift], [E-Mail] („Anbieter“)

## 1. Gegenstand

1.1 Der Anbieter überlässt dem Kunden die Software „NARCHI“ (BIM →
Kostenschätzung nach DIN 276, HOAI, GAEB, Baustelle, E-Rechnung) zur
Nutzung („Software“).

1.2 Die Software wird **auf der Infrastruktur des Kunden** betrieben
(Selbst-Hosting). Der Anbieter hat keinen Zugriff auf die Kundendaten,
außer zur Fehlerbehebung mit ausdrücklicher Zustimmung.

## 2. Leistungen und Mitwirkung des Kunden

2.1 Der Kunde stellt die technische Umgebung (Windows + Docker Desktop,
siehe Installationsanleitung `docs/guide/INSTALL.md`).

2.2 Der Kunde ist verantwortlich für die **Sicherung seiner Daten**
(mitgelieferte Skripte `5_SAUVEGARDE_EXTERNE.bat` und
`scripts\SAUVEGARDER_LES_FICHIERS.bat` sowie die Kopie auf ein externes
Medium — goldene Regel, `docs/SAUVEGARDES_NARCHI.md`).

## 3. Vergütung

3.1 Die Vergütung richtet sich nach der Preisliste des Anbieters
(Beta: kostenlos gegen wöchentlichen Erfahrungsbericht; Lizenz Büro
[1.790 €/Jahr] oder Kauf [3.900 € + 690 €/Jahr Wartung] — Stand
Beta-Bericht §120, vor Veröffentlichung zu bestätigen).

3.2 Preise verstehen sich [inkl./zzgl.] gesetzlicher Umsatzsteuer.

## 4. Haftung

4.1 Die Software wird für den bestimmungsgemäßen Gebrauch bereitgestellt.
Der Anbieter haftet für **Vorsatz und grobe Fahrlässigkeit**; im Übrigen
ist die Haftung [auf den typischerweise vorhersehbaren Schaden begrenzt].

4.2 **Kalkulationen, Mengen und Honorare sind stets durch den Kunden zu
prüfen**, bevor sie verwendet werden — NARCHI ist ein Hilfsmittel, keine
Garantieerklärung (alle Werte tragen eine Herkunfts-Marke „Messung /
Richtwert / Regel“).

## 5. Laufzeit und Kündigung

5.1 Laufzeit [12 Monate], Verlängerung [um 12 Monate], Kündigungsfrist
[3 Monate zum Laufzeitende], [Schriftform].

5.2 Nach Vertragsende bleiben die Daten des Kunden auf dessen
Infrastruktur und werden **nicht** eingezogen.

## 6. Datenschutz

Es gilt die **Auftragsverarbeitungsvereinbarung (Teil 2)**, soweit der
Anbieter personenbezogene Daten verarbeitet.

## 7. Schlussbestimmungen

Änderungen bedürfen der Schriftform. Es gilt deutsches Recht,
Gerichtsstand [Ort]. Sollte eine Bestimmung unwirksam sein, bleibt der
Rest wirksam.

---

# Teil 2 — Auftragsverarbeitungsvertrag (AVV) nach Art. 28 DSGVO

**Wichtiger Hinweis (ehrlich):** Im Selbst-Hosting-Modell ist die
Rollenverteilung ein Grenzfall: die Software läuft **beim Kunden**, der
Anbieter hat im Regelbetrieb **keinen** Zugriff. Ob überhaupt ein AVV
nötig ist, hängt vom Support-Modell ab (greift der Anbieter bei der
Fehlerbehebung auf Daten zu, ist er Auftragsverarbeiter). Ein Anwalt muss
dies klären; bis dahin ist dieser Entwurf der **sichere Rahmen**.

## 1. Gegenstand und Dauer

1.1 Der Kunde ist Verantwortlicher, der Anbieter Auftragsverarbeiter im
Sinne von Art. 4 Nr. 8 DSGVO.

1.2 Dauer: Laufzeit des Hauptvertrags (AGB Teil 1).

## 2. Art und Zweck der Verarbeitung

2.1 Kategorien betroffener Personen: Mitarbeitende des Kunden,
Geschäftspartner (Rechnungsadressen), ggf. Bauherren.

2.2 Kategorien personenbezogener Daten: Namen, E-Mail-Adressen,
Rechnungs-/Bankdaten (IBAN), Kontaktdaten.

2.3 Zweck: Bereitstellung, Wartung und Support der Software.

## 3. Pflichten des Auftragsverarbeiters (Art. 28 Abs. 3)

- Verarbeitung nur auf dokumentierte Weisung des Kunden;
- Vertraulichkeit der eingesetzten Personen;
- technische und organisatorische Maßnahmen nach Art. 32 DSGVO
  (Verschlüsselung der Passwörter mit Argon2id, Zugriffsschutz, keine
  Übertragung an Dritte);
- Unterstützung des Kunden bei Betroffenenrechten und Meldepflichten;
- Löschung/Rückgabe der Daten nach Vertragsende (hier: Daten bleiben
  ohnehin beim Kunden).

## 4. Unterauftragsverarbeiter

4.1 Der Einsatz von Unterauftragsverarbeitern bedarf der Zustimmung des
Kunden. Aktuelle Liste: [keine im Selbst-Hosting-Modell — zu bestätigen].

## 5. Schlussbestimmungen

Es gelten die Regelungen des Hauptvertrags. Änderungen schriftlich.

---

## Checkliste für den Anwalt (was zu prüfen ist)

- [ ] AGB: Haftungsklausel (Ziff. 4) wirksam ausgestalten (B2B).
- [ ] Preisklausel (Ziff. 3) — Beträge vor Veröffentlichung fixieren.
- [ ] AVV: ob im Selbst-Hosting überhaupt ein AVV nötig ist.
- [ ] TOM (technisch-organisatorische Maßnahmen) konkret dokumentieren.
- [ ] Impressum/Datenschutzerklärung für den Web-Auftritt.
- [ ] Steuerliche Behandlung der Beta (kostenlos gegen Bericht).

---

## Anhang A — Leistungsgrenzen (Stand 26.08.2026, Produktwahrheit)

Diese Liste ist **kein** Leistungsversprechen. Sie gehört in den Vertrag,
damit niemand Mesh, Peppol-Versand oder EnergyPlus erwartet.

| Nicht enthalten | Folge für Haftung / Nutzung |
|---|---|
| Mesh-Clash / Manifold / Soft-Clash | Nur AABB. Keine Zusicherung vollständiger Kollisionsfreiheit. |
| WebGPU | Darstellung WebGL. Kein Leistungsmerkmal. |
| Speckle | Kein Datenaustausch über Speckle. |
| EnergyPlus / TEASER | Kein öffentlich-rechtlicher Energienachweis. |
| Peppol Access Point | Kein Versand. UBL-Datei ≠ Netzzustellung. |
| Anwaltlich geprüfte AGB | Dieser Text bleibt Entwurf, bis ein Anwalt zeichnet. |

## Anhang B — TOM (technisch-organisatorisch, Self-Host)

- Betrieb **beim Kunden** (Docker). Anbieter hat im Regelbetrieb keinen Zugriff.
- Passwörter: Argon2id. Session: HttpOnly-Cookie.
- Mandantentrennung: Tenant-Interceptor auf jeder SQL-Abfrage.
- Backups: Kundenverantwortung (`5_SAUVEGARDE_EXTERNE.bat`).
- Kein Versand personenbezogener Daten an OpenAI, solange `LLM_CLOUD_ENABLED` aus ist (Werkseinstellung).

**Kein Anwaltsrat.** Vor Unterschrift: Rechtsanwalt IT/Bau, Gerichtsstand und Beträge einsetzen.
