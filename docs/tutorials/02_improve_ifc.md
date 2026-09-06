# Tutoriel 2 : Améliorer son IFC pour NARCHI

NARCHI fonctionne sur n'importe quel IFC, mais sa précision dépend de la qualité du modèle. Voici comment optimiser votre export IFC depuis Revit, Archicad ou Allplan.

## Le diagnostic NARCHI

```bash
python -m narchi.cli validate mon_modele.ifc
```

Vous obtenez un score, par exemple :
```
  ✅ [ERROR  ] Anzahl Bauteile                    275 bauteile      → >= 10
  ⚠️ [WARNING] Anteil IfcBuildingElementProxy     45.2%             → < 30 %
  ✅ [ERROR  ] Geometriedaten (Area/Volume)       83.4% mit Geo     → >= 50 %
  ⚠️ [WARNING] Pset_WallCommon vorhanden           Nein             → Ja
  ✅ [WARNING] Geschosse erkannt                   2 Geschosse       → >= 1
  ℹ️ [INFO   ] Materialinformationen              12.3%             → >= 30 %
  ℹ️ [INFO   ] IfcSpace (für NUF)                 0 Räume           → >= 1
  ℹ️ [INFO   ] U-Werte (für GEG-Check)            Nein              → Ja
```

## Les 6 réglages essentiels par logiciel

### 🔵 Revit

#### Activer les BaseQuantities
1. `File → Export → IFC → Modify Setup…`
2. Property Sets → cocher **« Export base quantities »**
3. Sauvegarder la configuration

#### Pset_WallCommon.IsExternal
1. Toutes vos Wand-Typen : ajouter le paramètre Revit « IsExternal » (Yes/No)
2. Définir manuellement par mur ou par type
3. Lors de l'export IFC : cocher **« Export user defined property sets »**

#### Matériaux corrects
1. Pour chaque Wand-/Slab-Typ : assigner un Revit-Material avec le bon nom (`Beton C25/30`, `Stahlbeton`, `KVH`, etc.)
2. Cela permet à NARCHI de matcher avec ÖKOBAUDAT pour le CO₂

#### IfcSpace
1. Créer des Rooms dans Revit
2. Nommer correctement : `Wohnzimmer`, `Küche`, `Bad`, `Flur`, `Technik`, etc.
3. NARCHI utilise ces noms pour distinguer NUF / VF / TF

#### Classification DIN 276 (optionnel mais top)
1. Installer le shared parameter « Classification »
2. Renseigner avec les codes DIN 276 (ex. `331`, `342`, `351`)
3. NARCHI le détecte et priorise ces codes natifs

### 🔴 Archicad

#### Pset_WallCommon.IsExternal
- **Eigenschaften** → **Exposition** : choisir « Außen » ou « Innen »
- Archicad mappe automatiquement vers `Pset_WallCommon.IsExternal`

#### Base Quantities
- IFC-Übersetzer → **Eigenschaftensätze** → cocher **Pset_*BaseQuantities**

#### Materialien
- Chaque Bauteil-Typ a un « Building Material » avec un nom propre

#### Räume
- Modeliser les Zonen avec nom et catégorie

### 🟡 Allplan

#### Setup IFC-Export
- `IFC-Export → Optionen → Mengen exportieren`
- Cocher base quantities + user-defined property sets

#### IsExternal
- Im Allplan-Wandattribut **Außen/Innen** zuweisen

## Tableau récapitulatif

| Qu'est-ce qui dépend de quoi dans NARCHI |
|---|
| **BGF** = somme des IfcSlab FLOOR + BASESLAB avec Area > 0 |
| **NUF** = somme des IfcSpace dont LongName ≠ Flur/Technik/Wand |
| **KG 331/332 vs 341/342** = `Pset_WallCommon.IsExternal` + `LoadBearing` |
| **CO₂-Bilanz** = IfcMaterial.Name + Volume |
| **GEG-Check** = `Pset_*Common.ThermalTransmittance` |
| **DIN 276 native** = `IfcClassificationReference` avec source "DIN276" |

## Cas spécial : modèle hérité sans Psets

Si vous travaillez sur un vieil IFC sans Psets propres, NARCHI fait du mieux possible :
- Heuristique sur le nom (« Wand-Ext-… », « Aussenwand », « Exterior » → KG 332)
- OmniClass-Codes Revit (si présents) sont mappés vers DIN 276
- Fallback à 60 % de confiance

Le rapport HTML/Excel indique pour chaque position : confidence %.

## Vérification après réglages

Re-lancez :
```bash
python -m narchi.cli validate mon_modele.ifc
```

Objectif : **score >= 80 %** pour avoir des résultats de qualité industrielle.

→ Suite : [Tutoriel 3 — Multi-Modèles et coordination interdisciplinaire](03_multi_model.md)
