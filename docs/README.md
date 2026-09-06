# NARCHI Documentation

Bienvenue dans la documentation NARCHI v2.4 + Plugin Revit.

## 🚀 Pour commencer (5 minutes)

1. [Installation par OS](guide/INSTALL.md) — Windows / Linux / macOS
2. [Tutoriel 1 : Première Kostenermittlung](tutorials/01_first_cost_estimation.md)
3. [Guide d'utilisation des 19 commandes CLI](guide/USAGE.md)

## 📚 Tutoriels (pas-à-pas)

| # | Titre | Niveau |
|---|---|---|
| 1 | [Première Kostenermittlung](tutorials/01_first_cost_estimation.md) | 🟢 Débutant |
| 2 | [Améliorer son IFC pour NARCHI](tutorials/02_improve_ifc.md) | 🟡 Intermédiaire |
| 3 | [Multi-modèles : Architektur + Tragwerk + TGA](tutorials/03_multi_model.md) | 🟡 Intermédiaire |
| 4 | [GEG + Förderprogramme : maximiser les subventions](tutorials/04_geg_foerderung.md) | 🟡 Intermédiaire |
| 5 | [Workflow Soll/Ist et suivi de projet HOAI](tutorials/05_soll_ist_workflow.md) | 🔴 Avancé |
| 6 | [Plugin Revit — NARCHI dans le ribbon](tutorials/06_revit_plugin.md) | 🟡 Intermédiaire |

## 📖 Guides de référence

- [Installation détaillée par OS](guide/INSTALL.md)
- [Utilisation complète des 19 commandes CLI](guide/USAGE.md)
- [FAQ (questions fréquentes)](guide/FAQ.md)
- [Glossaire DIN / HOAI / BKI / GEG](guide/GLOSSARY.md)

## 🔬 Référence technique

- [Carte des 23 modules](reference/MODULES.md)
- [Normes et standards référencés](reference/NORMS.md)
- [Fichiers de données (BKI, ÖKOBAUDAT, GEG, …)](reference/DATA.md)

## 💻 Pour développeurs

- [Référence API Python complète](api/API_REFERENCE.md)
- [Guide de contribution](../CONTRIBUTING.md)
- [Changelog des versions](../CHANGELOG.md)
- [Vergleich NARCHI vs cad2data](COMPARISON_cad2data_vs_NARCHI.md)

## ⚖️ Licence & responsabilité

- [LICENSE (MIT)](../LICENSE)
- [NOTICE (attributions)](../NOTICE)

---

## 💡 Cas d'usage rapide

### Le plus simple : 1 commande
```bash
python -m narchi.cli auto mon_modele.ifc -g wohngebaeude_mfh -b BY \
    --excel rapport.xlsx --html rapport.html
```

### Pour AVA-software (RIB iTWO, California.pro, …)
```bash
python -m narchi.cli gaeb mon_modele.ifc -g wohngebaeude_mfh -b BY
# → mon_modele.x83
```

### Pour HOAI § 6 prüfbarer Audit
```bash
python -m narchi.cli audit mon_modele.ifc -g wohngebaeude_mfh -b BY --rows
# → mon_modele.audit.json avec SHA-256
```

### Pour comparer 2 versions
```bash
python -m narchi.cli vergleich version1.ifc version2.ifc -g wohngebaeude_mfh -b BY
```

---

## 🆘 Aide rapide

- ❓ **Question conceptuelle** → [Glossaire](guide/GLOSSARY.md) + [FAQ](guide/FAQ.md)
- 🐛 **Bug / erreur** → [FAQ Dépannage](guide/FAQ.md#technik) puis GitHub Issues
- 🔧 **Installation difficile** → [Guide Installation](guide/INSTALL.md)
- 📊 **Mon IFC ne donne pas le bon résultat** → [Tutoriel 2 — Améliorer son IFC](tutorials/02_improve_ifc.md)
- 💼 **Pour mon bureau d'architecte** → [Tutoriel 5 — Workflow HOAI complet](tutorials/05_soll_ist_workflow.md)
- 👨‍💻 **Je veux développer/contribuer** → [API Reference](api/API_REFERENCE.md) + [CONTRIBUTING](../CONTRIBUTING.md)
