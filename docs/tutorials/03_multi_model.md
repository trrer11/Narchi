# Tutoriel 3 : Multi-modèles et coordination

Un vrai projet allemand n'a presque jamais UN seul IFC. Il en a 3 à 5 :
- **Architektur.ifc** (par l'architecte)
- **Tragwerk.ifc** (par le statiker)
- **TGA_HLS.ifc** (par le Fachplaner Heizung-Lüftung-Sanitär)
- **TGA_Elektro.ifc** (par le Fachplaner Elektro)
- **Aussenanlagen.ifc** (par le Landschaftsarchitekt)

Comment faire une Kostenermittlung globale sans **compter 2× les dalles** (modélisées dans Archi ET dans Tragwerk) ?

## La commande NARCHI multi

```bash
python -m narchi.cli multi \
    examples/Architektur.ifc \
    examples/Tragwerk.ifc \
    examples/TGA_HLS.ifc \
    examples/TGA_Elektro.ifc \
    -g wohngebaeude_mfh -b BY --grossstadt Muenchen \
    --stichtag 2026-Q4 --lp 3
```

NARCHI :
1. Détecte automatiquement le **fachmodell** d'après le nom (`Architektur` → typ `architektur`)
2. Charge chaque IFC dans son propre DataFrame
3. **Cherche les doublons** : éléments identiques (Class + Name + Area ± 5%)
4. **Résout les doublons selon une priorité** :
   - KG 322 (Bodenplatte) → priorité **Tragwerk**
   - KG 330 (Außenwände) → priorité **Architektur**
   - KG 340 (Innenwände non-porteuses) → priorité **Architektur**
   - KG 351 (Decken structurelles) → priorité **Tragwerk**
   - KG 410-430 (HLS) → priorité **TGA_HLS**
   - KG 440-450 (Elektro) → priorité **TGA_Elektro**
5. Fusionne en un seul calcul global

## Output typique

```
=== Multi-Model-Fusion ===

  • Architektur.ifc → fachmodell : architektur
  • Tragwerk.ifc    → fachmodell : tragwerk
  • TGA_HLS.ifc     → fachmodell : tga_hls
  • TGA_Elektro.ifc → fachmodell : tga_elektro

→ 1247 Bauteile nach Fusion
→ 38 Doublons résolus
  ⚠️ Doublons inter-fachmodelle détectés : 38 (38 supprimés, autorité = priorité fachmodell)
```

## Réglages avancés

### Forcer un fachmodell

Si le nom du fichier ne permet pas de deviner, vous pouvez passer par l'API Python :

```python
from narchi import multi_model

inputs = [
    multi_model.FachmodellInput(pfad="modele1.ifc", typ="architektur"),
    multi_model.FachmodellInput(pfad="modele2.ifc", typ="tga_hls"),
]
result = multi_model.fuse_models(inputs, dedup=True)
```

### Désactiver la déduplication

Si vous savez que vos modèles sont déjà coordonnés (Solibri ou Naviswork passés
avant) :
```python
result = multi_model.fuse_models(inputs, dedup=False)
```

## Cas typique : Coordination déficiente

Si vous voyez ce message dans le rapport NARCHI :
> ⚠️ Bauwerkskosten KG 300+400 = X € liegen 2.1× über dem BKI-Erwartungswert

Cela signifie probablement :
- Soit double-comptage non détecté
- Soit modèles non coordonnés (Architektur a modélisé toute la structure aussi)

→ Suite : [Tutoriel 4 — GEG + Förderprogramme : maximiser les subventions](04_geg_foerderung.md)
