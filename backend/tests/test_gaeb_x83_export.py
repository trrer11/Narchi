"""Tests §93 — Émission formelle GAEB X83 (Angebot) d'une offre stockée.

L'exigence est la même que §90/§91 : le fichier émis est un MIROIR
EXACT des prix vérifiés à l'import (centimes entiers), dans notre
seul dialecte GAEB (DA XML 3.2, phase 83 = Angebot). Vérifié :
conformité squelette (NS, DP=83, Version 3.2), centimes exacts point
décimal, position « ohne EP » SANS UP/IT (jamais 0,00 €), OZ paddée
REB 23.003 + tri numérique, refus motivés sur données non émettables,
round-trip par NOTRE parseur §91 (le produit relit ce qu'il écrit),
REST réel (headers) et isolation inter-bureaux indifférenciable.
"""

import json
import os
import xml.etree.ElementTree as ET
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.estimation.gaeb_export import GAEB_NS  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_history import _utcnow  # noqa: E402
from app.services.gaeb_import import parse_gaeb_offer_xml  # noqa: E402
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402
from app.services.gaeb_offer_export import (  # noqa: E402
    OfferX83Error,
    build_offer_gaeb_x83,
)
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


def _item(oz, qty, up_cents, it_cents, title="Position", unit="m³"):
    """Item tel que stocké en ``items_json`` (§91) : centimes entiers."""
    return {
        "oz": oz, "title": title, "qty": float(qty), "unit": unit,
        "up_cents": up_cents, "it_cents": it_cents,
    }


def _xml_items(xml: str):
    root = ET.fromstring(xml)
    return root, root.findall(f".//{{{GAEB_NS}}}Item")


# ------------------------------- builder ------------------------------------


def test_x83_structure_conforme_da_xml_32():
    xml = build_offer_gaeb_x83(
        project_name="Wasserwerk",
        company_name="Bauer GmbH",
        items=[_item("001.003.00010", 12.5, 18990, 237375, title="Stahlbeton C25/30")],
        source_dp="31",
        created=datetime(2026, 8, 10, 12, 0, 0),
    )
    root = ET.fromstring(xml)
    assert root.tag == f"{{{GAEB_NS}}}GAEB", "un seul dialecte : DA XML 3.2"
    assert root.findtext(f"{{{GAEB_NS}}}GAEBInfo/{{{GAEB_NS}}}Version") == "3.2"
    assert root.findtext(f"./{{{GAEB_NS}}}Award/{{{GAEB_NS}}}DP") == "83", \
        "phase émise = Angebot, TOUJOURS 83"
    name = root.findtext(
        f"./{{{GAEB_NS}}}Award/{{{GAEB_NS}}}BoQ/{{{GAEB_NS}}}BoQInfo/{{{GAEB_NS}}}Name"
    )
    assert "Bauer GmbH" in name
    lbl = root.findtext(
        f"./{{{GAEB_NS}}}Award/{{{GAEB_NS}}}BoQ/{{{GAEB_NS}}}BoQInfo/{{{GAEB_NS}}}LblBoQ"
    )
    assert "geprüftem NARCHI-Import" in lbl and "DP 31" in lbl, \
        "provenance + phase source écrites DANS le fichier"
    assert root.findtext(f"./{{{GAEB_NS}}}Award/{{{GAEB_NS}}}AwardInfo/{{{GAEB_NS}}}Cur") == "EUR"


def test_x83_prix_centimes_exact_point_decimal():
    xml = build_offer_gaeb_x83(
        project_name="P",
        company_name="C",
        items=[_item("001.00001", 12.5, 18990, 237375)],
    )
    assert "<UP>189.90</UP>" in xml and "<IT>2373.75</IT>" in xml
    assert "<Qty>12.5</Qty>" in xml and "<QU>m³</QU>" in xml
    assert "189,90" not in xml, "GAEB = point décimal, jamais la virgule"


def test_x83_position_ohne_ep_reste_sans_prix():
    xml = build_offer_gaeb_x83(
        project_name="P",
        company_name="C",
        items=[
            _item("001.00001", 12.5, 18990, 237375, title="Avec prix"),
            _item("001.00002", 3.0, None, None, title="Ohne EP"),
        ],
    )
    _, items = _xml_items(xml)
    assert len(items) == 2
    premier, second = items
    assert premier.attrib["RNoPart"] == "00001"
    assert premier.find(f"{{{GAEB_NS}}}UP") is not None
    assert premier.find(f"{{{GAEB_NS}}}IT") is not None
    assert second.find(f"{{{GAEB_NS}}}UP") is None, \
        "ohne EP : aucun UP écrit — jamais 0,00 €"
    assert second.find(f"{{{GAEB_NS}}}IT") is None
    assert second.findtext(f"{{{GAEB_NS}}}Qty") == "3", "quantité conservée"


def test_x83_roundtrip_relisible_par_notre_parseur_91():
    items = [
        _item("001.003.00010", 12.5, 18990, 237375, title="Stahlbeton C25/30"),
        _item("001.003.00020", 3.0, 4000, 12001, title="IT fourni respecté"),
        _item("002.00001", 1.0, None, None, title="Ohne EP"),
    ]
    xml = build_offer_gaeb_x83(
        project_name="Wasserwerk", company_name="Bauer GmbH", items=items,
        source_dp="83",
    )
    parsed = parse_gaeb_offer_xml(xml.encode("utf-8"))
    assert parsed["dp"] == "83" and parsed["cur"] == "EUR"
    assert parsed["item_count"] == 3 and parsed["ohne_preis_count"] == 1
    assert parsed["gp_total_cents"] == 237375 + 12001, \
        "somme EXACTE des IT connus uniquement"
    premier = parsed["items"][0]
    assert premier["oz"] == "001.003.00010", "OZ paddée REB 23.003 conservée"
    assert premier["up_cents"] == 18990 and premier["it_cents"] == 237375
    assert premier["title"] == "Stahlbeton C25/30" and premier["qty"] == 12.5
    respecte = parsed["items"][1]
    assert respecte["it_cents"] == 12001, "IT fourni (≠ UP×Qty) jamais recalculé"


def test_x83_refus_motives_sur_donnees_non_emettables():
    with pytest.raises(OfferX83Error, match="Keine Positionen"):
        build_offer_gaeb_x83(project_name="P", company_name="C", items=[])
    with pytest.raises(OfferX83Error, match="Kein einziger Preis"):
        build_offer_gaeb_x83(
            project_name="P", company_name="C",
            items=[_item("001.00001", 1.0, None, None)],
        )


def test_x83_oz_tri_numerique_et_padding_reb():
    xml = build_offer_gaeb_x83(
        project_name="P",
        company_name="C",
        items=[
            _item("1.10", 1.0, 100, 100, title="dix"),
            _item("1.2", 2.0, 200, 400, title="deux"),
        ],
    )
    root, items = _xml_items(xml)
    assert [i.attrib["RNoPart"] for i in items] == ["00002", "00010"], \
        "tri NUMÉRIQUE par segments (« 1.2 » avant « 1.10 »), padding 5"
    ctgy = root.find(f".//{{{GAEB_NS}}}BoQCtgy")
    assert ctgy is not None and ctgy.attrib["RNoPart"] == "001", \
        "groupe déduit du segment commun, padding 3"
    lengths = [
        b.findtext(f"{{{GAEB_NS}}}Length")
        for b in root.findall(f".//{{{GAEB_NS}}}BoQBkdn")
    ]
    assert "3" in lengths and "5" in lengths, "BoQBkdn déclarée = contenu réel"


# -------------------------------- REST --------------------------------------


def _stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, GaebOffer.__table__])
    session = sessionmaker(bind=engine)()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    fred = User(id="u-fred", email="fred@ander.de", hashed_password="x",
                name="Fred F", role="owner", tenant_id="t2", is_active=True)
    session.add_all([alice, fred])
    session.commit()
    app = FastAPI()
    app.include_router(routes_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    current = {"user": alice}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        return client, session, {"alice": alice, "fred": fred, "current": current}


def _upload_offer(client, firma="Bauer GmbH"):
    """Offre réelle via l'import §91 — le X83 part donc de données vérifiées."""
    xml = build_lv_gaeb_x31(
        project_name="Wasserwerk",
        positions=[
            {"id": "p1", "oz": "01.001", "title": "Beton C25/30", "qty": 12.5,
             "unit": "m³", "unit_price": 189.9, "price_hint": "manuell", "gp": 2373.75},
        ],
        mit_preisen=True,
    ).encode("utf-8")
    return client.post(
        "/api/v5/collab/notiz-buero/offers",
        files={"file": ("angebot.x31", xml, "application/xml")},
        data={"firma": firma},
    )


def test_rest_x83_telechargement_headers_et_relisible():
    client, _, _ = _stack()
    offer_id = _upload_offer(client).json()["offer"]["id"]
    res = client.get(f"/api/v5/collab/notiz-buero/offers/{offer_id}/gaeb.x83")
    assert res.status_code == 200, res.text
    assert "application/xml" in res.headers["content-type"]
    disposition = res.headers["content-disposition"]
    assert 'filename="angebot-Bauer-GmbH.x83"' in disposition
    assert res.headers["x-narchi-offer-positionen"] == "1"
    assert res.headers["x-narchi-offer-ohne-ep"] == "0"
    parsed = parse_gaeb_offer_xml(res.content)
    assert parsed["dp"] == "83" and parsed["item_count"] == 1
    assert parsed["items"][0]["up_cents"] == 18990, \
        "le X83 téléchargé porte les prix vérifiés à l'import"


def test_rest_x83_isolation_et_garde_422():
    client, session, users = _stack()
    offer_id = _upload_offer(client).json()["offer"]["id"]
    # Fred (t2) : 404 indifférenciable — l'URL X83 ne fuite rien.
    users["current"]["user"] = users["fred"]
    res = client.get(f"/api/v5/collab/notiz-buero/offers/{offer_id}/gaeb.x83")
    assert res.status_code == 404
    users["current"]["user"] = users["alice"]
    assert client.get(
        f"/api/v5/collab/notiz-buero/offers/{offer_id}/gaeb.x83"
    ).status_code == 200
    # Garde défensive : ligne corrompue directement en BDD → 122 motivé,
    # jamais de fichier vide ou fautif servi.
    session.add(GaebOffer(
        id="x83-vide", tenant_id="t1", room="notiz-buero",
        company_name="Kaputt AG", filename="", dp="83", cur="EUR",
        xml_raw=b"<GAEB/>", bytes=7, items_json="[]", item_count=0,
        ohne_preis_count=0, gp_total_cents=0, created_by="u-alice",
        created_by_name="Alice A", created_at=_utcnow(),
    ))
    session.commit()
    res = client.get("/api/v5/collab/notiz-buero/offers/x83-vide/gaeb.x83")
    assert res.status_code == 422 and "Keine Positionen" in res.json()["detail"]
