# app/services/xrechnung.py — §114 fondations E-Rechnung (cadre §112) :
# constructeur CII « facture électronique » 100 % maison, zéro dépendance.
#
# Ce que c'est : EN 16931 est le MODÈLE SÉMANTIQUE européen de la facture
# (les champs « BT-1, BT-2… ») ; la syntaxe retenue ici est CII D16B
# (UN/CEFACT), celle de XRechnung et de l'hybride ZUGFeRD/Factur-X. Ce
# module écrit le XML sans dépendance externe (stdlib xml.etree), en
# DECIMAL pour l'argent — jamais de float — avec deux règles d'orgueil
# Narchi :
#
#   1. AUCUNE VALEUR INVENTÉE. Un champ obligatoire manquant = une liste
#      de violations explicite (et rien n'est émis), pas un défaut caché.
#      On ne fabrique jamais un numéro de TVA, une Leitweg-ID ou une date.
#   2. IMPOSER LA VÉRITÉ AVANT LA BEAUTÉ. Le XML n'est produit qu'une
#      fois toutes les règles du profil respectées ; une facture qui se
#      ferait refuser par KoSIT ne quitte pas Narchi.
#
# Provenance légale (important pour le client) : implémentation écrite
# UNIQUEMENT à partir du standard public EN 16931-1 / XRechnung (KoSIT)
# et des schémas CII D16B — aucun code tiers n'est copié (l'étude §114
# d'un grand ERP open source sous AGPL a validé l'APPROCHE générale
# « profil = standard + identifiants + règles locales », pas fourni de
# code : l'AGPL-3.0 interdirait sinon de garder Narchi propriétaire).
#
# Jalons suivants (dits dans docs/ANALYSE_OUTIL_UPSTREAM_BTP.md) :
# validation officielle KoSIT en CI, UBL/Peppol, embarqué PDF/A-3
# (ZUGFeRD). §116 LIVRÉ : persistance Facture + API + écran
# (app/models/invoice.py, app/api/invoice_routes.py, page Rechnungen).
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

# --- Identifiants officiels (BT-24 « CustomizationID », spécifications
#     publiques KoSIT/CEN — ce sont des constantes DU STANDARD) -----------
GUIDELINE_EN16931 = "urn:cen.eu:en16931:2017"
# §123 — CORRECTIF mesuré au validateur officiel KoSIT (config XRechnung
# 3.0.2 du 31/01/2026) : l'identifiant émis au §114 reprenait le domaine
# d'avant XRechnung 3.0 (xoev-de + segment « standard: ») → « kein
# Prüfszenario gegriffen / REJECT ». Valeur officielle actuelle, copiée
# EXACTEMENT du scénario KoSIT (domaine xeinkauf.de, sans « standard: »).
GUIDELINE_XRECHNUNG_3 = (
    "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
)
PROFILES: dict[str, dict[str, str | bool]] = {
    # xrechnung : profil allemand secteur public → Leitweg-ID (BT-10) et
    # date de livraison OU période de facturation obligatoires.
    "xrechnung": {
        "guideline": GUIDELINE_XRECHNUNG_3,
        "buyer_reference_obligatoire": True,
        "livraison_ou_periode_obligatoire": True,
        # §123 — mesuré au validateur officiel KoSIT (config 3.0.2 du
        # 31/01/2026) : règle allemande BR-DE-1, instructions de paiement
        # (BG-16) OBLIGATOIRES. Sans IBAN, le profil refuse d'émettre.
        "payment_obligatoire": True,
    },
    # en16931 : profil européen générique (mêmes BT, règles souples).
    "en16931": {
        "guideline": GUIDELINE_EN16931,
        "buyer_reference_obligatoire": False,
        "livraison_ou_periode_obligatoire": False,
        "payment_obligatoire": False,  # BR-DE-1 = règle allemande, pas EN
    },
}

# Espaces de noms CII D16B (UN/CEFACT).
RSM = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
RAM = "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
UDT = "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
for _p, _u in {"rsm": RSM, "ram": RAM, "udt": UDT}.items():
    ET.register_namespace(_p, _u)
_NS: dict[str, str] = {"rsm": RSM, "ram": RAM, "udt": UDT}


def _q(prefix: str, local: str) -> str:
    """Tag qualifié « {ns}local » — AUCUN espace dans l'URI (1er jet
    avait une f-string avec espace parasite → namespace invalide ;
    relu et corrigé AVANT les tests)."""
    return f"{{{_NS[prefix]}}}{local}"

# Sous-ensemble HONNÊTE d'UN/ECE Rec 20 (unité BT-130). Une unité hors de
# cette table = violation explicite (on élargira au besoin réel), jamais
# de substitution silencieuse par « pièce ».
UNITE_CODES: dict[str, str] = {
    "piece": "C62",
    "stueck": "C62",
    "heure": "HUR",
    "jour": "DAY",
    "metre": "MTR",
    "m2": "MTK",
    "m3": "MTQ",
    "kg": "KGM",
    "cmc": "CMQ",
    "forfait": "LS",
}
# Plage supportée §114 : TVA allemande normale (catégorie S uniquement).
# Exonérations (AE/VATEX), autoliquidation (AE)… = jalon suivant, dit.
CATEGORIES_TVA_SUPPORTEES = frozenset({"S"})

_PRIX_PLACES = Decimal("0.0001")
_MONTANT_PLACES = Decimal("0.01")


@dataclass(frozen=True)
class Partie:
    """Vendeur/acheteur (BG-4/BG-7). vat_id = USt-IdNr (BT-31, schéma VA)."""

    nom: str
    rue: str
    code_postal: str
    ville: str
    pays: str  # ISO 3166-1 alpha-2, ex. « DE »
    vat_id: str = ""
    # §123 — BT-34 (vendeur) / BT-49 (acheteur) : adresse ÉLECTRONIQUE,
    # obligatoire XRechnung 3.0.2 (règles Peppol R010/R020, mesurées au
    # validateur KoSIT) ; schemeID « EM » = e-mail, valeur = l'adresse.
    email: str = ""


@dataclass(frozen=True)
class LigneFacture:
    """BG-25. quantité/prix en Decimal — les floats sont refusés ici."""

    designation: str
    quantite: Decimal
    unite: str  # clé de UNITE_CODES
    prix_unitaire_ht: Decimal
    taux_tva: Decimal  # ex. Decimal("19")
    categorie_tva: str = "S"


@dataclass(frozen=True)
class Facture:
    """Modèle d'entrée volontairement explicite (pas de défauts magiques)."""

    numero: str
    date_emission: str  # ISO « AAAA-MM-JJ » (BT-2)
    vendeur: Partie
    acheteur: Partie
    lignes: tuple[LigneFacture, ...]
    devise: str  # ex. « EUR » (BT-5)
    reference_acheteur: str = ""  # Leitweg-ID (BT-10), obligatoire XRechnung
    date_livraison: str = ""  # BT-72 (XRechnung : ceci OU période)
    periode_debut: str = ""  # BT-73 (BG-14)
    periode_fin: str = ""  # BT-74
    date_echeance: str = ""  # BT-9 (optionnel)
    iban: str = ""  # BT-84 (BG-16) — obligatoire XRechnung (BR-DE-1, §123)
    titulaire_compte: str = ""  # BT-85 (nom du compte, optionnel)
    bic: str = ""  # BT-86 (optionnel)
    # §123 — exigences XRechnung 3.0.2 mesurées au validateur officiel :
    processus: str = ""  # BT-23 (processus métier, règle Peppol R005)
    contact_nom: str = ""  # BT-41 (BG-6 vendeur, règle allemande BR-DE-2)
    contact_telephone: str = ""  # BT-42
    contact_email: str = ""  # BT-43
    notes: tuple[str, ...] = field(default_factory=tuple)


class XRechnungError(Exception):
    """Refus d'émettre : la liste des violations est publique (.violations).

    Jamais d'exception orpheline « invalide » : chaque violation dit le
    champ (BT-…) et pourquoi.
    """

    def __init__(self, violations: list[str]) -> None:
        self.violations = violations
        super().__init__("; ".join(violations))


_iso = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# §123 — IBAN : 2 lettres pays + 2 chiffres de contrôle + 11..30
# caractères compte (ISO 13616). Espaces de saisie tolérés (normalisés).
_iban = re.compile(r"^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$")


def _dec(valeur: Decimal, nom: str, violations: list[str]) -> Decimal:
    if not isinstance(valeur, Decimal):  # float refusé : erreur de centimes
        violations.append(f"{nom}: Decimal exigé (float interdit — erreurs d'arrondi)")
        return Decimal(0)
    return valeur


def _fmt_montant(v: Decimal) -> str:
    return str(v.quantize(_MONTANT_PLACES, rounding=ROUND_HALF_UP))


def _fmt_prix(v: Decimal) -> str:
    return str(v.quantize(_PRIX_PLACES, rounding=ROUND_HALF_UP))


def _fmt_qte(v: Decimal) -> str:
    # 4 décimales max, zéros superflus retirés (2.5000 → « 2.5 »).
    q = v.quantize(_PRIX_PLACES, rounding=ROUND_HALF_UP).normalize()
    return format(q, "f")


def valider(fac: Facture, profil: str) -> list[str]:
    """Règles EN 16931 + règles du profil. Codes propres NARCHI-XR-… (les
    codes BR-… officiels seront alignés lors du jalon validateur KoSIT —
    on ne prétend pas les connaître tous de mémoire)."""
    v: list[str] = []
    cfg = PROFILES.get(profil)
    if cfg is None:
        return [f"NARCHI-XR-00: profil inconnu « {profil} » (supportés : {sorted(PROFILES)})"]

    if not fac.numero.strip():
        v.append("NARCHI-XR-01: numéro de facture vide (BT-1)")
    if not _iso.match(fac.date_emission):
        v.append(f"NARCHI-XR-02: date d'émission invalide « {fac.date_emission} » (AAAA-MM-JJ, BT-2)")
    if not fac.devise or len(fac.devise) != 3:
        v.append(f"NARCHI-XR-03: devise invalide « {fac.devise} » (code ISO 3 lettres, BT-5)")

    for role, p in (("vendeur", fac.vendeur), ("acheteur", fac.acheteur)):
        if not p.nom.strip():
            v.append(f"NARCHI-XR-10: {role} sans nom (BT-27/BT-44)")
        if not p.rue.strip() or not p.ville.strip() or not p.code_postal.strip():
            v.append(f"NARCHI-XR-11: adresse {role} incomplète (BT-35…BT-40/BT-50…BT-53)")
        if len(p.pays) != 2:
            v.append(f"NARCHI-XR-12: pays {role} « {p.pays} » ≠ ISO alpha-2 (BT-40/BT-55)")
    if not fac.vendeur.vat_id.strip():
        v.append("NARCHI-XR-13: USt-IdNr du vendeur absente (BT-31) — jamais inventée")

    if cfg["buyer_reference_obligatoire"] and not fac.reference_acheteur.strip():
        v.append("NARCHI-XR-20: Leitweg-ID absente (BT-10) — XRechnung la rend obligatoire")

    if cfg["livraison_ou_periode_obligatoire"]:
        if not fac.date_livraison and not (fac.periode_debut and fac.periode_fin):
            v.append(
                "NARCHI-XR-21: ni date de livraison (BT-72) ni période (BT-73/74) — XRechnung en exige une"
            )
        # §123 — mesuré au validateur officiel KoSIT (XRechnung 3.0.2) :
        if not fac.processus.strip():
            v.append(
                "NARCHI-XR-43: processus métier absent (BT-23 — règle Peppol R005) "
                "— valeur canonique documentée, jamais masquée"
            )
        for role, p in (("vendeur", fac.vendeur), ("acheteur", fac.acheteur)):
            if not p.email.strip():
                v.append(
                    f"NARCHI-XR-44: adresse électronique {role} absente "
                    "(BT-34/BT-49, schemeID EM — règles Peppol R010/R020)"
                )
        if not (fac.contact_nom.strip() and fac.contact_telephone.strip() and fac.contact_email.strip()):
            v.append(
                "NARCHI-XR-45: contact vendeur incomplet (BG-6 : nom + téléphone + e-mail "
                "— règle officielle BR-DE-2)"
            )
    for etiquette, d in (
        ("livraison BT-72", fac.date_livraison),
        ("début période BT-73", fac.periode_debut),
        ("fin période BT-74", fac.periode_fin),
        ("échéance BT-9", fac.date_echeance),
    ):
        if d and not _iso.match(d):
            v.append(f"NARCHI-XR-22: date {etiquette} invalide « {d} »")
    if (fac.periode_debut and not fac.periode_fin) or (fac.periode_fin and not fac.periode_debut):
        v.append("NARCHI-XR-23: période de facturation ouverte d'un seul côté (BT-73 sans BT-74)")

    if cfg["payment_obligatoire"] and not fac.iban.strip():
        v.append(
            "NARCHI-XR-41: instructions de paiement obligatoires en XRechnung "
            "(BG-16, BT-84 IBAN — règle officielle BR-DE-1, mesurée au validateur "
            "KoSIT §123) — un IBAN se SAISIT, il ne s'invente pas"
        )
    if fac.iban.strip() and not _iban.match(fac.iban.replace(" ", "").upper()):
        v.append(
            "NARCHI-XR-42: IBAN illisible « …" + fac.iban.replace(" ", "")[-4:]
            + " » (forme ISO 13616 : pays 2 lettres + contrôle 2 chiffres + compte)"
        )

    if not fac.lignes:
        v.append("NARCHI-XR-30: facture sans ligne (BG-25) — rien à facturer, rien à émettre")
    for i, li in enumerate(fac.lignes, start=1):
        if not li.designation.strip():
            v.append(f"NARCHI-XR-31: ligne {i} sans désignation (BT-153)")
        qt = _dec(li.quantite, f"ligne {i} quantité", v)
        px = _dec(li.prix_unitaire_ht, f"ligne {i} prix", v)
        tx = _dec(li.taux_tva, f"ligne {i} taux TVA", v)
        if qt <= 0:
            v.append(f"NARCHI-XR-32: ligne {i} quantité ≤ 0 (BT-129)")
        if px < 0 or tx < 0:
            v.append(f"NARCHI-XR-33: ligne {i} prix ou taux négatif")
        if li.unite not in UNITE_CODES:
            v.append(
                f"NARCHI-XR-34: ligne {i} unité « {li.unite} » hors table supportée {sorted(UNITE_CODES)} (BT-130)"
            )
        if li.categorie_tva not in CATEGORIES_TVA_SUPPORTEES:
            v.append(
                f"NARCHI-XR-35: ligne {i} catégorie TVA « {li.categorie_tva} » non supportée §114 "
                f"(supporté : S) — on le dit au lieu de la mapper au hasard"
            )
        if li.categorie_tva == "S" and tx == 0:
            v.append(f"NARCHI-XR-36: ligne {i} catégorie S avec taux 0 — incohérent (sinon catégorie zéro-rated)")
    return v


def _sub(parent: ET.Element, prefix: str, local: str, texte: str | Decimal) -> ET.Element:
    el = ET.SubElement(parent, _q(prefix, local))
    el.text = str(texte)
    return el


def _add_partie(
    parent: ET.Element,
    tag: str,
    p: Partie,
    avec_vat: bool,
    contact: dict[str, str] | None = None,
) -> None:
    party = ET.SubElement(parent, _q("ram", tag))
    _sub(party, "ram", "Name", p.nom)
    # §123 — BG-6 « SELLER CONTACT » (BR-DE-2) : nom, téléphone, e-mail.
    # Position XSD TradeParty : APRÈS Name, AVANT l'adresse postale.
    if contact and contact.get("nom", "").strip():
        tc = ET.SubElement(party, _q("ram", "DefinedTradeContact"))
        _sub(tc, "ram", "PersonName", contact["nom"].strip())
        if contact.get("telephone", "").strip():
            tel = ET.SubElement(tc, _q("ram", "TelephoneUniversalCommunication"))
            _sub(tel, "ram", "CompleteNumber", contact["telephone"].strip())
        if contact.get("email", "").strip():
            mel = ET.SubElement(tc, _q("ram", "EmailURIUniversalCommunication"))
            _sub(mel, "ram", "URIID", contact["email"].strip())
    adresse = ET.SubElement(party, _q("ram", "PostalTradeAddress"))
    _sub(adresse, "ram", "PostcodeCode", p.code_postal)
    _sub(adresse, "ram", "LineOne", p.rue)
    _sub(adresse, "ram", "CityName", p.ville)  # §123 — nom officiel CII (XSD KoSIT)
    _sub(adresse, "ram", "CountryID", p.pays)
    # §123 — BT-34/BT-49 : adresse électronique, schemeID « EM » obligatoire
    # (règles Peppol R010/R020). Position : APRÈS l'adresse, AVANT la TVA.
    if p.email.strip():
        uri = ET.SubElement(party, _q("ram", "URIUniversalCommunication"))
        uriid = _sub(uri, "ram", "URIID", p.email.strip())
        uriid.set("schemeID", "EM")
    if avec_vat and p.vat_id.strip():
        tax = ET.SubElement(party, _q("ram", "SpecifiedTaxRegistration"))
        tid = _sub(tax, "ram", "ID", p.vat_id)
        tid.set("schemeID", "VA")


def _add_date(parent: ET.Element, iso_date: str) -> None:
    dts = _sub(parent, "udt", "DateTimeString", iso_date.replace("-", ""))
    dts.set("format", "102")  # 102 = CCYYMMDD (classeur CII)


def calculer_totaux(
    lignes: tuple[LigneFacture, ...] | list[LigneFacture],
) -> dict[str, Any]:  # hétérogène : net/tva/brut (Decimal) + groupes (dict)
    """Totaux EXACTS en Decimal — UNE SEULE arithmétique pour le XML §114
    ET l'API Facture §116 (jamais deux chemins qui divergent d'un centime).

    Retour : net/tva/brut (Decimal) + groupes {(taux, catégorie): base}.
    L'arrondi officialisé : CHAQUE ligne arrondie au centime (HALF_UP)
    AVANT regroupement par taux ; la TVA est calculée par groupe, jamais
    par ligne (méthode EN 16931 — des centimes différents sinon).
    """
    groupes: dict[tuple[Decimal, str], Decimal] = {}
    total_net = Decimal(0)
    for li in lignes:
        net_ligne = (li.quantite * li.prix_unitaire_ht).quantize(_MONTANT_PLACES, ROUND_HALF_UP)
        total_net += net_ligne
        cle = (li.taux_tva, li.categorie_tva)
        groupes[cle] = groupes.get(cle, Decimal(0)) + net_ligne
    total_tva = Decimal(0)
    for (taux, _cat), base in groupes.items():
        total_tva += (base * taux / Decimal(100)).quantize(_MONTANT_PLACES, ROUND_HALF_UP)
    return {
        "net": total_net,
        "tva": total_tva,
        "brut": total_net + total_tva,
        "groupes": groupes,
    }


def construire_cii(fac: Facture, profil: str = "xrechnung") -> str:
    """Arme finale : XML CII ou XRechnungError — jamais un fichier boiteux."""
    violations = valider(fac, profil)
    if violations:
        raise XRechnungError(violations)
    cfg = PROFILES[profil]

    # --- Totaux : EXACTEMENT la fonction partagée (§116) -----------------
    totaux = calculer_totaux(fac.lignes)
    groupes = totaux["groupes"]
    total_net = totaux["net"]
    total_tva = totaux["tva"]
    total_brut = totaux["brut"]

    racine = ET.Element(_q("rsm", "CrossIndustryInvoice"))

    contexte = ET.SubElement(racine, _q("rsm", "ExchangedDocumentContext"))
    # §123 — BT-23 processus métier : position XSD AVANT le Guideline.
    if fac.processus.strip():
        bp = ET.SubElement(contexte, _q("ram", "BusinessProcessSpecifiedDocumentContextParameter"))
        _sub(bp, "ram", "ID", fac.processus.strip())
    gl = ET.SubElement(contexte, _q("ram", "GuidelineSpecifiedDocumentContextParameter"))
    _sub(gl, "ram", "ID", str(cfg["guideline"]))

    doc = ET.SubElement(racine, _q("rsm", "ExchangedDocument"))
    _sub(doc, "ram", "ID", fac.numero)
    typecode = _sub(doc, "ram", "TypeCode", "380")  # 380 = facture (BT-3)
    idt = ET.SubElement(doc, _q("ram", "IssueDateTime"))
    _add_date(idt, fac.date_emission)
    for note in fac.notes:
        included = ET.SubElement(doc, _q("ram", "IncludedNote"))
        _sub(included, "ram", "Content", note)

    trx = ET.SubElement(racine, _q("rsm", "SupplyChainTradeTransaction"))

    for i, li in enumerate(fac.lignes, start=1):
        item = ET.SubElement(trx, _q("ram", "IncludedSupplyChainTradeLineItem"))
        ligne_doc = ET.SubElement(item, _q("ram", "AssociatedDocumentLineDocument"))
        _sub(ligne_doc, "ram", "LineID", str(i))  # numérotation dérivée, pas inventée
        produit = ET.SubElement(item, _q("ram", "SpecifiedTradeProduct"))
        _sub(produit, "ram", "Name", li.designation)
        accord = ET.SubElement(item, _q("ram", "SpecifiedLineTradeAgreement"))
        net_price = ET.SubElement(accord, _q("ram", "NetPriceProductTradePrice"))
        _sub(net_price, "ram", "ChargeAmount", _fmt_prix(li.prix_unitaire_ht))
        livraison = ET.SubElement(item, _q("ram", "SpecifiedLineTradeDelivery"))
        qte = _sub(livraison, "ram", "BilledQuantity", _fmt_qte(li.quantite))
        qte.set("unitCode", UNITE_CODES[li.unite])
        reglement = ET.SubElement(item, _q("ram", "SpecifiedLineTradeSettlement"))
        taxe_ligne = ET.SubElement(reglement, _q("ram", "ApplicableTradeTax"))
        _sub(taxe_ligne, "ram", "TypeCode", "VAT")
        _sub(taxe_ligne, "ram", "CategoryCode", li.categorie_tva)
        _sub(taxe_ligne, "ram", "RateApplicablePercent", _fmt_montant(li.taux_tva))
        net_ligne = (li.quantite * li.prix_unitaire_ht).quantize(_MONTANT_PLACES, ROUND_HALF_UP)
        somme_ligne = ET.SubElement(reglement, _q("ram", "SpecifiedTradeSettlementLineMonetarySummation"))
        _sub(somme_ligne, "ram", "LineTotalAmount", _fmt_montant(net_ligne))

    agreement = ET.SubElement(trx, _q("ram", "ApplicableHeaderTradeAgreement"))
    if fac.reference_acheteur.strip():
        _sub(agreement, "ram", "BuyerReference", fac.reference_acheteur)
    _add_partie(
        agreement, "SellerTradeParty", fac.vendeur, avec_vat=True,
        contact={"nom": fac.contact_nom, "telephone": fac.contact_telephone, "email": fac.contact_email},
    )
    _add_partie(agreement, "BuyerTradeParty", fac.acheteur, avec_vat=False)

    delivery = ET.SubElement(trx, _q("ram", "ApplicableHeaderTradeDelivery"))
    if fac.date_livraison:
        event = ET.SubElement(delivery, _q("ram", "ActualDeliverySupplyChainEvent"))
        occ = ET.SubElement(event, _q("ram", "OccurrenceDateTime"))
        _add_date(occ, fac.date_livraison)

    settlement = ET.SubElement(trx, _q("ram", "ApplicableHeaderTradeSettlement"))
    _sub(settlement, "ram", "InvoiceCurrencyCode", fac.devise)
    if fac.iban.strip():
        # §123 — BG-16 « PAYMENT INSTRUCTIONS » (obligatoire BR-DE-1) :
        # TypeCode 58 = virement SEPA (UNCL 4461). Position officielle dans
        # HeaderTradeSettlement : APRÈS la devise, AVANT les taxes (XSD).
        moyens = ET.SubElement(settlement, _q("ram", "SpecifiedTradeSettlementPaymentMeans"))
        _sub(moyens, "ram", "TypeCode", "58")
        compte = ET.SubElement(moyens, _q("ram", "PayeePartyCreditorFinancialAccount"))
        _sub(compte, "ram", "IBANID", fac.iban.replace(" ", "").upper())
        if fac.titulaire_compte.strip():
            _sub(compte, "ram", "AccountName", fac.titulaire_compte.strip())
        if fac.bic.strip():
            institut = ET.SubElement(moyens, _q("ram", "PayeeSpecifiedCreditorFinancialInstitution"))
            _sub(institut, "ram", "BICID", fac.bic.replace(" ", "").upper())
    for (taux, categorie), base in sorted(groupes.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        taxe = ET.SubElement(settlement, _q("ram", "ApplicableTradeTax"))
        tva_groupe = (base * taux / Decimal(100)).quantize(_MONTANT_PLACES, ROUND_HALF_UP)
        _sub(taxe, "ram", "CalculatedAmount", _fmt_montant(tva_groupe))
        _sub(taxe, "ram", "TypeCode", "VAT")
        _sub(taxe, "ram", "BasisAmount", _fmt_montant(base))
        _sub(taxe, "ram", "CategoryCode", categorie)
        _sub(taxe, "ram", "RateApplicablePercent", _fmt_montant(taux))
    if fac.periode_debut and fac.periode_fin:
        periode = ET.SubElement(settlement, _q("ram", "BillingSpecifiedPeriod"))
        start = ET.SubElement(periode, _q("ram", "StartDateTime"))
        _add_date(start, fac.periode_debut)
        end = ET.SubElement(periode, _q("ram", "EndDateTime"))
        _add_date(end, fac.periode_fin)
    if fac.date_echeance:
        termes = ET.SubElement(settlement, _q("ram", "SpecifiedTradePaymentTerms"))
        due = ET.SubElement(termes, _q("ram", "DueDateDateTime"))
        _add_date(due, fac.date_echeance)
    somme = ET.SubElement(settlement, _q("ram", "SpecifiedTradeSettlementHeaderMonetarySummation"))
    _sub(somme, "ram", "LineTotalAmount", _fmt_montant(total_net))
    _sub(somme, "ram", "TaxBasisTotalAmount", _fmt_montant(total_net))
    taxtotal = _sub(somme, "ram", "TaxTotalAmount", _fmt_montant(total_tva))
    taxtotal.set("currencyID", fac.devise)
    _sub(somme, "ram", "GrandTotalAmount", _fmt_montant(total_brut))
    _sub(somme, "ram", "DuePayableAmount", _fmt_montant(total_brut))

    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(racine, encoding="unicode")
