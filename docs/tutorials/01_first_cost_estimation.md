# Tutoriel 1 : Première Kostenermittlung en 5 minutes

**Objectif** : Vous avez un fichier IFC, vous voulez une Kostenermittlung DIN 276 prête en moins de 5 minutes.

## Pré-requis
- NARCHI installé ([INSTALL.md](../guide/INSTALL.md))
- Un fichier IFC (ou utilisez `examples/Ifc2x3_Duplex_Architecture.ifc` fourni)

## Étape 1 — Vérifier l'environnement

```bash
python -m narchi.cli doctor
```

Sortie attendue :
```
=== NARCHI Converter-Diagnose ===

  IFC (.ifc)       ✅ ifcopenshell 0.8.5
  DXF (.dxf)       ✅ ezdxf 1.4.4
  ...
```

## Étape 2 — Pré-valider votre IFC

```bash
python -m narchi.cli validate examples/Ifc2x3_Duplex_Architecture.ifc
```

Vous voyez un score (ici 60–80 % est normal pour un IFC pas optimisé pour NARCHI).
Les WARNINGs vous indiquent ce qui peut être amélioré dans votre modèle.

## Étape 3 — Lancer le calcul complet

```bash
python -m narchi.cli auto examples/Ifc2x3_Duplex_Architecture.ifc \
    -p "Mon Premier Projet" \
    -g wohngebaeude_mfh \
    -s standard_mittel \
    -b BY --grossstadt Muenchen \
    --stichtag 2026-Q4 \
    --lp 3 \
    --excel mon_premier_projekt.xlsx \
    --html mon_premier_projekt.html
```

## Étape 4 — Comprendre le résultat console

```
══════════════════════════════════════════════════════════════════════════════════
  NARCHI · DIN 276 Kostenermittlung · Mon Premier Projet
══════════════════════════════════════════════════════════════════════════════════
  Modus       : hybrid    HOAI-LP 3    Stichtag 2026-Q4
  Gebäudeart  : Mehrfamilienhaus / Mehrgeschossiger Wohnungsbau
  Standort    : Bayern / Muenchen   (Regionalfaktor 1.232, Indexfaktor 1.0742)
  IFC         : 275 Bauteile · 12 IFC-Klassen
  Mengen      : BGF 541 m² · BRI 1.623 m³ · NUF 406 m² · 2 Geschosse
```

À retenir :
- **Modus hybrid** : NARCHI utilise les Mengen IFC pour KG 300 (bottomup) + BKI pour le reste
- **Regionalfaktor 1.232** : München coûte 23 % plus cher que la moyenne fédérale
- **Indexfaktor 1.0742** : indexation des prix BKI 2025-Q1 → 2026-Q4

```
  KG   Bezeichnung                          Quelle         Summe netto
  200  Vorbereitende Maßnahmen              BKI-topdown      35.000 €
  331  Tragende Außenwände                  IFC-bottomup     62.474 €
  332  Nichttragende Außenwände             IFC-bottomup    197.925 €
  ...
```

Chaque ligne montre l'origine : `IFC-bottomup` = calculé depuis votre modèle ;
`BKI-topdown` = estimé via Kennwert.

```
  Bauwerkskosten KG 300+400          964.208 €
  Herstellungskosten KG 200–700     1.587.000 €
  ...
  + Risiko AHO 9 (10.0%)              96.421 €
  Gesamtkosten inkl. Risiko netto   1.640.000 €
  
  Konfidenz: E=1.481.688€  80%KI=[1.071.026;1.942.261]
```

**Important** : NARCHI ne donne JAMAIS qu'un chiffre unique. Toujours un Erwartungswert + intervalle de confiance.

## Étape 5 — Ouvrir les rapports

```bash
# Linux/macOS
xdg-open mon_premier_projekt.html   # ou: open mon_premier_projekt.html
# Windows
start mon_premier_projekt.html
```

Le HTML est responsive et imprimable.
Le Excel a **6 feuilles** :
1. **Deckblatt** : Projektdaten + chiffres-clés
2. **Kostenberechnung_DIN276** : Position-par-position
3. **IFC_DIN276_Mapping** : Comment chaque KG a été calculée
4. **Klassifikations_Audit** : Quels IFC-Elemente ont été pris en compte
5. **IFC_Rohdaten** : Top 500 Bauteile avec leur mapping
6. **Methodik_Quellen** : Normes utilisées

## Étape 6 — Et après ?

- **Pour AVA** : `python -m narchi.cli gaeb mon_projet.ifc -g … -b …` → fichier `.x83` à importer dans RIB iTWO etc.
- **Pour Bauherrenmeeting** : envoyez le HTML par mail
- **Pour comparer 2 variantes** : `python -m narchi.cli vergleich variante_A.ifc variante_B.ifc -g …`
- **Pour analyse de sensibilité** : `python -m narchi.cli sensitivity mon_projet.ifc -g …`

→ Suite : [Tutoriel 2 — Améliorer son IFC pour NARCHI](02_improve_ifc.md)
