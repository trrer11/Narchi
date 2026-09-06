# 🧪 Guide Bêta — inviter des testeurs sur NARCHI (mode d'emploi)

_Pour le propriétaire de NARCHI. Réponse directe : **OUI, tu peux déjà
faire tester NARCHI par d'autres personnes aujourd'hui.** Voici les 3
façons, la méthode recommandée, et la checklist avant d'inviter._

---

## 1. Les 3 façons de donner accès (déjà possibles, rien à coder)

| Mode | Comment | Ce que le testeur voit | Cas d'usage |
|---|---|---|---|
| **0. Einladungslink** ⭐ (nouveau §68, le plus simple) | Toi : page **Équipe** → carte « Einladungslink » → « Neuen Link erstellen » → **Kopieren** → tu envoies le lien (WhatsApp/e-mail) | Il clique, saisit nom/e-mail/mot de passe → **son compte est créé DANS TON Arbeitsraum** | Test collaboratif (chat, canaux, partage) ; lien 72 h, usage unique, révocable |
| **A. Inscription libre** ✅ (UI ajoutée §68) | Le testeur ouvre l'URL de ton NARCHI → « Noch kein Konto? Registrieren » | **Son propre espace d'essai (tenant Trial) vierge** — il ne voit PAS tes projets, tu ne vois pas les siens | Vrai test produit indépendant : chaque cabinet teste **son** NARCHI |
| **B. Compte dans TON espace** | Toi : page **Team** → « Neues Konto » → tu lui envoies les identifiants générés | Tes projets, tes canaux, ta Preisbibliothek | Collaboration sans lien |
| **C. Compte invité (demo)** | guest-login (route backend §60) | Espace démo temporaire | Démo salon, jamais pour un vrai test |

> ✅ Mise à jour §68 : l'inscription libre et l'acceptation d'invitation
> ont maintenant une **interface** (avant, seule la route backend
> existait — impossible de s'inscrire depuis l'écran de connexion).

> Sécurité déjà en place : chaque tenant est **étanche** (intercepteur
> testé), les inscriptions/connexions/invités sont **limités à 5/min**
> et l'upload à 10/min (§60). Un testeur ne peut ni voir les données
> des autres ni saturer la machine.

## 2. Comment les testeurs REJOIGNENT ton NARCHI

Ton installation tourne sur **ton PC (localhost:8080)** : une personne
extérieure ne peut pas y accéder telle quelle. Trois options :

### Option 1 — Même réseau Wi-Fi (gratuit, 2 minutes) ✅ pour tester avec quelqu'un chez toi/au bureau
1. Lance Narchi normalement (double-clic `.bat`).
2. Trouve ton IP locale : `ipconfig` → ex. `192.168.1.42`.
3. Le testeur, sur le MÊME Wi-Fi, ouvre `http://192.168.1.42:8080`.
4. Si Windows demande : autoriser le pare-feu pour le port 8080.
**Limite** : ça ne marche que sur place, même réseau.

### Option 2 — Petit serveur cloud (la vraie solution bêta) ⭐ recommandé
1. Loue un VPS **Hetzner CX22** (~4,5 €/mois, datacentres
   Falkenstein/Nürnberg — **DSGVO OK, données en Allemagne**, argument
   commercial en plus).
2. Installe Docker → copie le dossier `narchi` → `docker compose up -d`.
3. Nom de domaine (ex. `beta.narchi.de`, ~1 €/mois) + HTTPS automatique
   (Caddy ou Traefik — ou le nginx du projet en mode production avec
   certificat Let's Encrypt).
4. Envoie le lien `https://beta.narchi.de` à tes testeurs → ils
   s'**inscrivent** (mode A), c'est parti.
**Durée : une après-midi.** C'est aussi ton futur environnement SaaS.

### Option 3 — Tunnel temporaire (démo 30 min, pas pour un vrai test)
`cloudflared tunnel` ou `ngrok` exposent ton localhost en HTTPS.
Rapide mais : dépend de ton PC allumé, URL instable. Démo uniquement.

## 3. Checklist AVANT d'inviter (important)

- [ ] **Sauvegarde** : lancer `scripts/SAUVEGARDER_LA_BASE_MAINTENANT.ps1`.
- [ ] Données : **aucune donnée client réelle** dans l'espace (RGPD) —
      uniquement des projets de test.
- [ ] Créer un **projet d'exemple** propre (1 IFC + 1 estimation DIN 276
      réussie) pour que le testeur voie de suite le « waw ».
- [ ] 2 à 5 testeurs maximum au début : idéalement des **petits bureaux
      (1-10 personnes)** — c'est la cible (voir diagnostic §C5).
- [ ] Envoyer un mini-brief (ci-dessous) + récupérer leur feedback.
- [ ] Leur dire : le bouton **„Feedback hinterlassen"** (page
      d'accueil) envoie leurs remarques directement dans ton système
      (moteur de feedback intégré) — c'est la boucle officielle.

## 4. Mini-brief à copier-coller pour tes testeurs

> Herzlich willkommen zum NARCHI-Test! Bitte probieren Sie in Ruhe:
> 1) Registrieren Sie sich (eigener Testbereich).
> 2) Laden Sie ein IFC-Modell hoch (Menü „Modell importieren").
> 3) Öffnen Sie die „Kostenschätzung nach DIN 276" — prüfen Sie die
>    Herkunfts-Badges bei den Kennwerten.
> 4) Importieren Sie eine eigene Preisliste (CSV oder GAEB X31) in der
>    Preisbibliothek.
> 5) Testen Sie den Team-Messenger unten rechts.
> Fragen dazu: Was hat Sie überzeugt? Was hat gestoppt? Was fehlt, damit
> Sie dafür bezahlen würden? Bitte über „Feedback hinterlassen" senden.
> Hinweis: Testumgebung — bitte keine echten Mandantendaten.

## 5. Vague 2, tâche 9 — LIVRÉE au §68 ✅

Invitations **par lien signé** (JWT 72 h, usage unique, révocable, table
`tenant_invites` avec audit). Reste pour plus tard : l'envoi par e-mail
directement depuis l'app (SMTP) — aujourd'hui on **copie le lien** et on
l'envoie soi-même (WhatsApp/e-mail), ce qui suffit pour la bêta.

---
_Résumé : pour tes 3 premiers testeurs → Option 1 (sur place) ou Option
2 (VPS Hetzner, recommandé). Inscription = chacun son espace ; compte
créé par toi = il travaille dans le tien._
