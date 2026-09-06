"""Tests §77 du branding bureau (« PDF avec MON logo »).

Couvre : lecture vide honnête (null partout), round-trip complet, remplacement
et retrait du logo (null retire), rejets MOTIVÉS (SVG, faux PNG vérifié par
octets magiques, base64 cassé, surpoids), cloisonnement tenant et RBAC
(écriture owner seulement, lecture pour tous). Les images de test sont de
VRAIES images 1×1 — leur magie est vérifiée en premier.
"""

import base64
import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.database import Base  # noqa: E402
from app.models.tenant_branding import TenantBranding  # noqa: E402
from app.models.user import User  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]

# Vraies images 1×1 (malles de test sans surprise : magie vérifiée ci-dessous)
PNG_1PX_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
JPEG_1PX_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhIVFhUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLi0BCgoKDg0OFxAQGC0dHx0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAVEAEBAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAASaf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k="
)
PNG_URL = f"data:image/png;base64,{PNG_1PX_B64}"
JPEG_URL = f"data:image/jpeg;base64,{JPEG_1PX_B64}"


def test_fixtures_sont_de_vraies_images():
    assert base64.b64decode(PNG_1PX_B64).startswith(b"\x89PNG\r\n\x1a\n")
    assert base64.b64decode(JPEG_1PX_B64).startswith(b"\xff\xd8\xff")


def _load_routes():
    """Routeur isolé avec dos_guard bouchonné (doctrine des tests §50/§73)."""
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)

    path = BACKEND / "app" / "api" / "branding_routes.py"
    spec = importlib.util.spec_from_file_location("branding_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


TABLES = [User.__table__, TenantBranding.__table__]


def _mk_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
    return sessionmaker(bind=engine)()


def _mk_user(db, *, user_id: str, tenant: str, role: str = "owner") -> User:
    user = User(
        id=user_id, email=f"{user_id}@büro.de", hashed_password="x",
        name=user_id, role=role, tenant_id=tenant,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def api_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    mod = _load_routes()
    db = _mk_session()
    user = _mk_user(db, user_id="chef", tenant="t1", role="owner")
    autre = _mk_user(db, user_id="fremd", tenant="t2", role="owner")
    kollege = _mk_user(db, user_id="kollege", tenant="t1", role="architect")
    app = FastAPI()
    app.include_router(mod.router)
    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[mod.get_current_user] = lambda: user
    client = TestClient(app)
    client.state = {
        "user": user, "autre": autre, "kollege": kollege,
        "db": db, "app": app, "get_current_user": mod.get_current_user,
    }
    return client


def _as(client, who: str) -> None:
    st = client.state
    st["app"].dependency_overrides[st["get_current_user"]] = lambda: st[who]


# --------------------------------------------------------------------------

def test_branding_vide_honnete(api_client):
    body = api_client.get("/api/v5/branding").json()
    assert body == {"office_name": None, "logo": None,
                    "updated_at": None, "updated_by": None}


def test_branding_roundtrip_complet(api_client):
    res = api_client.put("/api/v5/branding",
                         json={"office_name": "Atelier Müller", "logo_data_url": PNG_URL})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["office_name"] == "Atelier Müller"
    assert body["logo"]["mime"] == "image/png"
    assert body["logo"]["bytes"] == len(base64.b64decode(PNG_1PX_B64))
    assert body["logo"]["data_url"] == PNG_URL  # round-trip EXACT
    assert body["updated_by"] == "chef" and body["updated_at"]
    # Relecture DB : mêmes champs (updated_at peut différer en notation de
    # fuseau selon la couche de sérialisation — le FOND est vérifié) :
    relu = api_client.get("/api/v5/branding").json()
    assert relu["office_name"] == body["office_name"]
    assert relu["logo"] == body["logo"]
    assert relu["updated_by"] == "chef" and relu["updated_at"]


def test_branding_remplacement_et_retrait_honnetes(api_client):
    api_client.put("/api/v5/branding",
                   json={"office_name": "Atelier", "logo_data_url": PNG_URL})
    api_client.put("/api/v5/branding",
                   json={"office_name": "Atelier", "logo_data_url": JPEG_URL})
    assert api_client.get("/api/v5/branding").json()["logo"]["mime"] == "image/jpeg"
    # null RETIRE (c'est « Logo entfernen ») — le nom survit :
    api_client.put("/api/v5/branding",
                   json={"office_name": "Atelier", "logo_data_url": None})
    body = api_client.get("/api/v5/branding").json()
    assert body["logo"] is None and body["office_name"] == "Atelier"


def test_branding_rejette_svg_et_faux_format_avec_raison(api_client):
    svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode()
    res = api_client.put("/api/v5/branding", json={"office_name": None, "logo_data_url": svg})
    assert res.status_code == 422 and "SVG" in res.json()["detail"]
    # Déclaré PNG mais contenu JPEG : la magie trahit, le rejet le dit :
    res2 = api_client.put("/api/v5/branding",
                          json={"office_name": None, "logo_data_url": f"data:image/png;base64,{JPEG_1PX_B64}"})
    assert res2.status_code == 422 and "Magic-Bytes" in res2.json()["detail"]


def test_branding_rejette_base64_casse_et_surpoids(api_client):
    res = api_client.put("/api/v5/branding",
                         json={"office_name": None, "logo_data_url": "data:image/png;base64,!!!"})
    assert res.status_code == 422
    gros = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * (513 * 1024)).decode()
    res2 = api_client.put("/api/v5/branding",
                          json={"office_name": None, "logo_data_url": f"data:image/png;base64,{gros}"})
    assert res2.status_code == 422 and "512" in res2.json()["detail"]
    # Rien n'a été persisté par ces rejets :
    assert api_client.get("/api/v5/branding").json()["logo"] is None


def test_branding_cloisonne_par_tenant(api_client):
    api_client.put("/api/v5/branding",
                   json={"office_name": "Atelier Müller", "logo_data_url": PNG_URL})
    _as(api_client, "autre")
    body = api_client.get("/api/v5/branding").json()
    assert body == {"office_name": None, "logo": None,
                    "updated_at": None, "updated_by": None}


def test_branding_ecriture_owner_seulement_lecture_pour_tous(api_client):
    _as(api_client, "kollege")  # architect, même tenant
    res = api_client.put("/api/v5/branding",
                         json={"office_name": "Intrusion", "logo_data_url": PNG_URL})
    assert res.status_code == 403 and "owner" in res.json()["detail"]
    assert api_client.get("/api/v5/branding").status_code == 200  # lecture OK
    assert api_client.get("/api/v5/branding").json()["office_name"] is None


def test_branding_nom_tronque_et_vide_normalise(api_client):
    res = api_client.put("/api/v5/branding", json={"office_name": "   ", "logo_data_url": None})
    assert res.status_code == 200 and res.json()["office_name"] is None  # blancs → null
    trop_long = api_client.put("/api/v5/branding", json={"office_name": "X" * 121, "logo_data_url": None})
    assert trop_long.status_code == 422  # pydantic max_length gravé
