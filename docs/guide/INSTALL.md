# Installation NARCHI

NARCHI fonctionne sur **Windows, Linux et macOS**. Voici les étapes par OS.

## Pré-requis communs

- **Python 3.10 ou plus récent** ([python.org/downloads](https://python.org/downloads))
- **Git** ([git-scm.com](https://git-scm.com))
- **Connexion Internet** (uniquement pour l'installation, ensuite NARCHI fonctionne offline)

## 🪟 Windows

### 1. Installer Python
1. Téléchargez Python 3.12+ depuis [python.org/downloads/windows](https://www.python.org/downloads/windows/)
2. **Important** : cochez « Add Python to PATH » lors de l'installation

### 2. Cloner et installer NARCHI
```powershell
git clone <your-narchi-repo-url> narchi
cd narchi
pip install -r requirements.txt
```

### 3. (Optionnel) Installer les converters RVT/DWG/DGN
```powershell
# Génère un script d'installation auto pour cad2data Windows
python -m narchi.cli install --format rvt

# Lance le script généré
.\Users\<vous>\.narchi\converters\install_cad2data.ps1
```

### 4. Vérification
```powershell
python -m narchi.cli doctor
```

Vous devriez voir :
```
✅ IFC (.ifc)       ifcopenshell 0.8.5
✅ DXF (.dxf)       ezdxf 1.4.4
✅ DWG (.dwg)       cad2data DwgExporter
✅ RVT (.rvt)       cad2data Rvt2Ifc
```

---

## 🐧 Linux (Debian / Ubuntu)

### 1. Installer Python et Git
```bash
sudo apt update && sudo apt install -y python3 python3-pip git
```

### 2. Cloner et installer NARCHI
```bash
git clone <your-narchi-repo-url> narchi
cd narchi
pip install -r requirements.txt
```

### 3. Import IFC (natif, sans outil externe)

Le pipeline BIM de NARCHI V5 est entièrement autonome :

- **Backend** : `ifcopenshell` (installé via `requirements.txt`) pour
  l'extraction des métrés (BGF/NGF/BRI, quantités par type d'élément).
- **Frontend** : runtime `web-ifc` servi localement (`public/ifc/`), copié
  au build par `npm run copy-ifc-assets`.

Aucun dépôt APT ni convertisseur propriétaire n'est requis. Les fichiers
RVT/DWG sont à exporter en IFC (Revit : *Fichier → Exporter → IFC*) avant
import ; le parsing DXF natif via `ezdxf` couvre les plans 2D.

### 4. Vérification
```bash
python3 -m narchi.cli doctor
```

---

## 🍎 macOS

### 1. Installer Homebrew, Python, Git
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python git
```

### 2. Cloner et installer NARCHI
```bash
git clone <your-narchi-repo-url> narchi
cd narchi
pip3 install -r requirements.txt
```

### 3. (Optionnel) ODA File Converter pour DWG
1. Créer un compte gratuit sur [opendesign.com/guestfiles](https://www.opendesign.com/guestfiles)
2. Télécharger « ODA File Converter pour macOS »
3. Glisser-déposer dans `/Applications`
4. Vérifier : `python3 -m narchi.cli doctor`

Pour RVT sur macOS, il faut Wine + cad2data Windows binaries (compliqué). Le plus simple : convertir le RVT sur une machine Windows puis transférer l'IFC.

---

## ✅ Test de bon fonctionnement

```bash
python -m narchi.cli auto examples/Ifc2x3_Duplex_Architecture.ifc \
    -g wohngebaeude_mfh -b BY \
    --excel test_output.xlsx --html test_output.html
```

Si vous voyez le rapport apparaître avec des chiffres, **NARCHI fonctionne** ! 🎉

---

## 🐛 Dépannage

| Problème | Solution |
|---|---|
| `ModuleNotFoundError: ifcopenshell` | `pip install ifcopenshell` |
| `pip install` échoue avec « no wheel for Python 3.x » | Utiliser Python 3.10–3.12 (pas 3.13+ encore parfois) |
| `RVT2IFCconverter: command not found` | Vérifier `which RVT2IFCconverter` ; relancer l'install |
| DWG non lu | Installer ODA File Converter ou cad2data DwgExporter |
| Rapport HTML s'affiche mal | Ouvrir avec Chrome/Firefox/Edge (pas IE) |

Voir aussi [docs/guide/FAQ.md](FAQ.md) pour plus de réponses.

---

## 🐋 Dépannage Docker Compose (stack complète)

### Le script refuse de démarrer : « Docker Desktop ne répond pas » / erreur `npipe`

Docker Desktop n'est tout simplement pas lancé. Depuis la version §56,
`1_DEMARRER_NARCHI.bat` (et `2_REDEMARRER_NARCHI_RAPIDE.bat`) tentent de le
démarrer **tout seuls** et patientent jusqu'à 180 s. Si le moteur ne répond
toujours pas :

1. Lancez Docker Desktop manuellement (menu Démarrer → Docker Desktop).
2. Attendez la mention « Engine running » (icône baleine stable).
3. Double-cliquez à nouveau sur le même fichier `.bat`.
4. Si le blocage persiste, redémarrez le PC puis recommencez.

Même sans Docker, `DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat` produit un ZIP complet :
il contient alors `00_DOCKER_DESKTOP_ARRETE.txt` avec la marche à suivre.

### `migrate` échoue : `password authentication failed for user "narchi"`

> ✅ **Corrigé en V6** : la base utilise désormais le volume `postgres_v6_data`, créé
> neuf avec le mot de passe actuel du `.env`. Ce problème ne peut plus survenir au
> premier lancement. L'ancien volume `postgres_v5_data` (V5) n'est pas supprimé.

**Cause historique** : PostgreSQL n'utilise `POSTGRES_PASSWORD` qu'au **tout premier**
démarrage (création du volume). Si le mot de passe du `.env` a changé depuis,
PgBouncer envoie le nouveau mot de passe à une base qui garde l'ancien → refus.

**Si cela se reproduit** (volume déjà existant avec un autre mot de passe), réparation
sans perte de données (DANS le dossier du projet, base démarrée) :

```powershell
# 1. Voir le mot de passe actuel du .env
Select-String -Path .env -Pattern "POSTGRES_PASSWORD"

# 2. Aligner la base sur ce mot de passe (remplacer MON_MDP par la valeur du .env)
docker compose exec db psql -U narchi -d postgres -c "ALTER USER narchi WITH PASSWORD 'MON_MDP';"

# 3. Relancer la pile (le service migrate repart tout seul)
docker compose up -d
```

> La connexion `psql` locale (socket Unix) est en mode `trust` par défaut : aucun mot de
> passe n'est demandé pour la commande n° 2.

**Variante « tout repartir à zéro »** (⚠️ supprime TOUTES les données
base v7/sauvegardes pgBackRest/Redis — à n'utiliser que si le volume ne
contient rien d'important ; une archive legacy `postgres_v6_data` éventuelle
n'est pas touchée) :

```powershell
docker compose down -v
docker compose up -d
```
