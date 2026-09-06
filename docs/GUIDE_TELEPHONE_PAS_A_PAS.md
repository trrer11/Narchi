# Guide téléphone / HTTPS local — OPTIONNEL (§206)

> **Décision produit (23/08/2026) :** le chemin **recommandé** n'est plus
> le téléphone dans le navigateur. Au chantier : photo WhatsApp / Telegram
> → au bureau : glisser-déposer dans **Baustelle**. Plus simple, plus
> robuste, zéro CA Android. Ce guide reste pour qui *veut* HTTPS local.
> On ne le pousse plus. On ne le teste plus en priorité.

# Ancien titre : essayer la synchro avec votre téléphone (§115→§119)

**Objectif du guide : à la fin, une photo prise AU CHANTIER avec le
téléphone apparaît SUR LE PC du bureau, et un projet créé AU BUREAU
apparaît SUR LE TÉLÉPHONE. Sans câble, sans copie manuelle.**

Temps honnête : **20 à 30 minutes la première fois** (le certificat du
téléphone est le seul geste un peu technique). Ensuite, plus jamais rien
à faire — sauf changement d'IP du PC (voir §8).

Ce que ce guide N'EST PAS : pas de bluff. Chaque étape dit ce que vous
devez VOIR. Si ce n'est pas ce qui est écrit, la table « ça coince »
(§7) dit quoi faire — et si rien n'y fait, c'est moi qui corrige.

---

## 1. Ce qu'il faut avant de commencer

| Besoin | Comment vérifier |
|---|---|
| Narchi à jour (avec §115→§119 dedans) | vous êtes en train de lire ce fichier : il est venu AVEC |
| PC et téléphone **sur le même Wi-Fi** (même box) | ouvrez un site quelconque sur les deux |
| Narchi qui tourne | http://localhost:8080 s'ouvre sur le PC |
| Droits administrateur Windows | vous êtes le propriétaire du PC : c'est bon |
| 20-30 min devant vous | les gestes téléphone sont à la fin |

---

## 2. Étape 1 — mettre le nouveau code dans les images (5–15 min)

Le code est **cuit dans les images Docker** : une nouvelle fonction
exige un rebuild, sinon vous regardez l'ancienne version.

1. Sur le PC : double-cliquez **`3_REPARER_NARCHI_SANS_PERTE.bat`**.
2. Attendez la fin (la première fois après une grosse mise à jour :
   5–15 minutes ; « CONSERVE » dans le nom = vos données restent).
3. Ouvrez http://localhost:8080 et faites **Ctrl+F5** (rechargement
   complet — sinon le navigateur peut garder l'ancienne page).

**Ce que vous devez voir :** l'écran de connexion normal, et une fois
connecté, la page **Baustelle** affiche en haut un petit badge rond avec
« ⇅ » (l'état de la synchro). Pas de badge = vieille version affichée
→ refaites Ctrl+F5.

---

## 3. Étape 2 — activer le cadenas HTTPS (5 min)

Le téléphone refuse caméra et sauvegarde locale sans cadenas : c'est
**obligatoire**, pas du confort.

1. Double-cliquez **`8_ACTIVER_HTTPS_LOCAL.bat`**.
2. Windows demande les droits administrateur → **Oui** (normal :
   installer un certificat de confiance et ouvrir le pare-feu l'exigent).
3. Laissez le script travailler. Il installe mkcert s'il manque
   (téléchargement vérifié par empreinte numérique : si le fichier
   téléchargé différait d'un octet, il serait supprimé — jamais exécuté
   à l'aveugle).
4. À la fin, le script **prouve** le résultat par de vraies requêtes.

**Ce que vous devez voir à la fin (en vert) :**

```
[OK] https://localhost:8443 repond (certificat de confiance, cote PC)
[OK] https://192.168.1.20:8443 repond et est de CONFIANCE (SAN couvert)
=========================== HTTPS LOCAL ACTIF ============================
  PC        : https://localhost:8443  (le 8080 HTTP marche comme avant)
  Telephone : https://192.168.1.20:8443
```

(l'adresse 192.168.x.x sera la vôtre — **notez-la**, c'est celle du
téléphone.)

**En cas de rouge :** la cause la plus probable est dite dans le
message — « image frontend antérieure à l'étape 4 » = refaites l'étape 1
dans le bon ordre (le `3_` d'abord, le `8_` ensuite).

---

## 4. Étape 3 — poser la confiance sur le téléphone (5 min, une fois)

Le téléphone doit apprendre à faire confiance à VOTRE PC. Le fichier à
lui donner est :

```
infra\tls\certs\narchi-CA-POUR-TELEPHONE.pem
```

(visible dans l'Explorateur — c'est un certificat public de confiance,
pas un secret ; la clé PRIVÉE, elle, ne quitte jamais le dossier).

### 4a. Faire parvenir le fichier au téléphone (§205)

**Le plus simple (après le `8_`)** : sur le téléphone, même Wi-Fi, ouvrez
dans le navigateur :

```
http://ADRESSE-IP-DU-PC:8080/narchi-ca.pem
```

(ex. `http://192.168.1.20:8080/narchi-ca.pem` — **http**, port **8080**,
pas 8443). Le fichier se télécharge. 404 = le `8_` n'a pas encore copié
la CA.

Autres canaux : e-mail, USB, carte SD. Ce PEM est **public** (pas un secret).

### 4b. Android — vérité importante (Chrome / Edge)

Depuis Android 7, **Chrome et Edge n'utilisent PAS** une CA installée
comme « certificat utilisateur » pour les sites HTTPS. Installer la CA
dans Paramètres puis ouvrir Chrome → **cadenas rouge**, même si le
certificat est listé. Ce n'est pas un bug NARCHI, c'est Android.

**Chemin qui marche sans root :**

1. Installez **Firefox** depuis le Play Store (il fait confiance aux CA
   utilisateur).
2. Installez quand même la CA : *Paramètres → Sécurité → Installer un
   certificat → Certificat CA* → le `.pem`.
3. Ouvrez NARCHI **dans Firefox** : `https://IP:8443`.

Samsung/Xiaomi : le menu s'appelle parfois autrement ; cherchez
« certificat » dans la loupe des Paramètres.

**Ce que vous devez voir :** dans Firefox, cadenas **sans** page
« connexion non privée ». Si Chrome reste rouge après l'install CA :
c'est attendu — utilisez Firefox.

### 4b-bis. iPhone — inchangé (Safari)

### 4c. iPhone (iOS) — Safari OK si les DEUX réglages sont faits

1. Ouvrez le fichier reçu (Pièce jointe mail → ouvrir ; ou Fichiers).
2. *Réglages* : un **« Profil téléchargé »** apparaît en haut →
   *Installer* (code du téléphone demandé → *Installer* à nouveau).
3. **Ne pas oublier la seconde moitié** : *Réglages → Général →
   Informations → Réglages des certificats* → activez la **confiance
   complète** pour mkcert. Sans ce geste, Safari refusera encore.

**Ce que vous devez voir :** l'interrupteur mkcert en vert dans
*Réglages des certificats*.

---

## 5. Étape 4 — ouvrir Narchi sur le téléphone (1 min)

1. Sur le téléphone (toujours même Wi-Fi) : ouvrez le navigateur et
   tapez exactement :

   ```
   https://192.168.1.20:8443
   ```

   (VOTRE adresse affichée en vert à l'étape 2 — le « s » de https et
   le « :8443 » comptent.)
2. **Ce que vous devez voir :** l'écran de connexion Narchi, **avec le
   cadenas** dans la barre d'adresse, SANS page d'avertissement.
   - Page « connexion non privée » → la confiance (étape 3) n'est pas
     prise → retournez au §4b/4c, c'est toujours ça.
3. Connectez-vous avec votre compte habituel (le même qu'au bureau —
   chaque bureau ne voit QUE ses données ; règle testée 404).

**Conseil confort :** dans le navigateur du téléphone, menu →
**« Ajouter à l'écran d'accueil »** : Narchi devient une icône comme
une application (c'est le mode PWA prévu au §101).

---

## 6. Étape 5 — LE test de synchro complet (10 min)

Maintenant, on prouve la chaîne dans les DEUX sens. Suivez dans l'ordre,
chaque ligne a son « vous devez voir ».

### A. Projet créé au bureau → visible au téléphone

1. **PC** : http://localhost:8080 → connexion → créez un projet
   (nom simple : « TEST SYNCHRO »).
2. **Téléphone** : ouvrez l'icône Narchi. Attendez jusqu'à 45 s
   (le cycle de tirage) ou fermez/rouvrez la page.
3. **Vous devez voir** : « TEST SYNCHRO » dans la liste des projets du
   téléphone. **C'est la plainte « projet invisible » traitée (§118).**
   (Un rafraîchissement manuel de la page du téléphone force le cycle
   si vous êtes pressé.)

### B. Mangel + photo prise AU TÉLÉPHONE → visible AU BUREAU

1. **Téléphone** : page **Baustelle** → choisissez « TEST SYNCHRO » →
   créez un Mangel (« Fissure test »).
2. Joignez une **photo** via « Fotos importieren » (galerie ou appareil
   photo du système). NARCHI n'ouvre pas la caméra dans la page
   (`Permissions-Policy: camera=()` — volontaire). Le cadenas HTTPS
   sert surtout au **contexte sûr** (PWA, cookies Secure, iOS).
3. **Vous devez voir** : le Mangel dans la liste du téléphone avec sa
   vignette, et le badge « ⇅ » passer à **« Synchronisiert · HH:MM »**
   (heure du serveur, pas celle du téléphone).
4. **PC** : page Baustelle → « TEST SYNCHRO » → attendez un cycle
   (45 s) ou rechargez.
5. **Vous devez voir** : « Fissure test » **AVEC la photo**. La photo a
   voyagé : versement automatique à l'import côté téléphone,
   récupération à l'affichage côté PC (§118). Aucun geste.

### C. Le test qui fait peur : mode avion

C'est LE test qui prouve la file d'attente honnête :

1. **Téléphone** : passez en **mode avion**.
2. Créez un second Mangel avec photo (« Test hors-ligne »).
3. **Vous devez voir** : badge **« Offline — … warten »** — RIEN ne
   part, RIEN ne se perd, et le badge le dit au lieu de mentir.
4. Coupez le mode avion (Wi-Fi de retour).
5. **Vous devez voir** : badge repassé à « Synchronisiert » sous
   quelques secondes — et le Mangel « Test hors-ligne » **arrive au
   bureau tout seul**. Même résultat si vous fermiez le navigateur
   entre-temps : la file est sur disque, elle repart au retour.

Si A, B et C sont au vert chez vous : **la fonction marche dans la vraie
vie**, pas que dans mes tests.

---

## 7. Table « ça coince » (symptôme → cause → remède)

| Symptôme | Cause probable | Remède |
|---|---|---|
| `https://IP:8443` ne s'ouvre même pas sur le PC | étape 1 oubliée (image ancienne) | `3_REPARER…` puis `8_…` à nouveau |
| Téléphone : « connexion non privée » | confiance CA pas prise | §4b/4c refait calmement (iPhone : les DEUX réglages) |
| Téléphone : page blanche / site injoignable | pas le même Wi-Fi, ou pare-feu | même box ; le `8_` ouvre le pare-feu (Privé/Maison) ; Wi-Fi public = volontairement bloqué |
| Photo refusée au téléphone (« nicht hochladbar ») | > 25 Mio ou type non listé | c'est le plafond DIT (photos 25 Mio, vidéos 300 Mio) — la raison exacte est affichée |
| Badge « Medien: … nicht hochladbar » en rouge | refus définitif serveur | clic : le motif serveur est gardé à vue — me le transmettre tel quel |
| Projet créé il y a 30 s pas encore au téléphone | cycle de tirage (45 s) | normal ; rechargez la page pour forcer |
| Caméra absente au chantier | cadenas manquant sur CET appareil | https + étape 3 sur cet appareil |
| Après changement de box/routeur, cadenas rouge | IP du PC changée | relancer `8_ACTIVER_HTTPS_LOCAL.bat` (le téléphone garde sa confiance : pas de §4 à refaire) |
| Retour complet en arrière | — | `9_RETIRER_HTTPS_LOCAL.bat` (8080 comme avant, prouvé par mesure) |

---

## 8. Limites (dites, pas cachées)

- **Même réseau seulement** : la synchro est locale au bureau. Pas de
  nucléaire magique depuis la plage — c'est aussi une protection.
- **Photos/vidéos** : plafonds 25 / 300 Mio, types vérifiés octet par
  octet côté serveur.
- **Téléchargement à la demande** : les photos des autres appareils
  arrivent QUAND VOUS LES REGARDEZ (pas de fond de téléchargement
  surprise sur votre forfait).
- **Suppression** : les textes et projets supprimés voyagent ; les
  FICHIERS sur le serveur ne sont pas encore purgés automatiquement
  (jalon noté, pas masqué).
- **IP changeante** → relancer le `8_` ; pour du confort durable, fixez
  l'IP du PC dans votre box (optionnel).
- Documentation d'activation complète et preuves sandbox :
  `docs/HTTPS_LOCAL.md` ; garanties de la synchro :
  `docs/SYNCHRO_MANGELS.md`.
