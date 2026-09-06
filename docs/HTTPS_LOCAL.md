# HTTPS local — OPTIONNEL (§206)

> **Décision produit (23/08/2026) :** ne plus construire NARCHI autour du
> téléphone dans le navigateur (CA Android, Firefox, IP qui change,
> pare-feu). Chemin officiel : **WhatsApp / Telegram → import Baustelle
> au bureau**. Ce fichier décrit encore `8_` / `9_` pour qui les utilise.
> Ce n'est plus un jalon bloquant.

# Ancien titre : le cadenas qui débloque le téléphone (étape 4)

**Date : 12 août 2026 · §119 — la dernière marche du plan de synchro
annoncé au §103. Après elle : photos du téléphone vers le bureau, sans
câble, sans copie manuelle.**

## 1. Pourquoi c'est obligatoire (et pourquoi ce n'est pas un caprice)

Un téléphone **refuse tout ce qui est moderne** sur une adresse en
`http://192.168.x.x` : la photo prise depuis la page web (appareil
photo), le mode hors-ligne (service worker), le chiffrement dans le
navigateur. Tout cela n'existe que dans un **« contexte sécurisé »** —
c'est-à-dire `https://` avec un cadenas valide, ou `localhost` sur le PC
lui-même (c'est pour ça que le bureau marche depuis toujours sans
cadenas, et pas le téléphone : `localhost` n'est intrinsèquement sûr que
sur la machine elle-même).

Exemple de la vraie vie : sans ce cadenas, vous ouvrez
`http://192.168.1.20:8080` sur le chantier, la page s'affiche… et la
photo que vous prenez ne part jamais, le navigateur bloque la fonction
silencieusement. C'est exactement le genre de silence qu'on élimine ici.

La solution retenue : **mkcert**, l'outil standard pour fabriquer un
certificat LOCAL de confiance. Pas de domaine à acheter, pas d'autorité
payante, pas de fuite : tout reste dans votre bureau.

## 2. Les 3 gestes (10 minutes la première fois)

### Geste 1 — sur le PC (celui où tourne Narchi)

Double-cliquez **`8_ACTIVER_HTTPS_LOCAL.bat`** à la racine du projet.
Une fenêtre demande les droits administrateur (Windows l'exige pour
installer un certificat de confiance et ouvrir le pare-feu) : acceptez.

Le script fait ensuite, dans l'ordre, **et le prouve à la fin** :

1. installe mkcert si absent (via winget, sinon téléchargement officiel
   **vérifié par empreinte numérique** : si le fichier téléchargé n'est
   pas exactement celui attendu, il est **supprimé sur-le-champ** et le
   script refuse — jamais un programme pris à l'aveugle) ;
2. installe l'autorité de certification locale (CA) dans Windows ;
3. fabrique le certificat pour `localhost` **et les adresses IP du PC**
   (celles que le téléphone utilisera) ;
4. active le port **8443 en HTTPS** d'Narchi (le `http://localhost:8080`
   habituel continue EXACTEMENT comme avant — prouvé par test) ;
5. ouvre le pare-feu Windows sur 8443, **réseau privé uniquement** —
   jamais en Wi-Fi public ;
6. relance le serveur web et **vérifie par de vraies requêtes** que le
   cadenas fonctionne, sur localhost et sur chaque IP.

### Geste 2 — sur le téléphone (une seule fois par téléphone)

Le téléphone doit apprendre à faire confiance à VOTRE PC :

1. Récupérez le fichier **`infra\tls\certs\narchi-CA-POUR-TELEPHONE.pem`**
   (visible dans l'Explorateur). Envoyez-le vous par mail, USB ou carte
   SD — c'est un certificat PUBLIC de confiance, pas un secret.
2. Installez-le :
   - **Android** : *Paramètres → Sécurité → Chiffrement et identifiants →
     Installer un certificat → Certificat CA* → choisissez le fichier
     (le chemin exact varie un peu selon Samsung/Xiaomi/…, la notion est
     la même).
   - **iPhone** : ouvrez le fichier reçu (mail/fichiers) → *Réglages →
     Profil téléchargé → Installer* → puis **obligatoire** :
     *Réglages → Général → Informations → Réglages des certificats* →
     activez la confiance complète pour mkcert.

### Geste 3 — ouvrir Narchi sur le téléphone

Dans le navigateur du téléphone (même Wi-Fi que le PC) :
**`https://ADRESSE-IP-DU-PC:8443`** (ex. `https://192.168.1.20:8443` —
le script vous a affiché les adresses exactes en vert à la fin).

Le cadenas est là, la photo part, le service worker s'installe. La
synchro (projet, Mängel, photos/vidéos) fait le reste toute seule.

## 3. Ce qui a été PROUVÉ (rejoué dans le sandbox, vrai nginx)

Le **vrai fichier de configuration livré** a été exécuté sous nginx
1.26.3 avec une CA fabriquée comme le fera mkcert. Mesures (les
substitutions du banc d'essai sont dites : chemins /etc→/tmp, backend
remplacé par un stub qui avoue être un stub) :

| Cas | Résultat mesuré |
|---|---|
| Dossier d'activation VIDE (client sans l'étape 4) | nginx valide, 8080 répond, **8443 muet**, AUCUN changement |
| 8443 activé (le « copier » du script) | `https://localhost:8443/` → **200**, CSP/HSTS présents |
| API via le cadenas | `/api/v5/healthz` rejoint le backend (200) |
| 8080 pendant que 8443 vit | **toujours 200** (coexistence) |
| IP absente du certificat | refus net : « no alternative certificate subject name matches » |
| Téléphone SANS la CA installée | refus net : « unable to get local issuer certificate » |

Les deux derniers refus sont la **raison d'être des gestes 1 et 2** :
sans certificat couvrant l'IP ou sans CA installée, le navigateur
bloque — et Narchi vous le dira au lieu de fouiner.

## 4. Limites DITES (pas d'esbroufe)

- **L'IP du PC peut changer** (box en attribution automatique) →
  relancez `8_ACTIVER_HTTPS_LOCAL.bat`, c'est fait pour. Le téléphone
  **garde sa confiance** (la CA ne change pas) : seul le certificat du
  PC est refait. Pour une adresse stable, fixez l'IP du PC dans la box
  (confort, pas une obligation).
- **La CA installée vaut pour toute la machine Windows** : c'est le
  principe même d'un certificat local. Un attaquant qui volerait la clé
  PRIVÉE de cette CA (dossier caché de mkcert, pas notre dossier
  `infra\tls`) pourrait signer de faux sites *vus par ce PC* — gardez le
  PC verrouillé comme d'habitude. Pour tout retirer :
  `9_RETIRER_HTTPS_LOCAL.bat` puis `mkcert -uninstall` (volontairement
  manuel : on ne retire pas une confiance sans vous).
- **Le certificat a une durée de vie** (des années, pas éternel) : le
  jour où le navigateur se plaint, relancez le `8_` — 30 secondes.
- **8443 seul** : le pare-feu n'est ouvert que sur les réseaux
  « privé/domaine » : au Wi-Fi d'un hôtel ou d'un café, votre Narchi
  ne s'affiche pas — et c'est voulu.
- **Téléphone et PC sur le MÊME réseau** : la synchro est locale, pas de
  cloud. Depuis l'extérieur du bureau, ça ne passe pas — c'est aussi une
  protection.
- **Pas de caméra dans la page** : Baustelle importe un fichier (galerie
  / appareil photo système). L'en-tête `Permissions-Policy: camera=()`
  est volontaire. Le HTTPS sert au contexte sûr (PWA, cookies, iOS).
- **Essai physique** : ce document n'a pas été rejoué sur un vrai
  téléphone dans cette session. Le chemin Android Firefox est de la
  documentation plateforme, pas une mesure NARCHI.

## 5. Où regarder si ça coince

1. Le `8_` affiche en rouge la cause exacte (la plus fréquente : image
   pas à jour → `3_REPARER_NARCHI_SANS_PERTE.bat` d'abord, puis le `8_`).
2. `https://localhost:8443` doit marcher **sur le PC** avant tout essai
   téléphone. Si oui sur le PC mais cadenas cassé au téléphone → geste 2
   (CA) refait calmement.
3. Test côté PC de l'adresse du téléphone : `https://192.168.x.x:8443`
   dans le navigateur du PC — si le PC la refuse, le téléphone la
   refusera aussi (c'est le même contrôle).
