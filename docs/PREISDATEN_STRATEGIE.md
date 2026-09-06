# Données de prix : d'où elles peuvent venir LÉGALEMENT, et comment NARCHI reste fiable

> Doc décisionnelle écrite à la demande du client (10 août 2026) :
> « l'estimation de prix est très importante et doit être fiable — y
> a-t-il des données gratuites façon BKI, ou une meilleure idée ? ».
> Règle du produit : **kein Preis ohne Herkunft** — chaque chiffre
> affiche sa source, et ce qui n'est pas mesuré porte un badge
> (Messung / Richtwert / Regel).

---

## 1. BKI, la vérité factuelle (vérifiée le 10.08.2026)

- BKI est **commercial** : Baukosten Neubau « Sparpaket » à partir
  d'environ **189–269 €**, Kostenplaner 2026 **599–712 €**, « Baupreise
  online » en abonnement (24 000+ prix), le tout avec **4 semaines de
  test gratuit**. Il n'existe **pas** de téléchargement gratuit et
  légal de la base complète — « hors site officiel » = violation de
  licence. NARCHI ne le fera pas, point.
- **Même avec un abonnement**, la licence BKI réserve l'usage à la
  « praktischen Kostenplanung » du bureau licencié ; leurs propres
  documents disent que la reprise dans des **systèmes électroniques**
  exige une autorisation expresse de l'éditeur. Autrement dit : pomper
  BKI dans un logiciel, même abonné, n'est **pas** automatiquement
  permis — il faut leur accord écrit.
- Bonnes nouvelles gratuites chez BKI quand même : leur
  **Baukostensimulationsmodell** (tableur gratuit) et leurs lettres
  d'indices trimestrielles ; et votre **Architektenkammer** négocie des
  remises membres (ex. Rheinland-Pfalz : formulaire de réduction). À
  vérifier auprès de VOTRE Kammer — parfois le Kostenplaner est inclus
  ou bradé pour les membres.

## 2. Les sources OFFICIELLES gratuites (l'épine dorsale légale)

| Source | Contenu | Licence/accès | Utilité NARCHI |
|---|---|---|---|
| **Destatis GENESIS-Online, code 61261** | Baupreisindizes : Wohngebäude, Büro, gewerblich, par Gewerk (Rohbau, Ausbau…), séries depuis 1958, trimestriel (Feb/Mai/Aug/Nov). Dernier état publié : **Fév. 2026 = +3,3 %/an** (Wohngebäude) | **Gratuit**, Datenlizenz Deutschland (attribution « Statistisches Bundesamt (Destatis), GENESIS-Online ») ; export CSV/Excel ; API REST après inscription gratuite | **Rafraîchir** un prix stocké à la date du jour (fortgeschrieben) + graphique d'évolution (#6) + badge « Regel/Index » |
| **Destatis « veranschlagte Kosten » (thème 311 / ex-53111)** | Coûts moyens DÉCLARÉS en permis par type d'ouvrage (€/m³, €/logement…), séries longues | même licence gratuite | Ordres de grandeur nationaux sourcés |
| **BBSR (rapports en téléchargement gratuit)** | Études de coûts réels, « Typengebäude » (KG 300/400), indice ARGE intégrant les qualités (EnEV…) | téléchargement libre des PDF | Etalonnage d'ordres de grandeur, citations |
| **Offices statistiques des Länder** | indices régionaux (ex. Berlin-Brandenburg en CC BY 3.0 de) | libre avec attribution | Regionalfaktoren honnêtes |
| **Eurostat (indices STS construction)** | indices zone euro comparables | libre | Contexte, tendances |

**Ce que ces sources ne donnent PAS** : des prix unitaires de positions
(EP Stahlbeton en €/m³) prêts-à-l'emploi façon BKI. Des EP fiables ne
sortent GRATUITEMENT que d'une seule place : vos propres affaires.

## 3. La mine d'or que NARCHI a DÉJÀ : vos vraies offres

Depuis §91 le produit importe les **Angebote réelles des entreprises**
(GAEB bepreist) avec provenance complète (firme, projet, date, centimes
exacts). BKI eux-mêmes font exactement ça à plus grande échelle :
collecter des prix réels, anonymiser, publier des statistiques.

**Idée (recommandée) — §95 « Preis-Spiegel »** à construire :

1. Sur chaque offre importée qui **gagne** (ou qu'on choisit) :
   bouton **« In Preisbibliothek übernehmen »** → les positions
   deviennent des entrées de bibliothèque avec
   **Herkunft = Angebot X, Firma Y, Datum Z** (réel, jamais anonymisé
   en marchandise tierce : ce sont VOS pièces contractuelles). → la
   bibliothèque s'enrichit à chaque appel d'offres, sans abonnement.
2. **Aktualisierung par indice Destatis** : la série 61261 du Gewerk
   concerné est embarquée (mise à jour trimestrielle, fichier ou API) ;
   un EP de Nov. 2024 affiché en août 2026 montre le **facteur exact**
   et son **Stand** (« fortgeschrieben mit Destatis 61261-0001,
   Stand Feb 2026 ») — badge **Regel**, jamais présenté comme mesuré.
3. Le badge existe déjà : **Richtwert/Messung/Regel** — zéro nouvelle
   promesse, que des sources.

## 4. Option « base ouverte internationale » (à décider en connaissance)

Il existe au moins une base de coûts **open data** de grande taille
(~55 000+ postes, licence CC BY 4.0). Faits à peser :
- **gratuit et légal**, MAIS attribution obligatoire de l'auteur —
  or la règle d'anonymisation de ce produit (règles du chantier §7)
  interdit justement de réintroduire des marques héritées ; nom
  volontairement absent de ce document, transmis au client en séance ;
- la profondeur **marché allemand** est non prouvée (prix « région »
  recalculés, pas des prix d'entreprises DE réelles) ;
- intégrer 55 000 prix génériques rendrait la Preisbibliothek plus
  riche en apparence et **moins fiable en fait** — inverse du cadrage
  « essentiel avec excellence ».

Recommandation : **ne pas** l'intégrer par défaut. Si un jour l'équipe
veut un coussin « cold start », alors import manuel contrôlé, marqué
Richtwert + attribution légale — décision du client.

## 5. Décision proposée (résumé)

| Brique | Effort | Statut | Apport fiabilité |
|---|---|---|---|
| Prix internes LV (déjà saisis, « manuelle Eingabe ») | — | ✅ livré §89/§90 | c'est la vérité du bureau |
| Import CSV/GAEB existant dans la Preisbibliothek | — | ✅ existant | apporte les prix possédés par le bureau |
| **Bouton « en bibliothèque » sur offre importée (§95a)** | ~1 session | 🔵 proposé | prix réels de VOS chantiers, source incluse |
| **Série Destatis 61261 embarquée + fortgeschriebene Anzeige (§95b)** | ~1 session | 🔵 proposé | fraîcheur datée, citation officielle |
| Graphique évolution indices (diagnostic #6) | ~1 session | 🔲 ouvert | ce que §95b prépare naturellement |
| Abonnement BKI du bureau, import de leurs exports GAEB | 0 code | 🔲 décision client | le standard marché, si Kammer = remise |
| Base ouverte CC BY (nom fourni au client) | — | 🔴 déconseillé | volume, pas fiabilité |

*Aucune ligne de code dans ce document n'invente une fonctionnalité :
les ✅ existent avec leurs tests, les 🔵 sont propositions, les 🔲/🔴
sont des décisions du client.*
