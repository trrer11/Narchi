# -*- coding: utf-8 -*-
"""§116 — API Factures / E-Rechnung (« finis d'abord la E-Rechnung »).

Ce qui est éprouvé ici, pour de vrai :
  - totaux recalculés CÔTÉ SERVEUR au centime près (Decimal, jamais de
    float — le cas piège §114 « 3 × 33,3350 = 100,005 → 100,01 ») ;
  - cycle GoBD : brouillon modifiable/supprimable → émission (numéro
    RE-AAAA-NNNN + date serveur, puis FIGÉE) → storno (numéro CONSERVÉ,
    ligne jamais effacée) ;
  - émission REFUSÉE avec violations nommées (NARCHI-XR-…) quand un champ
    obligatoire manque — et le compteur PAS consommé (aucun trou dans la
    chaîne de numéros) ;
  - chaîne de numérotation continue PAR BUREAU (deux bureaux ont chacun
    leur 0001) ;
  - cloisonnement tenant (404 hors bureau — garde §80 tenue) ;
  - contrat d'entrée strict : lignes obligatoires, décimaux en chaînes,
    unités limitées à la table supportée (dit, pas mappé au hasard).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import invoice_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.invoice import Invoice, InvoiceCounter  # noqa: E402
from app.models.user import User  # noqa: F401,E402
from app.schemas.invoice import CancelRequest, InvoiceUpsert  # noqa: E402

UTC = timezone.utc
ANNEE = datetime.now(UTC).year
AUJOURD_HUI = datetime.now(UTC).date().isoformat()


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [User.__table__, Invoice.__table__, InvoiceCounter.__table__]
    Base.metadata.create_all(bind=engine, tables=tables)
    session = sessionmaker(bind=engine)()
    session.info["tenant_id"] = "tenant-A"
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)


def _user(uid="arch-1", tenant="tenant-A"):
    return SimpleNamespace(id=uid, tenant_id=tenant, email=f"{uid}@narchi.de",
                           name=uid, role="architect")


def _payload(**kw):
    """Charge utile COMPLÈTE type « Stadt Hannover ← Narchi Büro »
    (conforme XRechnung). Les tests de refus partent d'elle et CASSENT
    un champ exprès — jamais l'inverse."""
    base = {
        "buyer_name": "Stadt Hannover — Gebäudemanagement",
        "buyer_street": "Trammplatz 2",
        "buyer_zip": "30159",
        "buyer_city": "Hannover",
        "buyer_country": "DE",
        "buyer_reference": "04011000-2026-4711",
        "seller_name": "Narchi Architekturbüro GmbH",
        "seller_street": "Lister Meile 1",
        "seller_zip": "30161",
        "seller_city": "Hannover",
        "seller_country": "DE",
        "seller_vat_id": "DE123456789",
        # §123 — BG-16 obligatoire (BR-DE-1, mesuré KoSIT) : l'IBAN de test
        # canonique accompagne désormais toute facture XRechnung valide.
        "seller_iban": "DE89370400440532013000",
        "seller_account_name": "Narchi Architekturbüro GmbH",
        # §123 (KoSIT) — adresses électroniques + contact vendeur + processus
        "seller_email": "buchhaltung@narchi-architekten.de",
        "buyer_email": "erfassung@hannover-stadt.de",
        "seller_contact_name": "A. Muster",
        "seller_contact_phone": "+49 511 1234567",
        "seller_contact_email": "a.muster@narchi-architekten.de",
        "currency": "EUR",
        "delivery_date": "2026-08-10",
        "due_date": "2026-09-10",
        "notes": ["Leistungsstand wie besprochen."],
        "lines": [
            {
                "designation": "Grundleistungen LP 5 (Bauantrag)",
                "quantite": "1",
                "unite": "forfait",
                "prix_unitaire_ht": "4000.00",
                "taux_tva": "19",
            },
        ],
    }
    base.update(kw)
    return base


def _creer(db, utilisateur=None, **kw):
    return routes.create_invoice(
        InvoiceUpsert(**_payload(**kw)), current_user=utilisateur or _user(), db=db,
    )


def _codes(exc: HTTPException):
    detail = exc.value.detail
    assert isinstance(detail, dict) and "violations" in detail, detail
    return "\n".join(detail["violations"])


class TestEntreesEtTotaux:
    def test_creation_totaux_recalcules_au_centime(self, db_session):
        # Cas piège §114 : 3 × 33,3350 = 100,005 → 100,01 (HALF_UP) ;
        # TVA par groupe : 100,01 × 19 % = 19,00 ; 87,50 × 7 % = 6,13.
        out = _creer(
            db_session,
            lines=[
                {"designation": "Honoraar je Stunde", "quantite": "3",
                 "unite": "heure", "prix_unitaire_ht": "33.3350", "taux_tva": "19"},
                {"designation": "Fahrtkosten", "quantite": "1",
                 "unite": "forfait", "prix_unitaire_ht": "87.50", "taux_tva": "7"},
            ],
        )
        assert out.status == "draft"
        assert out.rechnungsnummer is None and out.issue_date is None
        assert out.total_net == "187.51"
        assert out.total_tva == "25.13"          # 19,00 + 6,13 — jamais 25,12
        assert out.total_brut == "212.64"
        # Le total vient du SERVEUR : le client n'a rien envoyé à vérifier,
        # il ne PEUT pas envoyer de total (le schéma n'a pas de champ).

    def test_creation_sans_ligne_refusee(self, db_session):
        with pytest.raises(ValidationError):
            InvoiceUpsert(**_payload(lines=[]))

    def test_decimaux_en_chaines_sinon_refus(self, db_session):
        ligne = _payload()["lines"][0]
        with pytest.raises(ValidationError):
            InvoiceUpsert(**_payload(lines=[{**ligne, "quantite": "abc"}]))
        with pytest.raises(ValidationError):
            InvoiceUpsert(**_payload(lines=[{**ligne, "prix_unitaire_ht": "-5"}]))
        with pytest.raises(ValidationError):
            InvoiceUpsert(**_payload(lines=[{**ligne, "quantite": "0"}]))

    def test_unite_hors_table_refusee_et_dite(self, db_session):
        ligne = {**_payload()["lines"][0], "unite": "palette"}
        with pytest.raises(ValidationError) as exc:
            InvoiceUpsert(**_payload(lines=[ligne]))
        assert "palette" in str(exc.value)  # le message NOMME l'unité refusée

    def test_date_mal_formatee_refusee(self, db_session):
        with pytest.raises(ValidationError):
            InvoiceUpsert(**_payload(delivery_date="10.08.2026"))


class TestCloisonnement:
    def test_liste_et_lecture_hors_tenant(self, db_session):
        inv = _creer(db_session)
        espion = _user(uid="arch-9", tenant="tenant-B")
        liste_b = routes.list_invoices(
            status=None, q=None, limit=200, current_user=espion, db=db_session,
        )
        assert liste_b.total == 0
        with pytest.raises(HTTPException) as exc:
            routes.get_invoice(inv.id, current_user=espion, db=db_session)
        assert exc.value.status_code == 404

    def test_numerotation_independante_par_bureau(self, db_session):
        a = _creer(db_session)
        routes.issue_invoice(a.id, current_user=_user(), db=db_session)
        espion = _user(uid="arch-9", tenant="tenant-B")
        b = _creer(db_session, utilisateur=espion)
        b_out = routes.issue_invoice(b.id, current_user=espion, db=db_session)
        # Chaque bureau a SA chaîne : deux « 0001 », zéro fuite.
        a_apres = routes.get_invoice(a.id, current_user=_user(), db=db_session)
        assert a_apres.rechnungsnummer == f"RE-{ANNEE}-0001"
        assert b_out.rechnungsnummer == f"RE-{ANNEE}-0001"


class TestValidationEtEmission:
    def test_validation_brouillon_dit_les_manques(self, db_session):
        # Brouillon minimal : SEULEMENT nom client + une ligne.
        inv = _creer(
            db_session,
            seller_name="", seller_street="", seller_zip="", seller_city="",
            seller_vat_id="", buyer_street="", buyer_zip="", buyer_city="",
            buyer_reference="", delivery_date=None, due_date=None, notes=[],
        )
        rep = routes.validate_invoice(inv.id, current_user=_user(), db=db_session)
        assert rep.ok is False
        blob = "\n".join(rep.violations)
        assert "NARCHI-XR-13" in blob   # USt-IdNr vendeur
        assert "NARCHI-XR-20" in blob   # Leitweg-ID
        assert "NARCHI-XR-01" in blob   # numéro — attribué à l'émission (dit)
        assert "NARCHI-XR-02" in blob   # date d'émission — idem

    def test_validation_brouillon_complet_ok(self, db_session):
        inv = _creer(db_session)
        # XR-01/02 restent (le brouillon n'a volontairement NI numéro NI
        # date) ; TOUT LE RESTE doit être propre — prouvé en filtrant.
        rep = routes.validate_invoice(inv.id, current_user=_user(), db=db_session)
        restants = [v for v in rep.violations
                    if not v.startswith(("NARCHI-XR-01", "NARCHI-XR-02"))]
        assert restants == []

    def test_emission_numero_date_et_freeze(self, db_session):
        inv = _creer(db_session)
        out = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        assert out.status == "issued"
        assert out.rechnungsnummer == f"RE-{ANNEE}-0001"
        assert out.issue_date == AUJOURD_HUI
        assert out.issued_at is not None
        # Figée : ni PUT ni DELETE (GoBD) — 409 franc, jamais de dérobade.
        with pytest.raises(HTTPException) as exc:
            routes.update_invoice(inv.id, InvoiceUpsert(**_payload()),
                                  current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        with pytest.raises(HTTPException) as exc2:
            routes.delete_invoice(inv.id, current_user=_user(), db=db_session)
        assert exc2.value.status_code == 409
        # Seconde émission refusée aussi (sinon le numéro serait re-consommé).
        with pytest.raises(HTTPException) as exc3:
            routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        assert exc3.value.status_code == 409

    def test_emission_refusee_sans_leitweg_compteur_non_consomme(self, db_session):
        inv = _creer(db_session, buyer_reference="")
        with pytest.raises(HTTPException) as exc:
            routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 422
        assert "NARCHI-XR-20" in _codes(exc)
        # Toujours brouillon ; le compteur n'a PAS bougé (aucun trou) :
        # après correction, la facture prend 0001 — pas 0002.
        routes.update_invoice(
            inv.id, InvoiceUpsert(**_payload()), current_user=_user(), db=db_session,
        )
        out = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        assert out.rechnungsnummer == f"RE-{ANNEE}-0001"

    def test_chaine_continue_meme_annee(self, db_session):
        a = _creer(db_session)
        b = _creer(db_session, buyer_name="Stadt Wolfsburg")
        na = routes.issue_invoice(a.id, current_user=_user(), db=db_session)
        nb = routes.issue_invoice(b.id, current_user=_user(), db=db_session)
        assert na.rechnungsnummer == f"RE-{ANNEE}-0001"
        assert nb.rechnungsnummer == f"RE-{ANNEE}-0002"

    def test_list_emise_vs_brouillon(self, db_session):
        a = _creer(db_session)
        _creer(db_session, buyer_name="Noch ein Entwurf")
        routes.issue_invoice(a.id, current_user=_user(), db=db_session)
        emises = routes.list_invoices(status="issued", q=None, limit=200,
                                      current_user=_user(), db=db_session)
        brouillons = routes.list_invoices(status="draft", q=None, limit=200,
                                          current_user=_user(), db=db_session)
        assert emises.total == 1 and brouillons.total == 1
        with pytest.raises(HTTPException) as exc:
            routes.list_invoices(status="inventé", q=None, limit=200,
                                 current_user=_user(), db=db_session)
        assert exc.value.status_code == 400

    def test_liste_filtre_project_id(self, db_session):
        a = _creer(db_session, project_id="prj-alpha", buyer_name="Alpha")
        _creer(db_session, project_id="prj-beta", buyer_name="Beta")
        _creer(db_session, buyer_name="Ohne Projekt")
        assert a.project_id == "prj-alpha"
        nur = routes.list_invoices(
            status=None, q=None, project_id="prj-alpha", limit=200,
            current_user=_user(), db=db_session,
        )
        assert nur.total == 1
        assert nur.invoices[0].buyer_name == "Alpha"
        alle = routes.list_invoices(
            status=None, q=None, project_id=None, limit=200,
            current_user=_user(), db=db_session,
        )
        assert alle.total == 3


class TestStornoEtSuppression:
    def test_brouillon_supprimable_emise_jamais(self, db_session):
        inv = _creer(db_session)
        rep = routes.delete_invoice(inv.id, current_user=_user(), db=db_session)
        assert rep.status_code == 204
        with pytest.raises(HTTPException) as exc:
            routes.get_invoice(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 404

    def test_storno_conserve_le_numero(self, db_session):
        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        out = routes.cancel_invoice(
            inv.id, CancelRequest(reason="Falsche Leistungsperiode"),
            current_user=_user(), db=db_session,
        )
        assert out.status == "cancelled"
        assert out.rechnungsnummer == emise.rechnungsnummer  # JAMAIS libéré
        assert out.cancelled_at is not None
        assert out.cancel_reason == "Falsche Leistungsperiode"
        # XML d'une stornée : refus honnête, numéro cité.
        with pytest.raises(HTTPException) as exc:
            routes.download_xml(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        # Double storno refusé.
        with pytest.raises(HTTPException) as exc2:
            routes.cancel_invoice(inv.id, CancelRequest(), current_user=_user(), db=db_session)
        assert exc2.value.status_code == 409
        # La chaîne CONTINUE aux numéros suivants malgré le storno.
        b = _creer(db_session, buyer_name="Nächster Kunde")
        nb = routes.issue_invoice(b.id, current_user=_user(), db=db_session)
        assert nb.rechnungsnummer == f"RE-{ANNEE}-0002"


class TestXml:
    def test_xml_emise_contenu_et_nom_fichier(self, db_session):
        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        rep = routes.download_xml(inv.id, current_user=_user(), db=db_session)
        corps = rep.body.decode("utf-8")
        assert rep.media_type == "application/xml"
        assert emise.rechnungsnummer in corps
        assert "urn:xeinkauf.de:kosit:xrechnung_3.0" in corps  # §123 — ID officiel KoSIT 3.0.2
        assert "<ram:TypeCode>380</ram:TypeCode>" in corps
        # §123 — exigences mesurées au validateur officiel KoSIT (XRechnung
        # 3.0.2) reproduites SUR LE CHEMIN API : virement SEPA + IBAN (BG-16 /
        # BR-DE-1), adresses électroniques (R010/R020), contact (BR-DE-2).
        assert "<ram:TypeCode>58</ram:TypeCode>" in corps
        assert "<ram:IBANID>DE89370400440532013000</ram:IBANID>" in corps
        assert 'schemeID="EM"' in corps
        assert "<ram:DefinedTradeContact>" in corps
        assert "<ram:DuePayableAmount>4000.00</ram:DuePayableAmount>" not in corps
        # 4 000,00 HT + 19 % = 4 760,00 TTC — recalculé dans le XML,
        # JAMAIS lu depuis le texte envoyé par le client.
        assert "<ram:DuePayableAmount>4760.00</ram:DuePayableAmount>" in corps
        assert rep.headers["content-disposition"].startswith("attachment; filename=\"RE-")

    def test_xml_brouillon_refuse_franchement(self, db_session):
        inv = _creer(db_session)
        with pytest.raises(HTTPException) as exc:
            routes.download_xml(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "erst ausstellen" in exc.value.detail


class TestZugferd:
    """§129 — Facture hybride PDF/A-3 + factur-x.xml embarqué (ZUGFeRD/Factur-X).

    On éprouve la STRUCTURE (embarqué, XMP, OutputIntent, association /AF)
    et le round-trip du XML — la conformité veraPDF/Mustang complète se
    mesure par script (`scripts/valider-zugferd-mustang.sh`), pas ici
    (pas de dépendance Java dans les tests unitaires).
    """
    from app.services.zugferd_pdf import extraire_xml

    def test_zugferd_emise_pdf_hybride_complet(self, db_session):
        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        rep = routes.download_zugferd(inv.id, current_user=_user(), db=db_session)
        corps = rep.body
        assert rep.media_type == "application/pdf"
        assert corps.startswith(b"%PDF-1.")  # PDF/A-3 exige ≥ 1.7 (voir test suivant)

        # Structure hybride Factur-X/ZUGFeRD (mesurée, pas supposée).
        assert b"/AFRelationship /Alternative" in corps
        assert b"/EmbeddedFiles" in corps
        assert b"factur-x.xml" in corps
        assert b"/OutputIntents" in corps  # catalogue référence l'OutputIntent
        assert b"pdfaid:part" in corps and b"pdfaid:conformance" in corps
        assert b"fx:DocumentType" in corps and b"fx:ConformanceLevel" in corps
        assert b"pdfaExtension:schemas" in corps  # schéma d'extension déclaré (veraPDF 6.6)
        # MIME « text/xml » écrit /text#2Fxml (jamais double-échappé /text#232Fxml).
        assert b"/text#2Fxml" in corps and b"/text#232Fxml" not in corps
        # Filename = numéro officiel + suffixe _zugferd.pdf (tirets conservés).
        assert emise.rechnungsnummer + "_zugferd.pdf" in rep.headers[
            "content-disposition"
        ]

    def test_zugferd_xml_embarque_round_trip(self, db_session):
        import xml.etree.ElementTree as ET

        from app.services.zugferd_pdf import extraire_xml

        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        rep = routes.download_zugferd(inv.id, current_user=_user(), db=db_session)
        xml = extraire_xml(rep.body)
        assert xml is not None, "factur-x.xml introuvable dans le PDF hybride"
        # XML bien formé + profil EN 16931 (celui de ZUGFeRD, pas XRechnung).
        racine = ET.fromstring(xml.encode("utf-8"))
        assert "CrossIndustryInvoice" in racine.tag
        assert "urn:cen.eu:en16931:2017" in xml
        assert "urn:xeinkauf.de:kosit:xrechnung_3.0" not in xml  # pas l'extension XRechnung
        # Le numéro officiel émis est dans le XML embarqué.
        assert emise.rechnungsnummer in xml

    def test_zugferd_brouillon_refuse(self, db_session):
        inv = _creer(db_session)
        with pytest.raises(HTTPException) as exc:
            routes.download_zugferd(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "erst ausstellen" in exc.value.detail

    def test_zugferd_stornee_refuse(self, db_session):
        inv = _creer(db_session)
        routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        routes.cancel_invoice(
            inv.id, CancelRequest(reason="Teststorno"), current_user=_user(), db=db_session,
        )
        with pytest.raises(HTTPException) as exc:
            routes.download_zugferd(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "storniert" in exc.value.detail


class TestUbl:
    """§130 — Même facture en syntaxe UBL 2.1 (la syntaxe du réseau Peppol).

    On éprouve la structure (namespaces UBL, EndpointID, TaxTotal unique) et
    l'arithmétique — la conformité complète se mesure par script
    (`scripts/valider-ubl-kosit.sh`, validateur officiel KoSIT), pas ici.
    """
    import xml.etree.ElementTree as ET

    NS_UBL = {
        "": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }

    def test_ubl_emise_structure_et_arithmetique(self, db_session):
        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        rep = routes.download_ubl(inv.id, current_user=_user(), db=db_session)
        assert rep.media_type == "application/xml"
        racine = self.ET.fromstring(rep.body)
        ns = self.NS_UBL
        assert racine.tag == f"{{{ns['']}}}Invoice"

        def txt(chemin):
            el = racine.find(chemin, ns)
            assert el is not None and el.text is not None, f"absent: {chemin}"
            return el.text

        # Identité : profil officiel + numéro + devise.
        assert txt("cbc:CustomizationID") == (
            "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
        )
        assert txt("cbc:ID") == emise.rechnungsnummer
        assert txt("cbc:InvoiceTypeCode") == "380"
        assert txt("cbc:DocumentCurrencyCode") == "EUR"
        # EndpointID = adresse électronique (BT-34), schemeID EM.
        eid = racine.find(
            "cac:AccountingSupplierParty/cac:Party/cbc:EndpointID", ns
        )
        assert eid is not None and eid.get("schemeID") == "EM"
        # Contact BG-6 (BR-DE-2) : nom + téléphone + e-mail séparés de l'EndpointID.
        assert txt("cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name") == "A. Muster"
        assert txt("cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone") == "+49 511 1234567"
        # UN SEUL TaxTotal (règle PEPPOL-EN16931-R053), TaxAmount = TVA totale.
        totaux = racine.findall("cac:TaxTotal", ns)
        assert len(totaux) == 1
        assert txt("cac:TaxTotal/cbc:TaxAmount") == "760.00"  # 4 000 × 19 %
        sous = racine.findall("cac:TaxTotal/cac:TaxSubtotal", ns)
        assert len(sous) == 1  # une seule ligne à 19 %
        assert txt("cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount") == "4000.00"
        assert txt("cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent") == "19.00"
        # Totaux monétaires : 4 000 HT + 19 % = 4 760 TTC (facture du payload).
        assert txt("cac:LegalMonetaryTotal/cbc:PayableAmount") == "4760.00"
        assert txt("cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount") == "4000.00"
        assert txt("cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount") == "4760.00"
        # Ligne : InvoicedQuantity avec unitCode UNECE réel.
        qte = racine.find("cac:InvoiceLine/cbc:InvoicedQuantity", ns)
        assert qte is not None and qte.get("unitCode") == "LS"
        assert qte.text == "1"
        # Ligne : LineExtensionAmount = net de la ligne.
        assert txt("cac:InvoiceLine/cbc:LineExtensionAmount") == "4000.00"
        assert rep.headers["content-disposition"].startswith("attachment; filename=\"RE-")

    def test_ubl_brouillon_refuse(self, db_session):
        inv = _creer(db_session)
        with pytest.raises(HTTPException) as exc:
            routes.download_ubl(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "erst ausstellen" in exc.value.detail

    def test_ubl_profil_en16931_sans_leitweg_ni_iban(self, db_session):
        # Le profil en16931 n'exige ni Leitweg-ID ni IBAN (règles EN 16931
        # seules) : l'émission ET le UBL passent quand même, contrairement au
        # profil XRechnung (qui refuserait BR-DE-1/XR-20).
        inv_out = _creer(db_session, buyer_reference="", seller_iban="")
        # _creer renvoie un InvoiceOut (pydantic) : on modifie l'objet ORM réel.
        orm = db_session.query(Invoice).filter(Invoice.id == inv_out.id).first()
        orm.profile = "en16931"
        db_session.commit()
        emise = routes.issue_invoice(inv_out.id, current_user=_user(), db=db_session)
        rep = routes.download_ubl(inv_out.id, current_user=_user(), db=db_session)
        racine = self.ET.fromstring(rep.body)
        ns = self.NS_UBL
        assert racine.find("cbc:CustomizationID", ns).text == "urn:cen.eu:en16931:2017"
        assert racine.find("cbc:BuyerReference", ns) is None  # pas de Leitweg exigée
        assert racine.find("cac:PaymentMeans", ns) is None  # pas d'IBAN exigé
        assert emise.rechnungsnummer.startswith("RE-")


class TestVersand:
    """§131 — E-mail prêt à l'envoi (.eml) avec la facture hybride jointe.

    On éprouve la structure MIME (expéditeur/destinataire/objet, pièce jointe
    PDF = la facture hybride §129) et les refus honnêtes. Aucun envoi réel :
    le .eml est ouvert dans le client mail du bureau (dit).
    """
    from email import policy
    from email.parser import BytesParser

    def _parse(self, corps: bytes):
        return self.BytesParser(policy=self.policy.default).parsebytes(corps)

    def test_versand_eml_complet_avec_piece_jointe(self, db_session):
        inv = _creer(db_session)
        emise = routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        rep = routes.download_email(inv.id, current_user=_user(), db=db_session)
        assert rep.media_type == "message/rfc822"
        msg = self._parse(rep.body)
        # En-têtes : expéditeur/destinataire du modèle, objet avec le numéro.
        assert msg["To"] == "erfassung@hannover-stadt.de"
        assert msg["From"] == "buchhaltung@narchi-architekten.de"
        assert emise.rechnungsnummer in msg["Subject"]
        # Corps allemand avec le montant TTC recalculé (4 000 + 19 % = 4 760).
        corps = msg.get_body(preferencelist=("plain",)).get_content()
        assert "4.760,00 EUR" in corps
        assert "Sehr geehrte Damen und Herren" in corps
        # Pièce jointe = la facture hybride PDF (application/pdf).
        pieces = list(msg.iter_attachments())
        assert len(pieces) == 1
        att = pieces[0]
        assert att.get_content_type() == "application/pdf"
        assert "zugferd.pdf" in att.get_filename()
        data = att.get_content()
        assert data.startswith(b"%PDF-1.")  # un vrai PDF hybride, pas un leurre
        assert b"factur-x.xml" in data      # et le XML y est embarqué

    def test_versand_brouillon_refuse(self, db_session):
        inv = _creer(db_session)
        with pytest.raises(HTTPException) as exc:
            routes.download_email(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "erst ausstellen" in exc.value.detail

    def test_versand_sans_email_client_refuse(self, db_session):
        # Le profil XRechnung exige déjà l'e-mail à l'émission (règle R010) :
        # on passe en en16931 (où il n'est pas requis) pour éprouver la garde
        # de download_email elle-même — un e-mail sans destinataire = refus
        # honnête, on ne fabrique pas d'adresse.
        inv_out = _creer(db_session, buyer_email="")
        orm = db_session.query(Invoice).filter(Invoice.id == inv_out.id).first()
        orm.profile = "en16931"
        db_session.commit()
        routes.issue_invoice(inv_out.id, current_user=_user(), db=db_session)
        with pytest.raises(HTTPException) as exc:
            routes.download_email(inv_out.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409
        assert "Empfänger" in exc.value.detail  # honnête : il faut un vrai destinataire


class TestKositDual:
    def test_kosit_brouillon_refuse(self, db_session):
        inv = _creer(db_session)
        with pytest.raises(HTTPException) as exc:
            routes.kosit_check(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 409

    def test_kosit_sans_sidecar_503(self, db_session):
        inv = _creer(db_session)
        routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        with pytest.raises(HTTPException) as exc:
            routes.kosit_check(inv.id, current_user=_user(), db=db_session)
        assert exc.value.status_code == 503

    def test_kosit_dual_persiste_sur_facture(self, db_session, monkeypatch):
        def fake_pair(cii: str, ubl: str) -> dict:
            assert "CrossIndustryInvoice" in cii or "rsm:" in cii
            assert "Invoice" in ubl
            return {
                "ok": True,
                "verdict": "ACCEPTABLE",
                "cii": {"ok": True, "verdict": "ACCEPTABLE", "syntax": "cii"},
                "ubl": {"ok": True, "verdict": "ACCEPTABLE", "syntax": "ubl"},
                "peppol_network": False,
            }

        monkeypatch.setattr(routes, "kosit_validate_pair", fake_pair)
        monkeypatch.setattr(routes, "sidecar_ready", lambda: True)
        inv = _creer(db_session)
        routes.issue_invoice(inv.id, current_user=_user(), db=db_session)
        out = routes.kosit_check(inv.id, current_user=_user(), db=db_session)
        assert out["ok"] is True
        assert out["cii"]["syntax"] == "cii"
        assert out["ubl"]["syntax"] == "ubl"
        assert out["peppol_network"] is False
        lu = routes.get_invoice(inv.id, current_user=_user(), db=db_session)
        assert lu.kosit_last is not None
        assert lu.kosit_last["verdict"] == "ACCEPTABLE"
        assert lu.kosit_checked_at is not None
