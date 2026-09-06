# Floci — vérification mesurée (§124, 13/08/2026)

**Demande** : « vérifie cet outil, ça peut aider dans Narchi »
(<https://github.com/floci-io/floci>). Ce document = le verdict, avec ce qui
a été RÉELLEMENT mesuré dans le sandbox et ce qui reste non prouvé.

## 1. C'est quoi

Émulateur AWS **local** — l'alternative libre à LocalStack : on pointe le SDK
AWS (boto3, aws-cli, Terraform…) vers `http://localhost:4566` et les appels
S3/SQS/… restent sur la machine, **sans compte cloud, sans jeton, sans
fonctions payantes**.

Faits publics mesurés ce jour (API GitHub + build local) :

| Fait | Mesure |
|---|---|
| Licence | **MIT** — utilisable, même commercialement |
| Vie | créé le 18/02/2026, dernier push **aujourd'hui** (projet très actif) |
| Version | v1.6.0 (06/08/2026), Quarkus 3.36.3 / Java |
| Démarrage mesuré | **2,64 s** (jar local) ; HTTP 200 sur :4566 |
| Build maison | `./mvnw package` OK **mais exige JDK 25** (ni 11 ni 21 ne suffisent) |
| Binaire officiel | pas de jar en release : image Docker `floci/floci` (ou CLI) ou build |

## 2. Pourquoi ça nous regarde

`backend/app/services/storage_service.py` (chemin **SaaS** narchi.de, pas le
produit auto-hébergé qui stocke sur disque local) fait 4 choses précises :
générer une **URL de dépôt pré-signée (POST policy + `content-length-range`
anti-triche)**, **HEAD** pour authentifier la taille réelle, **URL de
téléchargement pré-signée**, et confinement par préfixe locataire. Jusqu'ici,
ce chemin n'était éprouvé qu'avec le vrai Cloudflare R2 — donc **jamais en
local/CI sans compte payant**. Floci prétend couvrir S3 dont les POST policy.

## 3. Preuve mesurée — NOTRE classe Python, inchangée, contre floci lancé ici

Script rejouable : `scripts/poc-floci-s3.py` (floci v1.6.0 lancé en sandbox,
13/08 soir). Résultats **mesurés, copiés tels quels** :

| # | Vérification | Résultat |
|---|---|---|
| 1 | `create_bucket` via boto3 | créé au 1er passage, `BucketAlreadyOwnedByYou` ensuite (idempotent) |
| 2 | Dépôt via la POST policy générée par NOTRE `StorageService` (128 Ko exacts) | **HTTP 204 accepté** |
| 3 | `HEAD` via NOTRE `get_cloud_object_metadata` | `size_bytes = 131 072` = exactement la taille envoyée |
| 4 | Téléchargement via NOTRE `generate_presigned_download_url` | octets **identiques** aux 128 Ko |
| 5 | Triche : 5 000 octets déposés pour 1 000 signés | **HTTP 400 refusé** (`content-length-range` appliqué côté floci) |
| 6 | Trop petit : 10 octets (< plancher 100 de notre policy) | **HTTP 400 refusé** |
| 7 | Fuite : lecture d'une clé d'un AUTRE locataire | **403** (refus dans notre code, empêché avant tout appel) |

**Verdict mesuré : oui, ça marche** — le chemin S3 complet de Narchi tourne
contre floci, y compris les gardes anti-triche dont dépend la promesse
quota. Ce n'est PAS une revue de papier : le jar tournait, notre code a
tourné, les assertions ont été relues.

## 4. Ce que ça débloque (valeur pour le client)

1. **Dev/CI du SaaS sans compte cloud** (économie directe + zéro donnée qui
   sort). Un job CI « S3 intégration » devient possible — c'est précisément
   le jalon « CI hébergée » laissé ouvert au §123 : floci peut en faire
   partie (image `floci/floci` un `docker compose` de CI).
2. Un banc d'essai pour tout futur usage AWS (files SQS, etc.) sans
   abonnement.

## 5. Limites dites — rien vendu au-delà de la mesure

- **Un émulateur n'est pas AWS/R2** : seuls 7 comportements ont été mesurés
  (les nôtres). Multipart complet, charge, cas limites de signature R2 →
  **INCONNU**. Règle proposée en conséquence : floci en dev/CI + **un smoke
  test réel R2 avant toute livraison SaaS** (dit, pas fait ici).
- Projet **jeune et rapide** (févr. 2026) : on épinglerait une version
  précise, jamais `latest`.
- **Non embarqué dans le produit auto-hébergé** : le client n'a pas de Java,
  et le produit stocke en local bonnement — floci n'apporte rien là
  (cadrage §90 : on ne l'installe PAS chez lui).
- Bucket POST policy : conforme sur nos cas mesurés ; toute condition
  supplémentaire (Content-Type imposé, métadonnées) devra être re-mesurée
  si on l'ajoute.

## 6. Décision et prochaine étape

- Décision §124 : **adopté comme outil de dev/CI, pas comme dépendance
  produit.** Aucun gate §123 ne dépend de lui (le jar/Java n'entre ni dans
  pytest ni sur les machines clientes).
- Prochaine étape ordonnancée (à faire quand le CI hébergé sera décidé) :
  service `floci` dans le compose de CI + rejouer `scripts/poc-floci-s3.py`
  en job. Le PoC reste rejouable à la main partout où une JVM 25 ou Docker
  existe ; chez vous (Windows + Docker Desktop), une ligne suffit :
  `docker run --rm -p 4566:4566 floci/floci:1.6.0` (commande DITE non
  testée depuis ce sandbox — pas de daemon Docker ici ; à essayer une fois
  sur votre machine, 2 min).
