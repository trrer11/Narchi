"""Tests §96 — Preisspiegel : min/médiane/max des observations réelles.

L'exigence : une médiane n'existe que s'il y a une HISTOIRE — chaque
reprise en bibliothèque (§95) mémorise une observation idempotente
(jamais comptée deux fois, jamais pour un « ohne EP »), la médiane est
au centime Half-Up (règle épinglée), jamais de « moyenne » d'une seule
pièce (comptée et dite), suppression d'offre = ses observations partent
(provenance réversible), isolation tenant stricte.
"""

import importlib.util
import os
import sys
import types
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as collab_mod  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.gaeb_offer import GaebOffer  # noqa: E402
from app.models.office_price import OfficePrice  # noqa: E402
from app.models.price_observation import PriceObservation  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.gaeb_lv_export import build_lv_gaeb_x31  # noqa: E402
from app.services.offer_to_pricebook import prices_from_offer_items  # noqa: E402
from app.services.price_observations import (  # noqa: E402
    median_cents,
    record_observations,
    spiegel_for_tenant,
)
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def _load_office_routes():
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)
    path = BACKEND / "app" / "api" / "office_price_routes.py"
    spec = importlib.util.spec_from_file_location("office_price_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


ROOM = "notiz-buero"
NOW = datetime(2026, 8, 10, 12, 0, 0)


# --------------------------- règles pures ------------------------------------


def test_median_cents_half_up_et_cas_limites():
    assert median_cents([10000, 10100, 19900]) == 10100, "impair : valeur centrale"
    assert median_cents([10000, 10101]) == 10051, "pair : (10000+10101)/2 = 10050,5 → Half-Up"
    assert median_cents([10000, 10100]) == 10050, "pair exact sans demi"
    assert median_cents([5000]) == 5000
    assert median_cents([]) is None, "vide : rien, jamais 0"


# ------------------------------- stack ---------------------------------------


def _stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, GaebOffer.__table__, OfficePrice.__table__,
                PriceObservation.__table__],
    )
    session = sessionmaker(bind=engine)()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    fred = User(id="u-fred", email="fred@ander.de", hashed_password="x",
                name="Fred F", role="owner", tenant_id="t2", is_active=True)
    session.add_all([alice, fred])
    session.commit()
    office_mod = _load_office_routes()
    app = FastAPI()
    app.include_router(collab_mod.router)
    app.include_router(office_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    current = {"user": alice}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        return client, session, {"alice": alice, "fred": fred, "current": current}


def _upload_take(client, firma, ep):
    xml = build_lv_gaeb_x31(
        project_name="Wasserwerk",
        positions=[{"id": "p1", "oz": "01.001", "title": "Beton C25/30", "qty": 12.5,
                    "unit": "m³", "unit_price": ep, "price_hint": "manuell",
                    "gp": round(12.5 * ep, 2)}],
        mit_preisen=True,
    ).encode("utf-8")
    offer_id = client.post(
        f"/api/v5/collab/{ROOM}/offers",
        files={"file": ("a.x31", xml, "application/xml")},
        data={"firma": firma},
    ).json()["offer"]["id"]
    res = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library")
    assert res.status_code == 200, res.text
    return offer_id, res.json()


# ------------------------------- REST ----------------------------------------


def test_to_library_enregistre_observation_provenance_exacte():
    client, session, _ = _stack()
    offer_id, body = _upload_take(client, "Bauer GmbH", 189.9)
    assert body["observations_added"] == 1
    # Idempotent : réappui = 0 observation ajoutée, 1 bibliothèque mise à jour.
    again = client.post(f"/api/v5/collab/{ROOM}/offers/{offer_id}/to-library").json()
    assert again["observations_added"] == 0
    obs = session.query(PriceObservation).filter_by(tenant_id="t1").all()
    assert len(obs) == 1, "jamais comptée deux fois"
    o = obs[0]
    assert o.offer_id == offer_id and o.ep_cents == 18990
    assert o.company_name == "Bauer GmbH" and o.preisstand_jahr == 2026
    assert o.oz == "001.00001" and "Bauer GmbH" in o.source_label


def test_ohne_ep_ne_produit_jamais_d_observation():
    _, session, _ = _stack()
    result = prices_from_offer_items(
        [{"oz": "1.1", "title": "Sans prix", "qty": 1.0, "unit": "m³",
          "up_cents": None, "it_cents": None}],
        preisstand_jahr=2026,
    )
    assert not result.accepted and len(result.rejected) == 1
    added = record_observations(
        session, tenant_id="t1", offer_id="off-x", company_name="C",
        source_label="L", preisstand_jahr=2026, accepted=result.accepted,
        taken_by="u", taken_at=NOW,
    )
    assert added == 0
    assert session.query(PriceObservation).count() == 0, \
        "on n'observe pas un prix absent"


def test_spiegel_trois_offres_min_mediane_max():
    client, _, _ = _stack()
    _upload_take(client, "A AG", 100.00)
    _upload_take(client, "B AG", 101.00)
    _upload_take(client, "C AG", 199.00)
    res = client.get("/api/v5/office-prices/spiegel")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_observations"] == 3 and body["single_oz_count"] == 0
    item = body["items"][0]
    assert item["oz"] == "001.00001" and item["n"] == 3
    assert item["min_cents"] == 10000 and item["max_cents"] == 19900
    assert item["median_cents"] == 10100
    assert item["latest_jahr"] == 2026 and item["latest_company"] in {"A AG", "B AG", "C AG"}
    assert item["latest_source"] and "Angebot:" in item["latest_source"]
    assert "mindestens 2 Beobachtungen" in body["hinweis"]


def test_spiegel_jamais_de_moyenne_d_une_seule_piece():
    client, _, _ = _stack()
    _upload_take(client, "Solo GmbH", 100.00)
    body = client.get("/api/v5/office-prices/spiegel").json()
    assert body["items"] == [], "une seule pièce = pas de Spiegel — dit"
    assert body["single_oz_count"] == 1 and body["total_observations"] == 1


def test_spiegel_tri_numerique_puis_lettres():
    client, session, _ = _stack()

    def _obs(offer_id, oz, cents):
        result = prices_from_offer_items(
            [{"oz": oz, "title": "P", "qty": 1.0, "unit": "m³",
              "up_cents": cents, "it_cents": cents}],
            preisstand_jahr=2026,
        )
        record_observations(session, tenant_id="t1", offer_id=offer_id,
                           company_name="C", source_label="L",
                           preisstand_jahr=2026, accepted=result.accepted,
                           taken_by="u", taken_at=NOW)

    for kg in (("o1", "01.010", 10000), ("o2", "01.010", 11000),
               ("o1", "01.9", 20000), ("o2", "01.9", 21000),
               ("o1", "A.03", 5000), ("o2", "A.03", 6000)):
        _obs(*kg)
    body = client.get("/api/v5/office-prices/spiegel").json()
    assert [i["oz"] for i in body["items"]] == ["01.9", "01.010", "A.03"], \
        "numérique d'abord (9 avant 10), lettres ensuite — jamais lexicographique"


def test_suppression_offre_emporte_ses_observations():
    client, _, _ = _stack()
    offer_a, _ = _upload_take(client, "A AG", 100.00)
    _upload_take(client, "B AG", 200.00)
    body = client.get("/api/v5/office-prices/spiegel").json()
    assert body["items"][0]["n"] == 2
    res = client.delete(f"/api/v5/collab/{ROOM}/offers/{offer_a}")
    assert res.status_code == 204
    after = client.get("/api/v5/office-prices/spiegel").json()
    assert after["items"] == [] and after["single_oz_count"] == 1
    assert after["total_observations"] == 1, \
        "il ne reste que l'observation de B — provenance réversible"


def test_spiegel_isolation_stricte_tenants():
    client, session, users = _stack()
    _upload_take(client, "A AG", 100.00)
    _upload_take(client, "B AG", 200.00)
    assert client.get("/api/v5/office-prices/spiegel").json()["items"][0]["n"] == 2
    users["current"]["user"] = users["fred"]
    body = client.get("/api/v5/office-prices/spiegel").json()
    assert body["items"] == [] and body["total_observations"] == 0
    assert session.query(PriceObservation).filter_by(tenant_id="t2").count() == 0
