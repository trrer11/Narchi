"""Tests §91 — Import GAEB entrant (offres d'entreprises).

L'excellence ici = les REFUS : chaque mauvais fichier est rejeté avec un
message allemand précis, jamais importé en silence. Vérifié : round-trip
avec notre propre X31 §90 (leq produit sait relire ce qu'il écrit),
dialecte étranger (namespace DA XML 3.1 / DP 83, virgules décimales),
montants centrimes exacts (jamais de float pour l'argent), IT absent
recalculé UP×Qty / IT fourni respecté, OZ paddée conservée, position
« ohne EP » comptée (pas de 0 € inventé), borne 12 offres, isolation
inter-bureaux indifférenciable (404).
"""

import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.api.collab_routes import MAX_OFFERS_PER_ROOM  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.price_observation import PriceObservation  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_history import _utcnow  # noqa: E402
from app.services.gaeb_import import (  # noqa: E402
    MAX_XML_BYTES,
    GaebImportError,
    parse_gaeb_offer_xml,
)
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402, E501
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


def _pos(oz, qty, up, title="Position", unit="m³"):
    return {
        "id": f"p-{oz}", "oz": oz, "title": title, "qty": float(qty),
        "unit": unit, "unit_price": up, "price_hint": "manuell",
        "gp": round(float(qty) * up, 2) if up is not None else None,
    }


# ------------------------------- parseur ------------------------------------


def test_roundtrip_x31_depuis_notre_export_90():
    xml = build_lv_gaeb_x31(
        project_name="Wasserwerk",
        positions=[_pos("01.003.010", "12.5", 189.9, title="Stahlbeton C25/30")],
        mit_preisen=True,
    )
    parsed = parse_gaeb_offer_xml(xml.encode("utf-8"))
    assert parsed["dp"] == "31" and parsed["cur"] == "EUR"
    assert parsed["item_count"] == 1 and parsed["ohne_preis_count"] == 0
    item = parsed["items"][0]
    assert item["oz"] == "001.003.00010", "OZ paddée REB 23.003 conservée"
    assert item["title"] == "Stahlbeton C25/30"
    assert item["qty"] == 12.5 and item["unit"] == "m³"
    assert item["up_cents"] == 18990 and item["it_cents"] == 237375
    assert parsed["gp_total_cents"] == 237375


def test_dialecte_etranger_x83_virgules_et_it_absent_recalcule():
    xml = """<?xml version="1.0" encoding="utf-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/200407">
 <GAEBInfo><Version>3.1</Version></GAEBInfo>
 <Award><DP>83</DP><AwardInfo><Cur>EUR</Cur></AwardInfo>
  <BoQ><BoQBody><BoQCtgy RNoPart="001"><BoQBody><Itemlist>
   <Item RNoPart="00010"><Qty>12,5</Qty><QU>m³</QU><UP>189,90</UP>
    <Description><CompleteText><OutlineText><OutlTxt><TextOutlTxt>
     <span>Stahlbeton, IT absent</span></TextOutlTxt></OutlTxt></OutlineText></CompleteText>
    </Description></Item>
   <Item RNoPart="00020"><Qty>3</Qty><QU>Stk</QU><UP>40,00</UP><IT>120,01</IT>
    <Description><CompleteText><OutlineText><OutlTxt><TextOutlTxt>
     <span>IT fourni différent — conservé tel quel</span></TextOutlTxt></OutlTxt></OutlineText>
    </CompleteText></Description></Item>
  </Itemlist></BoQBody></BoQCtgy></BoQBody></BoQ>
 </Award>
</GAEB>"""
    parsed = parse_gaeb_offer_xml(xml.encode("utf-8"))
    assert parsed["dp"] == "83"
    it1, it2 = parsed["items"]
    assert it1["up_cents"] == 18990
    assert it1["it_cents"] == 237375, "IT absent = UP×Qty (définition, pas une invention)"
    assert it2["it_cents"] == 12001, "IT fourni RESPECTÉ même s'il diffère d'UP×Qty"
    assert parsed["gp_total_cents"] == 237375 + 12001


def test_refus_motive_detail_par_detail():
    with pytest.raises(GaebImportError, match="Leere Datei"):
        parse_gaeb_offer_xml(b"")
    with pytest.raises(GaebImportError, match="Kein gültiges XML"):
        parse_gaeb_offer_xml(b"<GAEB><cass")
    with pytest.raises(GaebImportError, match="Kein GAEB-Namensraum"):
        parse_gaeb_offer_xml(b"<GAEB></GAEB>")
    with pytest.raises(GaebImportError, match="Unbekannter Namensraum"):
        parse_gaeb_offer_xml(b'<GAEB xmlns="http://schemas.example/soap"></GAEB>')
    with pytest.raises(GaebImportError, match="DTD"):
        parse_gaeb_offer_xml(b'<!DOCTYPE GAEB [<!ENTITY x SYSTEM "file:///etc/passwd">]><GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.2"/>')
    with pytest.raises(GaebImportError, match="zu gro"):
        parse_gaeb_offer_xml(b"x" * (MAX_XML_BYTES + 1))


def test_refus_sans_aucun_prix_et_position_partielle_comptee():
    # Ausschreibung §90 « ohne Preise » renvoyée par mégarde → refus clair.
    xml = build_lv_gaeb_x31(project_name="A", positions=[_pos("01.001", "3", None)])
    with pytest.raises(GaebImportError, match="Keine Preise gefunden"):
        parse_gaeb_offer_xml(xml.encode("utf-8"))
    # Position partiellement chiffrée : importée, comptée, jamais 0 €.
    xml = build_lv_gaeb_x31(project_name="B", positions=[
        _pos("01.001", "3", 40.0), _pos("01.002", "1", 5.0),
    ], mit_preisen=True)
    parsed = parse_gaeb_offer_xml(
        # Simule une position sans prix du tout : UP ET IT supprimés
        xml.encode("utf-8").replace(b"<UP>5.00</UP>", b"", 1).replace(b"<IT>5.00</IT>", b"", 1)
    )
    assert parsed["ohne_preis_count"] == 1
    assert parsed["gp_total_cents"] == 12000, "somme des seuls IT connus, en cents"


def test_dp_fehlt_nicht_als_31_erfunden_und_da_version_gelesen():
    xml = (
        b'<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.2">'
        b"<Award><BoQ><BoQBody><Itemlist>"
        b'<Item RNoPart="00010"><Qty>1</Qty><UP>10.00</UP><IT>10.00</IT></Item>'
        b"</Itemlist></BoQBody></BoQ></Award></GAEB>"
    )
    parsed = parse_gaeb_offer_xml(xml)
    assert parsed["dp"] == ""
    assert parsed["da_version"] == "3.2"


def test_entity_mitten_in_datei_abgelehnt():
    pad = b"<!-- " + (b"x" * 2500) + b" -->"
    xml = (
        b'<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.2">'
        + pad
        + b'<!ENTITY boom SYSTEM "file:///etc/passwd">'
        b"<Award/></GAEB>"
    )
    with pytest.raises(GaebImportError, match="DTD"):
        parse_gaeb_offer_xml(xml)
    partiel = next(i for i in parsed["items"] if i["up_cents"] is None)
    assert partiel["it_cents"] is None


def test_borne_items_refusee():
    items = "".join(
        f'<Item RNoPart="{i:05d}"><Qty>1</Qty><UP>1.00</UP><IT>1.00</IT></Item>'
        for i in range(1, 5002)
    )
    xml = (
        '<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA31/3.2"><Award><DP>83</DP>'
        f"<BoQ><BoQBody><Itemlist>{items}</Itemlist></BoQBody></BoQ></Award></GAEB>"
    ).encode()
    with pytest.raises(GaebImportError, match="Mehr als"):
        parse_gaeb_offer_xml(xml)


# -------------------------------- REST --------------------------------------


def _make_stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, GaebOffer.__table__, PriceObservation.__table__],
        # §96 — DELETE offer efface aussi ses observations (provenance croisée)
    )
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


def _angebot_xml(it_cents_hint="2373.75"):
    return build_lv_gaeb_x31(
        project_name="Wasserwerk",
        positions=[_pos("01.001", "12.5", 189.9, title="Beton C25/30")],
        mit_preisen=True,
    ).encode("utf-8")


def _upload(client, firma="Bauer GmbH"):
    return client.post(
        "/api/v5/collab/notiz-buero/offers",
        files={"file": ("angebot.x31", _angebot_xml(), "application/xml")},
        data={"firma": firma},
    )


def test_rest_upload_liste_detail_delete():
    client, session, _ = _make_stack()
    # Firma obligatoire.
    res = client.post("/api/v5/collab/notiz-buero/offers",
                      files={"file": ("a.x31", _angebot_xml(), "application/xml")},
                      data={"firma": "  "})
    assert res.status_code == 422

    res = _upload(client)
    assert res.status_code == 201, res.text
    body = res.json()
    meta = body["offer"]
    assert meta["company_name"] == "Bauer GmbH"
    assert meta["item_count"] == 1 and meta["gp_total_cents"] == 237375
    assert body["max_offers"] == MAX_OFFERS_PER_ROOM and body["hinweis"]

    res = client.get("/api/v5/collab/notiz-buero/offers")
    assert res.json()["count"] == 1

    res = client.get(f"/api/v5/collab/notiz-buero/offers/{meta['id']}")
    assert res.status_code == 200
    items = res.json()["items"]
    assert items[0]["oz"] == "001.00001" and items[0]["up_cents"] == 18990

    res = client.delete(f"/api/v5/collab/notiz-buero/offers/{meta['id']}")
    assert res.status_code == 204
    assert client.get(f"/api/v5/collab/notiz-buero/offers/{meta['id']}").status_code == 404


def test_rest_refus_parse_et_borne_12():
    client, _, _ = _make_stack()
    res = client.post("/api/v5/collab/notiz-buero/offers",
                      files={"file": ("notes.txt", b"bonjour", "text/plain")},
                      data={"firma": "X"})
    assert res.status_code == 422
    assert "XML" in res.json()["detail"] or "Namensraum" in res.json()["detail"]

    for i in range(MAX_OFFERS_PER_ROOM):
        assert _upload(client, firma=f"Firma {i}").status_code == 201
    res = _upload(client, firma="Une de trop")
    assert res.status_code == 422 and str(MAX_OFFERS_PER_ROOM) in res.json()["detail"]


def test_rest_isolation_inter_bureaux():
    client, session, users = _make_stack()
    res = _upload(client)
    offer_id = res.json()["offer"]["id"]
    # Fred (t2) : 404 nets — détail comme suppression, rien ne fuite.
    users["current"]["user"] = users["fred"]
    assert client.get(f"/api/v5/collab/notiz-buero/offers/{offer_id}").status_code == 404
    assert client.delete(f"/api/v5/collab/notiz-buero/offers/{offer_id}").status_code == 404
    assert client.get("/api/v5/collab/notiz-buero/offers").json()["count"] == 0
