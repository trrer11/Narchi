# NARCHI — Sauvegardes : ce qui protège vraiment vos données

**Date : 11 août 2026 · livraison §113 · langage simple, chiffres mesurés.**

---

## 1. Aveu d'abord

Mon rapport général (§112) disait : « pas de sauvegarde automatique ».
**C'était inexact** : les sauvegardes automatiques existaient déjà
(depuis la livraison §51) — mais **entièrement à l'intérieur de Docker**.
Le vrai problème, lui, était réel : tout était prisonnier du même endroit
que les données. Le §113 répare ce trou. Voici la vérité complète, couche
par couche.

## 2. Les 3 couches de protection (après §113 base + §133 fichiers)

| Couche | Où | Quand | Protège contre |
|---|---|---|---|
| **1. pgBackRest interne** (existait, §51) | volume Docker `pgbackrest_v1_data` | complet dimanche 03:30, incrémental lun.–sam. 03:30 + WAL en continu (retour en arrière à 5 min près) | erreur de manipulation, suppression accidentelle |
| **2. Export visible** (base §113 + fichiers §133) | dossier `sauvegardes\` à côté des `.bat` | manuel (`5_…bat`, `SAUVEGARDER_LES_FICHIERS.bat`) ou chaque dimanche 05:00 (`7_…bat`) | panne du volume Docker, `4_TOUT_EFFACER` |
| **3. Votre copie hors PC** (à vous) | clé USB / autre PC / NAS | quand vous copiez le dossier `sauvegardes\` ailleurs | **panne disque, vol, incendie** |

Règle d'or honnête : tant que la couche 3 n'existe pas, **toutes vos
données tiennent sur un seul disque**. Copier le dossier une fois par
semaine prend 30 secondes (glisser-déposer).

## 3. Comment s'en servir (3 fichiers à double-cliquer, numérotés)

| Fichier | Effet |
|---|---|
| `5_SAUVEGARDE_EXTERNE.bat` | Pose MAINTENANT une copie complète `narchi-AAAAMMJJ-HHMMSS.sql.gz` dans `sauvegardes\` + un manifeste de contenu (tables + lignes exactes) + un `dernier_export.json` de vérité (succès OU échec, jamais muet). |
| `6_VERIFIER_RESTAURATION.bat` | **La preuve** : rejoue la dernière copie dans une base jetable, la compare au manifeste, puis détruit la base jetable. Verdict affiché en clair. |
| `scripts/SAUVEGARDER_LES_FICHIERS.bat` | Pose MAINTENANT une archive `narchi-fichiers-AAAAMMJJ-HHMMSS.tar.gz` de TOUTES les photos/vidéos (volume `narchi_storage`) dans `sauvegardes\` + manifeste (fichiers + dossiers) + `dernier_export_fichiers.json` de vérité. Preuve de restauration : `infra/backups/verifier-fichiers.sh` (§133). |
| `7_PROGRAMMER_SAUVEGARDE_HEBDO.bat` | À lancer **une fois** : Windows fera l'export tout seul chaque dimanche 05:00 (PC allumé et session ouverte — sinon l'export est sauté, le suivant reprendra). |

Restauration réelle (un jour de malheur) : `scripts/RESTAURER_LA_BASE.bat`
(pgBackRest, §51) reste la voie d'origine ; l'export logique §113 se
rejoue par `psql` sur n'importe quel PostgreSQL récent — mode d'emploi au
§5.

## 4. Ce qui a été PROUVÉ, pas promis (tests réels du 11/08/2026, vrai PostgreSQL)

| # | Épreuve | Résultat |
|---|---|---|
| 1 | Export réel d'une base 30 tables / 9 000 lignes | `OK : narchi-….sql.gz (8 495 octets, 30 tables, 9000 lignes)` |
| 2 | Restauration réelle en base jetable + comparaison au manifeste | `VERDICT : OK — restauration complète et contenu IDENTIQUE (30 tables, 9000 lignes, 1s)`, base jetable détruite après coup |
| 3 | Rotation (garde 3, 5 exports lancés) | 3 fichiers restants, manifestes supprimés avec leur dump |
| 4 | Copie volontairement corrompue (octets modifiés) | `VERDICT : CORROMPU — …n'est pas un gzip lisible`, code 65 |
| 5 | Manifeste trafiqué (30→31 tables) | `VERDICT : ÉCHEC — restauré 30/9000, attendu 31/9000. Copie douteuse.` |
| 6 | **Base vivante modifiée APRÈS l'export** (une ligne ajoutée) | le verdict reste `OK` — la preuve compare au manifeste, jamais à une base qui bouge (plus de faux « ÉCHEC ») |
| 7 | Mon propre contrôle trop strict (bannière cherchée en ligne 1 au lieu des 3 premières) a **écarté un dump valide** au premier essai | attrapé par le test réel, corrigé — c'est exactement à ça que servent ces épreuves |

Environnement de test : PostgreSQL 17 en sandbox (le conteneur client
embarque PostgreSQL 16 ; un `pg_dump` de version ≥ source est
officiellement supporté).

## 5. Restaurer depuis l'export logique (jour de malheur, exemple)

```powershell
# Dans le dossier du projet, base de MÊME nom recréée vide au préalable :
docker compose exec -T db bash -c "zcat /sauvegardes/narchi-AAAAMMJJ-HHMMSS.sql.gz | psql -U postgres -d narchi_v3 -v ON_ERROR_STOP=1"
```

(La voie pgBackRest §51, plus rapide et avec point-dans-le-temps, reste
décrite dans `scripts/RESTAURER_LA_BASE.ps1`.)

## 6. Limites dites

- La tâche planifiée (`7_`) exige **PC allumé + session ouverte** à
  05:00 — limite standard du Planificateur Windows, dite plutôt que de
  promettre l'invisible.
- L'export couvre **la base** (`5_…bat`, §113) ET **les fichiers**
  (photos/vidéos du volume `narchi_storage`, §133) : le second pose une
  archive `narchi-fichiers-*.tar.gz` dans `sauvegardes\` avec son propre
  manifeste et sa propre preuve de restauration (fichiers comptés, jamais
  comparés à un volume vivant). Restauration un jour de malheur :
  `docker compose exec -T backend bash -c "tar xzf /sauvegardes/narchi-fichiers-….tar.gz -C /app/storage"`.
- Les fichiers `sauvegardes\*.sql.gz` contiennent TOUTES les données :
  **exclus de git** (.gitignore), à manipuler comme des documents
  confidentiels.
