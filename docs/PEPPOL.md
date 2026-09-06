# Peppol & UBL — où en est Narchi, honnêtement (§130)

> Document client (français simple). Écrit le 16/08/2026 après la livraison
> de la **syntaxe UBL** (§130). Il sépare ce qui est PROUVÉ de ce qui reste
> un jalon d'infrastructure — pour ne jamais vendre « Narchi envoie via
> Peppol » tant que l'envoi n'a pas été branché et prouvé.

---

## En 3 phrases

1. **Narchi sait désormais parler les DEUX syntaxes de la facture
   électronique européenne** : CII (XRechnung classique + ZUGFeRD/Factur-X,
   §114/§129) **et UBL 2.1** (§130) — la syntaxe que transporte le réseau
   Peppol. Les deux sont **validées par le programme officiel de l'État
   allemand (KoSIT)** : « ACCEPTABLE », mesuré le 16/08/2026, rejouable
   (`scripts/valider-ubl-kosit.sh`).
2. **Ce qui manque encore pour « envoyer via Peppol » n'est PAS du code de
   facture** : c'est un **abonnement à un Access Point** (fournisseur de
   service certifié Peppol) + des **identifiants de participant** (Peppol
   Participant ID). Le payload est prêt ; le tuyau ne l'est pas encore.
3. **Rien n'est simulé** : le XML UBL sort de Narchi exactement conforme,
   mais tant qu'il n'y a pas d'Access Point configuré chez le bureau, Narchi
   télécharge le fichier et le bureau l'envoie par son canal actuel (e-mail,
   portail client, ou son propre outil Peppol).

---

## Ce qui est PROUVÉ (§130, 16/08/2026)

| Point | Preuve |
|---|---|
| Syntaxe UBL 2.1 (OASIS) conforme EN 16931 | validateur KoSIT v1.6.2, scénarios « EN16931 (UBL Invoice) » + « EN16931 XRechnung (UBL Invoice) » → **ACCEPTABLE, 0 rejet** |
| Même modèle métier que CII (zéro valeur inventée, Decimal au centime) | `app/services/ubl.py` réutilise `valider()` et `calculer_totaux()` de §114 — une seule arithmétique pour les 2 syntaxes |
| Adresses électroniques Peppol (BT-34/49) correctes | `cbc:EndpointID` schemeID « EM » — règles Peppol R010/R020 mesurées au validateur |
| Téléchargement | `GET /api/v5/invoices/{id}/xrechnung-ubl.xml` (mêmes gardes GoBD que le XML CII) |
| Tests | +3 (structure + arithmétique + refus honnêtes) → backend 512→515 |

## L'e-mail est prêt (§131), Peppol reste différé

Depuis §131, Narchi produit en plus un **e-mail .eml prêt à l'envoi**
(`.../versand.eml`) avec la facture hybride jointe : le bureau l'ouvre dans
son client mail et l'envoie. C'est le canal humain par défaut — pas de SMTP
intégré (il faudrait les identifiants du serveur de messagerie de chaque
bureau), pas de faux statut « envoyé ».

## Ce qui reste (envoi Peppol réseau, DIFFÉRÉ — jamais prétendu)

| Brique | Ce que c'est | Qui la fournit |
|---|---|---|
| **Access Point** | Le logiciel/service qui reçoit le payload UBL et le route sur le réseau Peppol (AS4, SMP/SML) | un fournisseur Peppol accrédité (ex. Tickstar, Storecove, Banqup, ...) — pas Narchi |
| **Peppol Participant ID** | L'identifiant unique du bureau sur le réseau (ex. `9933:DE123456789`) | attribué via l'Access Point |
| **Leitweg-ID** (secteur public) | déjà gérée (BT-10, §123) pour XRechnung | le marché/contrat public |
| **Intégration** | Narchi → API de l'Access Point (envoi + statut) | à développer quand un bureau en aura besoin |

**Recommandation honnête** : pour la beta 3-5 bureaux, **ne pas brancher
Peppol tout de suite**. L'obligation B2B ne tombe que fin 2027/2028, et un
bureau beta enverra ses factures par e-mail (le PDF hybride ZUGFeRD §129 est
déjà lisible par un humain ET une machine). Brancher Peppol trop tôt = un
abonnement par bureau + une intégration que personne n'utilise encore.

---

## Limites dites

- Le profil UBL **XRechnung** exige les mêmes champs que le CII (Leitweg-ID,
  IBAN, contact, e-mails) — refus honnêtes NARCHI-XR-… identiques.
- Les règles Peppol BIS **complètes** (au-delà de ce que KoSIT vérifie pour
  XRechnung) ne sont pas encore éprouvées par un validateur Peppol dédié :
  c'est le rôle de l'Access Point au moment du branchement. Le validateur
  KoSIT couvre déjà EN 16931 + CIUS XRechnung (UBL), ce qui est le périmètre
  allemand.
