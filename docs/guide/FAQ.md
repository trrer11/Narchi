# FAQ NARCHI

## Allgemein

### Was ist der Unterschied zu BKI / RIB iTWO / California.pro ?

| Werkzeug | Stärken | Schwächen |
|---|---|---|
| **BKI Online** | Offizielle Daten | Keine BIM-Integration |
| **RIB iTWO** | Vollständige AVA-Suite | 10–50k €/Jahr, lange Einarbeitung |
| **California.pro** | Bewährt für AVA | Closed Source, teuer |
| **NARCHI** | BIM → DIN 276 in 10 Sek, open source, gratuit | Nicht für komplette AVA-Abwicklung |

NARCHI ist komplementär : es liefert die Vorab-Kostenermittlung und das GAEB-LV,
das man dann in eine AVA-Software importiert.

### Kann ich NARCHI kommerziell nutzen ?

Ja, der Code ist MIT-lizenziert. Beachten Sie aber :
- BKI-Originalkennwerte sind kostenpflichtig — die in NARCHI mitgelieferten sind aus
  öffentlichen Leseproben konsolidiert. Für gewerbliche Honorarabrechnung
  empfehlen wir, die offiziellen BKI-Daten zu erwerben und im `data/bki_kennwerte_2025.json`
  einzupflegen.
- Der IFC-Import läuft vollständig nativ (IfcOpenShell / web-ifc) — es sind
  keine externen Konverter und keine Lizenzen von Drittanbietern erforderlich.

### Ersetzt NARCHI eine Energieberatung / einen Architekten ?

**Nein.** NARCHI ist ein Hilfswerkzeug. Es kann die geprüfte Kostenermittlung
nach HOAI § 6 nicht ersetzen, ebensowenig die offiziellen Energieausweise.
Es beschleunigt aber massiv die Vorab- und Variantenanalysen.

---

## Technik

### Mein IFC wird nicht gelesen — was tun ?

1. `python -m narchi.cli validate mon_projet.ifc` zeigt die Probleme
2. Häufige Ursachen :
   - IFC-Export ohne « BaseQuantities » → re-exportieren mit Häkchen
   - IFC2x3-Datei zu alt (vor 2010) → IFC4 verwenden
   - Datei korrupt (Editor-Fehler) → in Solibri/BIMcollab nochmal speichern
3. Dans l'application web (depuis V6) : l'import est **résilient** — si les
   Web Workers sont bloqués (antivirus web-shield, extension, navigateur),
   le parseur bascule automatiquement sur le thread principal et l'import
   aboutit quand même. Le badge de la visionneuse indique le moteur actif
   (« Fragments », « WebGL direkt », « Fallback WebGL ») et le libellé
   « ±0,00 ↔ ‹niveau› » l'ancrage du point de base du projet. Détails et
   diagnostic complet : [Post-mortem affichage IFC](IFC_AFFICHAGE_POSTMORTEM.md).

### Mein RVT/DWG wird nicht gelesen

1. `python -m narchi.cli doctor` → zeigt welche Converter installiert sind
2. Wenn rien : `python -m narchi.cli install --format rvt` → générer le script d'install
3. Sur Linux : `sudo apt install ddc-rvt2ifcconverter ddc-dwgconverter`
4. Sur Windows : cloner le repo cad2data, ajouter au PATH

### Pourquoi mes Bauwerkskosten paraissent trop bas (ou trop hauts) ?

NARCHI vous prévient automatiquement avec un message du genre :
> ⚠️ Bauwerkskosten KG 300+400 = X € liegen nur bei 42 % des BKI-Erwartungswertes.

Causes possibles :
- **Trop bas** : il manque des éléments dans le modèle (TGA non modélisée par ex.)
- **Trop haut** : double-comptage (slabs + couvering, walls + bekleidungen)
- **BGF mal calculée** → vérifier `python -m narchi.cli validate`
- **Mauvais Standard** : essayez `standard_hoch` au lieu de `mittel`

### Comment ajouter mes propres prix de référence (au lieu de BKI) ?

Modifiez `data/bki_kennwerte_2025.json` :
```json
"wohngebaeude_mfh": {
  "kennwerte": {
    "standard_mittel": {
      "KG300": [2230, 1880, 2610],   ← [mittel, untergrenze, obergrenze] en €/m² BGF
      ...
    }
  }
}
```

### Comment ajouter une Gebäudeart manquante ?

Même fichier, ajouter un bloc :
```json
"feuerwehrhaus": {
  "label": "Feuerwehrhaus",
  "din276_code": "5300",
  "typische_bgf_min": 300,
  "typische_bgf_max": 2500,
  "kennwerte": {
    "standard_mittel": {"KG200":[…], "KG300":[…], …}
  }
}
```

---

## Précision & qualité

### Quelle est la précision de NARCHI ?

| Mode | Précision typique |
|---|---|
| `topdown` (LP 1/2) | ±25–30 % (= conforme attente HOAI Kostenschätzung) |
| `hybrid` (LP 3) | ±15–20 % (= conforme attente HOAI Kostenberechnung) |
| `bottomup` avec IFC riche | ±10–15 % (selon qualité du modèle) |

NARCHI affiche **toujours un intervalle de confiance 80 % et 95 %** pour que
l'architecte communique honnêtement avec le Bauherr.

### Comment améliorer la précision ?

1. **Qualité du modèle IFC** : utilisez `validate` pour identifier les manques
2. **Pset_WallCommon.IsExternal** : indispensable pour distinguer KG 330 vs 340
3. **Materialinformationen** : améliore le mapping CO₂
4. **IfcSpace classifiés** : améliore le calcul NUF
5. **Mode `hybrid`** : combinaison optimale
6. **Sonderrisiken** : `--risiko bauen_im_bestand --risiko denkmalschutz`

---

## Confidentialité & DSGVO

### Mes données restent-elles confidentielles ?

**Oui, totalement.** NARCHI fonctionne **100 % offline** :
- Aucun appel API externe
- Aucun upload cloud
- Aucun télémétrie
- Aucun LLM (sauf si vous l'activez explicitement plus tard)
- Stockage local uniquement (`~/.narchi/cache/`)

C'est conforme DSGVO sans configuration supplémentaire.

---

## Maintenance et évolutions

### Mises à jour BKI annuelles ?

Le fichier `data/bki_kennwerte_2025.json` peut être mis à jour à chaque
nouveau jahrgang BKI. Pour 2026 : remplacez le fichier ; pas de changement de code.

### Comment contribuer ?

Voir [CONTRIBUTING.md](../../CONTRIBUTING.md).
Bugs / propositions → GitHub Issues.

### Plugin Revit / Archicad bientôt ?

Oui, en préparation. pyRevit + Archicad Tapir-API.
Le cœur NARCHI est volontairement gardé pur Python pour pouvoir s'incarner
facilement dans n'importe quel host.
