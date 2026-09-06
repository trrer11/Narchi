# Guide — Tester NARCHI en conditions réelles (E2E, outils, téléphone)

> Écrit le 21/08/2026. Ce guide te prend par la main pour les 3 choses
> qu'on ne peut PAS prouver dans le sandbox : la suite E2E navigateur, les
> outils de la « stack hébergée », et l'essai téléphone (photo de Mangel
> prise sur le chantier, visible par les autres).

---

## Partie 1 — La suite E2E Playwright (5 volets)

C'est LA preuve que le logiciel marche de bout en bout dans un vrai
navigateur contre le vrai serveur. Tout est déjà écrit (`frontend/e2e/`).

### ⭐ Méthode recommandée : 100 % Docker, RIEN installé sur le PC

Tu ne veux installer **rien** sur ta machine ? Parfait : on fait tourner la
suite dans un **conteneur Docker jetable** (image officielle Playwright =
Node + Chromium déjà inclus). Sur le PC il ne reste rien — le code vient du
dossier du projet, les dépendances vont dans un **volume Docker** nommé.

**3 gestes :**

1. Double-clic sur **`1_DEMARRER_NARCHI.bat`** → attends la page de connexion
   sur http://localhost:8080.

2. Double-clic sur **`scripts\TEST_E2E_DOCKER.bat`**.

3. Regarde les 5 volets défiler (1er lancement : image + dépendances
   téléchargées, 2–4 min ; ensuite c'est rapide car le volume est réutilisé).
   **La fenêtre reste ouverte à la fin** (ne se ferme pas toute seule) et
   affiche un verdict : « SUCCES » ou « ECHEC » + un code.

### Comment lire le résultat (ce que tu dois voir)

À la fin, la fenêtre affiche **un verdict clair** :

- **SUCCES** = tu vois `5 passed` (5 lignes vertes) → tout va bien.
- **ECHEC** = tu vois `1 failed` (une ligne rouge) → copie la ligne rouge et
  le message d'erreur juste dessous, et envoie-les-moi.

La fenêtre attend que tu appuies sur une touche avant de se fermer (c'est
fait exprès pour que tu aies le temps de lire).

**Tout nettoyer ensuite (rien ne reste sur le PC) :**
```powershell
docker volume rm narchi-e2e-node_modules
docker rmi mcr.microsoft.com/playwright:v1.61.1-jammy
```

> Si tu es sous Linux (pas Docker Desktop) et que `host.docker.internal`
> ne répond pas, ajoute `--add-host=host.docker.internal:host-gateway` à la
> commande docker du script.

### Méthode alternative (seulement si tu acceptes Node sur le PC)

```powershell
# 1) Une seule fois : installer le navigateur de test
cd frontend
npx playwright install chromium
# 2) Lancer la suite (stack démarrée)
npm run e2e
```

### Ce que tu dois voir
Les 5 volets défilent, tous en vert :

| # | Ce que ça prouve |
|---|---|
| 1 | Création de compte, mauvais mot de passe refusé, bon mot de passe = cockpit |
| 2 | Un projet créé est **visible sur un 2e appareil** sans rien ressaisir |
| 3 | Un **Mangel avec photo** saisi → visible ailleurs, photo réellement décodée |
| 4 | Mode hors-ligne honnête : badge « Offline — N warten », rattrapage au retour |
| 5 | Vrai fichier IFC parsé → murs, DIN 276, m³, €, CO₂ remplis |

### Si ça échoue
- **La stack n'est pas démarrée** → la suite REFUSE de tourner et le dit
  (c'est voulu : un faux résultat ne sert à personne). Relance l'étape 1.
- **Test 5 lent au premier run** (~90 s) : c'est le parsing WASM à froid,
  dit dans le README e2e. Ne panique pas.
- **Zéro retry** : si un test est rouge, c'est un vrai bug à me remonter
  (avec le message d'erreur exact).

---

## Partie 2 — Les outils de la « stack hébergée » (TOUS en Docker)

Ce sont 4 outils **déjà 100 % Docker** (aucune installation sur le PC, que des
conteneurs jetables). Les commandes exactes sont dans
`docs/OUTILS_STACK_HEBERGEE.md`. Voici chacun : à quoi il sert + comment le
lancer.

### 2.1 OWASP ZAP — « est-ce que mon produit est sécurisé ? »
Scanner de sécurité qui attaque ton API tournante comme un hacker (injection,
XSS, mauvais réglages) et produit un rapport.
```powershell
docker run --rm -v "${PWD}/zap-reports:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://localhost:8080 -r zap-baseline.html
```
→ Rapport dans `zap-reports/zap-baseline.html`. **Verdict : exit 1 si des
alertes HIGH/CRITICAL → à corriger avant la beta.** (~10 min.)

### 2.2 VictoriaLogs — « je ne trouve plus mes logs »
Rassemble les logs de tous les conteneurs au même endroit, pour chercher
« qu'est-ce qui a planté à 14h ? ». Ajouter le bloc §2 du fichier
`docs/OUTILS_STACK_HEBERGEE.md` au `docker-compose.yml`, puis :
```powershell
docker compose up -d victorialogs
```

### 2.3 Uptime Kuma — « je ne savais pas que c'était down »
Moniteur qui surveille NARCHI en permanence et alerte (e-mail) si ça tombe.
Ajouter le bloc §3, puis :
```powershell
docker compose up -d uptime-kuma
```
→ Ouvre `http://localhost:3001` → ajoute un moniteur sur
`http://localhost:8080/health` → alerte configurée. (10 min, zéro code.)

### 2.4 pgBadger — « pourquoi ma base est lente ? »
Analyse les logs PostgreSQL pour trouver les requêtes lentes, SANS toucher la
base vivante.
```powershell
docker compose exec -T db bash -c "pgbadger /var/log/postgresql/postgresql-*.log -o /sauvegardes/pgbadger-report.html"
```
→ Rapport dans `sauvegardes/pgbadger-report.html`.

> ⚠️ **Honnête** : ZAP, VictoriaLogs et Uptime Kuma sont PRÊTS à lancer.
> **pgBadger** exige d'abord un réglage de config PostgreSQL
> (`log_min_duration_statement`) pas encore fait (noté dans le fichier source).
> Ce sont des outils d'EXPLOITATION (beta/ops), pas des tests du produit.

---

## Partie 3 — Le téléphone : photo de Mangel sur le chantier

C'est EXACTEMENT ta question : « je prends une photo d'un défaut sur le
chantier, les autres la voient ». Le logiciel le fait déjà (le volet E2E
n°3 le prouve en simulateur) — mais **ton téléphone physique** exige une
petite config unique, parce qu'un téléphone refuse la caméra/la géoloc sur
une page **http** (sans cadenas). C'est documenté dans `docs/HTTPS_LOCAL.md`.

### Pourquoi c'est nécessaire (en une phrase)
`http://localhost:8080` marche sur le PC, mais ton téléphone sur le chantier
utilise `http://192.168.x.x:8080` → le navigateur du téléphone **bloque la
caméra** sans HTTPS. Il faut un cadenas local (mkcert), ~10 min la première
fois.

### Les 3 gestes (résumé fidèle de `docs/HTTPS_LOCAL.md`)

**Geste 1 — sur le PC** (une fois, ~5 min) :
```powershell
# 1. installe mkcert (via winget ou le site officiel)
# 2. fabrique un certificat pour localhost ET l'IP de ton PC
# 3. double-clic sur :
8_ACTIVER_HTTPS_LOCAL.bat
```
NARCHI devient alors accessible en `https://…:8443` (le 8080 reste actif).

**Geste 2 — sur le téléphone** (une fois par téléphone) :
Installe le certificat « racine » de mkcert sur le téléphone et active la
confiance complète (détail exact dans `docs/HTTPS_LOCAL.md`, §2 geste 2).

**Geste 3 — ouvrir sur le téléphone** :
Même Wi-Fi que le PC, puis dans le navigateur du téléphone :
```
https://ADRESSE-IP-DU-PC:8443   (ex. https://192.168.1.20:8443)
```

### Le test à faire
1. Sur le **téléphone**, ouvre Narchi → onglet **Baustelle** (chantier) →
   crée un Mangel (défaut) → **prends une photo** (la caméra s'ouvre).
2. Sur le **PC** (ou un 2e téléphone), même compte → le Mangel **et sa
   photo** apparaissent. C'est le même chemin serveur que le volet E2E n°3.

### Limites DITES (pas d'esbroufe)
- **L'IP du PC peut changer** (box en attribution auto) → relance
  `8_ACTIVER_HTTPS_LOCAL.bat` (c'est fait pour), ou fixe l'IP de la box.
- **iOS (Safari) ≠ Chromium** : l'essai téléphone reste l'exercice à faire
  une fois chez toi — la suite E2E (Chromium) prouve le logiciel, l'essai
  téléphone prouve **ton matériel**.

---

## Ordre conseillé (pour ne pas perdre de temps)

1. **D'abord** la Partie 1 (E2E) — c'est le plus rapide (~35 min tout compris)
   et ça prouve que tout le cœur marche.
2. **Ensuite** la Partie 3 (téléphone) — 30 min, c'est ta question directe.
3. **En dernier** la Partie 2 (ZAP/VictoriaLogs/Kuma/pgBadger) — c'est de
   l'infra de beta, utile avant de confier le produit à un 3e bureau.

**Si un test échoue** : note le message d'erreur EXACT (le nom du test, la
ligne rouge) et reviens vers moi — je le corrige.
