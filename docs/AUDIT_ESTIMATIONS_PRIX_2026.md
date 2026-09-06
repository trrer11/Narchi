# Audit crédibilité des estimations de prix — NARCHI (06.08.2026)

**Question posée** : les estimations sont-elles réelles, et datées 2026 ?
**Méthode** : lecture des données réellement embarquées dans le repo + confrontation aux
publications officielles (Destatis, BKI). Aucun chiffre de ce document n'est estimé
sans provenance indiquée.

---

## 1. Ce qui est RÉEL et vérifiable ✅

| Élément | État | Preuve |
|---|---|---|
| Structure **DIN 276** (KG 100–700) et **USt 19 %** (§ 12 UStG) | Officiel, stable | `costEngine.ts`, migration (défaut USt 19 % natif) |
| **HOAI 2021** (tafels, interpolation log-linéaire) | Version en vigueur en 2026 ; note EuGH honnête (Mindestsätze entfallen) déjà affichée | `data/hoai.ts` (Stand 2026) |
| **Indices ÖKOBAUDAT 2024** (A1-A3) + retraitement §38 bandes min-max | Réel, daté 2024, dernière série stable largement diffusée | `data/precisionData.ts`, `materialMatch.ts` |
| Seed backend prix : **48 références × 18 zones = 864 lignes**, validité 01/2026 | Réel, daté 2026, **honnêtement étiqueté `narchi_referenz_2026`** (« ordres de grandeur marché, remplaçables par bibliothèques tenant ») | `german_price_seed.py`, migration `20260805_02` |
| Mécanisme de **synchronisation officielle Destatis (GENESIS REST)** | Existe dans le code (`price_revision.py`) — mais inactif | `app/core/estimation/price_revision.py` |
| Benchmark MFH 2 750 €/m² NGF (KG300+400, Standard, base 2024) → ×1,063 ≈ **2 920 €/m² NGF en 2026** | **Dans le couloir réel du marché** : BKI/StatBA 2024 → MFH ≈ 3 717 €/m² Mietfläche à Hambourg (marché +5-7 % vs moyenne DE), tendance 2025 ≈ 3 900-4 000 | seed interne vs [BKI via Stadtblick, janv. 2026] |
| Commentaire « +3,2 % Mai 2025 vs Mai 2024 (StatBA) » dans `countries.ts` | **EXACT** — c'est le chiffre officiel publié | Destatis via presse spécialisée (juillet 2025) |
| Repères Backend « Destatis » (Destatis-API réelle utilisable) | Mécanisme réel | `price_revision.py` |

## 2. Ce qui est PARTIELLEMENT crédible ⚠️

| Élément | Problème mesuré |
|---|---|
| **`COST_INDEX` frontend (`countries.ts`)** : 2024=142, 2025=147, 2026=151, base déclarée 2020=100 | Série **interne**, pas la série officielle. Officiel Destatis **base 2021=100 (inkl. USt)** : 2024 ≈ 129,8 (moyenne), 2025 ≈ 133,9 ; **2026 : Q1 = 137,0 · Q2 = 140,3 (Stand 10.07.2026)**. Effet réel : le facteur année 2024→2026 NARCHI = +6,3 % vs officiel ≈ **+8,1 %** → estimations 2026 légèrement *basses* (~2 points). La mention « 2026 = BBSR Prognose +~1 % » est **dépassée** (officiel +4,8 % vs moyenne 2025) |
| **`precisionData.ts`** : 2024=142, **2025=150** | **Deuxième série interne différente** de la première (147 ≠ 150) — deux sources pour le même fait |
| **Indices seed backend** (`q1_2024=120 … q1_2026_est=128`) | **Troisième série** (2020-base ≈ 120-128) incohérente avec les deux autres et loin de l'officielle |
| Convention **€/m² NGF vs BGF vs Mietfläche** | BKI publie par BGF/BRI/NF/Mietfläche ; NARCHI affiche NGF (÷0,82 ⇔ ±20 % d'écart de présentation). Pas un « faux chiffre », mais une **convention à expliciter**, sinon comparaisons faussées avec les chiffres BKI du bureau |

## 3. Ce qui est FAUX / dangereux 🔴 (à corriger)

| Élément | Verdict |
|---|---|
| **`config.py` : `DESTATIS_INDEX_Q2_2026 = 169.7`** | **Ceci n'est AUCUN chiffre officiel « Q2 2026 ».** Le vrai Q2/2026 = **140,3 (base 2021=100)** publié le 10.07.2026. Un « 169,7 » correspond à l'échelle abandonnée base 2015≈100 d'avant 2023 — pas à 2026. Variable **inutilisée** par le moteur réel, ne vit que dans le mock ci-dessous |
| **`/api/markt/forecast`** (compat_router) | Renvoie **en dur** `{index: 169.7, forecast: 174.2}` — chiffres inventés exposés comme « marché » |
| **`/api/precision/data/search`** | 2 items codés en dur (145 €/m² · 850 €) présentés comme « recherche de prix » |
| **`/api/foerderung/match`** | Montants KfW/BAFA codés en dur (150 000 € / 45 000 €) — **dangereux juridiquement** |
| **`/api/copilot/ask`** | Réponses inventées sur endpoint « copilot » |
| État front : les 4 fonctions `apiClient` correspondantes n'ont **aucun appelant** dans les pages | Code mort côté front, endpoints vivants côté backend → suppression propre possible |

## 4. Verdict global

1. **L'ossature est réelle et professionnelle** : DIN 276, HOAI 2021, USt, ÖKOBAUDAT 2024, régions BKI-calibrées, seed 2026 honnêtement étiquetée, moteur d'incertitude (fourchette −14 %…+14 % affichée).
2. **Les benchmarks typologies sont dans le couloir réel** du marché allemand 2026 (légèrement *conservateurs*).
3. **Mais il y a 3 séries d'indices incohérentes** et **5 endpoints mock codés en dur** dont une valeur « 169,7 » qui **n'est pas un chiffre 2026 officiel**. Tant que le frontend n'appelle pas ces fonctions, aucun écran ne montre du faux — mais le risque d'y brancher quelque chose existe, et c'est contraire à la charte.

**Priorité correctrice (proposée §49)** : une SEULE source d'indices = **Destatis base 2021=100, Stand visible dans l'app** ; activation de la synchro GENESIS existante ; suppression des mocks compat ; badge « Richtwert, Stand Q2/2026 » sur la page Estimation ; note de convention NGF/BGF.

---

## 5. Officialité des données de référence (consultées le 06.08.2026)

- **Baupreisindex Wohngebäude, base 2021=100 (inkl. USt), Destatis bpr110, Stand 10.07.2026** : 2024 Q1..Q4 = 128,5 / 129,4 / 130,3 / 130,8 · 2025 = 132,6 / 133,6 / 134,3 / 135,0 · **2026 Q1 = 137,0 · Q2 = 140,3** (Bürogebäude Q2/2026 = 142,7, Betriebsgebäude = 141,4). La publication Q2 a lieu début juillet → à date du 06.08.2026 c'est bien la série à jour.
- **BKI (Stadtblick/BKI Baukosten, janv. 2026)** : MFH Hambourg KG300+400 ≈ 3 717 €/m² Mietfläche (2024), projection 2025 ≈ 3 900-4 000 — à lire avec les conventions de surface.
- **HOAI** : version en vigueur = 2021 ; note EuGH (suppression des minima/maxima contraignants) exacte dans `hoai.ts`.
