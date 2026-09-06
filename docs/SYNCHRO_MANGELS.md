# Synchro entre appareils — plan COMPLET : Mängel §115/§117, Projets + photos/vidéos §118, HTTPS local §119

**Date : 12 août 2026 · les 4 étapes sont livrées, testées, commitées. La
synchro téléphone ↔ bureau n'attend plus que VOUS (3 gestes,
docs/HTTPS_LOCAL.md).** §121 (13 août) : la suite **navigateur réel**
Playwright éprouve désormais tout ça de bout en bout (5 volets, 31 s —
`frontend/e2e/README.md`) et a attrapé une **vraie course** au premier
démarrage d'un appareil, corrigée ici même (loi du curseur honnête).

## Pourquoi en étapes

Vos photos et Mängel vivent **dans le navigateur** de chaque appareil
(choix assumé « alles bleibt auf diesem Gerät » depuis le §103). La
synchro téléphone ↔ bureau touche aux données, au réseau ET à la
sécurité : je la livre en marches prouvées, pas en saut dans le vide.

| Étape | Contenu | État |
|---|---|---|
| **1 (§115)** | **API serveur des Mängel** : la « vérité partagée » en base PostgreSQL | ✅ Livrée — 14 tests, 17 au §117 |
| **2 (§117)** | **Moteur de synchro Mängel dans l'appli** : pousse/tire au bon moment, file hors-ligne persistante | ✅ Livrée — 18 tests moteur + 7 badge/store |
| **3 (§118)** | **Photos/vidéos elles-mêmes** (fichiers, vérifiés octet par octet) **+ synchro des PROJETS** | ✅ Livrée — 10 API médias + 9 API projets + 22 moteur projets + 10 moteur médias + 3 badge |
| 4 | **HTTPS local obligatoire** (le téléphone n'ouvre pas http://PC) | ✅ Livrée §119 — `8_ACTIVER_HTTPS_LOCAL.bat` + preuves mesurées |

## Ce que l'étape 1 garantit (prouvé par tests)

- **Chaque bureau reste chez soi** : un autre bureau obtient 404 sur vos
  Mängel — et la base elle-même l'interdit (clé composite bureau+id +
  double blindage de l'intercepteur multi-tenant).
- **Dernier-écrit-gagne** : la version la plus récente (horodatage de
  l'appareil) l'emporte ; un envoi plus ancien est **décliné avec le
  verdict écrit** (`applied:false` + horodatage gagnant) — jamais de
  silence, jamais de fusion « intelligente » opaque.
- **Suppression qui voyage** : supprimer pose une *pierre tombale* que le
  prochain delta distribue aux autres appareils (sinon un téléphone
  garderait éternellement un Mangel effacé au bureau).
- **Idempotence** : renvoyer deux fois le même Mangel = une seule ligne.
- **Validation serveur stricte** : jour ISO, gravité contrôlée
  (minor/major/critical), statut contrôlé (open/**in-review**/resolved),
  pas de float pour les données.
- **Résurrection honnête (§117)** : une écriture PLUS RÉCENTE qu'une
  suppression fait revivre la ligne côté serveur (LWW vrai, pas une
  ligne morte au contenu frais — le trou a été trouvé et bouché pendant
  l'écriture de l'étape 2).

## Ce que l'étape 2 ajoute (moteur navigateur, éprouvé §117)

- **Vous écrivez ici, les autres appareils le voient** : chaque création
  ou changement de statut d'un Mangel est DATÉ et mis en file ; la
  poussée est immédiate si le réseau va, sinon elle **attend dans
  localStorage** et repart seule — même après fermeture du navigateur.
- **Tirage sobre** : au démarrage, puis toutes les 45 s, puis dès que le
  réseau revient. Le curseur vient du **serveur** (`server_time`) ; si la
  page est tronquée (500), on repart du DERNIER élément reçu — aucun
  trou de lecture masqué.
- **Réponse déclinée rattrapée** : si le serveur garde une version plus
  récente, l'appareil va LA CHERCHER (GET par id) au lieu de repousser
  en boucle.
- **Suppressions apprises** : une pierre tombale venue d'ailleurs retire
  le Mangel ici — SAUF écrit locale plus récente (résurrection).
- **Badge sincère** sur la page Baustelle : « Noch nie synchronisiert »
  / « Offline — N warten » / « Synchronisiert · HH:MM » (heure SERVEUR)
  / « Sync-Fehler: … » / « N geparkt (Projekt fehlt hier) ». Jamais de
  « Synchronisiert » décoratif.
- Limite par page **plafonnée (500)** et drapeau `truncated` DIT.

## Ce que §118 ajoute — Projets et photos/vidéos (éprouvé)

### Synchro des PROJETS (la plainte « invisible sur l'autre compte »)

- **Un projet créé ou importé ici apparaît partout** : le slice date la
  création et la met en file persistante ; le serveur garde un **miroir**
  (table `project_mirrors`, fiche complète dans une charge relue) ;
  l'autre appareil le tire au prochain cycle (45 s) ou au retour réseau.
- **Mêmes lois que les Mängel**, réutilisées : dernier-écrit-gagne en
  **millisecondes** (jamais de comparaison lexicale d'horodatages),
  tombstone qui voyage, résurrection, décliné → rattrapage GET par id,
  curseur serveur, page tronquée dite.
- **La suppression voyage aussi** : file de DELETE **distincte**, posée
  avant toute réapparition ; DELETE 404 = déjà parti = but atteint ;
  re-création locale après suppression = sortie de la file de DELETE
  (l'upsert gagne, jamais l'inverse).
- **`activeProjectId` n'est JAMAIS touché par le tirage** : la sélection
  reste VOTRE choix (§111) ; si le projet actif est retiré par une tombe
  venue d'ailleurs, la façade replie le pointeur proprement (« »), sans
  pseudo-sélection nouvelle.
- **Legacy honnête** : un projet d'avant §118 n'a pas d'horodatage — la
  date de sa PREMIÈRE synchro fait foi, dit dans le code, jamais de
  passé inventé. Statut absent → repli « planning », le même que
  l'écran Projets (jamais de valeur hors union : attrapé à la relecture).

### Photos/vidéos (étape 3 — les fichiers eux-mêmes)

- **Import ici → versement automatique là-bas** : chaque photo/vidéo
  importée est écrite localement (comme avant) **et** mise en file de
  versement ; le versement part SEUL si le réseau va, sinon attend dans
  localStorage et repart après redémarrage navigateur.
- **À l'affichage, l'autre appareil voit la photo** : manque local →
  demandée au serveur (`pull-through`), rangée localement ensuite. Un
  Mangel synchronisé depuis le téléphone **montre sa photo au bureau**
  sans aucun geste.
- **Serveur méfiant par conception** : les octets magiques sont vérifiés
  côté serveur (JPEG/PNG/WebP/GIF/BMP ; WebM/MP4/MOV), les plafonds sont
  francs (25 Mio photo / 300 Mio vidéo, `NARCHI_MEDIA_*`), l'identifiant
  est une regex stricte (pas de chemin bakeré), chaque bureau écrit dans
  SON dossier. Écriture atomique (`.part` puis renommage) : jamais un
  fichier à moitié visible.
- **Refus DÉFINITIF dit, pas bouclé** : un 4xx (type/taille/id) sort le
  fichier de la file et le garde dans une liste **visible** avec la
  raison serveur (« Medien: 1 nicht hochladbar », badge rouge). Un 5xx
  ou une coupure réseau = la file attend sagement, réessayée plus tard.
- **404 franc** : « n'existe nulle part » est mémorisé le temps de la
  session — jamais redemandé à l'infini, jamais maquillé en succès.

### Le badge §118 dit les trois flux

Un seul badge, trois vérités : Mängel (§117) + « Projekte: N warten » +
« Medien: N warten » / « Medien: N nicht hochladbar » (rouge si refus ou
erreur). Chaque compteur correspond à une file réelle, persistante,
relisible — éprouvé par les tests du badge.

## §121 — la course réelle trouvée par le navigateur, et sa loi

Premier démarrage d'un appareil (votre téléphone fraîchement connecté) :
les moteurs Mängel et Projets partent **en même temps**. Mesuré en E2E :
le tirage Mängel peut arriver **avant** que le projet existe localement →
Mangel « garé » (le badge le dit : « 1 geparkt »). Avant §121, le garé
n'était rejoué que si le serveur le **renvoyait** — or le delta strict
(`updated_at > since`, curseur déjà passé) ne le renvoyait JAMAIS : le
Mangel restait **invisible à vie** sur cet appareil, même après
rechargement. Correctif livré :

- **Loi du curseur honnête** : tant qu'un enregistrement du tirage est
  garé, le curseur NE BOUGE PAS — rien n'est affirmé reçu qui ne l'est
  pas → le serveur REDONNE les garés au cycle suivant (guérison certaine,
  même après fermeture du navigateur).
- **Copie mémoire + rejeu instantané** : dès que le miroir Projets livre
  le projet manquant, les garés s'appliquent sur-le-champ, sans réseau
  (`retryParkedIssues`). En E2E réel : 8 s au lieu de 45.
- Une tombe serveur d'un Mangel garé le dé-gare proprement (pas de boucle,
  curseur qui repart).
- Un garé « éternel » (projet supprimé partout) reste **compté et dit**
  dans le badge — jamais fondu dans un autre projet.

Épinglé par 4 tests unitaires (bloc §121 de `issueSync.test.ts`) et par
les volets E2E 3 et 4. **Aveu** : le test §117 « appliqué quand le projet
arrive » simulait lui-même le renvoi serveur — l'intention était écrite,
le mécanisme absent. L'E2E l'a prouvé en conditions réelles ; c'est
exactement pour ça qu'elle existe.

## Limites DITES (pas d'esbroufe)

- Un appareil à l'**horloge déréglée** peut gagner un conflit à tort —
  limite inhérente au dernier-écrit-gagne, assumée et documentée.
- Le téléchargement des médias est **à la demande (à l'affichage)** : pas
  de fond de téléchargement surprise sur votre forfait téléphone — choix
  assumé, réversible si vous préférez la copie complète.
- Les médias supprimés localement ne sont **pas** effacés du serveur
  (pas de DELETE média) : la pierre tombale concerne les textes et les
  projets ; le nettoyage des fichiers orphelins côté serveur est un
  jalon séparé, dit ici.
- Le volume `narchi_storage` (médias + pièces jointes mails) n'est **pas
  couvert** par pg_dump : vos sauvegardes §113 copient la BASE ; copiez
  aussi le dossier des fichiers (rappel ajouté dans
  docs/SAUVEGARDES_NARCHI.md).
- **HTTP clair** : sur le bureau (mono-poste `http://localhost:8080`),
  tout vit comme avant et rien n'est moins sûr qu'hier. Pour le
  **téléphone**, l'étape 4 est livrée (§119) mais reste à ACTIVER une
  fois chez vous — 3 gestes, cadenas prouvé, retour gratuit
  (`9_RETIRER_HTTPS_LOCAL.bat`) ; détails et limites dans
  `docs/HTTPS_LOCAL.md` (l'IP du PC peut changer → relancer le `8_` ;
  la CA Windows est liée à la machine — dit).

## Et après ?

Le plan §103 est **terminé** : 4/4 étapes livrées et mesurées, éprouvées
en navigateur réel au §121. Ce qui peut encore grandir (votre choix,
comme toujours) : purge des médias orphelins côté serveur, sauvegarde
`.bat` du volume fichiers, recopie complète préventive des médias (au
lieu du pull à l'affichage), cible d'émulation Safari/iPhone dans la
suite E2E (aujourd'hui : Chromium).
