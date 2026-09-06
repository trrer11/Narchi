# E-Rechnung (XRechnung) — Guide client Narchi

_Publié au §116 · demande client : « finis d'abord la E-Rechnung »._

## En 3 phrases

1. **Ça marche, pour de vrai :** Narchi garde vos factures en base, leur
   attribue un numéro officiel à l'émission (RE-2026-0001, 0002…), les
   fige comme l'exige la loi (GoBD), et produit le fichier XML électronique
   au profil **XRechnung 3.0** (EN 16931, syntaxe CII — la même famille
   que ZUGFeRD). Chaque geste est testé : 17 tests serveur + 15 tests
   d'écran, 450/450 et 597/597 verts ce jour.
2. **Validateur officiel KoSIT : FAIT (§123, 13/08/2026).** Le XML de
   Narchi (les DEUX profils, plus le XML du chemin écran → serveur →
   téléchargement) a été soumis au programme officiel de l'État
   (Validator v1.6.2 + configuration XRechnung 3.0.2 du 31/01/2026) :
   verdict « ACCEPTABLE » partout, « Validation successful! ».
   La preuve est rejouable en une commande :
   `bash scripts/valider-xrechnung-kosit.sh`. Cette course a d'ailleurs
   trouvé et corrigé 6 vrais défauts (identifiant de profil, nom de balise
   ville, IBAN BG-16, contact BG-6, processus BT-23, e-mails BT-34/49) —
   détail daté dans `docs/RAPPORT_BETA_MARCHE_PRIX.md`, addendum §123.
   Reste ouvert, dit honnêtement : le branchement d'un job CI HÉBERGÉ qui
   rejouerait ce script à chaque version (préparé, pas encore exécuté).
3. **Le XML correspond exactement à ce que vous avez saisi** — aucune valeur
   n'est inventée : si un champ obligatoire manque (Leitweg-ID, USt-IdNr…),
   Narchi **refuse d'émettre** et vous nomme précisément ce qui manque.

## Ce que c'est, en vraie vie

À partir de 2027/2028, les factures électroniques deviennent progressivement
**obligatoires** en Allemagne (B2B, puis émission). Une facture PDF « à la
main » ne suffira plus : il faut un fichier XML structuré. Narchi le produit
déjà, dans le profil allemand du secteur public (XRechnung).

## Comment s'en servir (5 gestes)

1. **AGENCY OPS → Rechnungen** dans le menu, bouton **« + Neue Rechnung »**.
2. Remplissez le client (Kunde) et VOTRE bureau (Absender — mémorisé sur
   l'appareil pour les fois suivantes). La **Leitweg-ID** est obligatoire
   pour le profil XRechnung : c'est l'« adresse de facturation » de la
   collectivité, elle figure dans son marché/bescheid.
3. Ajoutez les **Leistungen** (lignes) : désignation, quantité, unité,
   prix net, taux 19 % ou 7 %. Le bloc en bas montre un **aperçu**
   (netto/MwSt/brutto) calculé avec exactement les mêmes règles que le
   serveur — arrondi par ligne au centime, TVA par taux.
   Renseignez le **Leistungsdatum** (date de livraison) **OU** un
   **Zeitraum** (période) : XRechnung en exige au moins un.
4. **« Entwurf speichern »** : c'est un brouillon — modifiable,
   supprimable, sans numéro. Bouton **« Pflichtangaben prüfen »** : la
   liste précise de ce qui manque éventuellement (les codes NARCHI-XR-01/02
   « numéro / date » sont normaux sur un brouillon : le serveur les
   attribue à l'émission).
5. **« Ausstellen »** : le serveur attribue le **numéro** et la **date**,
   et la facture devient **inchangeable**. Bouton **« XML herunterladen »**
   → `RE-2026-0001.xml` prêt à joindre à votre e-mail au client.

## Règles du jeu (et pourquoi elles vous protègent)

- **Une facture émise ne se supprime jamais, ne se modifie jamais.**
  Erreur ? **« Stornieren »** avec motif : la facture est marquée
  « Storniert » et le numéro reste **réservé**. Une chaîne de numéros
  avec un trou (0001, 0003, 0004…) est un signal d'alerte en révision
  fiscale ; chez Narchi c'est **impossible** (compteur par année, trou
  structurellement exclu : un essai d'émission refusé ne consomme pas de
  numéro).
- **Brouillon ≠ facture.** Un brouillon peut être supprimé ; il n'a ni
  numéro ni date — tant qu'il n'est pas émis, rien d'officiel n'existe.
- **L'argent n'est jamais un nombre flottant** : tout est en chaînes
  décimales exactes de l'écran jusqu'au XML (ex. réel éprouvé par les
  tests : 3 × 33,3350 € = 100,005 € → **100,01 €** ; 87,50 € × 7 % de TVA
  = **6,13 €**, jamais 6,12 à cause d'un arrondi machine).
- **Cloisonnement :** chaque bureau ne voit QUE ses factures et a SA
  propre chaîne de numéros (testé : deux bureaux, deux « 0001 »).

## Limites HONNÊTES (ce qui n'est pas encore là)

| Limite actuelle | Ce que ça veut dire | Jalon |
|---|---|---|
| ~~Validateur KoSIT~~ → **PASSÉ §123** (mesuré le 13/08/2026, rejouable par script). Ce qui reste : pas de job CI **hébergé** qui le rejoue tout seul à chaque version | La conformité est prouvée UNE fois mesurée + vérifiable par chacun localement ; l'automatisme continu n'est pas encore branché | prochain grand pas E-Rechnung |
| TVA catégorie **S** uniquement | Pas de facture sans TVA, autoliquidation (Reverse-Charge §13b) ou exonération intra-UE : Narchi refuse au lieu de deviner | avec le validateur |
| Deux profils prêts, un seul exposé | L'écran émet en **xrechnung** (le profil allemand, exigeant) ; le profil européen en16931 existe côté service | sur besoin |
| ~~Pas d'envoi intégré~~ → **e-mail .eml LIVRÉ §131** (16/08/2026) | E-mail prêt à l'envoi (`.../versand.eml`) avec la facture hybride jointe ; le bureau l'envoie depuis son client mail. Pas de SMTP intégré (dit) ; Peppol réseau = Access Point requis, différé | ✅ fait (e-mail) ; Peppol différé (`docs/PEPPOL.md`) |
| ~~Pas de PDF/A-3 embarqué (ZUGFeRD/Factur-X)~~ → **LIVRÉ §129** (16/08/2026) | Le PDF lisible par le client + XML dans le même fichier : `factur-x.xml` embarqué, **PDF/A-3b conforme prouvé par Mustang** (veraPDF + Schematron, `scripts/valider-zugferd-mustang.sh`) | ✅ fait |
| ~~Syntaxe UBL 2.1 (Peppol)~~ → **LIVRÉ §130** (16/08/2026) | La même facture en syntaxe UBL (celle du réseau Peppol), téléchargement `.../xrechnung-ubl.xml`, **validée par KoSIT** (scénarios UBL, `scripts/valider-ubl-kosit.sh`) | ✅ fait (la SYNTAXE) ; l'ENVOI Peppol reste différé (`docs/PEPPOL.md`) |
| Champs « vendeur » saisis par facture mémorisés DANS L'APPAREIL | Pas encore de fiche « mon bureau » centralisée serveur | confort, sans urgence |

## Technique (pour mémoire)

- Service : `backend/app/services/xrechnung.py` (§114, zéro dépendance,
  valeurs jamais inventées, violations nommées NARCHI-XR-01…36).
- Hybride ZUGFeRD/Factur-X : `backend/app/services/zugferd_pdf.py` (§129,
  PDF/A-3b + `factur-x.xml` embarqué, police VERA + profil ICC sRGB en
  constante, zéro dépendance nouvelle).
- Syntaxe UBL 2.1 : `backend/app/services/ubl.py` (§130, réutilise le modèle
  §114 — une seule arithmétique pour les deux syntaxes).
- Versand : `backend/app/services/versand.py` (§131, e-mail .eml RFC 5322,
  facture hybride jointe, zéro dépendance).
- Persistance : tables `invoices` + `invoice_counters` (migration
  20260812_16, additive), clés composites (tenant_id, id) comme §115.
- API : `/api/v5/invoices` (GET/POST/PUT/DELETE + `issue` / `cancel` /
  `validation` / `xrechnung.xml` / `zugferd.pdf` / `xrechnung-ubl.xml` /
  `versand.eml`), cycle GoBD appliqué côté serveur.
- Écran : `AGENCY OPS → Rechnungen` (allemand, aperçu exact en BigInt).
