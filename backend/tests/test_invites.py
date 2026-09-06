"""§68 — Einladungen : création/usage unique/révocation/expiration/tenant.

Mini-app FastAPI dédiée + SQLite StaticPool (tables ciblées uniquement —
jamais create_all global : d'autres modèles utilisent JSONB). Le bride
de dépendances (get_db/get_current_user) est remplacée proprement.
"""

from __future__ import annotations

import importlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

REPO_ROOT = Path(__file__).resolve().parents[2]
for path in (str(REPO_ROOT), str(REPO_ROOT / "backend")):
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "x")
from app.core.security import SECRET_KEY as TEST_JWT_SECRET  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.tenant_invite import TenantInvite  # noqa: E402
from app.models.user import User  # noqa: E402
from app.api import invite_routes  # noqa: E402
from app.core.security import get_current_user  # noqa: E402

def _owner() -> User:
    return User(
        id="u-owner",
        email="chef@buero.de",
        hashed_password="x",
        name="Chef",
        role="owner",
        tenant_id="tenant-alpha",
    )


def _member() -> User:
    return User(
        id="u-member",
        email="kollege@buero.de",
        hashed_password="x",
        name="Kollege",
        role="architect",
        tenant_id="tenant-alpha",
    )


@pytest.fixture()
def client_bundle():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, TenantInvite.__table__])
    session = TestingSession()
    # §59 — l'intercepteur tenant global (installé au niveau classe Session
    # par les autres modules en suite complète) exige un tenant explicite.
    session.info["tenant_id"] = "tenant-alpha"
    owner = _owner()
    # Instances FRAÎCHES par session : réutiliser des objets déjà attachés
    # déclenche « already attached to another session ».
    session.add_all([owner, _member()])
    session.commit()

    app = FastAPI()
    app.include_router(invite_routes.router)

    state = {"user": owner}

    def override_get_db():
        yield session

    def override_user():
        return state["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_user
    client = TestClient(app)
    yield client, session, state
    session.close()


def _create(client) -> dict:
    response = client.post("/api/v5/invites", json={})
    assert response.status_code == 201, response.text
    return response.json()


class TestCreate:
    def test_owner_creates_signed_72h_invite(self, client_bundle) -> None:
        client, session, _ = client_bundle
        body = _create(client)
        token = body["invite_path"].split("invite=", 1)[1]
        claims = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        assert claims["purpose"] == "tenant-invite"
        assert claims["tenant_id"] == "tenant-alpha"
        row = session.query(TenantInvite).filter(TenantInvite.jti == claims["jti"]).one()
        assert row.created_by == "u-owner"
        exp = datetime.fromisoformat(body["expires_at"])
        assert exp.tzinfo is not None

    def test_non_owner_forbidden(self, client_bundle) -> None:
        client, _, state = client_bundle
        state["user"].role = "architect"  # même utilisateur, rôle non-owner
        response = client.post("/api/v5/invites", json={})
        assert response.status_code == 403
        state["user"].role = "owner"

    def test_list_shows_states_german(self, client_bundle) -> None:
        client, _, _ = client_bundle
        _create(client)
        rows = client.get("/api/v5/invites").json()
        assert len(rows) == 1
        assert rows[0]["state"] == "offen"


class TestAccept:
    def _accept_payload(self, client, **overrides):
        body = _create(client)
        token = body["invite_path"].split("invite=", 1)[1]
        payload = {
            "token": token,
            "name": "Neue Architektin",
            "email": "neu@architektin.de",
            "password": "sicheres-passwort-123",
        }
        payload.update(overrides)
        return payload

    def test_accept_creates_user_in_inviter_tenant(self, client_bundle) -> None:
        client, session, _ = client_bundle
        response = client.post("/api/v5/invites/accept", json=self._accept_payload(client))
        assert response.status_code == 200, response.text
        created = session.query(User).filter(User.email == "neu@architektin.de").one()
        assert created.tenant_id == "tenant-alpha"  # tenant de l'ÉMETTEUR
        assert created.role == "architect"
        invite = session.query(TenantInvite).filter(TenantInvite.used_by_email == "neu@architektin.de").one()
        assert invite.used_at is not None

    def test_invite_is_single_use(self, client_bundle) -> None:
        client, _, _ = client_bundle
        payload = self._accept_payload(client)
        assert client.post("/api/v5/invites/accept", json=payload).status_code == 200
        payload2 = dict(payload, email="autre@personne.de")
        reused = client.post("/api/v5/invites/accept", json=payload2)
        assert reused.status_code == 410
        assert "bereits verwendet" in reused.json()["detail"]

    def test_tampered_token_rejected(self, client_bundle) -> None:
        client, _, _ = client_bundle
        body = _create(client)
        claims = jwt.decode(
            body["invite_path"].split("invite=", 1)[1],
            TEST_JWT_SECRET, algorithms=["HS256"],
        )
        forged = jwt.encode({**claims, "tenant_id": "tenant-autre"}, "MAUVAISE-CLE", algorithm="HS256")
        payload = self._accept_payload(client, token=forged)
        assert client.post("/api/v5/invites/accept", json=payload).status_code == 400

    def test_expired_token_rejected(self, client_bundle) -> None:
        client, _, _ = client_bundle
        expired = jwt.encode(
            {
                "purpose": "tenant-invite",
                "tenant_id": "tenant-alpha",
                "jti": "jti-ghost",
                "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            },
            TEST_JWT_SECRET, algorithm="HS256",
        )
        payload = self._accept_payload(client, token=expired)
        response = client.post("/api/v5/invites/accept", json=payload)
        assert response.status_code == 400
        assert "ungültig oder abgelaufen" in response.json()["detail"]

    def test_duplicate_email_rejected(self, client_bundle) -> None:
        client, _, _ = client_bundle
        payload = self._accept_payload(client, email="kollege@buero.de")
        assert client.post("/api/v5/invites/accept", json=payload).status_code == 400


class TestRevoke:
    def test_revoke_then_accept_rejected(self, client_bundle) -> None:
        client, _, _ = client_bundle
        body = _create(client)
        assert client.delete(f"/api/v5/invites/{body['invite_id']}").status_code == 204
        payload = {
            "token": body["invite_path"].split("invite=", 1)[1],
            "name": "N", "email": "n@n.de", "password": "motdepasse-tres-long",
        }
        response = client.post("/api/v5/invites/accept", json=payload)
        assert response.status_code == 410
        assert "widerrufen" in response.json()["detail"]

    def test_foreign_tenant_revoke_is_404(self, client_bundle) -> None:
        client, session, _ = client_bundle
        foreign = TenantInvite(
            id="inv-foreign",
            tenant_id="tenant-beta",  # AUTRE bureau
            jti="jti-beta",
            created_by="someone",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=72),
        )
        session.add(foreign)
        session.commit()
        assert client.delete("/api/v5/invites/inv-foreign").status_code == 404


class TestWiring:
    def test_router_mounted_in_main(self) -> None:
        source = (REPO_ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        assert "invite_routes.router" in source
        assert "invite_routes" in source

    def test_migration_revision_chain(self) -> None:
        source = (REPO_ROOT / "backend/alembic/versions/20260808_06_tenant_invites.py").read_text(encoding="utf-8")
        assert 'revision = "20260808_06"' in source
        assert 'down_revision = "20260808_05"' in source

    def test_routes_present_on_real_router(self) -> None:
        paths = [getattr(route, "path", "") for route in invite_routes.router.routes]
        assert "/api/v5/invites" in paths
        assert "/api/v5/invites/accept" in paths
