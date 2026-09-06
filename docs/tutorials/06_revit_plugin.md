# Tutoriel 6 : Plugin Revit — NARCHI dans le ribbon

NARCHI dispose maintenant d'un **plugin natif Revit** via pyRevit. Au lieu d'exporter en IFC puis d'utiliser la CLI, vous travaillez directement dans Revit.

## Pré-requis

- **Revit 2021 – 2026** (5 versions couvertes)
- **pyRevit 4.8+** installé ([github.com/eirannejad/pyRevit/releases](https://github.com/eirannejad/pyRevit/releases))
- **NARCHI** installé via `pip install narchi`

## Installation pas-à-pas (5 minutes)

### 1. Installer pyRevit
1. Téléchargez le dernier installer pyRevit
2. Lancez l'installer en mode Admin
3. Cochez vos versions Revit (2024, 2025, 2026 — typique)
4. Démarrez Revit → vous voyez maintenant un onglet **pyRevit** dans le ribbon

### 2. Installer NARCHI
```powershell
# PowerShell
pip install narchi
# OU bien clone du repo + pip install -e .
```

### 3. Ajouter l'extension NARCHI
```powershell
# Méthode 1 : pyRevit CLI (depuis n'importe où)
pyrevit extend ui NARCHI https://github.com/narchi-projekt/narchi.git
```

OU manuellement :
- Copiez le dossier `revit_plugin/NARCHI.extension/` du repo
- Vers `%APPDATA%\pyRevit\Extensions\NARCHI.extension\`
- Dans Revit : tab pyRevit → bouton "Reload"

### 4. Vérification
Un nouvel onglet **"NARCHI"** apparaît dans le ribbon avec 8 boutons répartis en 3 panels.

## Workflow type d'un bureau

### Étape 1 — Ouvrir le projet
Ouvrez votre `MFH_Berlin_Pankow.rvt` dans Revit.

### Étape 2 — Valider le modèle (30 secondes)
Cliquez sur **"Modell validieren"**.

Le plugin scanne tous les Bauteile et vous donne un score 0–100 % + une liste de problèmes :
- ✅ Anzahl Bauteile : 1247
- ✅ Geometriedaten : 89 %
- ⚠️ U-Werte (für GEG-Check) : Non → suggestion d'ajouter le param "Heat Transfer Coefficient"
- ℹ️ IfcSpace (für NUF) : 28 Räume

Vous savez tout de suite **si votre modèle est prêt** pour une Kostenermittlung sérieuse.

### Étape 3 — Kostenermittlung (3 secondes)
Cliquez sur **"Kostenermittlung"**.

Wizard en 6 étapes :
1. Nom du projet (proposé depuis ProjectInfo Revit)
2. Gebäudeart (12 types)
3. Standard (einfach/mittel/hoch)
4. Bundesland
5. Großstadt (optionnel)
6. Mode (hybrid par défaut)

→ Berechnung läuft (3-5 secondes).

→ WPF-Fenster mit allen Ergebnissen :
- Bauwerkskosten KG 300+400 : 5.266.873 €
- Summe brutto : 8.564.959 €
- 80%-Konfidenz : 5.349.812 € – 9.685.103 €
- CO₂-Bilanz : 452 t CO₂eq → DGNB Top-10%
- GEG-Konformität : 87 %
- Förderpotenzial : 187 500 €

### Étape 4 — Export pour Bauherr
Cliquez sur **"Excel Bericht"** → choisissez le dossier → HTML s'ouvre automatiquement dans le navigateur.

### Étape 5 — Export pour AVA (RIB iTWO etc.)
Cliquez sur **"GAEB X83 für AVA"** → un fichier `.x83` est créé, à importer dans votre logiciel AVA.

### Étape 6 — Audit pour HOAI § 6
Cliquez sur **"JSON Audit-Trail"** → fichier JSON avec hash SHA-256.

À joindre à la facturation HOAI pour démontrer la traçabilité du calcul.

### Étape 7 — Bidirectional (super-bonus)
Cliquez sur **"DIN276 Codes in Modell"** → tous vos Bauteile reçoivent leur code DIN 276 directement en paramètre Revit.

Maintenant vous pouvez filtrer dans le projet-browser : **« alle Elemente mit DIN276 = 331 »** = toutes les tragenden Außenwände, visible directement dans le modèle 3D.

## Avantages vs CLI

| Aspect | NARCHI CLI | NARCHI Plugin Revit |
|---|---|---|
| **Workflow** | Export IFC → ouvrir terminal → commande → ouvrir Excel | Un clic dans le ribbon |
| **Données** | Limité à l'export IFC (perte de 10-20%) | 100 % des données Revit (incl. Custom Params) |
| **Temps** | ~30 sec (avec conversion) | ~3-5 sec (direct API) |
| **Bidirectionnel** | Non | **Oui** (écrit DIN276 dans le modèle) |
| **Live recalc** | Non | Oui (relancer le bouton après chaque modif) |

## Gestion des modifications projet (LP3 → LP6)

À chaque modification importante :
1. Cliquer **"Kostenermittlung"** → nouveau calcul
2. Cliquer **"JSON Audit-Trail"** → sauver version `MFH_2026-02-15.audit.json`
3. Plus tard, après modifications : **"Soll/Ist Vergleich"** charge l'ancien JSON et compare

→ Suivi des coûts continu, prêt pour audit HOAI.

## Tests sans Revit

Les modules du plugin sont **mock-testés** — ils fonctionnent même sur Linux/macOS :
```bash
PYTHONPATH=. python tests/test_revit_plugin.py
# → 14/14 tests ✅
```

Cela permet à un développeur d'améliorer le plugin sans installer Revit.

## Pour aller plus loin

- Voir `revit_plugin/README.md` pour la doc technique du plugin
- Voir `docs/api/API_REFERENCE.md` pour utiliser `narchi_revit` programmatiquement
- Le plugin Archicad (via Tapir) viendra dans NARCHI v2.5
