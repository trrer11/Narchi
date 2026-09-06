# §114 — Fondations E-Rechnung (EN 16931 / CII « XRechnung »), vraies
# épreuves : structure relue par ElementTree, arithmétique Decimal
# vérifiée au centime, et la règle d'orgueil : AUCUNE valeur inventée —
# un champ obligatoire manquant doit REFUSER d'émettre, pas deviner.
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.xrechnung import (
    GUIDELINE_XRECHNUNG_3,
    Facture,
    LigneFacture,
    Partie,
    XRechnungError,
    construire_cii,
    valider,
)

NS = {
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
}


def _texte(racine: ET.Element, chemin: str) -> str:
    el = racine.find(chemin, NS)
    assert el is not None and el.text is not None, f"élément absent : {chemin}"
    return el.text


def facture_ok() -> Facture:
    vendeur = Partie(
        nom="Narchi Architekten GmbH",
        rue="Lister Meile 12",
        code_postal="30161",
        ville="Hannover",
        pays="DE",
        vat_id="DE123456789",
        email="buchhaltung@narchi-architekten.de",  # §123 — BT-34 (Peppol R020)
    )
    acheteur = Partie(
        nom="Stadt Hannover — Amt für Gebäudemanagement & <Sonderzeichen>",
        rue="Trammplatz 2",
        code_postal="30159",
        ville="Hannover",
        pays="DE",
        email="erfassung@hannover-stadt.de",  # §123 — BT-49 (Peppol R010)
    )
    lignes = (
        LigneFacture(
            designation="Grundleistungen HOAI LPH 5 — Entwurfsplanung",
            quantite=Decimal("3"),
            unite="piece",
            prix_unitaire_ht=Decimal("33.3350"),  # arrondi éprouvé en test
            taux_tva=Decimal("19"),
        ),
        LigneFacture(
            designation="Baustellenbesuch Junistranche",
            quantite=Decimal("2.5"),
            unite="heure",
            prix_unitaire_ht=Decimal("120"),
            taux_tva=Decimal("19"),
        ),
        LigneFacture(
            designation="Reprodukte & Porto (Zwischenschritt 7 %)",
            quantite=Decimal("1"),
            unite="forfait",
            prix_unitaire_ht=Decimal("87.50"),
            taux_tva=Decimal("7"),
        ),
    )
    return Facture(
        numero="RE-2026-0042",
        date_emission="2026-08-11",
        vendeur=vendeur,
        acheteur=acheteur,
        lignes=lignes,
        devise="EUR",
        reference_acheteur="040-11000-99NABC",
        date_livraison="2026-08-04",
        date_echeance="2026-09-10",
        iban="DE89 3704 0044 0532 0130 00",  # IBAN de test canonique (§123, BR-DE-1)
        titulaire_compte="Narchi Architekten GmbH",
        processus="urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",  # BT-23 (R005)
        contact_nom="A. Muster",                 # BG-6 (BR-DE-2)
        contact_telephone="+49 511 1234567",
        contact_email="a.muster@narchi-architekten.de",
        notes=("Zahlbar innerhalb 30 Tagen ohne Abzug.",),
    )


def test_xml_structure_complete_et_relisible() -> None:
    xml = construire_cii(facture_ok())
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    racine = ET.fromstring(xml.encode())  # reparse réel, pas confiance aveugle
    assert racine.tag == f"{{{NS['rsm']}}}CrossIndustryInvoice"

    # Identité du profil + en-tête (BT-24, BT-1..3).
    assert _texte(racine, "rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID") == (
        GUIDELINE_XRECHNUNG_3
    )
    assert _texte(racine, "rsm:ExchangedDocument/ram:ID") == "RE-2026-0042"
    assert _texte(racine, "rsm:ExchangedDocument/ram:TypeCode") == "380"
    assert _texte(racine, "rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString") == "20260811"

    trx = "rsm:SupplyChainTradeTransaction"
    # Leitweg-ID présente (BT-10), parties complètes, TVA schéma VA.
    assert _texte(racine, f"{trx}/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference") == "040-11000-99NABC"
    assert _texte(
        racine, f"{trx}/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name"
    ) == "Narchi Architekten GmbH"
    vat = racine.find(
        f"{trx}/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID", NS
    )
    assert vat is not None and vat.get("schemeID") == "VA" and vat.text == "DE123456789"
    # Échappement réel (l'acheteur contient &, <, >) : reparse = vérité.
    assert "&lt;Sonderzeichen&gt;" in xml and "&amp;" in xml

    # Livraison (BT-72) et échéance (BT-9) au bon format 102.
    assert _texte(
        racine,
        f"{trx}/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString",
    ) == "20260804"
    assert _texte(
        racine,
        f"{trx}/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString",
    ) == "20260910"


def test_arithmietique_au_centime_et_groupes_tva() -> None:
    racine = ET.fromstring(construire_cii(facture_ok()).encode())
    trx = "rsm:SupplyChainTradeTransaction"

    # Lignes : 3 × 33.3350 = 100.005 → 100.01 (HALF_UP au centime, épinglé) ;
    # 2.5 × 120 = 300.00 ; 1 × 87.50 = 87.50.
    lignes = racine.findall(f"{trx}/ram:IncludedSupplyChainTradeLineItem", NS)
    assert len(lignes) == 3
    nets = [
        li.findtext("ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount", namespaces=NS)
        for li in lignes
    ]
    assert nets == ["100.01", "300.00", "87.50"]
    qtes = [
        li.find("ram:SpecifiedLineTradeDelivery/ram:BilledQuantity", NS)
        for li in lignes
    ]
    assert [q.text for q in qtes] == ["3", "2.5", "1"]  # zéros superflus retirés
    assert [q.get("unitCode") for q in qtes] == ["C62", "HUR", "LS"]  # UNECE réel

    # Deux groupes TVA : 19 % sur 400.01 → 76.00 (400.01×0.19=76.0019→76.00) ;
    # 7 % sur 87.50 → 6.13 (6.125 HALF_UP → 6.13, épingle l'arrondi).
    groupes = racine.findall(f"{trx}/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax", NS)
    assert len(groupes) == 2
    paires = {
        (g.findtext("ram:CategoryCode", namespaces=NS), g.findtext("ram:RateApplicablePercent", namespaces=NS)):
        (g.findtext("ram:BasisAmount", namespaces=NS), g.findtext("ram:CalculatedAmount", namespaces=NS))
        for g in groupes
    }
    assert paires[("S", "19.00")] == ("400.01", "76.00")
    assert paires[("S", "7.00")] == ("87.50", "6.13")

    somme = f"{trx}/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation"
    assert _texte(racine, f"{somme}/ram:LineTotalAmount") == "487.51"  # 400.01+87.50
    assert _texte(racine, f"{somme}/ram:TaxBasisTotalAmount") == "487.51"
    assert _texte(racine, f"{somme}/ram:TaxTotalAmount") == "82.13"     # 76.00+6.13
    tt = racine.find(f"{somme}/ram:TaxTotalAmount", NS)
    assert tt is not None and tt.get("currencyID") == "EUR"
    assert _texte(racine, f"{somme}/ram:GrandTotalAmount") == "569.64"
    assert _texte(racine, f"{somme}/ram:DuePayableAmount") == "569.64"  # = TTC


def test_aucun_defaut_invente_les_champs_obligatoires_refusent() -> None:
    cas = [
        ("reference_acheteur", "", "NARCHI-XR-20"),   # Leitweg-ID obligatoire XRechnung
        ("date_livraison", "", "NARCHI-XR-21"),       # ni livraison ni période
        ("iban", "", "NARCHI-XR-41"),                 # §123 — BG-16 obligatoire (BR-DE-1 KoSIT)
        ("devise", "EUROS", "NARCHI-XR-03"),
        ("lignes", (), "NARCHI-XR-30"),
    ]
    for champ, valeur, code in cas:
        mauvaise = replace(facture_ok(), **{champ: valeur})
        with pytest.raises(XRechnungError) as exc:
            construire_cii(mauvaise)
        assert any(code in msg for msg in exc.value.violations), exc.value.violations

    # Vendeur sans USt-IdNr : refus — jamais de numéro fabriqué.
    sans_vat = replace(facture_ok(), vendeur=replace(facture_ok().vendeur, vat_id=""))
    assert any("NARCHI-XR-13" in msg for msg in valider(sans_vat, "xrechnung"))


def test_lignes_invalides_chacune_dite() -> None:
    base = facture_ok()
    lignes = (
        LigneFacture("", Decimal("1"), "piece", Decimal("1"), Decimal("19")),      # XR-31
        LigneFacture("q nulle", Decimal("0"), "piece", Decimal("1"), Decimal("19")),  # XR-32
        LigneFacture("unité inconnue", Decimal("1"), "lichtjahr", Decimal("1"), Decimal("19")),  # XR-34
    )
    f = replace(base, lignes=lignes)
    msgs = valider(f, "xrechnung")
    for code in ("NARCHI-XR-31", "NARCHI-XR-32", "NARCHI-XR-34"):
        assert any(code in m for m in msgs), msgs
    # Catégorie non supportée : dit franchement, pas mappée.
    f2 = replace(base, lignes=(replace(base.lignes[0], categorie_tva="AE"),))
    assert any("NARCHI-XR-35" in m for m in valider(f2, "xrechnung"))
    # Catégorie S à taux zéro : incohérence épinglée.
    f3 = replace(base, lignes=(replace(base.lignes[0], taux_tva=Decimal("0")),))
    assert any("NARCHI-XR-36" in m for m in valider(f3, "xrechnung"))
    # Float = refusé (erreurs de centimes).
    f4 = replace(base, lignes=(LigneFacture("flottant", 1.0, "piece", Decimal("1"), Decimal("19")),))  # type: ignore[arg-type]
    assert any("Decimal exigé" in m for m in valider(f4, "xrechnung"))


def test_periode_facturation_remplace_livraison() -> None:
    f = replace(facture_ok(), date_livraison="", periode_debut="2026-07-01", periode_fin="2026-07-31")
    racine = ET.fromstring(construire_cii(f).encode())
    trx = "rsm:SupplyChainTradeTransaction"
    assert racine.find(f"{trx}/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent", NS) is None
    periode = racine.find(
        f"{trx}/ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod", NS
    )
    assert periode is not None
    assert periode.findtext("ram:StartDateTime/udt:DateTimeString", namespaces=NS) == "20260701"
    assert periode.findtext("ram:EndDateTime/udt:DateTimeString", namespaces=NS) == "20260731"
    # Période à moitié ouverte : violation dédiée.
    ouverte = replace(f, periode_fin="")
    assert any("NARCHI-XR-23" in m for m in valider(ouverte, "xrechnung"))


def test_profil_en16931_ne_demande_pas_la_leitweg_id() -> None:
    f = replace(facture_ok(), reference_acheteur="", date_livraison="")
    xml = construire_cii(f, profil="en16931")
    assert "BuyerReference" not in xml
    assert "Leitweg" not in xml
    # … mais XRechnung refuse la même facture : la règle dépend du profil.
    with pytest.raises(XRechnungError):
        construire_cii(f, profil="xrechnung")


def test_determinisme_et_validation_positive() -> None:
    assert construire_cii(facture_ok()) == construire_cii(facture_ok())
    assert valider(facture_ok(), "xrechnung") == []
    with pytest.raises(XRechnungError):
        construire_cii(facture_ok(), profil="factur-x-impossible")


# ---------------------------------------------------------------------------
# §123 — épingles MESURÉES au validateur officiel KoSIT v1.6.2, configuration
# XRechnung 3.0.2 du 31/01/2026 (cf. fixtures/xrechnung_kosit/README.md).
# Chaque refus et chaque position d'élément ci-dessous correspond à une règle
# que le logiciel de l'État a fait échouer puis accepter — pas à de la
# spéculation lue dans un blog.
# ---------------------------------------------------------------------------

FIXTURES_KOSIT = Path(__file__).resolve().parent / "fixtures" / "xrechnung_kosit"


def test_octets_exactement_ceux_acceptes_par_le_validateur_kosit() -> None:
    """Régression dure : un octet qui bouge = plus le document validé
    officiellement le 13/08/2026 → revalidation KoSIT obligatoire
    (scripts/valider-xrechnung-kosit.sh) AVANT de rafraîchir la fixture."""
    attendu_xr = (FIXTURES_KOSIT / "facture-xrechnung-kosit-acceptee.xml").read_bytes()
    assert construire_cii(facture_ok(), "xrechnung").encode("utf-8") == attendu_xr
    attendu_en = (FIXTURES_KOSIT / "facture-en16931-kosit-acceptee.xml").read_bytes()
    assert construire_cii(facture_ok(), "en16931").encode("utf-8") == attendu_en


def test_exigences_kosit_xrechnung_refusent_franchement() -> None:
    f = facture_ok()
    # Champs directs de la facture : processus BT-23 (R005) et contact BG-6
    # (BR-DE-2) — chacun vide doit REFUSER d'émettre en profil xrechnung.
    for champ, code in (
        ("processus", "NARCHI-XR-43"),
        ("contact_nom", "NARCHI-XR-45"),
        ("contact_telephone", "NARCHI-XR-45"),
        ("contact_email", "NARCHI-XR-45"),
    ):
        mauvaise = replace(f, **{champ: ""})
        with pytest.raises(XRechnungError) as exc:
            construire_cii(mauvaise, "xrechnung")
        assert any(code in m for m in exc.value.violations), exc.value.violations
    # Adresses électroniques BT-34/BT-49 (R010/R020) : le rôle est CITÉ.
    for role in ("vendeur", "acheteur"):
        mauvaise = replace(f, **{role: replace(getattr(f, role), email="")})
        with pytest.raises(XRechnungError) as exc:
            construire_cii(mauvaise, "xrechnung")
        assert any(
            "NARCHI-XR-44" in m and role in m for m in exc.value.violations
        ), exc.value.violations


def test_profil_en16931_tolere_ce_que_l_allemagne_exige() -> None:
    """Ces règles sont allemandes (BR-DE-*, Peppol DE) : la même facture
    allégée doit passer en profil européen et refuser en profil xrechnung."""
    f = facture_ok()
    legere = replace(
        f,
        processus="",
        iban="",
        contact_nom="",
        contact_telephone="",
        contact_email="",
        vendeur=replace(f.vendeur, email=""),
        acheteur=replace(f.acheteur, email=""),
    )
    assert valider(legere, "en16931") == []
    xml_en = construire_cii(legere, "en16931")
    # …et le XML allégé ne prétend à rien : rien d'émis, rien de masqué.
    assert "BusinessProcessSpecifiedDocumentContextParameter" not in xml_en
    assert "URIUniversalCommunication" not in xml_en
    assert "DefinedTradeContact" not in xml_en
    assert "SpecifiedTradeSettlementPaymentMeans" not in xml_en
    with pytest.raises(XRechnungError):
        construire_cii(legere, "xrechnung")


def test_iban_tordu_refuse_et_non_divulgue() -> None:
    tordu = "DE12 AB!F"
    with pytest.raises(XRechnungError) as exc:
        construire_cii(replace(facture_ok(), iban=tordu), "xrechnung")
    joint = " ".join(exc.value.violations)
    assert "NARCHI-XR-42" in joint, exc.value.violations
    # Le message ne révèle que les 4 derniers caractères (log, tickets…).
    assert tordu not in joint and "AB!F" in joint


def test_iban_minuscule_avec_espaces_normalise_pas_refuse() -> None:
    f = replace(facture_ok(), iban="de89 3704 0044 0532 0130 00")
    assert valider(f, "xrechnung") == []
    xml = construire_cii(f)
    assert "<ram:IBANID>DE89370400440532013000</ram:IBANID>" in xml


def _localname(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]  # stdlib ET : pas de QName.localname (lxml only)


def test_bg16_bg6_bt23_bt34_bt49_emis_aux_positions_officielles() -> None:
    racine = ET.fromstring(construire_cii(facture_ok()).encode())
    local = [_localname(el) for el in racine.find("rsm:ExchangedDocumentContext", NS)]
    # BT-23 (processus) AVANT le Guideline (BT-24) — ordre XSD, mesuré KoSIT.
    assert local == [
        "BusinessProcessSpecifiedDocumentContextParameter",
        "GuidelineSpecifiedDocumentContextParameter",
    ]
    assert racine.find(
        "rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID", NS
    ).text == "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"

    trx = "rsm:SupplyChainTradeTransaction"
    settlement = racine.find(f"{trx}/ram:ApplicableHeaderTradeSettlement", NS)
    ordre = [_localname(el) for el in settlement]
    # BG-16 : APRÈS la devise, AVANT les taxes (ordre XSD HeaderTradeSettlement).
    assert ordre.index("InvoiceCurrencyCode") < ordre.index("SpecifiedTradeSettlementPaymentMeans")
    assert ordre.index("SpecifiedTradeSettlementPaymentMeans") < ordre.index("ApplicableTradeTax")
    pm = settlement.find("ram:SpecifiedTradeSettlementPaymentMeans", NS)
    assert pm.findtext("ram:TypeCode", namespaces=NS) == "58"  # virement SEPA (UNCL 4461)
    assert pm.findtext(
        "ram:PayeePartyCreditorFinancialAccount/ram:IBANID", namespaces=NS
    ) == "DE89370400440532013000"  # espaces de saisie normalisés
    assert pm.findtext(
        "ram:PayeePartyCreditorFinancialAccount/ram:AccountName", namespaces=NS
    ) == "Narchi Architekten GmbH"

    agreement = f"{trx}/ram:ApplicableHeaderTradeAgreement"
    seller = racine.find(f"{agreement}/ram:SellerTradeParty", NS)
    ordre_s = [_localname(el) for el in seller]
    # BG-6 après le nom, avant l'adresse ; BT-34 après l'adresse, avant la TVA.
    assert ordre_s.index("Name") < ordre_s.index("DefinedTradeContact") < ordre_s.index("PostalTradeAddress")
    assert ordre_s.index("PostalTradeAddress") < ordre_s.index("URIUniversalCommunication") < ordre_s.index(
        "SpecifiedTaxRegistration"
    )
    tc = seller.find("ram:DefinedTradeContact", NS)
    assert tc.findtext("ram:PersonName", namespaces=NS) == "A. Muster"
    assert tc.findtext("ram:TelephoneUniversalCommunication/ram:CompleteNumber", namespaces=NS) == "+49 511 1234567"
    assert tc.findtext("ram:EmailURIUniversalCommunication/ram:URIID", namespaces=NS) == (
        "a.muster@narchi-architekten.de"
    )
    uri_v = seller.find("ram:URIUniversalCommunication/ram:URIID", NS)
    assert uri_v.get("schemeID") == "EM" and uri_v.text == "buchhaltung@narchi-architekten.de"
    uri_a = racine.find(f"{agreement}/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID", NS)
    assert uri_a.get("schemeID") == "EM" and uri_a.text == "erfassung@hannover-stadt.de"
