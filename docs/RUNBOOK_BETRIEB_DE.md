# NARCHI — Betriebs-Handbuch für das Büro (Runbook)

> **Für die Person im Büro, die NARCHI am Laufen hält** (nicht für
> Entwickler). Stand: 16. August 2026 (§134). Alles hier Genannte
> existiert wirklich — die Dateinamen stimmen mit den `.bat` im
> Projektordner überein. Bei Unsicherheit: die Skripte sagen selbst, was
> sie tun, und melden Fehler ehrlich.

---

## 1. Täglich: NARCHI starten und stoppen

| Sie wollen … | Datei (Doppelklick) | Dauer |
|---|---|---|
| Erster Start überhaupt | `1_DEMARRER_NARCHI.bat` | 15–45 Min (einmalig, baut alles) |
| Normaler Start danach | `2_REDEMARRER_NARCHI_RAPIDE.bat` | 2–3 Min |
| Etwas ist kaputt → reparieren OHNE Datenverlust | `3_REPARER_NARCHI_SANS_PERTE.bat` | baut neu, Daten bleiben |
| Alles komplett zurücksetzen (löscht ALLES!) | `4_TOUT_EFFACER_ET_REDEMARRER.bat` | nur im Notfall |

> **Merke:** 1 und 3 bauen die Software neu (Code wird in die Docker-
> Bilder „gebacken“). Nach jedem Neubau im Browser einmal **Strg+F5**
> drücken (Cache leeren), damit Sie die neueste Version sehen.

---

## 2. Wöchentlich: sichern (goldene Regel)

1. `5_SAUVEGARDE_EXTERNE.bat` → Kopie der **Datenbank** in `sauvegardes\`.
2. `scripts\SAUVEGARDER_LES_FICHIERS.bat` → Kopie der **Fotos/Videos** in
   `sauvegardes\` (§133).
3. Den Ordner `sauvegardes\` **auf einen USB-Stick / ein anderes Gerät
   kopieren** (30 Sekunden).

> Eine Kopie auf demselben Rechner schützt NICHT vor Festplattenschaden.
> Erst die Kopie außerhalb des PCs ist die echte Sicherung
> (`docs/SAUVEGARDES_NARCHI.md`).

**Automatisch jede Woche:** einmal `7_PROGRAMMER_SAUVEGARDE_HEBDO.bat`
starten → Windows sichert dann sonntags 05:00 selbst (PC muss an und
angemeldet sein).

**Beweis, dass die Sicherung wirklich zurückgespielt werden kann:**
`6_VERIFIER_RESTAURATION.bat` (prüft eine Kopie in einer Wegwerf-Datenbank,
ohne Ihre echten Daten anzufassen).

---

## 3. Wenn etwas nicht geht: zuerst Diagnose

1. `DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat` → sammelt einen Bericht.
2. Die häufigsten Ursachen und Abhilfen stehen in
   `docs/guide/INSTALL.md` (Abschnitt „Dépannage“) — die zwei Klassiker:
   - **Docker Desktop antwortet nicht:** Docker neu starten, dann
     `2_REDEMARRER_NARCHI_RAPIDE.bat`.
   - **Anmeldung klappt, aber Daten „weg“?** Nicht neu installieren —
     zuerst `3_REPARER_NARCHI_SANS_PERTE.bat` (Daten bleiben erhalten).

---

## 4. Konten & Rollen (kurz)

- Der System-Admin (Zugangsdaten stehen in den `.bat`) lebt im
  technischen Bereich `tenant-narchi-office` — **nicht** zum gemeinsamen
  Arbeiten nutzen.
- Neue Mitarbeitende: **Team → Neues Konto** (als Owner angemeldet).
- Rollen: Owner / Admin / Architekt. Kanäle löschen/umbenennen darf nur
  Owner/Admin (der Server erzwingt es — 403).

---

## 5. Aktualisieren auf eine neue NARCHI-Version

1. Neue Version ins Projektverzeichnis übernehmen (vom Anbieter).
2. `3_REPARER_NARCHI_SANS_PERTE.bat` (baut neu, **Daten bleiben**).
3. Browser: **Strg+F5**.

---

## 6. HTTPS für die Telefon-Nutzung (optional)

- Aktivieren: `8_ACTIVER_HTTPS_LOCAL.bat` (mkcert, geprüfter Download).
- Das Telefon installiert einmalig die CA-Datei (Anleitung:
  `docs/HTTPS_LOCAL.md`).
- Rückbau: `9_RETIRER_HTTPS_LOCAL.bat`.

---

## 7. Die wichtigsten Ordner (kurz)

| Ordner | Inhalt | Anfassen? |
|---|---|---|
| `sauvegardes\` | Ihre sichtbaren Sicherungen (Datenbank + Dateien) | kopieren, nie löschen |
| `.env` | Zugangsdaten / Konfiguration | nur auf Anweisung |
| Rest | Software | nicht von Hand ändern |

---

## 8. Im Notfall: Daten wiederherstellen

- Datenbank: `scripts\RESTAURER_LA_BASE.bat` (aus einer Sicherung).
- Fotos/Videos: `docker compose exec -T backend bash -c "tar xzf /sauvegardes/narchi-fichiers-….tar.gz -C /app/storage"` (Details in `docs/SAUVEGARDES_NARCHI.md` §6).

**Ruhig bleiben:** eine ausgestellte Rechnung verschwindet nie (GoBD),
Kanäle werden archiviert statt gelöscht, und die Sicherungen sind mit
Beweis wiederherstellbar.

## 9. Recht & Datenschutz (Pflichtdokumente)

Vor dem ersten echten Kundenkontakt prüfen und ausfüllen (Entwürfe, §170):

- `docs/IMPRESSUM_DE.md` — Impressum nach § 5 DDG (Pflicht für jede Website).
- `docs/DATENSCHUTZERKLAERUNG_DE.md` — Datenschutzerklärung (Art. 13/14 DSGVO).
- `docs/AGB_AVV_ENTWURF.md` — AGB/CGV + Auftragsverarbeitungsvertrag (AVV).

Alle drei sind **Entwürfe zur anwaltlichen Prüfung** — die Platzhalter `[…]`
ersetzen und den Text vor dem Launch durch einen Anwalt freigeben lassen.

## 10. Löschkonzept (DSGVO Art. 17 / 25)

Wie Daten gelöscht (oder bewusst aufbewahrt) werden — kurz und ehrlich:

| Was | Verhalten | Grund |
|---|---|---|
| **Projekte** | Löschen = Kaskade (Projekt + seine Bauteile); serverseitig als „pierre tombale" (Soft-Delete) synchronisiert | andere Geräte ziehen die Löschung nach (§118) |
| **Rechnungen** | Nur **Entwürfe** sind löschbar; **ausgestellte** Rechnungen bleiben (Archiv) | GoBD — eine ausgestellte Rechnung verschwindet nie |
| **Mängel / Baustelle** | Löschen = Soft-Delete + Synchronisation | Nachweis, kein Datenverlust auf anderen Geräten |
| **Medien (Fotos/Videos)** | Purge über `python -m app.services.media_purge` (standardmäßig **Simulation** — zeigt erst, was gelöscht würde) | keine Löschung „auf Verdacht" |
| **Konten** | Eigentümer-Konten werden **deaktiviert statt gelöscht** (Historie bleibt) | Nachvollziehbarkeit, § 147 AO |
| **Sicherungen** | Rotieren nach Plan (`docs/SAUVEGARDES_NARCHI.md`) | Wiederherstellbarkeit |
| **Komplettes Zurücksetzen** | `4_TOUT_EFFACER_ET_REDEMARRER.bat` (löscht ALLES) | nur im Notfall |

**Aufbewahrungsfristen beachten:** Rechnungen und Buchungsbelege i. d. R.
**6–10 Jahre** (§ 147 AO, § 257 HGB) — daher „archiviert statt gelöscht".
Kundendaten ohne gesetzliche Pflicht sind auf Anfrage (Art. 17 DSGVO) zu
löschen; das Büro trägt hierfür die Verantwortung gegenüber seinen Kunden.
