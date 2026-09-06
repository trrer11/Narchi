"""Tests de l'export GAEB X31 (DA XML 3.2, phase 31) du BOQ DIN 276.

Vérifie la grammaire du document (namespace, DP=31, hiérarchie
BoQCtgy → Itemlist → Item), la cohérence numérique (IT = Qty × UP),
l'échappement XML des libellés et la déterminité de la sortie.
"""

import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal

import pytest

from app.core.estimation.gaeb_export import (
    GAEB_NS,
    build_gaeb_x31,
    build_gaeb_x31_kostengruppen,
)
from app.core.estimation.price_database import PriceRegion
from app.core.estimation.quick_estimate import QuickElement, estimate_quick

FIXED = datetime(2026, 8, 5, 14, 30, 0)


def _sample_lines():
    elements = [
        QuickElement(
            ifc_type="IfcWall",
            name="AW Stahlbeton 24cm",
            net_volume=Decimal("2.4"),
            confidence=0.9,
        ),
        QuickElement(
            ifc_type="IfcSlab",
            name="Decke Stahlbeton",
            net_volume=Decimal("5.0"),
            net_area=Decimal("20.0"),
            confidence=0.9,
        ),
        QuickElement(
            ifc_type="IfcWindow",
            name="Kunststofffenster > 1,5 m²",
            net_area=Decimal("1.8"),
            count=3,
            confidence=0.9,
        ),
    ]
    return estimate_quick(elements, PriceRegion.NIEDERSACHSEN)["lines"]


def _parse(xml: str) -> ET.Element:
    return ET.fromstring(xml)


def test_document_x31_bien_forme_et_phase_31():
    xml = build_gaeb_x31(
        project_name="EFH Hannover",
        lines=_sample_lines(),
        region="de_ni",
        created=FIXED,
    )
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    root = _parse(xml)
    assert root.tag == f"{{{GAEB_NS}}}GAEB"
    version = root.findtext(f"{{{GAEB_NS}}}GAEBInfo/{{{GAEB_NS}}}Version")
    assert version == "3.2"
    dp = root.findtext(f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}DP")
    assert dp == "31"
    assert root.findtext(
        f"{{{GAEB_NS}}}PrjInfo/{{{GAEB_NS}}}LblPrj"
    ) == "EFH Hannover"


def test_une_categorie_par_kostengruppe_et_rno_part():
    xml = build_gaeb_x31(
        project_name="EFH",
        lines=_sample_lines(),
        region="de_ni",
        created=FIXED,
    )
    root = _parse(xml)
    ctgys = root.findall(
        f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}BoQ/{{{GAEB_NS}}}BoQBody/{{{GAEB_NS}}}BoQCtgy"
    )
    assert len(ctgys) == 3  # KG 320, KG 340, KG 361
    for ctgy in ctgys:
        rno = ctgy.get("RNoPart")
        assert rno is not None and len(rno) == 3 and rno.isdigit()
        items = ctgy.findall(
            f"{{{GAEB_NS}}}BoQBody/{{{GAEB_NS}}}Itemlist/{{{GAEB_NS}}}Item"
        )
        assert items, "chaque catégorie porte au moins une position"
        for index, item in enumerate(items, start=1):
            assert item.get("RNoPart") == str(index).rjust(5, "0")
    ids = [c.get("ID") for c in ctgys] + [
        item.get("ID")
        for c in ctgys
        for item in c.findall(
            f"{{{GAEB_NS}}}BoQBody/{{{GAEB_NS}}}Itemlist/{{{GAEB_NS}}}Item"
        )
    ]
    assert len(set(ids)) == len(ids), "les IDs GAEB doivent être uniques"


def test_coherence_numerique_it_egal_qty_fois_up():
    xml = build_gaeb_x31(
        project_name="EFH",
        lines=_sample_lines(),
        region="de_ni",
        created=FIXED,
    )
    root = _parse(xml)
    items = root.findall(f".//{{{GAEB_NS}}}Item")
    assert items
    for item in items:
        qty = Decimal(item.findtext(f"{{{GAEB_NS}}}Qty"))
        up = Decimal(item.findtext(f"{{{GAEB_NS}}}UP"))
        it = Decimal(item.findtext(f"{{{GAEB_NS}}}IT"))
        assert it == (qty * up).quantize(Decimal("0.01"))
        # Format GAEB : point décimal, jamais de virgule décimale
        assert "." in item.findtext(f"{{{GAEB_NS}}}UP")  # EP : 2 décimales
        assert "." in item.findtext(f"{{{GAEB_NS}}}IT")  # GB : 2 décimales
        assert "," not in item.findtext(f"{{{GAEB_NS}}}Qty")
        assert item.findtext(f"{{{GAEB_NS}}}QU")  # unité toujours présente


def test_echappement_xml_umlauts_et_caracteres_speciaux():
    lines = [
        {
            "kostengruppe": "kg320_rohbau_waende",
            "titel": "Wände & Decken <Sonder>nöten \"Außen\"",
            "menge": 12.5,
            "einheit": "m³",
            "einheitspreis_netto": 178.0,
            "gesamt_netto": 2225.0,
            "anzahl_elemente": 2,
            "beispiele": ["AW Stahlbeton 24cm", "Kellerwand"],
        }
    ]
    xml = build_gaeb_x31(
        project_name="Müller & Söhne <Neubau>",
        lines=lines,
        region="de_ni",
        created=FIXED,
    )
    root = _parse(xml)  # lève si mal échappé
    assert root.findtext(f"{{{GAEB_NS}}}PrjInfo/{{{GAEB_NS}}}LblPrj") == (
        "Müller & Söhne <Neubau>"
    )
    span = root.find(
        f".//{{{GAEB_NS}}}Item/{{{GAEB_NS}}}Description/{{{GAEB_NS}}}CompleteText/"
        f"{{{GAEB_NS}}}OutlineText/{{{GAEB_NS}}}OutlTxt/{{{GAEB_NS}}}TextOutlTxt/{{{GAEB_NS}}}span"
    )
    assert span is not None
    assert span.text == "Wände & Decken <Sonder>nöten \"Außen\""


def test_route_gaeb_x31_contrat_http():
    """La route POST /api/v5/estimation/gaeb-x31 renvoie bien un fichier .x31
    en pièce jointe (contrat que le frontend télécharge tel quel)."""
    from app.api.estimation_routes import GaebExportRequest, export_gaeb_x31

    req = GaebExportRequest(
        elements=[
            {
                "ifc_type": "IfcWall",
                "name": "AW Stahlbeton 24cm",
                "volume_m3": 12.5,
                "confidence": 0.9,
            }
        ],
        region="de_ni",
        project_name="EFH Hannover",
    )
    response = export_gaeb_x31(req)  # dépendances auth/DoS injectées par FastAPI
    assert response.media_type.startswith("application/xml")
    disposition = response.headers["Content-Disposition"]
    assert disposition.startswith("attachment;")
    assert disposition.lower().endswith('.x31"')
    root = ET.fromstring(response.body.decode("utf-8"))
    assert root.tag == f"{{{GAEB_NS}}}GAEB"
    assert root.findtext(f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}DP") == "31"


def test_document_deterministe_hors_uuid():
    import re

    def normalize(xml: str) -> str:
        xml = re.sub(r"[0-9a-f-]{36}", "<uuid>", xml)
        return re.sub(r"ID_[0-9a-f-]{36}", "ID_x", xml)

    xml_a = build_gaeb_x31(
        project_name="EFH", lines=_sample_lines(), region="de_ni", created=FIXED
    )
    xml_b = build_gaeb_x31(
        project_name="EFH", lines=_sample_lines(), region="de_ni", created=FIXED
    )
    assert normalize(xml_a) == normalize(xml_b)


# --------------------------------------------------------------------------
# §74 V2.5 — GAEB X31 de la Kostenschätzung DIN 276 (positions pauschales)
# --------------------------------------------------------------------------

def _kg_payload():
    return [
        {"code": "200", "label": "Vorbereitende Maßnahmen",
         "lines": [{"code": "220", "label": "Erschließung des Grundstücks", "amount": 12345.67}]},
        {"code": "300", "label": "Bauwerk – Baukonstruktionen",
         "lines": [{"code": "310", "label": "Baugrund, Gründung", "amount": 456789.0},
                    {"code": "320", "label": "Außenwände", "amount": 234567.89}]},
    ]


def test_gaeb_din276_document_bien_forme():
    xml = build_gaeb_x31_kostengruppen(
        project_name="MFH Linden", din276="2018",
        kostengruppen=_kg_payload(), created=FIXED,
    )
    assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    root = _parse(xml)
    assert root.tag == f"{{{GAEB_NS}}}GAEB"
    assert root.findtext(f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}DP") == "31"
    ctgys = root.findall(f".//{{{GAEB_NS}}}BoQCtgy")
    assert [c.attrib["RNoPart"] for c in ctgys] == ["200", "300"]
    items = root.findall(f".//{{{GAEB_NS}}}Item")
    assert len(items) == 3
    for it in items:
        assert it.findtext(f"{{{GAEB_NS}}}Qty") == "1"
        assert it.findtext(f"{{{GAEB_NS}}}QU") == "psch"
        assert it.findtext(f"{{{GAEB_NS}}}UP") == it.findtext(f"{{{GAEB_NS}}}IT")
    detail = items[0].find(f".//{{{GAEB_NS}}}DetailTxt//{{{GAEB_NS}}}span")
    assert detail is not None
    assert "Richtwert" in detail.text and "Pauschalposition" in detail.text


def test_gaeb_din276_round_trip_importeur():
    """Preuve indépendante : notre propre importeur X31 relit l'export."""
    from app.core.estimation.office_price_import import parse_gaeb_x31_prices

    xml = build_gaeb_x31_kostengruppen(
        project_name="MFH Linden", din276="2018",
        kostengruppen=_kg_payload(), created=FIXED,
    )
    result = parse_gaeb_x31_prices(xml.encode("utf-8"), 2026)
    assert not result.rejected
    assert len(result.accepted) == 3
    prix = sorted(float(p.einheitspreis_netto) for p in result.accepted)
    cible = sorted([12345.67, 456789.0, 234567.89])
    assert all(abs(a - b) < 0.01 for a, b in zip(prix, cible))


def test_route_gaeb_din276_contrat_http():
    from app.api.estimation_routes import GaebDin276Request, export_gaeb_din276

    req = GaebDin276Request(
        project_name="MFH Linden", din276="2018", kostengruppen=_kg_payload()
    )
    response = export_gaeb_din276(req)  # dépendances auth/DoS injectées par FastAPI
    assert response.media_type.startswith("application/xml")
    disposition = response.headers["Content-Disposition"]
    assert disposition.startswith("attachment;")
    assert disposition.lower().endswith('-din276.x31"')
    root = ET.fromstring(response.body.decode("utf-8"))
    assert root.tag == f"{{{GAEB_NS}}}GAEB"
    lbl = root.findtext(f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}BoQ/{{{GAEB_NS}}}BoQInfo/{{{GAEB_NS}}}LblBoQ")
    assert "2018-12" in lbl and "Pauschalpositionen" in lbl


def test_gaeb_din276_rejette_liste_vide():
    with pytest.raises(ValueError):
        build_gaeb_x31_kostengruppen(
            project_name="X", din276="2018", kostengruppen=[], created=FIXED
        )

def test_devise_code_iso_4217_dans_les_deux_builders():
    """§76 — la fachdokumentation GAEB montre le CODE ISO 4217 (« EUR »),
    pas le symbole « € » : un vérificateur de conformité externe
    (GAEB-Viewer) ne doit pas tiquer sur la devise."""
    xml_ifc = build_gaeb_x31(
        project_name="EFH", lines=_sample_lines(), region="de_ni", created=FIXED
    )
    xml_kg = build_gaeb_x31_kostengruppen(
        project_name="EFH", din276="2018", kostengruppen=_kg_payload(), created=FIXED
    )
    for xml in (xml_ifc, xml_kg):
        root = _parse(xml)
        assert root.findtext(f"{{{GAEB_NS}}}PrjInfo/{{{GAEB_NS}}}Cur") == "EUR"
        assert root.findtext(
            f"{{{GAEB_NS}}}Award/{{{GAEB_NS}}}AwardInfo/{{{GAEB_NS}}}Cur"
        ) == "EUR"
        assert root.findtext(f"{{{GAEB_NS}}}PrjInfo/{{{GAEB_NS}}}CurLbl") == "Euro"

