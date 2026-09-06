# NARCHI 2027 — Feuille de route (état d’exécution)

Date : 26/08/2026. **Toute la feuille ne peut pas être livrée en un sprint.**  
Ce fichier dit **ce qui est fait maintenant** vs **reporté**.  
Grafana/Loki = **AGPL** → **pas** embarqués dans le produit (doctrine §114).

## Fait maintenant (§243)

| Item | Décision |
|---|---|
| A1 IFC 4.3 | Schema `IFC4X3*` **accepté**. 2x3 **reste accepté** (bureaux existants). Avertissement Vergabe 2027. Pas de rejet 2x3. ifcopenshell reste 0.8.5 (0.9 = bump testé plus tard). |
| A2 LLM DSGVO | Cloud aus. Ollama **branché** si `OLLAMA_BASE_URL` : modèle **llama3.2:3b** (8 Go). 16 Go : `llama3.1:8b`. |
| A3 Observabilité | OTEL déjà dans requirements. Grafana **non** ajouté (AGPL). |
| B4 XRechnung 3.0 | **Déjà** CII 3.0.2 + KoSIT scripts. factur-x / KoSIT-in-Docker = plus tard. |
| A4 Passkeys | **§246** WebAuthn: Register/Login, Tabelle `webauthn_credentials`. Verify nur mit Paket `webauthn`. HTTP = localhost. |
| A3 OTEL | Collector **optional** `docker-compose.otel.yml` (Apache). Grafana/Loki **nicht** neu. Prometheus war schon da. |
| B4 KoSIT Docker | **§260–§264** Sidecar JAR + **CII und UBL** im selben Lauf, Ergebnis auf der Rechnung. Peppol-Netz **nein**. |
| Scope-Guard bureau | **§249** Vertragspunkte + Nachtrag mit echtem HOAI-Delta. Kein Manifold. |
| A2 RAG | **§252** Keyword-Retrieve der Werkzeug-Fakten + « Lokal erklären ». Kein LlamaIndex, keine Embeddings-Erfindung. |
| Clash bureau | **§254** Protokoll-PDF aus AABB-Radar. Manifold-Mesh = später. |
| Beta-Härte | **§255** Honorarvorschlag = HOAI-Tafel; Haftungsradar + Audit; Supabase zugeklappt. |
| Stunden | **§256** Zwei Bücher getrennt + Menü Büro-Stunden. Keine Fusion. |
| HOAI PDF | **§257** PDF aus calcHoai. Orientierung, kein Bescheid. |
| BCF 2.1 | **§258–§263** ZIP, Import (Planprüfung+Qualität), Viewpoint 3D, **IDS-Fails als BCF**. AABB. Manifold später. |

## Reporté (vrai calendrier)

Q4 2026 suite : LlamaIndex **nicht** (überflüssig). RAG = Keyword-Schnipsel §252. Passkey LAN nur HTTPS.  
Q1 2027 : Manifold clash, WebGPU, factur-X-Ersatz nur wenn KoSIT bleibt grün.  
Q2–Q3 : TEASER, Speckle, Podman — nur wenn Beta es verlangt.

## RAM

Stack actuel ~10 Go. Ollama profil ~+8 Go. Full 2027 28 Go = **pas** le défaut bureau 16 Go.
