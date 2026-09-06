# -*- coding: utf-8 -*-
"""§163 — Synchro des VE-Varianten. Éprouvé : upsert idempotent, LWW avec
verdict, tombstone qui voyage, résurrection (leçon §117), cloisonnement
tenant, validation de FORME du payload."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import ve_variant_sync_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.user import User  # noqa: F401,E402
from app.models.ve_variant_mirror import VEVariantMirror  # noqa: E402
from app.schemas.ve_variant_sync import (  # noqa: E402
    VEVariantSyncBatchRequest,
    VEVariantSyncItem,
)

UTC = timezone.utc
T0 = datetime(2026, 8, 17, 10, 0, 0, tzinfo=UTC)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [User.__table__, VEVariantMirror.__table__]
    Base.metadata.create_all(bind=engine, tables=tables)
    session = sessionmaker(bind=engine)()
    session.info["tenant_id"] = "tenant-A"
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)


def _user(uid="arch-1", tenant="tenant-A"):
    return SimpleNamespace(id=uid, tenant_id=tenant, email=f"{uid}@narchi.de",
                           name=uid, role="architect")


def _item(vid="ve-A1", nom="Holzbau", maj=T0, **kw):
    params = dict(
        id=vid, name=nom,
        payload={
            "projectName": "EFH Hannover",
            "selectedKeys": ["stahlbeton_c25_30->clt"],
            "totalCo2SavedKg": 1800.0,
            "totalEurDelta": 12000.0,
            "count": 1,
        },
        updated_at=maj,
    )
    params.update(kw)
    return VEVariantSyncItem(**params)


def _pousse(db, *items, utilisateur=None):
    return routes.push_batch(
        VEVariantSyncBatchRequest(items=list(items)),
        current_user=utilisateur or _user(), db=db,
    )


class TestCycleDeVie:
    def test_creation_relai_complet(self, db_session):
        out = _pousse(db_session, _item())
        assert out.results[0].applied is True
        liste = routes.list_variants(since=None, limit=500,
                                     current_user=_user(), db=db_session)
        v = {x.id: x for x in liste.variants}["ve-A1"]
        assert v.name == "Holzbau"
        assert v.payload["selectedKeys"] == ["stahlbeton_c25_30->clt"]

    def test_upsert_idempotent_et_lww(self, db_session):
        _pousse(db_session, _item())
        # Même id, plus ancien → refusé (LWW).
        out = _pousse(db_session, _item(maj=T0 - __import__("datetime").timedelta(seconds=5)))
        assert out.results[0].applied is False
        # Même id, plus récent → appliqué (mise à jour).
        t1 = T0 + __import__("datetime").timedelta(seconds=5)
        out = _pousse(db_session, _item(nom="Holzbau v2", maj=t1))
        assert out.results[0].applied is True
        liste = routes.list_variants(since=None, limit=500,
                                     current_user=_user(), db=db_session)
        assert {x.id: x for x in liste.variants}["ve-A1"].name == "Holzbau v2"

    def test_tombstone_voyage_et_resurrection(self, db_session):
        _pousse(db_session, _item())
        routes.delete_variant("ve-A1", current_user=_user(), db=db_session)
        liste = routes.list_variants(since=None, limit=500,
                                     current_user=_user(), db=db_session)
        v = {x.id: x for x in liste.variants}["ve-A1"]
        assert v.deleted_at is not None
        # Un upsert plus récent ressuscite la pierre tombale (leçon §117).
        # La pierre tombale porte now() du serveur → il faut un horodatage
        # STRICTEMENT postérieur.
        t1 = datetime.now(timezone.utc) + __import__("datetime").timedelta(seconds=1)
        out = _pousse(db_session, _item(nom="Holzbau v3", maj=t1))
        assert out.results[0].applied is True
        liste = routes.list_variants(since=None, limit=500,
                                     current_user=_user(), db=db_session)
        v = {x.id: x for x in liste.variants}["ve-A1"]
        assert v.deleted_at is None
        assert v.name == "Holzbau v3"

    def test_cloisonnement_tenant(self, db_session):
        _pousse(db_session, _item(), utilisateur=_user(tenant="tenant-A"))
        # Un autre tenant ne voit RIEN.
        liste = routes.list_variants(since=None, limit=500,
                                     current_user=_user(uid="arch-2", tenant="tenant-B"),
                                     db=db_session)
        assert liste.variants == []

    def test_404_hors_tenant(self, db_session):
        _pousse(db_session, _item())
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as e:
            routes.get_variant("ve-A1", current_user=_user(tenant="tenant-B"), db=db_session)
        assert e.value.status_code == 404


class TestValidationForme:
    def test_payload_liste_textes_courts(self):
        # selectedKeys = liste de textes courts → OK.
        _item(payload={"selectedKeys": ["a->b", "c->d"]})

    def test_payload_texte_demesure_refuse(self):
        with pytest.raises(ValidationError):
            VEVariantSyncItem(id="v", name="x", payload={"trop": "z" * 3000}, updated_at=T0)

    def test_payload_liste_non_texte_refusee(self):
        with pytest.raises(ValidationError):
            VEVariantSyncItem(id="v", name="x", payload={"keys": [1, 2]}, updated_at=T0)
