"""Tests §95 — « Preis-Spiegel » : la Preisbibliothek apprend des offres.

L'exigence : les EP RÉELS d'une offre importée (§91) entrent dans la
Preisbibliothek du bureau VIA le pipeline éprouvé §50 (upsert idempotent,
fortgeschrieben Destatis §49, KG sans ambiguïté) — avec provenance écrite
dans la donnée et refus honnêtes (ohne EP, OZ double/vide, plausibilité).
La chaîne complète est prouvée : X31 (§90) → offre (§91) → bibliothèque
(§95), et le X83 (§93) re-importé alimente pareillement.
"""

import json
import os
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.office_price import OfficePrice  # noqa: E402
from app.models.price_observation import PriceObservation  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402
from app.services.offer_to_pricebook import (  # noqa: E402
    offer_source_label,
    prices_from_offer_items,
)
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

ROOM = "notiz-buero"


# ------------------------------- service ------------------------------------


def _item(oz, up_cents, title="Position", unit="m³"):
    return {"oz": oz, "title": title, "qty": 2.0, "unit": unit,
            "up_cents": up_cents, "it_cents": (up_cents * 2 if up_cents is not None else None)}


def test_items_vers_import_result_prix_exact_et_kg():
    result = prices_from_offer_items(
        [_item("001.003.00010", 18990, title="Stahlbeton C25/30")],
        preisstand_jahr=2026,
    )
    assert result.kind == "offer" and len(result.accepted) == 1 and not result.rejected
    price = result.accepted[0]
    assert price.oz == "001.003.00010"
    assert price.einheitspreis_netto == Decimal("189.90"), "centimes → Decimal net"
    assert price.preisstand_jahr == 2026, "le prix vaut à sa date d'offre"
    assert price.kostengruppe == "kg320_aussenwaende_rohbau", \
        "même détection KG sans ambiguïté que §50 (« beton c »)"


def test_refus_honnêtes_ohne_ep_oz_vide_double_et_plausibilite():
    result = prices_from_offer_items(
        [
            _item("001.00001", None, title="Sans prix"),
            _item("", 500, title="Sans numéro"),
            _item("001.00002", 100, title="Première"),
            _item("001.00002", 200, title="Doublon"),
            _item("001.00003", 150_000_001, title="Trop cher"),  # > 1 M€/unité
        ],
        preisstand_jahr=2026,
    )
    assert len(result.accepted) == 1 and result.accepted[0].oz == "001.00002"
    assert result.accepted[0].einheitspreis_netto == Decimal("1.00"), \
        "OZ doppelt : PREMIÈRE ligne gagne, déterministe"
    raisons = [r.reason for r in result.rejected]
    assert len(result.rejected) == 4
    assert any("ohne EP" in r and "erfunden" in r for r in raisons)
    assert any("keine OZ" in r for r in raisons)
    assert any("doppelt" in r for r in raisons)
    assert any("Plausibilität" in r for r in raisons)


def test_source_label_stable_et_borne():
    import datetime as dt
    label = offer_source_label(
        company_name="Bauer GmbH", room=ROOM,
        received_at=dt.datetime(2026, 8, 10, 9, 30),
    )
    assert label == "Angebot: Bauer GmbH · notiz-buero · 2026-08-10"
    assert len(offer_source_label(
        company_name="X" * 300, room=ROOM,
        received_at=dt.datetime(2026, 1, 1),
    )) <= 255, "borne de la colonne respectée"


# -------------------------------- REST --------------------------------------


def _stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, GaebOffer.__table__, OfficePrice.__table__,
                PriceObservation.__table__],  # §96 — la route écrit aussi ici
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


def _upload(client, firma, ep=189.9, titre="Beton C25/30"):
    xml = build_lv_gaeb_x31(
        project_name="Wasserwerk",
        positions=[{"id": "p1", "oz": "01.001", "title": titre, "qty": 12.5,
                    "unit": "m³", "unit_price": ep, "price_hint": "manuell",
                    "gp": round(12.5 * ep, 2)}],
        mit_preisen=True,
    ).encode("utf-8")
    return client.post(
        f"/api/v5/collab/{ROOM}/offers",
        files={"file": ("angebot.x31", xml, "application/xml")},
        data={"firma": firma},
    )


def test_rest_to_library_happy_path_provenance_dans_la_donnee():
    client, session, _ = _stack()
    offer_id = _upload(client, "Bauer GmbH").json()["offer"]["id"]
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["inserted"] == 1 and body["updated"] == 0 and body["skipped"] == 0
    assert body["preisstand_jahr"] == 2026 and "Preisstand" in body["hinweis"]
    row = session.query(OfficePrice).filter_by(tenant_id="t1").one()
    assert row.source_kind == "offer"
    assert "Bauer GmbH" in row.source_file and "Angebot:" in row.source_file
    assert row.einheitspreis_netto == Decimal("189.90")
    assert row.preisstand_jahr == 2026 and row.kostengruppe == "kg320_aussenwaende_rohbau"


def test_rest_to_library_idempotent_et_remplacement_par_plus_recent():
    client, session, _ = _stack()
    offer_id = _upload(client, "Bauer GmbH", ep=189.9).json()["offer"]["id"]
    first = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    assert first.json()["inserted"] == 1
    again = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    assert again.json()["inserted"] == 0 and again.json()["updated"] == 1, \
        "réappui = idempotent, jamais de doublon"
    assert session.query(OfficePrice).filter_by(tenant_id="t1").count() == 1
    # Offre plus récente, même OZ, nouveau prix réel → remplacement tracé.
    offer2 = _upload(client, "Müller AG", ep=175.5).json()["offer"]["id"]
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer2}/to-library")
    assert res.json() == {**res.json(), "inserted": 0, "updated": 1}
    row = session.query(OfficePrice).filter_by(tenant_id="t1").one()
    assert row.einheitspreis_netto == Decimal("175.50"), "dernier prix RÉEL gagne"
    assert "Müller AG" in row.source_file, "la provenance suit le remplacement"


def test_rest_to_library_isolation_404():
    client, session, users = _stack()
    offer_id = _upload(client, "Bauer GmbH").json()["offer"]["id"]
    users["current"]["user"] = users["fred"]
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    assert res.status_code == 404, "inter-bureaux indifférenciable"
    assert session.query(OfficePrice).filter_by(tenant_id="t2").count() == 0, \
        "rien n'est écrit chez le voisin"


def test_chaine_complete_x31_offre_x83_reimport_bibliotheque():
    """La chaîne vertueuse entière est prouvée en un test :
    X31 (§90) → offre A (§91) → bibliothèque (§95, insert) ; X83 (§93)
    re-téléchargé → re-importé comme offre B (§91) → bibliothèque (update).
    Le produit se nourrit de SES propres pièces formelles."""
    client, session, _ = _stack()
    offer_a = _upload(client, "Bauer GmbH", ep=189.9).json()["offer"]["id"]
    assert client.post(
        f"/api/v5/collab/{ROOM}/offers/{offer_a}/to-library"
    ).json()["inserted"] == 1
    # Le X83 formel repart, revient comme nouvelle pièce d'une suite affaire.
    x83 = client.get(f"/api/v5/collab/{ROOM}/offers/{offer_a}/gaeb.x83")
    assert x83.status_code == 200
    re_import = client.post(
        f"/api/v5/collab/{ROOM}/offers",
        files={"file": ("angebot-Bauer.x83", x83.content, "application/xml")},
        data={"firma": "Bauer GmbH (Nachverhandlung)"},
    )
    assert re_import.status_code == 201, re_import.text
    offer_b = re_import.json()["offer"]["id"]
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_b}/to-library")
    body = res.json()
    assert body["updated"] == 1 and body["inserted"] == 0 and body["skipped"] == 0
    assert session.query(OfficePrice).filter_by(tenant_id="t1").count() == 1
    assert "Nachverhandlung" in session.query(OfficePrice).filter_by(tenant_id="t1").one().source_file
