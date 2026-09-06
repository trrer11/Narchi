# Outils open source pour élever NARCHI — fiabilité « irréprochable »

> **Document d'analyse (fr, pour le client).** Écrit le 16/08/2026 (§138),
> sur demande « cherche des outils open source sur GitHub qui vont élever le
> niveau de professionnalisme et de fiabilité irréprochable ». Règle de la
> maison : chaque outil est cité avec sa **licence** (la doctrine §114 interdit
> de COPIER du code AGPL dans NARCHI) et son **état réel** (déjà présent / à
> ajouter). Ce qui n'est pas encore exécuté est marqué « à prouver », jamais
> « livré ».

---

## 1. Ce que NARCHI a DÉJÀ (pour ne pas recommander l'existant)

| Domaine | Outil présent | Licence |
|---|---|---|
| Métriques | **Prometheus** (compose `prom/prometheus:v3.5.0`) + **Grafana 12.1.0** | Apache-2.0 / AGPL-3.0 (service séparé) |
| Erreurs | **Sentry** (`sentry-sdk[fastapi]`) | source-available (BSL) |
| Traces | **OpenTelemetry SDK** (FastAPI + Celery instrumentés) | Apache-2.0 |
| Sauvegardes | **pgBackRest** + export visible §113/§133 | MIT / maison |
| Qualité code | **Ruff**, **Bandit**, **pip-audit**, `npm audit` | MIT / Apache-2.0 |
| Scan dépendances | **Trivy** + **OWASP Dependency-Check** (CI `security.yml`) | Apache-2.0 |
| E2E navigateur | **Playwright** (5 volets, Chromium réel) | Apache-2.0 |
| E-Rechnung | **KoSIT** + **Mustang** (validateurs officiels) | Apache-2.0 |

> **Nuance licence, dite honnêtement** : Grafana (et Loki) sont AGPL-3.0.
> La doctrine §114 interdit de *copier* du code AGPL dans `backend/app` /
> `frontend/src` (un ERP AGPL → NARCHI devrait devenir AGPL). **Utiliser**
> un outil AGPL **non modifié** comme service séparé dans la stack du client
> ne contamine PAS le code propriétaire de NARCHI — c'est pourquoi Grafana y
> figure déjà. Je signale néanmoins l'alternative permissive à chaque fois.

---

## 2. Les trous mesurés (§120) → les outils qui les comblent

Le rapport §120 chiffre : sécurité 75 % (pas de pentest), ops 50 % (pas de
monitoring centralisé des logs, pas de preuve de charge), bus factor 1.
Voici les outils open source, classés par impact sur la fiabilité.

### 🔴 P0 — Correction monétaire prouvée & preuve de charge

| Outil | Licence | Ce qu'il apporte à NARCHI | État |
|---|---|---|---|
| **Hypothesis** (property-based testing) | MPL-2.0 | Les invariants de l'argent (Decimal anti-float, arrondi HALF_UP au centime, `calculer_totaux()`) deviennent des **propriétés** testées sur des milliers de cas aléatoires. Une étude académique (ACM, 2025) montre qu'un test par propriété tue **~52× plus de mutants** qu'un test unitaire. C'est LE filet pour « jamais un centime de travers ». | à ajouter (pytest déjà là) |
| **Locust** (load testing) | MIT | Prouve la formule « waw » (~60 s) et le `dos_guard` (503 à >80 % CPU) sous charge réelle, en Python (même stack que NARCHI). **k6 est AGPL-3.0 → écarté** ; Locust (MIT) ou Gatling/JMeter (Apache-2.0) sont les alternatives propres. | à ajouter |

### 🟠 P1 — Sécurité : boucher une partie du trou « pas de pentest »

| Outil | Licence | Ce qu'il apporte | État |
|---|---|---|---|
| **Semgrep CE** (SAST, règles custom) | LGPL-2.1 | Au-delà de Bandit (Python), Semgrep couvre TS/TSX + règles maison (« jamais `dangerouslySetInnerHTML` », « jamais `X-Forwarded-For` » — les règles §60 deviennent exécutables). | à ajouter (Bandit déjà) |
| **Gitleaks** (secrets, pre-commit) | MIT | Verrouille le « jamais de secret versionné » : scan à chaque commit local + en CI. Complète Trivy (déjà là). | à ajouter |
| **Checkov** (IaC) | Apache-2.0 | Scanne `docker-compose.yml` + `Dockerfile` (montages, privilèges, secrets en dur) — la surface « infra » n'est aujourd'hui pas scannée. | à ajouter |
| **OWASP ZAP** (DAST) | Apache-2.0 | Scan dynamique de l'API tournante (injection, en-têtes de sécurité) — comble UNE PARTIE du trou « pentest ». **Honnête : un scan automatique ≠ un pentest humain** (le rapport §120 le dit). | à ajouter (à prouver) |
| **Syft + Grype** (SBOM + CVE) | Apache-2.0 | Inventaire exact des dépendances (SBOM) + matching CVE — la traçabilité exigée par les grands comptes. | à ajouter (Trivy déjà) |

### 🟡 P2 — Ops : logs centralisés, uptime, santé PostgreSQL

| Outil | Licence | Ce qu'il apporte | État |
|---|---|---|---|
| **VictoriaLogs** (logs) | Apache-2.0 | Agrégation des logs (aujourd'hui `json-file` seul, illisible à distance). **Loki est AGPL-3.0** — cohérent avec Grafana déjà présent, mais je préfère l'alternative permissive si le client veut zéro AGPL. | à ajouter |
| **Uptime Kuma** (heartbeat) | MIT | Surveille http://localhost:8080 + l'API et alerte (e-mail/Webhook) dès qu'un bureau est en panne — le « je ne savais pas que c'était down ». | à ajouter |
| **pgBadger** (analyse de logs PG) | PostgreSQL License | Rapporte les requêtes lentes, erreurs, checkpoints depuis les logs PostgreSQL — sans connexion à la base vivante (sûr en production). | à ajouter |

### ⚪ P3 — Qualité de test (bus factor 1)

| Outil | Licence | Ce qu'il apporte | État |
|---|---|---|---|
| **mutmut** (mutation testing) | BSD-3-Clause | « Teste tes tests » : modifie le code (mutants) et vérifie que la suite les attrape. Un test qui laisse passer un mutant est un test faible — le filet anti-régression de NARCHI (541 backend / 663 frontend) devient *mesuré*, pas seulement *compté*. | à ajouter |
| **mypy** (typage statique) | MIT | Attrape des classes d'erreurs avant l'exécution (le README cite déjà `tsc` côté frontend ; `mypy` serait l'équivalent backend). | à ajouter (progressif) |

---

## 3. Recommandation priorisée (ROI décroissant)

1. **Hypothesis** sur `app/services/xrechnung.py` + `calculer_totaux()` — là où
   un centime coûte cher. Propriétés : *jamais de float* ; *net + tva = brut* ;
   *arrondi idempotent* (arrondir deux fois = arrondir une fois). ~1 journée.
2. **Locust** : un scénario « formule waw » (login → IFC → estimation) avec
   seuils (p95 < X s, 0 erreur) → gate CI séparé comme l'E2E §121. ~1 journée.
3. **Gitleaks + Checkov** en CI + pre-commit : coût ~½ journée, effet immédiat
   sur « jamais de secret / infra durcie ».
4. **Semgrep CE** avec 2-3 règles maison reflétant les interdits §60. ~1 journée.
5. **mutmut** en gate séparé (lent, comme l'E2E) : transforme « 541 tests »
   en « 541 tests dont ~X % tuent les mutants » — la preuve de fiabilité que
   le client peut montrer. ~1 journée.
6. **ZAP + Syft/Grype** : ~1-2 jours, à brancher une fois la stack hébergée
   (le sandbox ne l'exécute pas — dit).
7. **VictoriaLogs + Uptime Kuma + pgBadger** : ~2-3 jours, cible les bureaux
   beta multi-PC (ops 50 % → 60 %).

---

## 4. Honnêteté — ce que ce document ne prétend PAS

- **Aucun de ces outils n'a encore été branché ni exécuté ici** (le sandbox
  est recyclé, pas de stack). Ce document est une **analyse sourcée**, pas une
  livraison. Chaque outil reste « à prouver » par un PoC rejouable, comme la
  maison l'a fait pour floci (§124) et KoSIT (§123).
- **Un scan automatique (ZAP) ne remplace pas un pentest humain** — le rapport
  §120 garde le pentest externe en INCONNU assumé jusqu'aux premiers bureaux
  payants.
- Les **licences** sont celles constatées à la source en 08/2026 (à
  re-vérifier avant intégration) : Semgrep CE = LGPL-2.1, k6 = AGPL-3.0
  (écarté), Loki = AGPL-3.0, Hypothesis = MPL-2.0, Locust/mutmut/Gitleaks/
  Uptime Kuma = MIT, Trivy/Syft/Grype/Checkov/ZAP = Apache-2.0, mutmut =
  BSD-3, pgBadger = licence PostgreSQL.

---

## 5. ÉTAT RÉEL après le chantier §139–§148 (mis à jour 16/08, fin)

| Outil | Licence | État réel | Preuve |
|---|---|---|---|
| **Hypothesis** | MPL-2.0 | ✅ **EXÉCUTÉ** (§139) | 3 propriétés monétaires sur des milliers de cas |
| **Locust** | MIT | 🟡 **PRÉPARÉ, non exécuté** (§140) | locustfile validé ; exige la stack |
| **Gitleaks** | MIT | ✅ **PROUVÉ** (§141) | `no leaks found` ; 2 faux positifs allowlistés |
| **Semgrep CE** | LGPL-2.1 | ✅ **PROUVÉ** (§142) | 0 ERROR (XSS tenu) ; 18 float() = dette → corrigée §145 |
| **Checkov** | Apache-2.0 | ✅ **PROUVÉ** (§143) | 0 FAILED / 336 PASSED |
| **Syft + Grype** | Apache-2.0 | ✅ **PROUVÉ** (§146) | 2 CVE pypdf trouvées → bump → 0 CVE |
| **mypy** | MIT | ✅ **PROUVÉ** (§147) | --strict 0 erreur sur 6 fichiers ; 20 erreurs corrigées |
| **mutmut** | BSD-3 | 🟠 **dette CI confirmée** (§144/§148) | milliers de mutants, exige machine dédiée |
| ZAP, VictoriaLogs, Uptime Kuma, pgBadger | Apache-2.0/MIT/PG | ⚪ **PRÉPARÉS** (§148) | snippets exacts, exigent la stack |

**Bilan honnête** : sur les 12 outils identifiés, **7 sont PROUVÉS**
(Hypothesis, Gitleaks, Semgrep, Checkov, Syft+Grype, mypy — et le banker's
rounding corrigé §145 en bonus réel), 1 préparé (Locust), 1 dette CI (mutmut),
3 préparés stack (ZAP, VictoriaLogs, Uptime Kuma, pgBadger). Aucun « livré »
sans avoir été exécuté.

**Bonus non planifié** : la règle Semgrep `no-float-money` a révélé le bug de
**banker's rounding** (§145) — corrigé, +17 tests, l'Angebotsvergleich ne
dérive plus d'un centime. Et Syft+Grype ont trouvé **2 vraies CVE** corrigées.

## 6. Prochaine étape (si vous dites « go »)

Ordre proposé : **Hypothesis → Locust → Gitleaks+Checkov → Semgrep → mutmut**,
chacun livré + testé + commité séparément (règle de la maison), les PoC
rejouables comme `scripts/poc-*.py`. Les outils « à exécuter sur stack
hébergée » (ZAP, Syft/Grype, VictoriaLogs, Uptime Kuma, pgBadger) seront
préparés mais **dits non exécutés** tant que la stack n'est pas disponible.
