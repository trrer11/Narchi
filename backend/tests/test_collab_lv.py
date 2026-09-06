"""Tests §89 — Positions LV structurées co-éditées (étape 3 2/2).

Couvre, avec de VRAIES répliques pycrdt (jamais de mock) :
- extraction d'un état binaire : ordre conservé, GP calculé (arrondi
  centimes), « ohne EP » compté à part, hostiles ignorés (scalaire dans
  le tableau, id manquant, nombres corrompus/négatifs/hors borne),
  borne 500 servie, état corrompu → [] sans exception ;
- REST GET /{room}/lv : réponse vide honnête sans document (pas de 404
  orphelin), positions + totaux + « hinweis » honnête sur document
  seedé, invisibilité inter-bureaux (document d'un AUTRE tenant → même
  réponse vide, indifférenciable).
"""

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pycrdt import Array, Doc, Map
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.collab_doc import CollabDoc  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_history import _utcnow  # noqa: E402
from app.services.lv_positions import (  # noqa: E402
    LV_KEY,
    LV_MAX_POSITIONS,
    extract_lv_positions,
    lv_totals,
)


def _state_with(entries: list) -> bytes:
    """État binaire réel contenant un tableau `lv` avec les entrées données."""
    doc = Doc()
    yarr = doc.get(LV_KEY, type=Array)
    with doc.transaction():
        for entry in entries:
            yarr.append(Map(entry) if isinstance(entry, dict) else entry)
    return doc.get_update()


def _pos(oz: str, qty: float, unit_price, pid: str | None = None, **extra) -> dict:
    base = {
        "id": pid or f"p-{oz}",
        "oz": oz,
        "title": extra.pop("title", f"Position {oz}"),
        "qty": qty,
        "unit": extra.pop("unit", "m³"),
        "unit_price": unit_price,
        "price_hint": extra.pop("price_hint", "manuell"),
    }
    base.update(extra)
    return base


# --------------------------- extraction pure --------------------------------


def test_extract_ordre_gp_et_ohne_ep():
    state = _state_with([
        _pos("01.001", 12.5, 189.9),
        _pos("01.002", 3.0, None),              # position « ohne EP » légale
        _pos("01.010", 2.0, 100.005),           # GP à arrondir au centime
    ])
    positions = extract_lv_positions(state)
    assert [p["oz"] for p in positions] == ["01.001", "01.002", "01.010"]
    assert positions[0]["gp"] == pytest.approx(2373.75, abs=1e-9)
    assert positions[1]["gp"] is None and positions[1]["unit_price"] is None
    assert positions[2]["gp"] == 200.01          # round centimes, pas de float sale
    totals = lv_totals(positions)
    assert totals["count"] == 3 and totals["ohne_ep"] == 1
    assert totals["gp_total"] == 2573.76


def test_extract_ignore_les_hostiles_sans_jamais_deviner():
    state = _state_with([
        "hostile-string",                        # scalaire dans le tableau
        42,
        {"id": "", "oz": "01.001", "qty": 1.0, "unit_price": 10.0},  # id vide → ignoré
        _pos("01.002", "abc", 10.0),             # qty texte → corrompue
        _pos("01.003", -5.0, 10.0),              # Menge négative → refusée
        _pos("01.004", 1.0, "viel"),             # EP texte → corrompue
        _pos("01.005", 1.0, True),               # booléen ≠ nombre
        _pos("01.006", 1.0, 2.0e9),              # hors borne 1 milliard
        _pos("01.007", 4.0, 25.0, title=None),   # titre manquant → "" honnête
    ])
    positions = extract_lv_positions(state)
    assert [p["oz"] for p in positions] == ["01.007"], \
        "une seule position réellement lisible survit — le reste est ignoré, pas deviné"
    assert positions[0]["title"] == ""


def test_extract_borne_500_et_etat_corrompu():
    state = _state_with([_pos(f"99.{i:04d}", 1.0, 1.0) for i in range(LV_MAX_POSITIONS + 50)])
    positions = extract_lv_positions(state)
    assert len(positions) == LV_MAX_POSITIONS, "la borne est SERVIE, jamais dépassée"
    assert extract_lv_positions(b"n'importe quoi") == []
    assert extract_lv_positions(b"") == []


def test_extract_doc_sans_cle_lv_renvoie_vide():
    doc = Doc()
    with doc.transaction():
        doc.get("notiz", type=__import__("pycrdt").Text).insert(0, "nur Text")
    assert extract_lv_positions(doc.get_update()) == []


# ---------------------------------- REST ------------------------------------


def _make_stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, CollabDoc.__table__])
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
    return app, session, {"alice": alice, "fred": fred}


@pytest.fixture()
def stack():
    app, session, users = _make_stack()
    current = {"user": users["alice"]}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        yield client, session, users, current


def _seed(session, tenant: str, room: str, entries: list) -> None:
    session.add(CollabDoc(id=f"{tenant}:{room}", tenant_id=tenant, room=room,
                          state=_state_with(entries), version=1, updated_at=_utcnow()))
    session.commit()


def test_rest_lv_flux_complet(stack):
    client, session, users, _ = stack
    # Sans document : vide honnête, jamais 404 orphelin.
    res = client.get("/api/v5/collab/notiz-buero/lv")
    assert res.status_code == 200 and res.json()["count"] == 0

    _seed(session, "t1", "notiz-buero", [
        _pos("01.001", 12.5, 189.9, title="Stahlbeton C25/30"),
        _pos("01.002", 80.0, None, unit="m²", title="Schalung, EP offen"),
    ])
    res = client.get("/api/v5/collab/notiz-buero/lv")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] == 2 and body["ohne_ep"] == 1
    assert body["gp_total"] == pytest.approx(2373.75, abs=1e-9)
    assert body["max_positions"] == LV_MAX_POSITIONS
    assert body["hinweis"], "l'honnêteté ~2 s + EP manuel est servie, pas décorative"
    first = body["positions"][0]
    assert first["title"] == "Stahlbeton C25/30" and first["price_hint"] == "manuell"


def test_rest_lv_invisibilite_inter_bureaux(stack):
    client, session, users, current = stack
    # Le document appartient au tenant t2 (Fred) ; Alice (t1) ne doit
    # RIEN voir — même réponse que « pas de document », indifférenciable.
    _seed(session, "t2", "notiz-buero", [_pos("01.001", 1.0, 2.0)])
    res = client.get("/api/v5/collab/notiz-buero/lv")
    assert res.status_code == 200 and res.json()["count"] == 0

    # Contrôle : Fred, lui, voit bien sa position.
    current["user"] = users["fred"]
    res = client.get("/api/v5/collab/notiz-buero/lv")
    assert res.json()["count"] == 1
