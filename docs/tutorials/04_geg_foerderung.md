# Tutoriel 4 : GEG + Förderprogramme — maximiser les subventions

NARCHI calcule automatiquement quels programmes KfW/BAFA votre projet peut obtenir, ce qui peut représenter **20 000 à 200 000 € de subvention**.

## Le contexte (court résumé)

Depuis le 1.1.2024, l'Allemagne a renforcé son **Gebäudeenergiegesetz (GEG)** :
- 65 % d'énergie renouvelable pour toute nouvelle Heizung en zone Neubau
- U-Werte des Bauteile sous des Höchstwerte sévères
- Effizienzhaus-Klassen (EH 40, EH 55, EH 70, EH 85) déterminent l'accès aux **subventions KfW**.

Plus votre projet est efficient, plus vous obtenez de **Tilgungszuschuss**.

## Exécution

NARCHI inclut le check GEG + le matcher Förderprogramme automatiquement dans `auto` et `ifc`. Vous obtenez :

```
====================================================================================================
  GEG 2024 / KfW-Effizienzhaus Vor-Check
====================================================================================================
  Bauteile geprüft: 8
  Konformitätsquote: 87.5%
  Datenbasis vollständig: 75.0%
  Effizienzhaus-Einstufung (Schätzung): EH 55 oder besser
----------------------------------------------------------------------------------------------------
  Bauteil                        n    Fläche   U max GEG  U gemessen  Verdict
----------------------------------------------------------------------------------------------------
  Außenwände gegen Außenluft    45     783        0.24       0.18    ✅
  Fenster und Fenstertüren      26      89        1.30       0.95    ✅
  Dach gegen Außenluft           3     315        0.20       0.15    ✅
  Bodenplatte gegen Erdreich    23     128        0.30       0.28    ✅
  ...

====================================================================================================
  FÖRDERPROGRAMME-Analyse (KfW + BAFA 2026)
====================================================================================================
  Gesamt-Förderpotenzial:         187.500 €
  ✅ Hohes Förderpotenzial: bis zu 187.500 € durch Kombination der Programme.
----------------------------------------------------------------------------------------------------
  ✅ [ 95%]  KfW 297 Klimafreundlicher Neubau (KFN)
      Förderung geschätzt:       100.000 €
      
  ✅ [ 85%]  KfW 297 KFN mit QNG-Plus
      Förderung geschätzt:        67.500 €
      
  ✅ [ 70%]  BAFA Heizungsförderung Wärmepumpe
      Förderung geschätzt:        20.000 €
```

## Comment exploiter cette info ?

### 1. Si la Konformität est faible (<70%)

NARCHI vous indique précisément quels bauteile sont non-conformes. Action :
- Augmenter l'épaisseur d'isolation (Dämmung)
- Choisir une meilleure fenêtre (3-fach Verglasung Ug ≤ 0.6)
- Modifier le BIM-Modell → re-export IFC → re-lancer NARCHI

### 2. Si la KfW 297 KFN apparaît mais avec un fehlt critère

Exemple :
```
✅ [ 75%]  KfW 297 KFN
   → GHG = 28.4 > 24 kgCO2e/m²·a (CO₂ reduzieren für QNG)
```

Action :
- Remplacer le **Stahlbeton** par du **Holz CLT** pour la structure
- Passer en **Pellets** ou **Wärmepumpe + PV**
- Re-lancer le calcul → vérifier que GHG ≤ 24

### 3. Sauvegarder l'analyse comme document client

```bash
python -m narchi.cli audit mon_projet.ifc \
    -g wohngebaeude_mfh -b BY --lp 3
# → mon_projet.audit.json contient TOUT, y compris GEG + Förderung
```

Le JSON peut être imprimé en PDF et présenté au Bauherr pour démontrer la
profitabilité d'investir dans l'efficience.

## La règle d'or NARCHI / Förderung

> **« Tu paies 5 000 € d'isolation supplémentaire → tu gagnes 20 000 € de subvention. ROI immédiat. »**

C'est pour ça que la commande NARCHI vaut son pesant d'or pour un bureau : en
LP 2/3, l'architecte peut **convaincre son client** avec des chiffres concrets.

## Pour aller plus loin

- Le `data/foerderprogramme_2026.json` peut être mis à jour à chaque
  modification des conditions KfW/BAFA — pas de changement de code
- Pour QNG-Plus officiel, un Auditeur QNG reste obligatoire (NARCHI fait juste
  la pré-vérification)
- Pour iSFP (+5 % bonus), un Energieberater BAFA-zugelassen reste obligatoire

→ Suite : [Tutoriel 5 — Workflow Soll/Ist et suivi de projet](05_soll_ist_workflow.md)
