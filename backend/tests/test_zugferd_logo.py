"""§150 — Gabarit professionnel + logo du bureau sur la facture ZUGFeRD.

Éprouve (sans Java, en pur Python) :
  * `_logo_image` : un PNG/JPEG valide est mis à l'échelle pour l'en-tête,
    un contenu illisible → None (jamais d'image cassée) ;
  * `_office_name` : branding §77 prioritaire, sinon le nom du vendeur ;
  * `generer_pdf_zugferd` avec un logo (RGBA, transparence) → le PDF reste
    un hybride valide (round-trip XML intact, en-tête %PDF) ;
  * `pillow` est épinglé dans requirements-api.txt (l'image API décore le
    PDF, or reportlab.lib.utils.ImageReader exige PIL).
"""
from __future__ import annotations

import base64
import re
from decimal import Decimal
from pathlib import Path

from reportlab.lib.units import cm

from app.services.xrechnung import Facture, LigneFacture, Partie, construire_cii
from app.services.zugferd_pdf import (
    _logo_image,
    _office_name,
    extraire_xml,
    generer_pdf_zugferd,
)

ROOT = Path(__file__).resolve().parents[2]

# PNG 1×1 gris (valide, sans alpha).
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _facture() -> Facture:
    vendeur = Partie(
        nom="Narchi Architekten GmbH", rue="Lister Meile 12", code_postal="30161",
        ville="Hannover", pays="DE", vat_id="DE123456789",
        email="buchhaltung@narchi-architekten.de",
    )
    acheteur = Partie(
        nom="Stadt Hannover — Gebäudemanagement", rue="Trammplatz 2",
        code_postal="30159", ville="Hannover", pays="DE",
        email="erfassung@hannover-stadt.de",
    )
    lignes = (
        LigneFacture("Grundleistungen LP 5", Decimal("1"), "forfait",
                     Decimal("4000.00"), Decimal("19")),
    )
    return Facture(
        numero="RE-2026-0042", date_emission="2026-08-11",
        vendeur=vendeur, acheteur=acheteur, lignes=lignes, devise="EUR",
        reference_acheteur="040-11000-99NABC", date_livraison="2026-08-04",
        date_echeance="2026-09-10", iban="DE89370400440532013000",
        titulaire_compte="Narchi Architekten GmbH",
        contact_nom="A. Muster", contact_telephone="+49 511 1234567",
        contact_email="a.muster@narchi-architekten.de",
    )


class TestLogoImage:
    def test_png_valide_mis_a_l_echelle(self):
        r = _logo_image(base64.b64encode(_PNG_1X1).decode())
        assert r is not None
        reader, w, h = r
        assert 0 < w <= 5.0 * cm
        assert 0 < h <= 1.5 * cm

    def test_absent_ou_illisible_retourne_none(self):
        assert _logo_image(None) is None
        assert _logo_image("") is None
        assert _logo_image("!!! pas du base64 !!!") is None
        assert _logo_image(base64.b64encode(b"pas une image").decode()) is None


class TestOfficeName:
    def test_branding_prioritaire(self):
        fac = _facture()
        assert _office_name("Architekturbüro Muster", fac) == "Architekturbüro Muster"
        assert _office_name("  ", fac) == "Narchi Architekten GmbH"  # vide → vendeur
        assert _office_name(None, fac) == "Narchi Architekten GmbH"


class TestPdfAvecLogo:
    def test_round_trip_xml_intact_et_pdf_valide(self):
        fac = _facture()
        xml = construire_cii(fac, "en16931")
        pdf_sans = generer_pdf_zugferd(fac, xml)
        pdf_avec = generer_pdf_zugferd(
            fac, xml, logo_b64=base64.b64encode(_PNG_1X1).decode(),
            office_name="Architekturbüro Muster",
        )
        for pdf in (pdf_sans, pdf_avec):
            assert pdf.startswith(b"%PDF-1.")
            assert extraire_xml(pdf) == xml  # le XML embarqué ne bouge pas
        # Le PDF avec logo est plus lourd (l'image est embarquée).
        assert len(pdf_avec) > len(pdf_sans)

    def test_logo_illisible_retombe_sans_erreur(self):
        fac = _facture()
        xml = construire_cii(fac, "en16931")
        pdf = generer_pdf_zugferd(fac, xml, logo_b64="garbage-not-b64")
        assert pdf.startswith(b"%PDF-1.")
        assert extraire_xml(pdf) == xml


class TestPillowManifest:
    def test_pillow_epingle_dans_requirements_api(self):
        texte = (ROOT / "backend" / "requirements-api.txt").read_text(encoding="utf-8")
        m = re.search(r"pillow==(\d+)\.(\d+)\.(\d+)", texte)
        assert m, "pillow doit être épinglé dans requirements-api.txt (§150, logo ZUGFeRD)"
        assert (int(m.group(1)), int(m.group(2))) >= (12, 0)
