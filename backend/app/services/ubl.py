"""§130 — Syntaxe UBL 2.1 pour l'E-Rechnung (EN 16931, profil XRechnung ou générique).

Le service §114 écrit le XML en syntaxe CII D16B (UN/CEFACT) — celle de
XRechnung « classique » et de l'hybride ZUGFeRD/Factur-X §129. Ce module-ci
écrit la MÊME facture en syntaxe **UBL 2.1 (OASIS)** : c'est la seconde
syntaxe autorisée par EN 16931, et celle que transporte le réseau **Peppol**
(Peppol BIS 3.0).

Pourquoi c'est important pour le client : le jour où un bureau envoie sa
facture via Peppol (l'obligation B2B 2027/28 passera par ces réseaux), le
payload est du UBL. Avoir les DEUX syntaxes produites par le même modèle
métier (aucune valeur inventée, Decimal partout) évite un chemin parallèle
qui divergerait d'un centime.

Ce que ce module FAIT :
  * `construire_ubl(facture, profil)` → UBL Invoice 2.1 conforme EN 16931,
    profil `xrechnung` (CIUS allemand, mêmes règles BR-DE que le CII) ou
    `en16931` (générique) ;
  * réutilise `valider()` et `calculer_totaux()` de §114 — UNE SEULE
    arithmétique et UNE SEULE liste de violations pour les deux syntaxes ;
  * zéro dépendance (stdlib `xml.etree`), Decimal anti-centimes, aucune
    valeur inventée (champ manquant = refus, jamais deviné).

Ce que ce module ne PRÉTEND PAS :
  * **Peppol = l'ENVOI réel sur le réseau** (Access Point, AS4, SMP/SML,
    identifiants de participant). Ceci est la SYNTAXE du payload, pas le
    transport. L'envoi exige un fournisseur d'Access Point et des
    identifiants — jalon « Versand » (§129/README), DIFFÉRÉ et dit, jamais
    simulé. Un PDF/XML Peppol ne « s'envoie » pas tout seul.
  * La conformité est PROUVÉE via le validateur officiel KoSIT (scénarios
    « EN16931 XRechnung (UBL Invoice) » et « EN16931 (UBL Invoice) ») —
    rejouable par `scripts/valider-ubl-kosit.sh`.

Provenance : écrit en salle blanche à partir du standard public EN 16931-1
(mapping syntaxique CII↔UBL) et du schéma public UBL 2.1 (OASIS). Aucun code
tiers copié (doctrine §114 — zéro ligne AGPL chez nous). L'ordre des éléments
respecte la séquence `InvoiceType` du XSD UBL-Invoice-2.1 et les types
`PartyType`, `AddressType`, `TaxSubtotalType`, etc. (CommonAggregateComponents).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from decimal import ROUND_HALF_UP, Decimal

from app.services.xrechnung import (
    GUIDELINE_EN16931,
    GUIDELINE_XRECHNUNG_3,
    UNITE_CODES,
    XRechnungError,
    Facture,
    Partie,
    PROFILES,
    _fmt_montant,
    _fmt_prix,
    _fmt_qte,
    calculer_totaux,
    valider,
)

# Espaces de noms UBL 2.1 (OASIS).
INV = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
for _p, _u in {"": INV, "cac": CAC, "cbc": CBC}.items():
    ET.register_namespace(_p, _u)
_NS: dict[str, str] = {"": INV, "cac": CAC, "cbc": CBC}


def _q(prefix: str, local: str) -> str:
    return f"{{{_NS[prefix]}}}{local}"


def _sub(parent: ET.Element, prefix: str, local: str, texte: str) -> ET.Element:
    el = ET.SubElement(parent, _q(prefix, local))
    el.text = str(texte)
    return el


def _add_party(
    parent: ET.Element,
    role_tag: str,  # "AccountingSupplierParty" | "AccountingCustomerParty"
    p: Partie,
    *,
    avec_vat: bool,
    contact: dict[str, str] | None = None,
) -> None:
    """BG-4 / BG-7. L'ordre respecte PartyType : EndpointID → PostalAddress →
    PartyTaxScheme → PartyLegalEntity → Contact.

    Deux adresses électroniques DISTINCTES en UBL (leçon §123, réappliquée) :
      * BT-34/BT-49 (adresse électronique de routage Peppol) → cbc:EndpointID
        avec schemeID « EM » (règles R010/R020) — c'est p.email ;
      * BG-6 (contact vendeur : nom + téléphone + e-mail, règle BR-DE-2) →
        cac:Contact/cbc:Name + Telephone + ElectronicMail.
    """
    role = ET.SubElement(parent, _q("cac", role_tag))
    party = ET.SubElement(role, _q("cac", "Party"))

    # BT-34/BT-49 — adresse électronique (EndpointID, AVANT PostalAddress).
    if p.email.strip():
        eid = ET.SubElement(party, _q("cbc", "EndpointID"))
        eid.text = p.email.strip()
        eid.set("schemeID", "EM")

    # Adresse postale (BG-5/BG-8) : StreetName, CityName, PostalZone, Country.
    adresse = ET.SubElement(party, _q("cac", "PostalAddress"))
    _sub(adresse, "cbc", "StreetName", p.rue)
    _sub(adresse, "cbc", "CityName", p.ville)
    _sub(adresse, "cbc", "PostalZone", p.code_postal)
    pays = ET.SubElement(adresse, _q("cac", "Country"))
    _sub(pays, "cbc", "IdentificationCode", p.pays)

    # TVA (BT-31, vendeur seulement) : CompanyID + TaxScheme/ID=VAT.
    if avec_vat and p.vat_id.strip():
        tax_scheme = ET.SubElement(party, _q("cac", "PartyTaxScheme"))
        _sub(tax_scheme, "cbc", "CompanyID", p.vat_id.strip())
        ts = ET.SubElement(tax_scheme, _q("cac", "TaxScheme"))
        _sub(ts, "cbc", "ID", "VAT")

    # Nom légal (BT-27/BT-44) — après la TVA dans PartyType.
    legal = ET.SubElement(party, _q("cac", "PartyLegalEntity"))
    _sub(legal, "cbc", "RegistrationName", p.nom)

    # BG-6 contact vendeur (BR-DE-2) : nom + téléphone + e-mail.
    if contact:
        ctc = ET.SubElement(party, _q("cac", "Contact"))
        if contact.get("nom", "").strip():
            _sub(ctc, "cbc", "Name", contact["nom"].strip())
        if contact.get("telephone", "").strip():
            _sub(ctc, "cbc", "Telephone", contact["telephone"].strip())
        if contact.get("email", "").strip():
            _sub(ctc, "cbc", "ElectronicMail", contact["email"].strip())


def construire_ubl(fac: Facture, profil: str = "xrechnung") -> str:
    """UBL Invoice 2.1 conforme EN 16931 — ou XRechnungError (jamais boiteux).

    Mêmes règles métier que `construire_cii` §114 : on valide d'abord, on
    calcule les totaux avec LA fonction partagée, puis on sérialise en UBL.
    """
    violations = valider(fac, profil)
    if violations:
        raise XRechnungError(violations)
    cfg = PROFILES[profil]

    totaux = calculer_totaux(fac.lignes)
    groupes = totaux["groupes"]
    total_net = totaux["net"]
    total_tva = totaux["tva"]
    total_brut = totaux["brut"]

    racine = ET.Element(_q("", "Invoice"))

    # BT-24 (identifiant du profil) — SAME valeur que le CII §123.
    _sub(racine, "cbc", "CustomizationID", str(cfg["guideline"]))
    # BT-23 (processus métier, règle Peppol R005) → cbc:ProfileID, sans schemeID.
    if fac.processus.strip():
        _sub(racine, "cbc", "ProfileID", fac.processus.strip())
    # BT-1, BT-2, BT-9, BT-3.
    _sub(racine, "cbc", "ID", fac.numero)
    _sub(racine, "cbc", "IssueDate", fac.date_emission)
    if fac.date_echeance:
        _sub(racine, "cbc", "DueDate", fac.date_echeance)
    _sub(racine, "cbc", "InvoiceTypeCode", "380")  # 380 = facture (BT-3)
    for note in fac.notes:
        _sub(racine, "cbc", "Note", note)
    # BT-5 devise.
    _sub(racine, "cbc", "DocumentCurrencyCode", fac.devise)
    # BT-10 Leitweg-ID (obligatoire XRechnung).
    if fac.reference_acheteur.strip():
        _sub(racine, "cbc", "BuyerReference", fac.reference_acheteur)

    # BT-73/74 période de facturation (BG-14) → cac:InvoicePeriod.
    if fac.periode_debut and fac.periode_fin:
        periode = ET.SubElement(racine, _q("cac", "InvoicePeriod"))
        _sub(periode, "cbc", "StartDate", fac.periode_debut)
        _sub(periode, "cbc", "EndDate", fac.periode_fin)

    # BG-4 vendeur (avec TVA + contact BG-6) et BG-7 acheteur (e-mail BT-49).
    _add_party(
        racine, "AccountingSupplierParty", fac.vendeur, avec_vat=True,
        contact={
            "nom": fac.contact_nom,
            "telephone": fac.contact_telephone,
            "email": fac.contact_email,
        },
    )
    _add_party(
        racine, "AccountingCustomerParty", fac.acheteur, avec_vat=False,
        contact=None,
    )

    # BT-72 date de livraison → cac:Delivery/cbc:ActualDeliveryDate.
    if fac.date_livraison:
        livraison = ET.SubElement(racine, _q("cac", "Delivery"))
        _sub(livraison, "cbc", "ActualDeliveryDate", fac.date_livraison)

    # BG-16 instructions de paiement (BR-DE-1) → cac:PaymentMeans.
    if fac.iban.strip():
        moyens = ET.SubElement(racine, _q("cac", "PaymentMeans"))
        _sub(moyens, "cbc", "PaymentMeansCode", "58")  # virement SEPA (UNCL 4461)
        compte = ET.SubElement(moyens, _q("cac", "PayeeFinancialAccount"))
        _sub(compte, "cbc", "ID", fac.iban.replace(" ", "").upper())
        if fac.titulaire_compte.strip():
            _sub(compte, "cbc", "Name", fac.titulaire_compte.strip())
        if fac.bic.strip():
            institut = ET.SubElement(moyens, _q("cac", "PayeeFinancialInstitution"))
            _sub(institut, "cbc", "ID", fac.bic.replace(" ", "").upper())

    # BG-23 totaux de TVA : UN SEUL TaxTotal (BT-110 = TVA totale), puis un
    # TaxSubtotal par catégorie (règle PEPPOL-EN16931-R053 « one tax total »).
    tax_total = ET.SubElement(racine, _q("cac", "TaxTotal"))
    _sub(tax_total, "cbc", "TaxAmount", _fmt_montant(total_tva)).set("currencyID", fac.devise)
    for (taux, categorie), base in sorted(groupes.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        tva_groupe = (base * taux / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        sous = ET.SubElement(tax_total, _q("cac", "TaxSubtotal"))
        _sub(sous, "cbc", "TaxableAmount", _fmt_montant(base)).set("currencyID", fac.devise)
        _sub(sous, "cbc", "TaxAmount", _fmt_montant(tva_groupe)).set("currencyID", fac.devise)
        cat = ET.SubElement(sous, _q("cac", "TaxCategory"))
        _sub(cat, "cbc", "ID", categorie)
        _sub(cat, "cbc", "Percent", _fmt_montant(taux))
        ts = ET.SubElement(cat, _q("cac", "TaxScheme"))
        _sub(ts, "cbc", "ID", "VAT")

    # BG-22 montants totaux (MonetaryTotalType, ordre XSD).
    total = ET.SubElement(racine, _q("cac", "LegalMonetaryTotal"))
    _sub(total, "cbc", "LineExtensionAmount", _fmt_montant(total_net)).set("currencyID", fac.devise)
    _sub(total, "cbc", "TaxExclusiveAmount", _fmt_montant(total_net)).set("currencyID", fac.devise)
    _sub(total, "cbc", "TaxInclusiveAmount", _fmt_montant(total_brut)).set("currencyID", fac.devise)
    _sub(total, "cbc", "PayableAmount", _fmt_montant(total_brut)).set("currencyID", fac.devise)

    # BG-25 lignes (InvoiceLineType, ordre XSD : ID, InvoicedQuantity,
    # LineExtensionAmount, Item, Price).
    for i, li in enumerate(fac.lignes, start=1):
        ligne = ET.SubElement(racine, _q("cac", "InvoiceLine"))
        _sub(ligne, "cbc", "ID", str(i))
        qte = _sub(ligne, "cbc", "InvoicedQuantity", _fmt_qte(li.quantite))
        qte.set("unitCode", UNITE_CODES[li.unite])
        net_ligne = (li.quantite * li.prix_unitaire_ht).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        _sub(ligne, "cbc", "LineExtensionAmount", _fmt_montant(net_ligne)).set("currencyID", fac.devise)
        item = ET.SubElement(ligne, _q("cac", "Item"))
        _sub(item, "cbc", "Name", li.designation)
        cat = ET.SubElement(item, _q("cac", "ClassifiedTaxCategory"))
        _sub(cat, "cbc", "ID", li.categorie_tva)
        _sub(cat, "cbc", "Percent", _fmt_montant(li.taux_tva))
        ts = ET.SubElement(cat, _q("cac", "TaxScheme"))
        _sub(ts, "cbc", "ID", "VAT")
        prix = ET.SubElement(ligne, _q("cac", "Price"))
        _sub(prix, "cbc", "PriceAmount", _fmt_prix(li.prix_unitaire_ht)).set("currencyID", fac.devise)

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(racine, encoding="unicode")
