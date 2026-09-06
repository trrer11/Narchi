"""Tests §78 — présence + verrous doux sur fakeredis (mêmes appels que Redis).

Couvre : couleur stable, cycle join/heartbeat/leave, EXPIRATION réelle de la
présence (TTL abaissé à 1 s via monkeypatch — attendre 45 s serait absurde),
verrou NX (un seul détenteur, refus MOTIVÉ avec propriétaire + TTL),
libération réservée au détenteur, cloisonnement tenant, routes REST
(polling annoncé, salle invalide 422).
"""

import importlib.util
import json
import os
import sys
import time
import types
from pathlib import Path

import fakeredis
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.services.collab_service as svc_module  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_service import (  # noqa: E402
    LOCK_TTL_S,
    PRESENCE_TTL_S,
    CollabService,
    color_for,
)

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture()
def svc():
    return CollabService(fakeredis.FakeStrictRedis(decode_responses=True))


# ------------------------------- service pur -------------------------------

def test_couleur_stable_et_dans_la_palette(svc):
    assert color_for("user-a") == color_for("user-a")
    assert color_for("user-a") != color_for("user-b")
    assert color_for("user-a").startswith("#")


def test_cycle_join_presence_leave(svc):
    svc.join("t1", "buero", "u1", "Anna")
    svc.join("t1", "buero", "u2", "Ben")
    members = svc.presence("t1", "buero")
    assert [m["name"] for m in members] == ["Anna", "Ben"]  # tri déterministe
    assert members[0]["color"] == color_for("u1")
    svc.leave("t1", "buero", "u1")
    assert [m["user_id"] for m in svc.presence("t1", "buero")] == ["u2"]


def test_presence_expire_vraiment(svc, monkeypatch):
    monkeypatch.setattr(svc_module, "PRESENCE_TTL_S", 1)
    svc.join("t1", "buero", "u1", "Anna")
    assert svc.presence("t1", "buero")
    time.sleep(1.05)  # le TTL est la SEULE vérité — pas de zombie
    assert svc.presence("t1", "buero") == []


def test_heartbeat_prolonge_et_conserve_la_date_d_arrivee(svc):
    svc.join("t1", "buero", "u1", "Anna")
    avant = svc.presence("t1", "buero")[0]
    svc.heartbeat("t1", "buero", "u1", "Anna")
    apres = svc.presence("t1", "buero")[0]
    assert apres["joined_at"] == avant["joined_at"]
    assert apres["last_seen"] >= avant["last_seen"]


def test_verrou_un_seul_detenteur_refus_motive(svc):
    premier = svc.claim_lock("t1", "buero", "import-preise", "u1", "Anna")
    assert premier["acquired"] is True
    assert premier["lock"]["expires_in_s"] == LOCK_TTL_S
    second = svc.claim_lock("t1", "buero", "import-preise", "u2", "Ben")
    assert second["acquired"] is False
    assert second["held_by"]["owner_name"] == "Anna"
    assert 0 < second["held_by"]["expires_in_s"] <= LOCK_TTL_S


def test_liberation_reservee_au_detenteur(svc):
    svc.claim_lock("t1", "buero", "cible", "u1", "Anna")
    etranger = svc.release_lock("t1", "buero", "cible", "u2")
    assert etranger == {"released": False, "reason": "not_owner"}
    assert svc.list_locks("t1", "buero")  # verrou intact
    detenteur = svc.release_lock("t1", "buero", "cible", "u1")
    assert detenteur == {"released": True, "reason": "ok"}
    assert svc.list_locks("t1", "buero") == []
    assert svc.release_lock("t1", "buero", "cible", "u1")["reason"] == "absent"


def test_list_locks_et_cloisonnement_tenant(svc):
    svc.claim_lock("t1", "buero", "a", "u1", "Anna")
    svc.claim_lock("t2", "buero", "a", "u2", "Ben")  # MÊME salle, AUTRE bureau
    assert svc.list_locks("t1", "buero")[0]["owner_name"] == "Anna"
    assert svc.list_locks("t2", "buero")[0]["owner_name"] == "Ben"
    svc.join("t1", "buero", "u1", "Anna")
    assert svc.presence("t2", "buero") == []


# ------------------------------ routes REST --------------------------------

def _load_routes():
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)

    path = BACKEND / "app" / "api" / "collab_routes.py"
    spec = importlib.util.spec_from_file_location("collab_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def api_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    mod = _load_routes()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__])
    db = sessionmaker(bind=engine)()
    user = User(id="chef", email="chef@büro.de", hashed_password="x",
                name="Anna Chef", role="owner", tenant_id="t1")
    db.add(user)
    db.commit()
    app = FastAPI()
    app.include_router(mod.router)
    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[mod.get_current_user] = lambda: user
    # UNE instance partagée — sinon chaque requête obtient un Redis VIDE neuf
    # (leçon : la factory de test doit être un singleton, comme en prod).
    shared = CollabService(fakeredis.FakeStrictRedis(decode_responses=True))
    app.dependency_overrides[mod.get_collab_service] = lambda: shared
    return TestClient(app)


def test_routes_join_presence_claim_release(api_client):
    res = api_client.post("/api/v5/collab/buero/join")
    assert res.status_code == 200
    assert res.json()["heartbeat_interval_s"] == 15
    body = api_client.get("/api/v5/collab/buero/presence").json()
    assert body["count"] == 1 and body["members"][0]["name"] == "Anna Chef"
    assert body["poll_interval_s"] == 5  # annoncé, pas survendu

    claim = api_client.post("/api/v5/collab/buero/locks", json={"target": "import"})
    assert claim.status_code == 200 and claim.json()["acquired"] is True
    assert claim.json()["lock_ttl_s"] == 900
    locks = api_client.get("/api/v5/collab/buero/locks").json()
    assert locks["count"] == 1 and locks["locks"][0]["owner_name"] == "Anna Chef"
    rel = api_client.delete("/api/v5/collab/buero/locks/import")
    assert rel.json() == {"released": True, "reason": "ok"}
    assert api_client.get("/api/v5/collab/buero/locks").json()["count"] == 0


def test_route_salle_invalide_422(api_client):
    assert api_client.get("/api/v5/collab/bad room!!/presence").status_code == 422
    assert api_client.post("/api/v5/collab/éè/heartbeat").status_code == 422
