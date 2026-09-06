# NARCHI — Die BTP-Plattform für deutsche Architekturbüros

**Vom IFC-Modell zur Kostenschätzung nach DIN 276 in Sekunden — direkt im
Browser, ohne Installation, ohne 100-MB-Dateien, ohne Schulungsmarathon.**

NARCHI ist die arbeitsplatzübergreifende SaaS-Plattform, die aus einem
BIM-Modell sofort die Antworten liefert, für die Büros heute Stunden in
Excel, AVA-Desktopsoftware und E-Mail-Anhängen verlieren: Mengen, Kosten
nach **DIN 276**, Honorar nach **HOAI**, Energie nach **GEG 2024**,
Qualität und Team-Kommunikation — alles in einem Cockpit, auf Deutsch,
für den deutschen Markt gebaut.

> **Marktlücke, die NARCHI schließt:** Nur ~28 % der Ingenieur- und
> Architekturbüros in Deutschland arbeiten mit BIM (Erhebung
> Bundesingenieurkammer). Die häufigsten Gründe dagegen: zu teuer, zu
> komplex, kein erkennbarer Mehrwert, keine Zeit für Einarbeitung.
> NARCHI ist die Antwort auf genau diese vier Punkte — besonders für
> Büros mit weniger als 10 Mitarbeitenden.

---

## Das kann NARCHI

> Alltags-Beispiele aus dem echten Büroalltag (frz., für den Kunden):
> **`docs/NARCHI_EXEMPLES_VRAIE_VIE.md`** — nur was bereits existiert
> und getestet ist.

### 1. Modell-Import & BIM-Portfolio
- **IFC / IFCZIP / IFCXML / STEP** direkt im Browser hochladen —
  Upload mit Magic-Byte-Prüfung, Quoten, Rate-Limiting und sicherem
  Pfad-Handling (kein Schreiben außerhalb des Upload-Volumes).
- Parsing in einem überwachten **Web-Worker mit Watchdog** — die
  Oberfläche bleibt flüssig, auch bei großen Modellen.
- 3D-Ansicht auf Basis von **That Open Engine** (Fragments) + Three.js.
- Alle Bauelemente indexiert und durchsuchbar (Typ, Material, Ebene,
  Mengen) — in der Übersicht: „1.814 Bauteile indexiert".

### 2. Mengen & Kostenschätzung nach DIN 276
- **Automatischer Mengenauszug aus dem Modell** — statt 2 Tage
  Tipparbeit (kontrollierte Zuordnung, kein Blind-Import).
- Kostenschätzung strukturiert nach den **Kostengruppen der DIN 276**
  mit explizitem Preisstand-Jahr (wählbar in der Preisbibliothek).
- **Charta der Ehrlichkeit (§36): „Kein Preis ohne Herkunft."** Jeder
  Kennwert trägt seine Quelle — Badges **Messung / Richtwert / Regel**:
  - *Messung* = aus dem Modell gemessen,
  - *Richtwert* = Kennwert mit benannter Herkunft und Jahr,
  - *Regel* = normativ begründete Annahme.
- Ergebnis-Cache (Redis, 1 h) — wiederholte Schätzungen in < 1 s.

### 3. Preisbibliothek (eigene Preise + Import)
- Import eigener Preislisten als **CSV** (`oz;kurztext;einheit;ep;[jahr]`)
  oder **GAEB X31**, mit Analyse-Vorschau vor Übernahme
  („N Positionen übernehmen").
- Büro-eigene Preise werden zur Wiederverwendung gespeichert —
  jede Schätzung macht die nächste besser.

### 4. Honorar nach HOAI
- Honorar-Seite auf Basis der anrechenbaren Kosten (DIN 276) —
  transparente Herleitung statt Blackbox, inklusive der Fragen, die in
  HOAI-Foren wöchentlich diskutiert werden (Anrechenbarkeit KG 3/4/5…).
- **Rentabilität in einem Blick (§176–§182)** : Nachtragsmanagement (le
  changement est payé), Entscheidungslog (qui a validé quoi, quand),
  Projektstunden → Deckungsbeitrag (le projet gagne/perd), Abschlagsrechnung
  (facturer par Leistungsphase).

### 5. Rechnungen & E-Rechnung (XRechnung, §116)
- **Rechnungsbuch mit GoBD-Lebensweg**: Entwurf (änderbar/löschbar) →
  Ausstellung mit serverseitiger Nummer `RE-AAAA-NNNN` + Datum, dann
  eingefroren → Storno mit Grund, **Nummer bleibt reserviert** (die
  Nummernkette hat niemals ein Loch).
- **Ehrliche Validierung**: Ausstellung wird verweigert, solange
  Pflichtangaben fehlen (Leitweg-ID, USt-IdNr, Leistungsdatum/Zeitraum) —
  mit GENAUEN Meldungen statt „ungültig“.
- **Echte Preise bis auf 4 Dezimalstellen**, Vorschau live im Browser auf
  den Cent genau mit derselben Rundung wie der Server (keine
  Float-Überraschungen), Download als **XML Profil XRechnung 3.0**
  (EN 16931) — **offizieller KoSIT-Validator bestanden** (XRechnung 3.0.2,
  gemessen 13.08.2026: „ACCEPTABLE“ für beide Profile + kompletter
  API-Weg; nachspielbar via `scripts/valider-xrechnung-kosit.sh`).
- **Facture hybride ZUGFeRD/Factur-X (§129)** : un SEUL PDF que le client
  lit à l'écran ET dont la machine extrait le XML (`factur-x.xml`
  embarqué) — **PDF/A-3b CONFORME (ISO 19005-3) prouvé par Mustang**
  (veraPDF 2 978 assertions à 0 échec + XML EN 16931 valide ;
  `scripts/valider-zugferd-mustang.sh`), téléchargement
  `.../zugferd.pdf` sur la facture émise.
- **Syntaxe UBL 2.1 (§130)** : la même facture en syntaxe UBL (celle du
  réseau Peppol), téléchargement `.../xrechnung-ubl.xml` — **validée par
  le validateur officiel KoSIT** (scénarios UBL, « ACCEPTABLE » mesuré
  16/08, `scripts/valider-ubl-kosit.sh`). L'envoi Peppol réel (Access
  Point) reste un jalon d'infrastructure DIFFÉRÉ (voir `docs/PEPPOL.md`).
- **Versand (envoi, §131)** : e-mail **.eml prêt à l'envoi** avec la facture
  hybride jointe (`.../versand.eml`) — expéditeur/destinataire du modèle,
  corps allemand, le bureau l'envoie depuis son client mail (pas de SMTP
  intégré, dit honnêtement). L'envoi Peppol réseau reste différé (Access
  Point requis).

### 6. GEG-Energie & LCA
- Energiebilanz-Prüfung nach **GEG 2024** automatisch aus den
  Modelldaten; CO₂-Bilanz (inkarnierte Emissionen) übers Portfolio.
- **VE-Studio (§154–§160)** : value engineering en un clic — pour chaque
  matériau, l'alternative bas-carbone avec **ΔCO₂ ET Δ€ simultanés** et le
  coût-efficacité **€/tCO₂e** (la métrique pour négocier avec le client).
  Chaque substitution est appliquée aux **VRAIES quantités du takeoff IFC**
  (masse ÷ densité = m³) : ΔCO₂ gesamt, ΔKosten gesamt et % du bilan A1–A3
  pour LE projet. **What-if cumulatif (§156)** : sélectionnez plusieurs
  substitutions → nouveau total CO₂/€ et kg/m² recalculés en direct.
  Substitutions Ökobaudat (BMWSB) + BKI, triées « win-win » (moins cher ET
  plus vert) d'abord. Réponse au point de douleur n°1 des
  architectes (le processus VE et l'explosion des coûts).

### 7. QC & Planprüfung
- Modell-Gesundheitscheck, Konformitätsübersicht, Issues-Tracking mit
  Verlauf — inkl. **Haftungsradar** (Fluchtweg & Brandschutz § 34 MBO /
  DIN 4102, Barrierefreiheit DIN 18040, GEG, Kostensicherheit DIN 276)
  mit „Risiko / Geschützt"-Klarstellung je Thema.

### 8. Team & Kommunikation
- **Eingebauter Team-Messenger**: Projekt-Kanäle, Direktnachrichten,
  Ungelesen-Badges, kalibriertes Dock (§61–§63: exakt ausgerichtete
  Oberflächen, keine verdeckten Fenster) — **eine einzige schwarze
  Blase** mit dem Gesamt-Zähler; der Detailstand je Unterhaltung lebt im
  Panel „Unterhaltungen“ (§109), beim Start öffnet sich nichts von
  allein.
- Echte Mandanten-Trennung: Server-seitiger **Tenant-Interceptor**
  filtert jede Datenbankabfrage — kein Kanal, kein Projekt eines anderen
  Büros ist auch nur lesbar (durch Tests bewiesen).
- Kanal-Archivierung statt Löschung: aus dem Modell-Katalog
  verschwundene Projektkanäle werden weich archiviert und bei Rückkehr
  reaktiviert — Daten gehen nie verloren.
- **Kanal-Verwaltung per Rechtsklick** (nur Inhaber/Admins, der Server
  erzwingt 403): Team-/Projekt-Kanäle dauerhaft umbenennen (die
  Auto-Synchronisation überschreibt einen eigenen Namen nie) und **jede
  Unterhaltung endgültig löschen** (§110 — Mitglieder und Nachrichten
  werden für alle entfernt, die Anzahl gelöschter Nachrichten wird
  gemeldet; ein Tombstone-Eintrag verhindert, dass die
  Auto-Synchronisation einen gelöschten Kanal je wieder anlegt).
  Direktnachrichten heißen immer wie der Kontakt.
- **Baustellendoku**: Fotos **und Videos** (MP4/WebM/MOV) vom Handy ins
  Büro importieren — gruppiert nach echtem Aufnahmedatum (EXIF bzw.
  Video-Metadaten, die Quelle wird immer angezeigt), Mängel mit
  Beweisdateien aus der Auswahl; ohne gewähltes Projekt ist der Import
  gesperrt — und sagt das auch; existiert **gar kein** Projekt, legt die
  Seite das erste direkt selbst an (ein Name genügt, Import sofort
  frei — §111) und wählt ansonsten selbstständig das erste Projekt.
- **Mängel-Sync zwischen Geräten (§117)**: Mängel-Texte wandern über den
  Server (Offline-Warteschlange überlebt Browser-Neustart; ehrliches
  Badge „Offline — N warten“ / „N geparkt — Projekt fehlt hier“; offene/
  in Prüfung/erledigt zählen).
- **Projekt- & Medien-Sync (§118)**: ein hier angelegtes/importiertes
  Projekt erscheint auf den anderen Geräten des Büros (Server-Spiegel,
  gleiche Regeln wie Mängel, aktive Auswahl nie angerührt); **Fotos und
  Videos wandern jetzt selbst mit** — Upload automatisch nach dem Import,
  Abruf beim Anzeigen, Bytes serverseitig geprüft (25 MiB Foto / 300 MiB
  Video, ehrlich genannt), dauerhaft abgelehnte Dateien werden mit Grund
  angezeigt statt endlos erneut versucht.
- **Lokales HTTPS (§119, Schritt 4 — letzter Meilenstein der Synchro)**:
  `8_ACTIVER_HTTPS_LOCAL.bat` genügt — mkcert mit geprüftem Download
  (SHA-256 festgelegt, Abweichung = Abruch), Zertifikat für localhost +
  alle LAN-IPs des PCs, Firewall nur für private Netze, und der Erfolg
  wird per echter Abfrage BEWIESEN statt versprochen. Das Telefon
  installiert einmalig die CA-Datei (Anleitung: `docs/HTTPS_LOCAL.md`);
  der Weg zurück bleibt frei: `9_RETIRER_HTTPS_LOCAL.bat`. Ohne das
  Ganze läuft NARCHI exakt wie bisher auf http://localhost:8080 —
  im Sandbox mit echtem nginx nachgewiesen (leerer Schalter = inert).
- Kalender, Team-Planung, Projekt-Zuordnung.

### 9. NARCHI IQ — KI mit orgelfesten Regeln
- Feedback-Engine & KI-Audit serverseitig (OpenAI-Key verbleibt
  ausschließlich auf dem Server — im Repo existiert **keine** echte
  Schlüsseldatei; `.env.example` ist leer).
- KI-Antworten sind an Daten und zitierte Herkunft gebunden — keine
  erfundenen Kennwerte.

---

## Warum Büros NARCHI wählen (Stärken)

| Schmerz aus der Praxis (Foren, Kammer-Umfragen) | NARCHI-Antwort |
|---|---|
| Desktopsoftware: „kompliziert, benutzerunfreundlich", riesige Datenmengen, Lizenz-Bindung an Arbeitsplatz | 100 % Browser, kein Install, keine Arbeitsplatz-Lizenz — einfach einloggen |
| „Spezifikationen und Preise verstreut über Dateien, Stunden Excel-Formeln reparieren" | Zentrale Preisbibliothek + Mengen direkt aus dem Modell + Revisionen mit Herkunft |
| BIM-Einstieg „für kleine Büros finanziell nicht zu stemmen" | SaaS statt Enterprise-Lizenz; Trial-Mandant bei Registrierung; kein Server, keine IT-Abteilung nötig |
| Zusammenarbeit: große Dateien hin- und herschicken, Versionskonflikte | Ein Mandanten-Arbeitsraum: Projekte, Kanäle, Nachrichten am selben Datenstand |
| AVA-Tools: „kein vollständiges Projektmanagement, keine Teamkommunikation" | Chat, Kalender, Team-Planung, QC, Honorar, Energie in einem System |
| DIN 276/HOAI-Unsicherheit (welche KG anrechenbar? welche Normfassung?) | Struktur, Badges und Begründungen direkt in der Oberfläche |
| **Scope creep** (« Scope Creep is a killer », la 1re cause de dépassement) | **Nachtragsmanagement** (§176) : le changement → delta d'honoraires HOAI automatique + Begründung — l'architecte est **payé** |
| **Communication client fragmentée** (« courir après les validations », 1er voleur de temps) | **Entscheidungslog** (§177) : décisions datées/sourcées + protocole qui fait foi |
| **Factures impayées** (51 % des bureaux attendent 31–60 j) | **Mahnwesen** (§179) : statut de paiement + Mahnstufe + lettre de relance (§ 288 BGB) |
| **Heures non facturées / réalisation inconnue** (41 % ne la suivent pas) | **Projektstunden → Deckungsbeitrag** (§180) : « ce projet gagne ou perd » en < 1 min/jour |
| **Teilrechnungen manuelles** (30–45 min + erreurs de %) | **Abschlagsrechnung** (§182) : facturer par Leistungsphase HOAI (satz officiels) |
| **« Je réinvente des détails »** | **Bauteil-Standard-Bibliothek** (§181) : standards réutilisables (U-Wert, composition, coût) |
| **« Un outil pas fiable »** | **System-Status** (§178) : DB pingée + capacités E-Rechnung **mesurées**, en clair |
| **Carbone (obligation croissante GEG/EU-Taxonomie)** | **VE-Studio + Klima-Bericht** (§154–§175) : mesure → optimisation → négociation, en un outil |

---

## Technik (kurz)

- **Frontend:** React 19 + TypeScript + Vite 7, Tailwind 4, That Open
  Engine (Fragments), TanStack Query, Zustand, i18next.
- **Backend:** FastAPI (Pydantic v2), PostgreSQL 16 multi-tenant
  (SQLAlchemy + Tenant-Interceptor + pgBouncer + NullPool), Alembic,
  Celery/Redis (IFC-Parsing, PDF), WebSocket über Redis Pub/Sub,
  Keyset-Pagination, pgvector für KI-Kontext.
- **Sicherheit (extern auditiert, §60):** XSS-Input-Sanitizer
  (Entity-Escaping, NFC, Trojan-Source-Abwehr), keine
  `dangerouslySetInnerHTML`-Sinks, HttpOnly+Secure+SameSite=Strict
  Session-Cookie, strikte CSP (frame-ancestors 'none', object-src
  'none'), Rate-Limiting auf Login (5/min), Guest-Login, Registrierung,
  Passwort-Reset (5/min), IFC-Upload (10/min) und Chat (30/min) —
  Redis-Sliding-Window mit lokalem Fallback, IP ausschließlich aus dem
  ASGI-Socket (niemals `X-Forwarded-For`).
- **Betrieb:** Docker-Compose-Stack (API, PostgreSQL+pgvector,
  pgBouncer, Redis, Celery, nginx), One-Double-Click-Installer für
  Windows (Docker Desktop WSL2), automatische Backups & Restore-Skripte,
  DSGVO-freundlich: Datenbank und Dateien bleiben auf eigener Infrastruktur.

## Qualitäts-Nachweis (Test-Gates)

- **Backend:** 582 pytest-Tests (u. a. Tenant-Isolation, GoBD-Rechnungszyklus
  mit ununterbrochener Nummernkette, XRechnung-Arithmetik auf den Cent,
  **KoSIT-§123-Pins: Golden-Fixtures Oktett für Oktett gegen die vom
  offiziellen Validator akzeptierten Bytes, Pflicht-Refuse XR-41…45,
  XSD-Positionen**, facture hybride ZUGFeRD/Factur-X PDF/A-3b (§129,
  structure + round-trip XML éprouvés), syntaxe UBL 2.1 (§130, validée
  KoSIT scénarios UBL), Versand .eml (§131, structure MIME + pièce jointe),
  Mängel-/Projekt-Sync mit Tombstones und ehrlicher
  Auferstehung,
  Medien-API mit Magic-Bytes-Prüfung und Größen-Deckeln,
  HTTPS-Lokal-Pack: nginx/compose/Scripts auf geteilte Pfade festgenagelt,
  Backup-/Restore-Stack (base §113 + fichiers §133, preuves de restauration
  réelles), cohérence kit beta §137 (doc↔fichiers), Windows-Skript-Encoding).
- **Sécurité en profondeur (§139–§144)** : property testing Hypothesis
  (invariants monétaires), gitleaks (secret scan), Semgrep règles maison
  (interdits §60), Checkov (IaC) — chacun PROUVÉ (0 finding) ou documenté ;
  + §145 : banker's rounding monétaire corrigé (money.py, HALF_UP).
- **Frontend:** 797 vitest-Tests (108 Dateien) — u. a. Rechnungsmaske mit
  Cent-genauer Vorschau, Sync-Motoren (Mängel, Projekte, Medien) mit
  ehrlicher Offline-Warteschlange — `tsc` fehlerfrei, Production-Build
  geprüft bei jedem Commit.
- **E2E (§121):** 5 Playwright-Volets im ECHTEN Chromium gegen die ECHTE
  Stack (Konto, Projekt-Sync auf zweitem Gerät, Mangel+Foto decodiert,
  Offline-Queue, IFC-Parsing) — ~31 s, `cd frontend && npm run e2e`
  (Stack vorher per 1_DEMARRER_NARCHI.bat starten; Details in
  frontend/e2e/README.md).

## Schnellstart (Windows, Docker Desktop)

1. Repository entpacken, Ordner `narchi` öffnen.
2. Erster Start: Doppelklick auf `1_DEMARRER_NARCHI.bat` — das Skript
   startet Docker Desktop bei Bedarf selbst, baut den Stack (beim ersten
   Mal 15–45 Min.) und öffnet den Browser. Jeder weitere Start:
   `2_REDEMARRER_NARCHI_RAPIDE.bat` (2–3 Min. dank BuildKit-Cache).
3. <http://localhost:8080> — registrieren (eigener Trial-Mandant),
   IFC hochladen, Kostenschätzung nach DIN 276 erhalten.

### Bedienung unter Windows (alle Dateien existieren wirklich)

| Datei | Zweck |
|---|---|
| `1_DEMARRER_NARCHI.bat` | Erster vollständiger Start (Build + Dienst) |
| `2_REDEMARRER_NARCHI_RAPIDE.bat` | Schneller Neustart aus dem Cache |
| `3_REPARER_NARCHI_SANS_PERTE.bat` | Reparatur OHNE Datenverlust |
| `4_TOUT_EFFACER_ET_REDEMARRER.bat` | Vollständiger Reset (löscht alles) |
| `5_SAUVEGARDE_EXTERNE.bat` | Sichtbare Sicherungskopie in `sauvegardes\` |
| `6_VERIFIER_RESTAURATION.bat` | Beweis, dass eine Kopie wirklich zurückspielt |
| `7_PROGRAMMER_SAUVEGARDE_HEBDO.bat` | Wöchentliche Sicherung (So 05:00) einplanen |
| `8_ACTIVER_HTTPS_LOCAL.bat` | Optional HTTPS lokal — nicht der empfohlene Baustellenweg (§206) |
| `9_RETIRER_HTTPS_LOCAL.bat` | Sauberer Rückbau auf http://localhost:8080 allein |
| `10_START_KOSIT.bat` | Optional: offizieller KoSIT-Validator im Docker (Profil kosit) |
| `scripts/SAUVEGARDER_LA_BASE_MAINTENANT.bat` | Sofort-Backup der Datenbank |
| `scripts/SAUVEGARDER_LES_FICHIERS.bat` | Sofort-Backup der Fotos/Videos (Volumen `narchi_storage`, §133) |
| `scripts/RESTAURER_LA_BASE.bat` | Wiederherstellung aus einem Backup |

#### Correspondance avec les anciens noms

La nomenclature est stable ci-dessus : les fichiers `REPAIR_*.bat`
n'existent pas et ne sont plus promus nulle part. Toute documentation
citant un autre nom que ceux du tableau est obsolète.

Ausführlich: `docs/guide/INSTALL.md` · Historie:
`CHANGELOG_NARCHI_V6.md` (§0–§67).

---

_NARCHI ist für den deutschen Markt gebaut: DIN 276, DIN 276-1,
HOAI 2021, VOB, GEG 2024, § 34 MBO, DIN 18040 — UI und Dokumentation
auf Deutsch._

---

## ÉTAT DU CHANTIER & REPRISE PAR UN AUTRE DÉVELOPPEUR/IA (fr)

> Cette section est la **seule lecture obligatoire** pour reprendre le
> travail : elle dit ce qui est fait, comment le prouver, et ce qui reste
> ouvert. Historique détaillé par tâche : `CHANGELOG_NARCHI_V6.md` (§0–§201,
> une section par commit). Le « Historie §0–§67 » plus haut est obsolète.

### 0. REPRISE IMMÉDIATE (5 septembre 2026 — LIRE EN PREMIER)

Ce bloc est la **vérité opérationnelle**. L’historique §1 plus bas est
une archive (août 2026) : utile, **pas** le plan du jour.
`docs/PROMPT_RELEVE_IA.md` = style + interdits. **Les compteurs et HEAD
de ce prompt sont périmés** — seuls README §0 + `git log -1` + dernière
section CHANGELOG font foi.

| | Fait mesuré |
|---|---|
| HEAD | `git log -1` — message attendu **§277** Relève README (ce commit) |
| Client | Windows + **Edge** + Docker Desktop · `http://localhost:8080` |
| Recopie | Code **cuit** dans l’image → `3_REPARER_NARCHI_SANS_PERTE.bat`. **Jamais** `4_TOUT_EFFACER` sur données réelles |
| E2E | **5/5 VERT chez le client, 33,8 s** (`scripts/TEST_E2E_DOCKER.bat`) le 23/08/2026. **Ne pas relancer** après docs/texte. Relancer seulement auth/cookie, Baustelle/sync, IFC, nginx/compose |
| Cookie | `Secure` **seulement si HTTPS**. HTTP = HttpOnly + SameSite=Lax |
| E2E Docker | Image `mcr.microsoft.com/playwright:v1.61.1-jammy` · `E2E_BASE_URL=http://host.docker.internal:8080` · **jamais** `*.localhost` |
| Alembic | tête `20260826_23` (`office_senders`) — migrate via `3_REPARER` |
| pytest / vitest | Derniers compteurs **écrits** 592 / 797 — **non rejoués** dans le sandbox Arena. Ne pas les citer comme frais |
| Jamais | push GitHub · ZIP produit · secret dans git · `.bat` non-ASCII |
| Deux carnets d’heures | HOAI `narchi:projektstunden` + blob `stunden` **≠** Practice `narchi:time_entries`. **Ne pas fusionner** |
| Téléphone | **§206 abandonné** comme voie officielle. Photos = WhatsApp/Telegram → import **Baustelle** au bureau. Pas de bot |
| AGPL | Grafana déjà dans compose historique. **Ne pas ajouter** Grafana/Loki. Doctrine §114. XFakturist / open-invoice / xBim IDS = AGPL |
| Agent-Reach | **§275 non** — scrapers sociaux hors produit (DSGVO/CGU) |

**Dernière tâche :** §277 Relève — README §0 aligné sur HEAD réel (plus de « HOAI 1 € » faux).
**Audit limites :** `docs/LEISTUNGSGRENZEN_BETA_DE.md` · GitHub lu : `docs/GITHUB_SOURCES_2026-08-26.md`
**Prochaine (cœur bureau) :** recopie + `3_REPARER`. Puis défauts métier restants (pas Manifold, pas Peppol AP, pas EnergyPlus). Page **Grenzen & Recht** dans le menu.

**Si tu es une autre IA / un autre dev :**
1. `git log -12 --oneline` + **cette section 0** + `docs/ROADMAP_NARCHI_2027.md`.
2. `CHANGELOG_NARCHI_V6.md` — dernière section = vérité du dernier commit.
3. Un commit **lourd et honnête** par tâche. README §0 **à chaque** commit (HEAD + dernière tâche + interdits encore vrais).
4. Excellence : formats métier réels (BCF = ZIP buildingSMART, pas XML déguisé).
5. Prouver ou dire qu’on ne sait pas. Pas de compteurs non rejoués.
6. Identité git (évaporée) : `git config user.name "NARCHI DevOps" && git config user.email "devops@narchi.de"`.
7. Répondre au client en **français**. UI produit en **allemand**.

#### Chaîne récente (main, jamais poussée)

`1e5bbc0` §266 robustesse → `19b6df0` §267 AABB/Labor → `fe1a5f7`/`127c995` §268 QC n.a. / §271 DIN NGF 0 → `285af44` §270 HOAI 0=0 → `95cb532` §269 Grenzen → `bf9eedb` §272 clearance AABB → `a7d2e7e` §273 GAEB DP → `a328c2c` §274 GEG TFA 0 → `9f89ac4` §275 Agent-Reach nein → `105df45` §276 Vergleich DP → **§277** cette relève.

Avant : §258–§265 BCF 2.1 / KoSIT sidecar / office_senders · §246 Passkeys · §248 Redis 7.4.2.

#### Zéro inventé (moteurs, 2026-09)

| Moteur | 0 / vide |
|---|---|
| HOAI `anrechenbareKosten≤0` | **§270** tous les € = 0, `orientierungGueltig=false`. **Plus d’interpolation à 1 €.** |
| DIN 276 `ngf≤0` | **§271** tous les € = 0, `schaetzungGueltig=false`. **Plus de dégression sur 30 m².** |
| GEG `tfa≤0` | **§274** HWB/PEB = 0, label « Keine NGF ». **Plus d’Infinity.** |
| GAEB import / Vergleich | **§273/§276** DP absent = vide, **pas « 31 »**. ENTITY scanné dans tout le fichier. |
| QC Bauteil | **§268** règles non mesurables = n.a., score 0 si rien de mesurable. |
| Clash | AABB + **§272** clearance TGA×Tragwerk ≤ 50 mm. **Pas de mesh.** |

#### Feuille 2027 — fait vs reporté (sans bluff)

| Item feuille | État |
|---|---|
| A1 IFC 4.3 | `IFC4X3*` accepté. **2x3 reste**. ifcopenshell **0.8.5** |
| A2 LLM | Cloud **off**. Ollama optionnel `llama3.2:3b` / 16 Go `llama3.1:8b`. RAG = mots, **pas** LlamaIndex |
| A3 OTEL | Collector optionnel. Grafana **non ajouté** |
| A4 Passkeys | §246 WebAuthn. HTTP = localhost |
| B4 XRechnung / KoSIT | CII 3.0.2 + ZUGFeRD + UBL. **§260** sidecar JAR. Peppol réseau **non** |
| BCF 2.1 | §258–§263 export/import/viewpoint/Qualität/IDS |
| Clash mesh / WebGPU / Speckle / TEASER / SAM2 / Podman / FastAPI 1.0 / Rust / Agent-Reach | **Non livré** — ne pas prétendre |

#### Produit bureau déjà utilisable (beta encadrée)

IFC → DIN 276 honnête → HOAI (`calcHoai`, 0 € = 0) → GEG/VE-Studio → Clash AABB (+ clearance TGA) + protocole PDF → BCF 2.1 → IDS → Rechnungen GoBD + ZUGFeRD + UBL + .eml → Baustelle import bureau → synchro Mängel/projets/médias → GAEB X31/X83.

#### Interdits / pièges

- E2E : pas `localhost` dans Chromium Docker.
- Cookie Secure seulement HTTPS.
- `include_router` sans **import du module** = gunicorn NameError (§208, §265b).
- `generateBcf()` XML legacy : **ne pas casser** (tests §44). Le livrable bureau = BCF 2.1 ZIP.
- Clash = AABB, texte « kein Mesh ». Clearance ≠ hard.
- HOAI / DIN / GEG : **0 reste 0** (§270–§274). Ne pas réintroduire de garde à 1 € / 30 m² / Infinity.
- pyGAEB / IFCescu = idées MIT/MPL, **pas de copie de source**.
- Agent-Reach / scrapers sociaux : **pas dans le produit**.

### 1. Où on en est (complément historique — 21 août → 23 août)

> **Pour le client** : les situations concrètes que NARCHI résout déjà,
> racontées avec des exemples de la vraie vie de bureau →
> **`docs/NARCHI_EXEMPLES_VRAIE_VIE.md`** (lecture seule, aucun jargon
> requis).

- **Formule « waw » livrée** : IFC déposé → ~60 s → Kostenschätzung DIN 276
  avec sources (charte §36 « kein Preis ohne Herkunft », badges
  Messung/Richtwert/Regel) → **PDF marque blanche (logo du bureau §79)**.
- **Collaboration temps réel V2.7 terminée** : présence + verrous anti-
  écrasement (§78), **co-édition CRDT réelle** bout-en-bout (§81 : Yjs
  frontend, noyau pycrdt/yrs backend, WS `/api/v5/collab/ws/{room}`,
  pont Redis inter-workers, persistance PG `collab_docs`), Team visible
  pour tous les rôles (§82), chat stabilisé (§84 anti-tempête),
  **historique de versions Notiz** snapshots+restauration propagée (§86).
- **Session qui tient la journée (§87)** : renouvellement silencieux
  (boucle frontend, marge 2 min / réveil 10 min, rattrapage à
  l'expiration) + `/refresh` sécurisé (pw_stamp, expires_in) +
  **réparation de persistance BDD sur reset-password et PATCH
  /members/me** (deux sessions SQLAlchemy par requête → mutations jamais
  écrites ; C'ÉTAIT la vraie cause de la panne avatar §82–§84 : après
  rebuild, re-définir l'avatar une fois et il persiste).
- **Compteurs de preuve** (à faire correspondre après toute reprise) :
  backend **592/592** pytest (§178) · frontend **797/797** vitest (108 fichiers)
  · `npx tsc --noEmit` = **0 erreur** · `npm run build` RC=0 (44 jsFiles)
  · E2E Playwright **5/5 en 33,8 s MESURÉ chez le client le 23/08/2026**
  via `scripts/TEST_E2E_DOCKER.bat` (§184–§200). L'ancien « 30,0 s §123 »
  n'est plus le dernier run.
- Série de commits récents (rôle en une ligne) :
  `§77` PDF marque blanche · `§78` présence/verrous REST · `§79` logo PDF
  · `§80` hiérarchie Büro 3 niveaux + membres PG réels · `§81` CRDT
  co-édition (mort du leurre collaborationManager) · `§82` Team pour tous
  + avatar_json serveur · `§83` résolution avatars « nom→e-mail » +
  bulle chat sur Team · `§84` fin de la tempête markRead (~4×/s → ≤3/5 s,
  preuve chiffrée testée) · `§85` ce document de reprise · `§86`
  historique versions Notiz + pastilles curseur · `§87` session stable +
  vérité BDD (avatars enfin persistants) · `§88` invités AK Berlin
  renouvelés (fin expulsion 15 min) · `§89` étape 3 (2/2) : positions LV
  co-éditées structurées + GET /lv (matière GAEB) — étape 3 TERMINÉE ·
  `§90` export GAEB X31 du LV co-édité (réutilise les conventions du
  builder DIN 276 : DA XML 3.2 DP=31, padding REB 23.003, groupes par
  segments d'OZ, ohne/mit Preise, refus 0,00 € inventé, invisibilité
  inter-bureaux) — essentiel livré · `§90b` dette test reminders (date
  figée révolue) · `§91` import GAEB entrant : offres d'entreprises
  (parseur à refus motivés, centimes entiers, XML audit, borne 12) ·
  `§92` Angebotsvergleich COMPLET : matrice entreprises × positions,
  verdict parmi les offres complètes seulement, Teilsummen marquées —
  chaîne métier LV→X31→offres→verdict bouclée · `§93` émission formelle
  X83 (DP=83) de l'Angebot retenu : re-généré depuis les prix VÉRIFIÉS
  (centimes), un seul dialecte GAEB (fonctions §90 réutilisées), ohne EP
  jamais « réparé » en 0,00 €, round-trip prouvé par notre parseur §91
  — chaîne Vergabe bouclée LV→X31→offres→verdict→Angebot formel ·
  `§94` doc stratégie données de prix (réponse client, zéro code :
  BKI payant/licencié, Destatis gratuit, proposition « Preis-Spiegel ») ·
  `§95` Preis-Spiegel LIVRÉ : bouton « → Bibliothek » sur chaque offre —
  les EP réels alimentent la Preisbibliothek du bureau via le pipeline §50
  (upsert idempotent, fortgeschrieben Destatis §49), provenance dans la
  donnée, ohne EP jamais réparé en 0,00 €, chaîne X31→offre→X83→bibliothèque
  prouvée en un test · `§96` Preisspiegel : chaque reprise mémorise une
  OBSERVATION (table + migration 20260810_13, idempotente, suppression
  croisée avec l'offre) → Min/Median/Max par OZ servis seulement ≥ 2
  observations (médiane Half-Up, tri OZ numérique), carte dans la
  Preisbibliothek avec Streuung % et dernière provenance · `§97`
  Preisstand-Wahrheit (question client « 2018 vs 2022 vs 2026 ? ») :
  millésime par ligne, JAMAIS de régression (ancien refusé + OZ nommées
  dans le rapport), note honnête pré-2020 (« keine Indexierung möglich…
  auffrischen », fin du « ×1 » muet), Jahrgänge marqués dans le
  Spiegel — tout est répondu dans docs/NARCHI_EXEMPLES_VRAIE_VIE.md §9 ·
  `§98` #6 graphique Baupreisindex LIVRÉ : carte SVG hors-ligne (zéro
  dépendance) de la série officielle 61261-0002, cadrage d'axe dit,
  variation annuelle exacte affichée, attribution Destatis (licence
  respectée) — avec l'alerte > 12 mois §73, #6 est complet · `§99`
  Median-Büropreis im Schnell-Schätzer : dès 2 prix propres même Einheit
  par KG, la MÉDIANE des prix indexés (règle §96 réutilisée) prime sur
  l'ancien choix « un seul prix » — un Ausreißer ne tire plus le devis ;
  unités jamais mélangées (écartées comptées+dites), jamais de fausse OZ ;
  test §50 « millésime le plus récent » remplacé explicitement · `§100`
  écran de connexion : pass visuel + VÉRITÉ (régression « avant plus simple
  et joli ») — affirmations non prouvables supprimées (« certifié DIN 276 »,
  « Zero-Leak » ×2, « Production V5 »), faits vérifiés (Argon2id,
  auto-hébergement, invitations 72 h), écran 100 % allemand, vraie icône œil
  + aria-label ; reste énoncé : landing marketing en français (autre décision) ·
  `§101` #10 socle PWA chantier LIVRÉ : service worker écrit main (navigation
  network-first, assets fingerprintés cache-first, **/api/ jamais caché**),
  icônes PNG réelles depuis le SVG officiel (raster IM raté — sans le N —
  attrapé par relecture visuelle, re-généré PIL), manifeste complet
  (raccourcis routes réelles cost/import/prices), pastille « nouvelle version
  — recharger » persistante (fin du Ctrl+F5 manuel après rebuild) ·
  `§102` page « Baustelle » (idée « tout sur le téléphone ») — livrée
  puis **SUPPRIMÉE au §103** (voir §103 : voie téléphone invalide en HTTP
  local, abandonnée au profit de l'idée client) ·
  `§103` NETTOYAGE demandé par le client : ancienne page terrain §102
  supprimée (page + lib + nav + raccourci manifeste + ses 9 tests
  spécifiques ; 527→518) — conservé, car réutilisable et testé :
  stockage photos IndexedDB (`mangelPhotos`, tests re-logés), clé
  `Issue.photoIds`, action `addIssue`, socle PWA §101 **recadré poste de
  bureau** (installable via localhost ; téléphone hors-ligne = impossible
  sans TLS, dit) ·
  `§104` #10 page « Baustelle » **selon l'idée du client** : import des
  photos AU BUREAU (glisser-déposer/sélecteur, JPEG), tri automatique par
  VRAIE date de prise de vue (parseur EXIF écrit main, zéro dépendance —
  JPEG synthétiques little/big endian fabriqués en test ; repli nom
  IMG_/PXL_/WhatsApp puis date de fichier, la source est TOUJOURS
  affichée), groupes « Besuch vom TT.MM.JJJJ » + séances (rupture >
  10 min, borne pile-10-min épinglée), sélection cochée → vrai Mangel du
  store (Tag = jour de la photo la plus ancienne, preuve datée — pas de
  la saisie), photos en blobs IDB (visibles au cockpit), balayage des
  orphelines au montage (le disque ne gonfle pas dans le dos de
  l'utilisateur) ; JAMAIS d'analyse de contenu — l'écran dit « keine
  Bilderkennung » ; erreur admise : `Uint8Array<ArrayBufferLike>` refusé
  en BlobPart (TS ≥ 5.7) → ArrayBuffer exact passé, attrapé par tsc ·
  `§105` retours client : (1) multi-format — JPEG/PNG/WebP/GIF/BMP
  acceptés ; EXIF aussi lu dans PNG (chunk eXIf) et WebP (chunk EXIF du
  RIFF), parseurs fabriqués en test ; **HEIC refusé EXPLIQUÉ** (le
  navigateur ne sait pas l'afficher — importer serait du fake ; message
  avec le réglage iPhone « Maximale Kompatibilität ») ; autres formats
  ignorés comptés ; (2) pass visuel « haut de gamme » de la page
  Baustelle : en-tête sombre brandée, zone de dépôt animée (drag-over),
  visites en rail-agenda (badge jour + pilule horaire), sélection par
  anneau ambre + pastille ✓, gravité en pastilles colorées — libellés
  fonctionnels inchangés (tests §104 rejoués tels quels) ; 544→549 ·
  `§106` bugs LUS dans la capture client : (1) **correctif réel** — le
  balayage des photos orphelines tournait AVANT la fin de réhydratation
  du store (IDB asynchrone) → photos de Mängel effaçables au rechargement ;
  désormais balayage après `persist.hasHydrated`/`onFinishHydration`,
  testé (référencée = jamais touchée) ; (2) garde **« Kein Projekt »** — le
  projet fantôme produisait « Tag 0 » et des Mängel sans rattachement :
  import/création bloqués-expliqués ; (3) « aucune information » →
  visionneuse plein écran (Esc/clic), tuile honnête « Foto nicht gefunden »
  si photo disparue, badges gravité + « n Fotos » sur chaque Mangel,
  stats réelles dans l'en-tête ; mystère « (0) + lignes » de la capture =
  rendu auto-traduction du navigateur (DOM bricolé) : compteurs dérivés du
  même tableau, désormais ÉPINGLÉS par test (badge ⇔ agenda ⇔ lignes) ;
  549→553 ·
  `§107` infos Mangel COMPLÈTES + densité : la ligne affiche désormais la
  vraie date de visite (« Besuch: 01.08.2026 », jour ISO persisté sur
  l'Issue = photo la plus ancienne), la zone et le commentaire saisi
  (line-clamp-2 — il existait mais restait invisible) ; sélecteur de
  densité 70/85/100 % (défaut 70 % = demande « dézoome de 30 % »),
  mémorisé en localStorage ; 553→556 ·
  `§108` conversations : clic droit renommer/supprimer réservé
  owner+admin — serveur = garde 403, PATCH rename durable (DM→400 : une
  DM garde le nom du contact), DELETE uniquement DM avec cascade +
  compte des messages (canal projet→409 : auto-géré, il renaîtrait — le
  vrai outil = archivage §59) ; UI : items désactivés EXPLIQUÉS, modale
  qui DIT la perte définitive « für beide Seiten », architecte = menu
  natif conservé (prouvé) ; backend 392→398, frontend 556→560 (80
  fichiers) ·
  `§109` trois retours de la capture : (1) zoom = réglage d'INTERFACE
  (erreur d'interprétation §107 admise : widget page-seule supprimé,
  contrôle « Ansicht » discret dans la barre du haut, appliqué sur <html>
  = dock de chat inclus, 70/85/100 %, défaut 70 %, reprise unique de
  l'ancienne clé) ; (2) UNE seule bulle noire avec le total des non lus
  (rangée de bulles ambre supprimée) — détail préservé dans le panneau
  « Unterhaltungen » (canaux ET directs, avant §109 les DM non lues
  n'avaient AUCUN autre affichage) + démarrage propre (fenêtres passées
  ne rouvrent plus seules) ; (3) Baustelle pleine largeur : grille 2
  colonnes (flux import/visites | résultat Mangel/Mängel) au lieu de la
  colonne 768 px « mx-auto max-w-3xl » (les « côtés vides » de la
  capture) + états vides enrichis ; erreurs de MES assertions admises
  (espace insécable vs simple, placeholders cherchés dans textContent,
  assertion démarrage vacuante → preuve réelle getMessages) ; test §84
  repassé par la vraie voie (bus événement) et toujours probant ;
  frontend 560→571 (83 fichiers) ·
  `§110` (1) suppression de TOUTE discussion owner/admin : pierre
  tombale `chat_channel_tombstones` (migration 14) sinon l'ensure
  recréait le canal = théâtre ; modale dit la vérité (DM « beide Seiten
  », canal « ganze Team + nie neu erstellt ») ; (2) « je ne peux plus
  rien importer » — cause lue dans sa capture : « Kein Projekt » + garde
  §106 SILENCIEUSE → clic mort ressenti comme une panne : dropzone
  parlante (pastille permanente + clic qui explique raison ET remède),
  garde intacte ; (3) IMPORT VIDÉO réel : MP4/M4V/WebM/MOV acceptés,
  AVI/MKV refusés expliqués (règle HEIC), parseur mvhd maison
  zéro-dépendance (v0 32b + v1 64b, époque 1904, sondes tête ET queue,
  gardes anti-faux-positif), source de date toujours affichée,
  comptages distincts « 1 Foto + 1 Video », Issue.videoIds persisté,
  lecteur <video controls> en visionneuse, iPhone-HEVC dit ; erreurs
  admises : fixtures tombstone oubliées (no such table au 1er run),
  b''.encode() dans un test, annotations ArrayBuffer TS≥5.7, helper
  chaîne vide vs « 0 Fotos » (épingle §106) ; backend 398→400,
  frontend 571→583 (84 fichiers) ·
  `§111` « TOUJOURS impossible d'importer » — vraie cause ADMISE : la
  liste de projets du client est VIDE (aucun seed, aucune synchro — un
  projet naît uniquement via addProject page Projekte) → ma consigne
  §110 « Wähle oben links » pointait un sélecteur sans rien à choisir =
  faux remède ; correctif : la carte ambrée CRÉE le premier projet
  inline (un nom suffit, addProject le choisit aussitôt, tentative
  serveur best-effort comme page Projekte) + auto-choix du premier
  projet quand la liste existe sans sélection (sur activeProjectId BRUT
  — le repli d'affichage de la facade `?? projects[0]` rendait ma 1re
  condition muette : test rouge attrapé, aveu) + explications « zéro
  projet → crée » vs « projets → choisis » ; ZOOM : bouton « Ansicht »
  retiré sur demande (« pas joli »), la densité choisie (70 % défaut)
  reste appliquée via readAnsicht, AnsichtMenu.tsx + test supprimés,
  aucun code mort ; backend 400/400 inchangé, frontend 583→582 moins 3
  tests AnsichtMenu plus 2 Baustelle (83 fichiers) ·
  `§112` rapport général & diagnostic
  (`docs/RAPPORT_GENERAL_NARCHI.md`, document client sans code) :
  inventaire mesuré (982 tests verts rejoués, 114 commits, 15
  migrations, ~57 k lignes frontend), 9 points faibles DITS (sauvegarde
  BDD = seul trou rouge), open source = non aux gros ERP clé-en-main,
  oui aux briques spécialisées (ZUGFeRD+KoSIT 2026, Playwright), route
  P0/P1/P2 où chaque pas reste le choix du client ·
  `§113` P0 sauvegardes LIVRÉ (aveu : pgBackRest tournait déjà chaque
  nuit §51 — mon §112 disait « absent », inexact ; le vrai trou = tout
  prisonnier du volume Docker, détruit par 4_TOUT_EFFACER) : export
  VISIBLE pg_dump|gzip dans sauvegardes\ (monté dans db,
  5_SAUVEGARDE_EXTERNE.bat), manifeste du contenu exact à l'export +
  statut vérité atomique (philosophie §51), rotation 60,
  planification hebdo schtasks (7_…bat), et surtout la PREUVE de
  restauration (6_VERIFIER_RESTAURATION.bat : base jetable, comparaison
  au manifeste — jamais à la vivante qui bouge) éprouvée sur un VRAI
  PostgreSQL : restauration identique 30 tables/9 000 lignes, rotation
  5→3, copie corrompue refusée (65), manifeste trafiqué refusé (1),
  base vivante modifiée → toujours OK ; aveu : mon contrôle de bannière
  (ligne 1 vs vraie ligne 2) a écarté un dump VALIDE au 1er essai réel
  — corrigé ; exports exclus de git (.gitignore) ;
  docs/SAUVEGARDES_NARCHI.md + corrigendum écrit dans le rapport §112 ;
  aucun code produit/frontend touché ; backend 400→412 : la garde
  d'encodage §52 a auto-découvert les 6 nouveaux scripts (mon 1er jet
  ROUGE : accents + § → translittération ASCII), gates rejoués verts ·
  `§114` « utilise l'outil open source » : dépôt CLONÉ et MESURÉ (189
  modules, 1 431 tests, licence AGPL-3.0+commerciale LUE) → doctrine
  actée : zéro ligne AGPL chez nous (copyleft réseau = risque de devoir
  publier Narchi), on étudie l'ARCHITECTURE et on réécrit en salle
  blanche sur les standards ; 1er fruit = E-Rechnung fondations
  `services/xrechnung.py` (constructeur CII EN 16931 maison, Decimal
  anti-centimes, aucune valeur inventée : Leitweg-ID/livraison-
  ou-période/USt-IdNr obligatoires sinon REFUS d'émettre avec
  violations NARCHI-XR nommées) + doc d'analyse anonymisée
  `docs/ANALYSE_OUTIL_UPSTREAM_BTP.md` ; backend 412→419/419 (+7 tests
  structure+arithmétique+violations), frontend inchangé ·
  `§115` synchro inter-appareils ÉTAPE 1 (le « GO » client) : API
  serveur des Mängel — vérité partagée `baustelle_issues` (clé
  composite tenant+id, upsert idempotent LWW avec verdict écrit,
  tombstone de suppression qui voyage dans les deltas, ?since
  (curseur serveur_time), truncated dit), 14 tests (cloisonnement 404, idempotence,
  LWW, validation), migration additive 15 ; étapes restantes dites :
  moteur frontend, blobs, HTTPS local ; aveux : PK globale→composite,
  datetime naïf SQLite, intercepteur ORM découvert vivant (double
  blindage désormais posé par handler) ·
  `§116` « fini avan le E rechnung » : E-Rechnung FINIE de bout en bout —
  registre `invoices` + `invoice_counters` (migration 16, clé composite
  tenant+id), cycle GoBD appliqué serveur (brouillon → émission
  RE-AAAA-NNNN + date serveur figées → storno numéro CONSERVÉ, chaîne
  sans trou possible : émission refusée = compteur non consommé, éprouvé),
  émission pré-validée (422 + violations NARCHI-XR nues), XML XRechnung
  3.0 téléchargeable (totaux RECALCULÉS, jamais lus du navigateur),
  refactor §114 en `calculer_totaux()` unique partagée, page AGENCY OPS→
  Rechnungen (allemand, éditeur lignes 19/7 %, aperçu BigInt au centime
  — cas piège 3×33,3350=100,01 épinglé dans les deux mondes, Absender
  mémorisé, bandeau « validateur KoSIT = prochaine étape ») ; aveux :
  mon test parseur prétendait « 4.000 »=4000 €, la règle honnête (refus)
  a gagné ; option 0 % retirée (XR-36 garanti sinon) ; backend
  433→450/450 (+17), frontend 582→597 (+15, 85 fichiers), tsc 0, build
  RC=0 44 jsFiles, docs/E_RECHNUNG.md client + rapport §112 aligné ·
  `§117` synchro Mängel ÉTAPE 2 (carte blanche) : TROIS vrais trous
  trouvés en l'écrivant puis bouchés sous tests — serveur : upsert
  tombstoné ne revivait jamais (résurrection LWW livrée), statut cockpit
  « in-review » absent du contrat (élargi) ; navigateur : déclin
  repoussé à l'infini (rattrapage par GET, testé). Moteur DI
  lib/issueSync.ts : file hors-ligne PERSISTANTE (localStorage), curseur
  SERVEUR (page tronquée = curseur au dernier reçu), LWW en ms (jamais
  lexicale — keyhole « .000Z »/« +00:00 » épinglé), tombstone vécue par
  écrit locale plus récente, Mängel « garés » projet absent comptés+DITS,
  badge sincère page Baustelle (heure serveur, jamais décoratif), textes
  « alles bleibt » corrigés (fichiers locaux / textes sync — dit).
  Backend 450→453, frontend 597→622 (87 fichiers, +25), docs SYNCHRO
  réécrit, rapport §112 aligné · `§118` réponse à la plainte « photos/
  vidéos ne se synchronisent pas + projet invisible sur l'autre compte »
  — ÉTAPE 3 livrée + synchro des PROJETS : miroir serveur
  `project_mirrors` (migration 20260812_17, PK composite, LWW client,
  tombstones, résurrection d'office leçon §117), routes
  `/api/v5/project-sync` (delta/batch GET-DELETE) ; médias = FICHIERS
  dans le volume `narchi_storage` existant (compose INCHANGÉ) via
  `/api/v5/media` : octets magiques vérifiés (jpeg/png/webp/gif/bmp,
  webm/mp4/mov brand `qt  ` reconnu), plafonds 25/300 Mio francs, écriture
  atomique .part+rename, id regex stricte, dossier par bureau ; moteurs
  frontend projectSync.ts + mediaSync.ts (files persistantes, upload auto
  à l'import, pull-through à l'affichage, 4xx = refus GARDÉ+DIT avec la
  raison serveur jamais bouclé, 404 mémorisé session, anti-boucle Silent/
  LocalOnly éprouvé), badge §117 étendu aux 3 flux (Projekte/Medien
  warten, nicht hochladbar en rouge), statut par défaut corrigé « planning »
  (jamais « active » hors union — attrapé à la relecture des types, tsc
  masqué par le cast), aveux : mon test d'intégration média avait oublié
  le déclenchement auto voulu, pytest-asyncio absent → asyncio.run,
  regex-chirurgie cassée réécrite main, fixtures 413/id-espaces refaites.
  Backend 453→472 (+19), frontend 622→657 (89 fichiers, +35 : 22 moteur
  projets + 10 moteur médias + 3 badge), docs SYNCHRO (étape 3 livrée,
  limites dites : pas de DELETE média serveur, volume fichiers hors
  pg_dump — rappel dans SAUVEGARDES), rapport §112 ligne b → presque
  complet · `§119` ÉTAPE 4 (dernière du plan synchro §103) : HTTPS local
  mkcert — corps du nginx découpé en include commun (8080/8443 ne
  peuvent pas diverger), bloc 8443 = gabarit versionné sans secret
  coché par copie dans infra/tls/enabled/ (glob nginx VIDE = inerte,
  installation sans étape 4 strictement inchangée — prouvé), scripts
  8_ACTIVER/9_RETIRER (mkcert winget ou téléchargement SHA-256 épinglé
  mesuré par moi — refus sec d'un binaire différent, SAN = localhost+
  127.0.0.1+::1+IP LAN réelles, pare-feu Privé/Domaine jamais Public,
  résultat PROUVÉ par requêtes réelles, retrait qui CONSERVE les
  certificats et le dit), PROUVE RÉELLE sandbox : nginx 1.26 + CA
  openssl façon mkcert, cas A/B rejoués (8080 vivant/inerte 8443 puis
  TLS 200 + CSP/HSTS + API proxyfiée + SAN refusé hors liste + refus
  sans CA), substitutions DITES (chemins /etc→/tmp, backend=stub,
  -T validé). +9 tests de garde (chemins partagés, glob niveau http,
  pureté contexte inc, hash épinglé présent, .pem jamais versionnés),
  aveu : « exprès » avec è dans mon .ps1 (garde ASCII §52 style, attrapé
  par ma propre vérification octet avant pytest). backend 472→489,
  frontend inchangé 657, docs HTTPS_LOCAL.md client + SYNCHRO (4/4),
  rapport §112 lignes b/e → plan de synchro COMPLET · `§120` demandes
  client, documents seuls (zéro code) : `docs/GUIDE_TELEPHONE_PAS_A_PAS.md`
  (essai synchro pas à pas, chaque étape avec son « vous devez voir »,
  table ça-coince, limites dites) + `docs/RAPPORT_BETA_MARCHE_PRIX.md`
  réel non flatteur : beta-readiness pondérée ~70 % = GO ENCADRÉ
  (bureaux amis, contrat beta, données non critiques) avec la liste
  chiffrée des 6 manques vers 90 % ; concurrents sourcés datés
  (PlanRadar 26/89/129 €, smino 948 CHF/an/util., BauMaster 79 €,
  Dalux gratuit→7 €, BKI 1 299-1 545 € one-time, RIB iTWO 5-6 chiffres,
  marché BAK ~35 000 bureaux dont 91 % < 10 pers.) ; classe =
  KMU-Bausoftware 1-15 pers. hybride coûts+chantier+back-office (seul
  hybride du panel — périmètre mesuré, pas qualité garantie) ; chances
  en scénarios francs (référence beta ~100 % apprentissage, 30-60
  bureaux/3 ans sérieux si effort commercial, leader <5 %) ; prix
  recommandé : beta 0 € contre feedback écrit, licence bureau
  1 790 €/an ou 3 900 € + 690 €/an — jamais 19 €/mois, jamais
  enterprise sur devis ; prochaines actions ordonnancées. Gates
  rejoués verts (docs seuls : 489/489 · 657/657 · tsc 0 · build RC=0)
  · `§121` « supposons que ça fonctionne, GO la prochaine étape » =
  action 2 du rapport : SUITE E2E NAVIGATEUR RÉEL (Playwright, Chromium,
  nginx+FastAPI+PostgreSQL+Redis réels — zéro écran simulé) : 5 volets
  verts en ~31 s (compte/connexion avec refus visible du mauvais mot de
  passe ; projet bureau→2e appareil ; Mangel+PHOTO décodée sur appareil
  frais ; MODE AVION automatisé avec badge honnête puis rattrapage
  prouvé serveur ; vraie IFC parsée → Mengenliste KG/m³/€/CO₂). Lois :
  zéro retry, aucun waitForTimeout, 1 worker, compte/tenant neuf par
  test, santé de stack exigée au démarrage. BUG RÉEL attrapé : au 1er
  démarrage d'un appareil, un Mangel dont le projet n'était pas encore
  tiré restait « garé » INVISIBLE À VIE (le test §117 simulait un renvoi
  serveur que le delta strict ne produit jamais — aveu) → loi du
  curseur honnête (garé = curseur gelé) + copie mémoire rejouée dès que
  le miroir Projets livre + tombe qui dé-gare ; 4 tests unitaires §121.
  frontend 657→661 (89 fichiers), squelettes E2E V4 jamais exécutables
  SUPPRIMÉS (dits), docs : frontend/e2e/README.md + SYNCHRO §121 +
  addendum daté au rapport beta (synchro 55→70 %, l'essai téléphone
  physique reste l'action 1) · `§122` demande client « mets à jour le
  README + crée le prompt pour la prochaine IA » : docs seuls (zéro
  code) — **`docs/PROMPT_RELEVE_IA.md`** = la lettre de relève à coller
  telle quelle (règles de la maison, gates avec chiffres attendus,
  pièges sandbox/Windows mesurés, conventions produit, prochaines
  étapes ordonnancées du rapport §120, interdits absolus, checklist du
  premier tour) ; la relève commence par vérifier `git log` (les chiffres
  du prompt datent — CHANGELOG/README font foi à l'instant T) · `§123`
  carte blanche → **validateur officiel KoSIT PASSÉ** (v1.6.2, XRechnung
  3.0.2 du 31/01/2026, verdict « ACCEPTABLE » mesuré le 13/08 sur les 2
  profils + chemin API complet) : 6 défauts réels trouvés et corrigés
  (CustomizationID xeinkauf.de, CityName, BG-16 IBAN, BG-6 contact,
  BT-23 processus, BT-34/49 e-mails), 5 refus honnêtes NARCHI-XR-41…45,
  9 colonnes + migration _18, formulaire allemand (banque/contact/e-mails),
  preuves octet-par-octet dans `backend/tests/fixtures/xrechnung_kosit/`,
  script rejouable `scripts/valider-xrechnung-kosit.sh` (SHA-256 épinglés)
  ; backend 489→495, vitest 661/661, tsc 0, build RC=0, E2E rejoué 5/5
  (30,0 s, stack reconstruite, migration fumée sur PG17 réel) ; dit :
  CI hébergée pas encore branchée, Versand/PDF-A-3/UBL ouverts · `§124`
  demande client « vérifie floci (émulateur AWS local) » : **vérification
  MESURÉE, pas papier** — floci v1.6.0 buildé ici (build = JDK 25 exigé),
  lancé en 2,64 s, et NOTRE `StorageService` inchangé y a passé **7/7
  vérifications** (POST policy + content-length-range anti-triche refusée
  sur dépassement, HEAD exact, GET pré-signé octets identiques, fuite
  cross-locataire 403) → décision : adopté pour dev/CI (licence MIT),
  jamais embarqué dans le produit auto-hébergé (stockage local y suffit,
  pas de Java chez le client) ; émulateur ≠ AWS/R2 : smoke test réel R2
  exigé avant livraison SaaS (dit, non fait) ; preuve rejouable
  `scripts/poc-floci-s3.py` (vert, RC=0), rapport `docs/OUTIL_FLOCI_S3.md` ·
  `§125` carte blanche → backlog §120 « purge des médias orphelins serveur »
  LIVRÉ : `python -m app.services.media_purge` — **simulation par défaut**,
  conservateur par construction (rien qu'un appareil hors-ligne pourrait
  réclamer n'est jamais touché : vivant > tombale récente > horloge fiable
  deleted_at/mtime, horizon 30 j DIT et paramétrable ; .part abandonnés et
  .meta orphelins aussi ; noms inattendus IGNORÉS, jamais supprimés ;
  chaque octet libéré est journalisé) ; 13 tests éprouvent les 7 situations
  réelles (vivant vieux, tombale récente/âgée, jamais référencé jeune/vieux,
  priorité vivant, bornage par bureau, horizon 90 j) ; en-tête §118 aligné ;
  backend 495→508, vitest 661/661, tsc 0, build OK ; E2E non rejoué et DIT
  (commentaire interne seul côté produit) ·
  `§126` reprise 16/08 : état figé §125 + **note globale** (readiness beta
  pondérée **~71 %**) + acte des chantiers 2 (suite KoSIT) et 3 (contrat
  beta) — `docs/REPRISE_2026-08-16.md` · `§127` chantier 3 livré :
  `docs/CONTRAT_BETA.md` (brouillon 1 page DE, à faire relire par un
  avocat) + `docs/GRILLE_SELECTION_BUREAUX_PILOTES.md` (6 critères
  pondérés, duo coûts/AVA + chantier) · `§128` chantier 2 (1/4) : job CI
  KoSIT `.github/workflows/kosit-validate.yml` PRÉPARÉ (path-filtered +
  manuel + hebdo), script **re-prouvé en local** (exit 0, Acceptable 2/0)
  ; pipeline GitHub **non exécutée et DITE** — reste UBL/Peppol, Versand ·
  `§129` chantier 2 (2/4) : facture hybride **ZUGFeRD/Factur-X PDF/A-3b
  LIVRÉE et PROUVÉE** (Mustang v2.25.0 Apache-2.0 : isCompliant=true,
  veraPDF 2 978 assertions 0 échec + XML valide ; `zugferd.pdf` route +
  `scripts/valider-zugferd-mustang.sh` SHA-256 épinglé ; backend 508→512 ;
  + correctif séparé : 2 tests à date figée `T0=12/08` vieillie → résurrection
  future-datée) · `§130` chantier 2 (3/4) : **syntaxe UBL 2.1 LIVRÉE et
  PROUVÉE** (validateur officiel KoSIT scénarios UBL → ACCEPTABLE ×2 ;
  `xrechnung-ubl.xml` route + `scripts/valider-ubl-kosit.sh` + docs/PEPPOL.md ;
  backend 512→515) · `§131` chantier 2 (4/4) : **Versand LIVRÉ** — e-mail .eml
  prêt à l'envoi avec la facture hybride jointe (`versand.eml` route, pas de
  SMTP intégré, dit ; Peppol réseau différé — Access Point) ; backend 515→518 ·
  `§132` frontend : les **4 sorties téléchargeables** depuis l'écran
  Rechnungen (XML / PDF/A-3 ZUGFeRD / UBL Peppol / .eml), bandeau mis à jour,
  +2 tests (frontend 661→663) · `§133` sauvegarde des FICHIERS (photos/vidéos) :
  export visible + preuve de restauration (`SAUVEGARDER_LES_FICHIERS.bat`,
  `export-fichiers-visible.sh`, `verifier-fichiers.sh`), le volume n'est plus
  « hors sauvegarde » ; backend 518→531.
  **Le lot E-Rechnung est COMPLET : XML KoSIT + PDF/A-3 + UBL + Versand.** ·
  `§134` kit beta (1/3) : guide utilisateur final allemand
  (`docs/GUIDE_NUTZER_DE.md`, 15 sections, limites dites) · `§135` kit beta
  (2/3) : AGB/CGV + AVV DSGVO brouillons (`docs/AGB_AVV_ENTWURF.md`,
  checkliste avocat) · `§136` kit beta (3/3) : Runbook Betrieb
  (`docs/RUNBOOK_BETRIEB_DE.md`) — documentation 55→65, juridique 50→60,
  ops 40→50 → **readiness pondérée ~74 %** · `§137` garde-fou de
  cohérence kit beta (doc↔fichiers, 10 tests, backend 531→541) ·
  `§138` analyse open source fiabilité (`docs/OUTILS_OPEN_SOURCE_ELEVATION.md`,
  licences vérifiées, priorités P0–P3) · `§139` Hypothesis (property testing
  monétaire, backend 541→544) · `§140` Locust (preuve de charge, PRÉPARÉ) ·
  `§141` Gitleaks (secret scan PROUVÉ, 544→547) · `§142` Semgrep (interdits
  §60 exécutables, 547→550) · `§143` Checkov (IaC PROUVÉ, 550→553) · `§144`
  mutmut (configuré, dette d'intégration documentée) · `§145` centime : banker's
  rounding corrigé partout (money.py HALF_UP, +17 tests, backend 553→570) ·
  `§146` SBOM syft + scan grype (2 CVE pypdf trouvées→corrigées, 570→573) ·
  `§147` mypy strict cœur monétaire (0 erreur, 20 corrigées, 573→576) ·
  `§148` mutmut mesuré (dette CI) + outils stack hébergée PRÉPARÉS ·
  `§149` retour client : verrou téléchargement expliqué + bouton « Beispiel
  ausfüllen » (frontend 663→665) · `§150` facture PROFESSIONNELLE : gabarit
  soigné + logo du bureau sur le PDF ZUGFeRD (backend 576→582, Mustang
  isCompliant=true avec logo RGBA) · `§151` le « waw » bouclé : pont
  estimation → facture (bouton « → Rechnung », frontend 665→669) · `§152`
  « Beispielprojekt » (projet démo en 1 clic, premier contact, 669→671) ·
  `§153` correctif (client du projet, pas le nom) · `§154` **VE-Studio** : le
  « waouh » — value engineering CO₂+€ en un clic (substitution matériaux,
  €/tCO₂e, salle blanche Ökobaudat/BKI, frontend 671→680) · `§155` VE-Studio
  **branché sur la maquette réelle** : les vrais m³ du takeoff (masse ÷
  densité) → ΔCO₂ gesamt + ΔKosten gesamt + % du A1–A3, frontend 680→686 ·
  `§156` **What-if cumulatif** : sélection multiple → nouveau total CO₂/€ et
  kg/m² recalculés en direct (frontend 686→691) · `§157` **le waouh au premier contact** : le Beispielprojekt embarque une vraie maquette démo (takeoff EFH réaliste → LCA + VE-Studio + Baustelle allumés en 1 clic) + correctif « Porenbeton » reclassé à tort en « beton » (frontend 691→695) · `§158` **export PDF** « CO2- und Kosten-Optimierung » : le plan VE + le what-if deviennent un livrable client avec le logo du bureau (frontend 695→699) · `§159` **argumentaire client bas-carbone** : le what-if génère un texte de négociation allemand chiffré (copiable + intégré au PDF), frontend 699→704.

### 2. Gates OBLIGATOIRES avant chaque commit (séquentiels, règle §70)

```bash
cd backend  && rm -f test.db && python -m pytest tests -q     # 592 attendus (§178)
cd frontend && npx tsc --noEmit                                # 0 erreur
cd frontend && npx vitest run                                  # 797 attendus
cd frontend && npm run build                                   # RC=0 (44 jsFiles)
# Gate E2E SÉPARÉ (§121 — exige la stack démarrée + chromium installé) :
cd frontend && npx playwright install chromium                 # 1re fois
cd frontend && npm run e2e                                     # 5/5 attendus (~31 s)
```
Pièges connus : `rm -f backend/test.db` OBLIGATOIRE avant pytest si le
modèle User a changé (`create_all` n'altère pas) ;
`tout nouvel import en tête de module backend/` doit figurer dans
`requirements-api.txt` (test_requirements_manifests scanne l'AST) ;
`pip install`/`npm ci` à refaire si le sandbox a été recyclé ;
**JAMAIS deux gates en parallèle** : le dos_guard coupe à CPU conteneur
> 80 % (503 « serveur surchargé ») — pytest lancé en même temps que
npm/tsc fait échouer des tests au hasard (flake 0/5/19 observé §87) ;
identité git s'évapore à chaque session →
`git config user.name "NARCHI DevOps" && git config user.email "devops@narchi.de"`.

### 3. Environnement de l'utilisateur final (à respecter)

Windows PowerShell + Docker Desktop WSL2 · http://localhost:8080 ·
**le code est CUIt dans les images Docker** (pas de bind mount) → toute
modif exige `3_REPARER_NARCHI_SANS_PERTE.bat` (rebuild --no-cache,
données préservées, alembic joué par le service migrate) puis **Ctrl+F5**.
Comptes : l'admin système (identifiants dans les .bat) vit dans le tenant
technique `tenant-narchi-office` — NE PAS tester la collaboration avec :
créer les comptes de test **connecté en tant que son propre owner**
(Team → Neues Konto). Vérif SQL :
`docker exec narchi-db-1 psql -U narchi -d narchi_v3 -c "SELECT email, role, tenant_id FROM users WHERE is_active ORDER BY tenant_id, email;"`

### 4. Carte technique minute

- Backend FastAPI (`backend/app/main.py`) · SQLAlchemy + Alembic
  (chaîne de migrations → tête `20260826_23_office_senders`) ·
  auth cookie HttpOnly `narchi_session` (aucun token lisible en JS) ·
  `app/middlewares/tenant` cloisonne chaque requête SQL par tenant.
- Temps réel : chat WS `/api/v5/chat/ws` (§61) · presence/locks REST §78
  · collab WS `/api/v5/collab/ws/{room}` §81 (hub pycrdt = même noyau
  CRDT que Yjs ; pont Redis `collabdoc:{tenant}:{room}` anti-ping-pong ;
  flush PG débouncé 2 s + final). Registre `collab_routes` (rooms REST).
- Frontend React 19 + Zustand (`store/AppStore.ts`) · chat dock
  `components/FloatingChat.tsx` (verrous §84) · page messages
  `pages/dashboard/Messages.tsx` · registre avatars réactif
  `lib/avatars.ts` (§82 serveur → §83 clés e-mail) · membres
  `lib/members.ts` + `backend/app/api/members_routes.py` (matrice
  owner/admin/architect testée miroir §80).

### 5. Charte d'honnêteté (non négociable)

Aucun écran fake : si une donnée n'est pas disponible, l'UI le DIT et se
dégrade honnêtement. Marqueurs allemands **Messung / Richtwert / Regel**
partout où une valeur n'est pas mesurée. Pas de chiffre inventé ; toute
fonctionnalité livrée avec ses tests (compteurs §1). Les erreurs
d'analyse sont admises par écrit dans le CHANGELOG (§83, §84).

### 6. SUJETS OUVERTS (état véridique)

- **Avatars inter-fenêtres chez l'utilisateur** : CAUSE TROUVÉE et
  réparée au §87 (double session SQLAlchemy → PATCH /members/me
  répondait « sauvegardé » sans jamais écrire ; preuve de persistance
  HTTP ajoutée aux tests). Reste UNE action chez lui après rebuild :
  re-définir son avatar une fois → il persiste et se propage (≤30 s ou
  F5). Le psql de contrôle montrera alors la ligne :
  `docker exec narchi-db-1 psql -U narchi -d narchi_v3 -c "SELECT email, left(avatar_json,45) FROM users WHERE avatar_json IS NOT NULL;"`
- **Écran de connexion** : régression esthétique signalée (« avant plus
  simple et joli ») — pass visuel non entamé.
- **Étape 3 CRDT : TERMINÉE complète** (§86 historique/curseurs + §89
  LV structuré, §90 export X31 depuis le JSON positions livré).
- **Restes diagnostic** (`docs/DIAGNOSTIC_NARCHI_2026.md`) : GAEB
  **chaîne Vergabe COMPLÈTE** — X31 export §90, import offres §91,
  Angebotsvergleich §92, **émission X83 §93 (#5 livré)**, **#6 livré
  §98+§73** (graphique SVG officiel + alerte > 12 mois) ; restent : PWA
  **#10 COMPLET** : socle PWA §101 (poste de bureau, téléphone hors-ligne
  jamais promis) + page « Baustelle » §104 (idée client : import photos
  au bureau, tri EXIF+dit, Mängel datés par la photo la plus ancienne) —
  l'ancienne voie téléphone §102 a été supprimée au §103 ; §105 :
  multi-format (PNG/WebP/GIF/BMP + HEIC refusé expliqué) et pass visuel
  premium de la page ; §106 : balayage après hydratation (photo référencée
  jamais effacée), garde « Kein Projekt », visionneuse plein écran ;
  **pass visuel connexion §100**
  (vérité §36 + allemand complet + épure) ; nettoyage d'un ancien PDF de
  pitch (mentions « calcul certifié ») toujours différé.
- **Données de prix (§94/§95)** : stratégie →
  **`docs/PREISDATEN_STRATEGIE.md`** ; §95 « Preis-Spiegel » **LIVRÉ**
  (offres → bibliothèque, Preisspiegel Min/Median/Max §96) ; **médiane
  branchée dans le Schnell-Schätzer §99 LIVRÉ** (un Ausreißer ne tire
  plus le devis, unités jamais mélangées). Reste possible : séries
  Büro/gewerblich dans le graphique #6 (saisie officielle requise).
- **Roadmap UI (§201)** : plus de théâtre Vercel / Supabase / 2.384 Stückpreise
  / « 78 % ». Texte aligné sur le self-host réel + readiness ~74 % documentée.
- **Chantiers en cours (décision 16/08, voir §126–§154)** : **chantier 2 =
  suite KoSIT TERMINÉ (4/4)** — CI hébergée préparée (non exécutée, dit),
  PDF/A-3 ZUGFeRD §129, syntaxe UBL §130, Versand §131 + **frontend §132**
  (4 sorties téléchargeables). Seul l'envoi Peppol réseau reste un jalon
  d'infrastructure DIFFÉRÉ (Access Point, `docs/PEPPOL.md`) ; chantier 3 =
  contrat beta (brouillon livré, à faire relire par un avocat) + choix des 2
  premiers bureaux pilotes (grille livrée). **Backlog repris §133** :
  sauvegarde des FICHIERS (photos/vidéos) LIVRÉE — le volume `narchi_storage`
  n'est plus « hors sauvegarde ». **Kit beta §134–§136** : guide utilisateur
  DE + AGB/AVV (brouillons) + runbook Betrieb — documentation/juridique/ops
  remontent. **Readiness beta pondérée ~74 %** (GO ENCADRÉ 3-5 bureaux amis ;
  ~16 points vers ~90 %). **§206 : le test téléphone n'est plus un
  jalon bloquant** — photos via messagerie + import bureau.

### 7. Règles du chantier

Un commit propre TESTÉ par tâche, CHANGELOG complété AVANT `git add`,
anonymisation : les 3 chaînes de marque héritées (`OpenConstruction`+`ERP`,
`datadriven`+`construction`, `data2`+`drive` — à concaténer dans le grep)
doivent rester à 0 occurrence dans frontend/src, backend/app,
backend/tests, README.md, docs et le CHANGELOG ;
`git checkout -- frontend/public/ifc/` avant chaque add,
**jamais de push GitHub, jamais d'archive/ZIP**.


