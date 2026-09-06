# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import office_blob_sync_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.office_blob_mirror import OfficeBlobMirror  # noqa: E402
from app.models.user import User  # noqa: F401,E402
from app.schemas.office_blob_sync import OfficeBlobPut  # noqa: E402

UTC = timezone.utc
T0 = datetime(2026, 8, 23, 10, 0, 0, tzinfo=UTC)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [User.__table__, OfficeBlobMirror.__table__]
    Base.metadata.create_all(bind=engine, tables=tables)
    session = sessionmaker(bind=engine)()
    session.info["tenant_id"] = "tenant-A"
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)


def _user(uid="arch-1", tenant="tenant-A"):
    return SimpleNamespace(id=uid, tenant_id=tenant, email=f"{uid}@narchi.de", name=uid, role="architect")


def test_empty_then_put_then_lww(db_session):
    out = routes.get_blob("mahnwesen", current_user=_user(), db=db_session)
    assert out.empty is True
    put = routes.put_blob(
        "mahnwesen",
        OfficeBlobPut(payload={"inv-1": "bezahlt"}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert put.payload["inv-1"] == "bezahlt"
    older = routes.put_blob(
        "mahnwesen",
        OfficeBlobPut(payload={"inv-1": "offen"}, updated_at=T0 - timedelta(seconds=5)),
        current_user=_user(),
        db=db_session,
    )
    assert older.payload["inv-1"] == "bezahlt"


def test_bauteile_kind_ok(db_session):
    out = routes.put_blob(
        "bauteile",
        OfficeBlobPut(payload={"items": [{"id": "bt-1", "name": "WDVS"}]}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert out.payload["items"][0]["name"] == "WDVS"


def test_absender_kind_ok(db_session):
    out = routes.put_blob(
        "absender",
        OfficeBlobPut(payload={"name": "Büro GmbH", "iban": "DE89"}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert out.payload["name"] == "Büro GmbH"


def test_abschlag_and_worklog_kinds_ok(db_session):
    a = routes.put_blob(
        "abschlag",
        OfficeBlobPut(payload={"lps": [1, 2, 3]}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert a.payload["lps"] == [1, 2, 3]
    w = routes.put_blob(
        "worklog",
        OfficeBlobPut(payload={"entries": [{"userId": "arch-1", "date": "2026-08-23"}]}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert w.payload["entries"][0]["date"] == "2026-08-23"


def test_kalender_kind_ok(db_session):
    out = routes.put_blob(
        "kalender",
        OfficeBlobPut(
            payload={"bundesland": "NI", "entries": [{"id": "c1", "userId": "arch-1", "date": "2026-08-23"}]},
            updated_at=T0,
        ),
        current_user=_user(),
        db=db_session,
    )
    assert out.payload["bundesland"] == "NI"
    assert out.payload["entries"][0]["id"] == "c1"


def test_scope_kind_ok(db_session):
    out = routes.put_blob(
        "scope",
        OfficeBlobPut(payload={"lines": [{"id": "sv-1", "kind": "vertrag", "text": "LP 1-4"}]}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert out.payload["lines"][0]["text"] == "LP 1-4"


def test_impressum_kind_ok(db_session):
    out = routes.put_blob(
        "impressum",
        OfficeBlobPut(payload={"firma": "Beispiel GmbH", "email": "a@b.de"}, updated_at=T0),
        current_user=_user(),
        db=db_session,
    )
    assert out.payload["firma"] == "Beispiel GmbH"


def test_unknown_kind_404(db_session):
    with pytest.raises(HTTPException) as e:
        routes.get_blob("secret", current_user=_user(), db=db_session)
    assert e.value.status_code == 404


def test_router_imported_and_mounted_in_main():
    """§208 — sans l'import, gunicorn meurt (NameError) et le healthcheck tombe."""
    source = (BACKEND.parent / "backend" / "app" / "main.py").read_text(encoding="utf-8")
    assert "office_blob_sync_routes," in source
    assert "office_blob_sync_routes.router" in source


def test_tenant_isolation(db_session):
    routes.put_blob(
        "stunden",
        OfficeBlobPut(payload={"eintraege": [1]}, updated_at=T0),
        current_user=_user(tenant="tenant-A"),
        db=db_session,
    )
    other = routes.get_blob("stunden", current_user=_user(uid="b", tenant="tenant-B"), db=db_session)
    assert other.empty is True
