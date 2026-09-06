# Tutoriel 7 — Les fonctions qui rendent NARCHI addictif (v2.6.0)

Cette session a ajouté **4 modules majeurs** qui transforment NARCHI d'un outil de calcul en un **assistant intelligent qui captive l'architecte**.

## 1. 📊 Live Market Snapshot (Mai 2026)

NARCHI montre **en temps réel l'état du marché allemand** :

```bash
python -m narchi.cli market
```

Sortie :
```
📊 NARCHI · LIVE MARKT-SNAPSHOT · Stand : Mai 2026

📈 Baupreisindex Wohngebäude Q1/2026 : 137.0 Punkte
   YoY +3.3%   QoQ +1.5%

🔥 TOP KOSTENTREIBER :
   ↑ nadelschnittholz_kvh    +8.3% (stark steigend) — Rohholz-Mangel
       betrifft KG : 361, 351, 335
   ↑ tischlerarbeiten        +7.5% (stark steigend)
       betrifft KG : 344, 352
   ...

❄️  TOP KOSTENDRÜCKER :
   ↓ bitumen                -14.7% (Ölpreis-Entwicklung)
   ↓ stahl_gewalzt           -4.7%
```

**Pourquoi c'est addictif** : l'architecte sait à chaque ouverture si "son" KG est dans une phase de hausse ou de baisse. Il peut **timer ses achats matériaux** ou **alerter le Bauherr** si le marché bouge fort.

Sources : Destatis Q1/2026 (publié avril 2026) + Materialpreise mai 2026.

## 2. 🏆 Benchmark avec 30 projets réels

NARCHI compare ton projet à une base de 30 projets anonymisés (EFH, MFH, Büro, Schule, etc.) construits en 2024-2025 :

```bash
python -m narchi.cli benchmark \
    -g wohngebaeude_efh --bgf 165 -b BY -s mittel \
    --bauwerkskosten 380000
```

Sortie :
```
📊 NARCHI · BENCHMARK-VERGLEICH MIT 30 REFERENZPROJEKTEN 2024-2025

📌 Dein Projekt : wohngebaeude_efh · 165 m² BGF · BY · mittel
   Aktuell : 2.303 €/m² BGF

📈 Verglichen mit 8 ähnlichen realen Projekten :
   Median : 1.992 €/m²    P10 : 1.417 €/m²    P90 : 2.186 €/m²
   Dein Projekt liegt im 100. Perzentil

🎯 🔴 PREMIUM/TEUER : Dein Projekt ist teurer als 80% der Vergleichsprojekte

TOP-5 ähnlichste Referenzprojekte :
   • [REF001] EFH 165m² BY mittel 2024 → 2170 €/m² (-5.8%)
   • [REF004] EFH 220m² HE mittel 2025 → 1764 €/m² (-23.4%)
     "Brettstapeldecken, Lüftungsanlage mit WRG"

💡 INSIGHTS :
   💡 Günstigere Projekte verwenden oft : 'Massivbau KS'
   🌍 Durchschnittlicher CO₂-Wert : 7.4 kg CO₂eq/m²·Jahr
   ⚡ Häufigstes Effizienzhaus-Niveau : EH 55

🏆 BEST-IN-CLASS :
   ⭐ [REF003] Fertighaus Holz (ST) → 4.1 kg CO₂eq/m²·a
```

**Pourquoi c'est addictif** : l'architecte voit **où il se positionne dans le marché**, identifie les **stratégies des projets gagnants**, et reçoit des **recommandations concrètes**.

## 3. 💼 HOAI Honorar-Rechner

Calcule immédiatement le honorarie HOAI 2021 § 35 (Gebäude) :

```bash
python -m narchi.cli honorar \
    --bauwerkskosten 350000 \
    --hz III --satz mittel --vergleich
```

Sortie :
```
💼 NARCHI · HOAI HONORAR-RECHNER

Anrechenbare Kosten netto (KG 300+400) :    350.000,00 €
Honorarzone : III    Honorarsatz : mittel

Grundhonorar Tafelwert HZ III Basis    :    43.594,25 €
× HZ-Faktor (1.00)                    :    43.594,25 €
× Honorarsatz-Faktor (1.00)           :    43.594,25 €

Verteilung auf Leistungsphasen :
   LP1   (  2%) :       871,88 €
   LP2   (  7%) :     3.051,60 €
   LP3   ( 15%) :     6.539,14 €
   LP5   ( 25%) :    10.898,56 €
   LP8   ( 32%) :    13.950,16 €

HONORAR BRUTTO                         :    54.471,02 €

Vergleich Basis / Mittel / Oben :
   basis  :  39.235 € netto  →  49.024 € brutto
   mittel :  43.594 € netto  →  54.471 € brutto
   oben   :  47.954 € netto  →  59.918 € brutto
   → Verhandlungsspielraum :  10.894 €
```

**Pourquoi c'est addictif** : 
- l'architecte sait **immédiatement combien il va gagner**
- il a **les arguments chiffrés** pour négocier le honorarsatz oben vs mittel vs basis
- il peut **discuter chaque LP** séparément avec le Bauherr

## 4. 🏆 Optimization Score (le killer feature)

NARCHI donne un **score 0-100 sur 6 dimensions**, façon "credit score" pour le projet :

```bash
# Inclus automatiquement dans `narchi ifc` (toutes les commandes principales)
python -m narchi.cli ifc mon_projet.ifc -g wohngebaeude_mfh -b BY
```

Sortie (extrait) :
```
🏆 NARCHI · PROJEKT-OPTIMIERUNGS-SCORE

GESAMT-SCORE : 64/100   [C]   Durchschnitt
██████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░

Detail nach 6 Dimensionen :

💰 KOSTEN-EFFIZIENZ     100.0  [A+]  ██████████████████████████████
    Dein Projekt liegt im 0. Perzentil (1671 €/m² vs 3062 €/m² Marktdurchschnitt)

⚡ ENERGIE-EFFIZIENZ     30.0  [F ]  █████████░░░░░░░░░░░░░░░░░░░░░
    Konformität 0%, 100% Daten fehlen

🌍 CO₂-PERFORMANCE       95.0  [A+]  ████████████████████████████░░
    3.88 kg CO₂/m²·a — DGNB Top 10%

💸 FÖRDER-AUSSCHÖPFUNG   35.0  [F ]  ██████████░░░░░░░░░░░░░░░░░░░░
    Geringes Förderpotenzial

🔧 MODELL-QUALITÄT       75.0  [B ]  ██████████████████████░░░░░░░░
    IDS-Score 75%

⚠️  RISIKO-PROFIL         49.0  [F ]  ██████████████░░░░░░░░░░░░░░░░
    Breites Konfidenz-Intervall

🎯 TOP-5 EMPFOHLENE AKTIONEN :
   1. [energie_effizienz] Pset_WallCommon.ThermalTransmittance pflegen
   2. [energie_effizienz] U-Werte für alle Bauteile angeben
   3. [risiko_profil] Detaillierung der TGA-Planung kann Konfidenz erhöhen
   ...

💡 Geschätztes Einsparpotenzial : 23.500 €
```

**Pourquoi c'est ULTRA addictif** :

C'est de la **gamification** au sens noble. Chaque mise à jour du modèle BIM → l'architecte relance NARCHI → voit son score **monter ou descendre**.

C'est exactement comme :
- Un sportif qui regarde son **Apple Watch** après chaque course
- Un trader qui regarde son **portefeuille**
- Un dev qui regarde son **code coverage**

→ **L'architecte va vouloir AMÉLIORER ce score**. Chaque action recommandée par NARCHI a une **valeur €** estimée. Il sait que +10 points de score = ~5% d'économies sur le Bauwerk.

## 5. 🚨 KG-Alerting

```bash
python -m narchi.cli alert 361   # Dächer
```

Sortie :
```
📊 Marktlage KG 361 — Mai 2026

   ↑ nadelschnittholz_kvh         +8.3% (stark steigend)
   ↑ dachdeckungsarbeiten         +7.3% (stark steigend)
   ↑ konstruktionsvollholz_kvh    +8.3% (stark steigend)
   ↑ brettschichtholz_bsh         +6.5% (steigend)
```

**Pourquoi c'est addictif** : avant de commander, l'architecte vérifie si "son" KG est dans une phase chaude → peut **décaler la commande** ou **bloquer le prix** maintenant.

## Le résultat : un workflow quotidien

Un architecte va utiliser NARCHI **plusieurs fois par jour** :

1. **Matin** : `narchi market` → check si le marché a bougé
2. **Avant un Bauherr-Termin** : `narchi ifc projet.ifc ...` → rapport complet avec score
3. **Pour négocier honorar** : `narchi honorar --bauwerkskosten X --vergleich`
4. **Avant un appel d'offres** : `narchi benchmark` → compare avec marché
5. **Quand un prix monte** : `narchi alert KG342` → décide si commande maintenant ou plus tard

→ **NARCHI devient une habitude quotidienne**, comme regarder son agenda ou ses mails.

## Combiné dans le plugin Revit

Toutes ces fonctionnalités sont disponibles **dans le plugin Revit** via :
- Le rapport HTML qui s'ouvre automatiquement après le calcul
- Le bouton "Kostenermittlung" déclenche TOUT (calcul + benchmark + score + honorar + market)
- Le bouton "Excel" exporte un rapport 6-feuilles avec ces sections

**Total : ~30 secondes pour avoir une analyse professionnelle complète, vs plusieurs heures manuelles.**

---

→ Suite : [Tutoriel 8 — API Python pour intégrer dans son propre outil](08_python_api_examples.md) (à venir)
