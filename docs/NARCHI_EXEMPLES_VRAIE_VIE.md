# NARCHI — ce que ça résout DANS LA VRAIE VIE (exemples de bureau)

> Document écrit pour le client (demande explicite) : des situations
> concrètes de cabinet d'architecture allemand, et ce que NARCHI y fait
> **aujourd'hui**. Règle absolue : **seulement ce qui existe et qui est
> testé** — les noms d'écrans et de boutons sont ceux du produit
> (allemand), rien n'est promis « pour bientôt » sans être martelé comme
> tel. Limites honnêtes tout en bas.
>
> Repères : tout se passe sur `http://localhost:8080` (après
> `3_REPARER_NARCHI_SANS_PERTE.bat` + Ctrl+F5 si le code a changé).

---

## 1. « Vendredi on remet l'Ausschreibung — et on est deux dessus »

**Situation réelle.** Frau Klein prépare le LV (Leistungsverzeichnis) du
gymnase, Herr Öztürk ajoute les positions de gros œuvre en même temps.
Avant : un Excel sur le serveur, « qui a le fichier ouvert ? », deux
versions à fusionner le jeudi soir.

**Avec NARCHI.** Les deux ouvrent la même Notiz (page **Team** → section
Notiz) et la **Positionsliste (LV)** : ils voient leurs pastilles de
curseur, chacun saisit ses lignes (OZ, texte, quantité, unité, EP),
rien ne s'écrase, le total GP se recalcule sous leurs yeux. C'est de la
co-édition réelle (CRDT), pas un verrou « fichier en lecture seule ».

**Le plus.** Quand le LV est prêt, bouton **« GAEB · ohne Preise »** →
fichier `.x31` conforme (DA XML 3.2, padding REB 23.003) à envoyer aux
entreprises. Les **EP internes du bureau ne partent JAMAIS** dans ce
fichier — c'est structurel, pas une option à cocher. *(§89, §90)*

---

## 2. « Bauer est 8 % moins cher que Schneider… vraiment ? »

**Situation réelle.** Trois offres reviennent en GAEB. L'œil nu lit les
totaux et se fait avoir : Bauer a « oublié » 12 positions → son total
est une **Teilsumme**, incomparable. Schneider a ajouté une ligne de
son cru. Müller a chiffré une position avec un EP faux d'un zéro.

**Avec NARCHI.** Chaque offre reçue (`.x31`/`.x83` bepreist) est
**hochgeladen** dans la carte **Angebote** : le parseur vérifie le
fichier (fichier **sans aucun prix = refusé** avec le message
« Ausschreibung ≠ Angebot » ; XML piégé DTD/XXE = refusé), stocke les
prix **au centime** et conserve le XML original pour l'audit. Puis
bouton **« Vergleichen »** :

- le verdict vert **« Günstigstes vollständiges Angebot »** ne choisit
  QUE parmi les offres complètes — la Teilsumme de Bauer est marquée,
  jamais couronnée ;
- la ligne inventée par Schneider porte le badge **« nur im Angebot »** ;
- l'écart de chaque EP vs votre estimation interne en % rouge/vert —
  donc le zéro manquant de Müller saute aux yeux. *(§91, §92)*

---

## 3. « Zuschlag voté : il me faut l'offre formelle pour le Bauherr »

**Situation réelle.** Le comité a choisi Schneider. Il faut joindre au
dossier (Vergabeakte) l'offre formelle en phase X83 — propre, lisible,
traçable.

**Avec NARCHI.** Bouton **« X83 »** en face de l'offre de Schneider →
`angebot-Schneider.x83` **re-généré depuis les prix vérifiés à
l'import** (pas depuis le fichier d'origine du logiciel de Schneider,
que NARCHI ne connaît pas). La phase émise est **DP=83** (la définition
de l'Angebot), la provenance est écrite DANS le fichier
(« aus geprüftem NARCHI-Import, Quelldatei DP 31 »), et une position
« ohne EP » y reste **visiblement sans prix** — NARCHI n'écrit jamais
un 0,00 € pour faire joli. *(§93)*

---

## 4. « Qui a modifié la note hier à 18 h ? On avait tout validé… »

**Situation réelle.** La note de coordination du projet a été « mal
éditée » ; le contenu validé a disparu et personne ne se souvient.

**Avec NARCHI.** Section **Versionen** : l'historique réel de la Notiz
(snapshots automatiques + manuels, 25 max) avec heure et auteur. Un
clic restaure — et **la restauration se propage en direct** sur les
écrans des collègues connectés, comme une vraie édition. *(§86)*

---

## 5. « Je bosse deux heures au calendrier — et paf, délogué »

**Situation réelle (remontée par le client).** Les invités (compte
public AK Berlin qui essaie le produit) étaient expulsés au bout de
15 minutes en pleine utilisation — calendrier, contacts, chat : des
usages LONGS de bureau.

**Avec NARCHI.** Terminé : le jeton de 15 minutes se **renouvelle en
silence** en arrière-plan (onglet ouvert, réveil d'onglet, rattrapage à
l'expiration) et les invités ont le même droit au renouvellement que
les comptes du bureau. Ce qui reste vrai par sécurité, et c'est écrit :
le jeton court reste de 15 min (compromis → vite mort), seul le
renouvellement automatique évite la coupure visible. *(§87, §88)*

---

## 6. « Mon avatar a encore sauté — et celui de ma collègue aussi »

**Situation réelle (§82–§84).** Les photos de profil « disparaissaient »
après sauvegarde. Cause racine trouvée au §87 : deux sessions de base
de données par requête → le serveur répondait « gespeichert » **sans
jamais écrire**. Réparé et **prouvé par un test de persistance HTTP**.

**Chez vous après le prochain rebuild** : redéfinir son avatar **une
fois** → il persiste et apparaît chez les collègues (≤ 30 s ou F5).
Contrôle factuel possible :
`docker exec narchi-db-1 psql -U narchi -d narchi_v3 -c "SELECT email, left(avatar_json,45) FROM users WHERE avatar_json IS NOT NULL;"`

---

## 7. « Ce prix, il sort d'où ? » — le principe du bureau, appliqué

**Situation réelle.** Un chiffre sans source, ça se paie en réunion de
chantier. La charte du produit : **kein Preis ohne Herkunft** — chaque
estimation affiche sa source, et tout chiffre non mesuré porte le badge
**Richtwert** (valeur indicative), **Messung** (mesuré) ou **Regel**
(règle appliquée).

Conséquences concrètes déjà livrées : l'export GAEB **ohne Preise** ne
peut pas fuiter un EP interne (§90) ; l'export **mit Preisen** écrit
dans le fichier « EP = manuelle Eingabe » ; une position sans prix n'est
jamais « réparée » en 0,00 € (§90, §91, §93) ; une offre totalement sans
prix est refusée à l'import avec le message qui explique pourquoi (§91).

---

## 8. Le chiffrage DIN 276 « waw » — la porte d'entrée

**Situation réelle.** Un IFC arrive. Il faut un ordre de grandeur
structuré DIN 276 avec sources, présentable, vite.

**Avec NARCHI.** IFC déposé → **~60 s** → Kostenschätzung **DIN 276**
avec sources et badges (§36) → **PDF à en-tête du bureau** (logo
choisi dans Einstellungen). C'est la formule qui présente le produit —
et le chiffrage reste honnêtement attesté comme estimation, jamais
comme un « calcul certifié ». *(§77, §79)*

---

## 9. « Mes prix de 2018, 2022, 2026 — comment NARCHI les distingue ? »

**Situation réelle (question du client, 10.08.2026).** Le bureau a un
vieux CSV de 2018, un export de 2022, et des offres reçues en 2026. Si
tout atterrit dans la même bibliothèque, qui gagne ?

**Avec NARCHI (§97).** Chaque prix porte **SON millésime**
(`Preisstand-Jahr`) : dans le CSV c'est la colonne `jahr` (sinon l'année
choisie dans l'assistant d'import s'applique à tout le lot), dans un
GAEB c'est l'année saisie à l'import (la norme n'en porte pas), dans
une offre c'est **automatiquement l'année de réception**. Ensuite :

- **l'écran les distingue** : badges d'année dans la bibliothèque,
  « Preisstände » listés dans les statistiques, et le Verlauf montre
  chaque lot avec sa plage d'années ;
- **à l'usage, c'est la règle qui tranche** : à position égale, **un
  millésime plus ancien ne remplace JAMAIS un plus récent** — importer
  le CSV de 2018 après celui de 2026 est refusé ligne à ligne, compté,
  et le rapport nomme les OZ concernées (« der neuere Preisstand
  bleibt ») ;
- **l'indexation Destatis** projette un prix de 2022 vers l'année
  courante **avec le facteur affiché** (« indexiert 2022→2026 ×1,08… ») ;
- **avant 2020, honnêteté complète** : la série officielle embarquée
  commence en 2020 → un prix de 2018 **ne peut pas être indexé** —
  NARCHI le dit (« keine Indexierung möglich… bitte auffrischen ») au
  lieu d'afficher un « ×1 » muet, et le Verlauf alerte déjà au-delà de
  12 mois sans mise à jour ;
- **l'historique des offres** (Preisspiegel §96) garde les deux années
  et **les marque** (« Jahrgänge 2018–2026 · Rohwerte, nicht
  indexiert ») quand un lot mélange les millésimes.

En clair : le plus récent gagne en bibliothèque, l'histoire reste
visible au centime près, et tout prix qu'on ne peut pas actualiser
proprement **le dit** au lieu de faire semblant.

---

## 10. « Un chiffre fou ne casse plus mon devis » — la médiane à la rescousse

**Situation.** Votre bibliothèque contient trois prix pour les murs
(KG 320) : 120 €/m² (2023), 135 €/m² (2026)… et **9 000 €/m²**, tapé à
la va-vite un soir (le bureau qui l'a saisi visait un prix global et a
laissé l'unité en « m² »).

**Avant §99.** NARCHI prenait la position « la plus récente » — si la
folle était la dernière importée, tout un devis partait avec un EP de
9 000 €. Un seul chiffre fou fabriquait un devis fou.

**Maintenant.** Dès qu'une Kostengruppe a **au moins deux prix propres
de même unité**, l'estimateur éclaire avec la **valeur du milieu**
(médiane) : 120 / 135 / 9 000 → **135 €/m²**. Le chiffre fou existe
toujours en bibliothèque (on ne l'efface pas derrière votre dos), mais
il ne dirige plus l'estimation. La ligne du devis le dit noir sur
blanc : « eigene Preise · **Median n=3** » puis « Median aus 3 eigenen
Preisen (m²), je auf 2026 indexiert · Jahrgänge 2023–2026 ».

Deux garde-fous honnêtes :

- **chaque prix est actualisé à SON année AVANT** la médiane (un prix
  2018 et un prix 2026 ne sont jamais moyennés en vrac — sinon la
  statistique mentirait) ;
- **unités jamais mélangées** : si la KG contient aussi un prix « St »,
  il est écarté du calcul m² et la ligne le dit (« 1 Preis anderer
  Einheit nicht vermischt ») — des €/m² et des €/pièce ne font pas une
  statistique.

En clair : un seul prix = sa vérité ; plusieurs prix = leur milieu —
et chaque choix reste lisible sur la ligne du devis.

---

## 11. « Sur le chantier, il n'y a pas de réseau » — l'application qui s'ouvre quand même

**Situation.** Visite de chantier, salle des machines : ni WLAN ni
réseau mobile. Avec une appli web classique, l'écran reste blanc.

**Avec NARCHI (§101, PWA installée).** L'application s'est installée
comme une vraie appli (icône Narchi sur l'écran d'accueil, fenêtre
propre). Elle **s'ouvre hors-ligne** : toute la coquille — navigation,
écrans — est embarquée, et les métrés/listes d'éléments déjà extraits
(persistés en IndexedDB) restent consultables. Ce qui dépend du serveur
du bureau (prix, offres, projets partagés) **échoue visiblement** au
lieu de mentir : une vieille valeur servie « comme si elle était
fraîche » serait dangereuse — NARCHI préfère dire « pas réseau » plutôt
qu'afficher du périmé. Les messages/notes partent dans la file
d'attente (OfflineOutbox) et se synchronisent au retour du réseau.
**Dit, pas caché** : le fichier IFC 3D lui-même ne survit pas à un
rechargement (donnée binaire volatile) — à emporter sur le disque de la
tablette si la visionneuse doit servir hors-ligne.

**Bonus quotidien au bureau.** Après chaque mise à jour du produit
(votre `3_REPARER...bat`), une pastille en bas d'écran propose
« Neue NARCHI-Version bereit — Jetzt neu laden ». Fini la corvée
Ctrl+F5 en se demandant si on voit la bonne version : la pastille ne
disparaît que quand la nouvelle version tourne.

**Ce qui n'est PAS promis** (dit) : la synchronisation hors-ligne des
PRIX/DEVIS (les calculs restent côté serveur, vérifiés par les tests) —
hors-ligne, NARCHI montre et fait saisir ; il ne fabrique pas de chiffre
sans le serveur.

**La page chantier existe (§104) — et elle suit l'idée du client** :
l'architecte photographie normalement avec son téléphone (appareil photo
natif, aucune appli à ouvrir sur place). De retour **au bureau**, il
branche le téléphone (ou copie le dossier `DCIM`) et glisse les images
dans l'onglet **Baustelle** (JPEG, PNG, WebP, GIF, BMP — depuis §105 ;
les HEIC d'iPhone sont refusés avec le réglage qui convertit en JPEG,
parce qu'aucun navigateur ne saurait les afficher). Exemple : 25 photos
d'un matin de chantier →
Narchi reconnaît les vraies dates de prise de vue (EXIF, écrit par
l'appareil) et affiche « Besuch vom 01.08.2026 · 2 séances 09:12–09:31 et
10:04–10:27 ». On coche la séance de 10:04, on écrit « Riss in
Treppenlauf OG 2 », Gewerk NMC, gravité → **un vrai Mangel du projet**,
daté du **jour de la photo** (Tag 61, preuve) et pas du jour de saisie,
avec les photos jointes (visibles aussi au cockpit, onglet Issues).

Ce qui est dit, pas caché : (1) le tri n'utilise **que les dates** —
Narchi ne « regarde » pas le contenu des photos (pas d'IA qui « voit »
une fissure : l'écran dit « keine Bilderkennung ») ; (2) si une photo
n'a pas de date EXIF, Narchi tente son nom (`IMG_20260801_091200.jpg`),
puis la date du fichier — et **dit laquelle** (« Dateiname » /
« Dateidatum — Aufnahmedatum fehlt! ») ; (3) tout reste sur CE poste
(IndexedDB) : pas de synchronisation entre appareils, jamais promise.
Photos importées puis abandonnées sans Mangel ? Elles sont balayées au
retour sur la page — le disque ne gonfle pas dans le dos de l'utilisateur.

*(Histoire honnête : une première page « tout sur le téléphone au
chantier » (§102) a été écrite puis **supprimée au §103** à la demande
du client — le hors-ligne téléphone est techniquement impossible sur un
serveur local en simple HTTP, et l'idée du client est simplement
meilleure pour son usage réel.)*

---

## Ce que NARCHI ne fait PAS encore (dit, pas caché)

- **Page d'accueil marketing (Landing)** : encore en français alors que le
  produit est allemand — la connexion, elle, est corrigée (**§100** :
  épurée, 100 % allemande, sans slogans invérifiables).
- **Validateur GAEB officiel** : il n'existe pas hors ligne ; la
  conformité est prouvée chez nous par **round-trip** (le produit relit
  ce qu'il émet, tests §90/§91/§93) — pas par tampon officiel.
- Ancien PDF de pitch avec mentions trop fortes (« calcul certifié ») :
  nettoyage toujours différé, énoncé.

*Chaque scénario ci-dessus renvoie aux sections du
`CHANGELOG_NARCHI_V6.md` (§n) où le correctif/la fonction est prouvée
par ses tests — compteurs dans le README (« Où on en est »).*
