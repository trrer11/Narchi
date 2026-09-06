# -*- coding: utf-8 -*-
"""§118 — Synchro des Projets (plainte client : « invisible sur l'autre
compte »). Éprouvé pour de vrai : upsert idempotent, LWW avec verdict,
tombstone qui voyage, résurrection (leçon §117 apprise d'office),
cloisonnement tenant, validation de FORME du payload (jamais de contenu
opaque valide en base partagée)."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import project_sync_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.project_mirror import ProjectMirror  # noqa: E402
from app.models.user import User  # noqa: F401,E402
from app.schemas.project_sync import (  # noqa: E402
    ProjectSyncBatchRequest,
    ProjectSyncItem,
)

UTC = timezone.utc
T0 = datetime(2026, 8, 12, 10, 0, 0, tzinfo=UTC)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [User.__table__, ProjectMirror.__table__]
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


def _item(pid="prj-A1", nom="Anbau Familie Meyer", maj=T0, **kw):
    params = dict(
        id=pid, name=nom,
        payload={"code": "P-01", "client": "Familie Meyer", "startDate": "2026-08-01",
                 "status": "active", "budget": 240000},
        updated_at=maj,
    )
    params.update(kw)
    return ProjectSyncItem(**params)


def _pousse(db, *items, utilisateur=None):
    return routes.push_batch(
        ProjectSyncBatchRequest(items=list(items)),
        current_user=utilisateur or _user(), db=db,
    )


class TestCycleDeVie:
    def test_creation_relai_complet(self, db_session):
        out = _pousse(db_session, _item())
        assert out.results[0].applied is True
        liste = routes.list_projects(since=None, limit=500,
                                     current_user=_user(), db=db_session)
        p = {x.id: x for x in liste.projects}["prj-A1"]
        assert p.name == "Anbau Familie Meyer"
        assert p.payload["client"] == "Familie Meyer"  # fiche complète relayée
        assert p.payload["startDate"] == "2026-08-01"
        assert p.deleted_at is None

    def test_upsert_idempotent_meme_horodatage(self, db_session):
        _pousse(db_session, _item())
        out = _pousse(db_session, _item(nom="renommage simultané (même heure)"))
        assert out.results[0].applied is False
        p = routes.get_project("prj-A1", current_user=_user(), db=db_session)
        assert p.name == "Anbau Familie Meyer"

    def test_lww_recent_gagne_ancien_decline_avec_gagnant_dit(self, db_session):
        _pousse(db_session, _item(nom="nouveau", maj=T0 + timedelta(hours=3)))
        out = _pousse(db_session, _item(nom="ancien", maj=T0))
        assert out.results[0].applied is False
        assert out.results[0].server_updated_at == T0 + timedelta(hours=3)
        p = routes.get_project("prj-A1", current_user=_user(), db=db_session)
        assert p.name == "nouveau"

    def test_tombstone_voyage_dans_le_delta_et_retrait_idempotent(self, db_session):
        _pousse(db_session, _item())
        tombe = routes.delete_project("prj-A1", current_user=_user(), db=db_session)
        assert tombe.deleted_at is not None
        delta = routes.list_projects(since=T0, limit=500,
                                     current_user=_user(), db=db_session)
        assert {x.id: x.deleted_at is not None for x in delta.projects}["prj-A1"] is True
        encore = routes.delete_project("prj-A1", current_user=_user(), db=db_session)
        assert encore.deleted_at == tombe.deleted_at  # date figée, jamais de voile

    def test_resurrection_upsert_plus_recent_que_la_tombe(self, db_session):
        # Leçon §117 apprise d'office : l'écriture la plus récente fait
        # revivre la ligne (le moteur §117 compte dessus pour les projets).
        _pousse(db_session, _item())
        routes.delete_project("prj-A1", current_user=_user(), db=db_session)
        out = _pousse(db_session, _item(nom="recréé sur téléphone",
                                        # FUTUR (pas T0+2j) : la tombe est écrite à now(),
                                        # la résurrection doit être STRICTEMENT plus récente.
                                        maj=datetime.now(UTC) + timedelta(days=1)))
        assert out.results[0].applied is True
        p = routes.get_project("prj-A1", current_user=_user(), db=db_session)
        assert p.deleted_at is None and p.name == "recréé sur téléphone"


class TestCloisonnement:
    def test_lecture_hors_tenant_404_et_id_independant(self, db_session):
        _pousse(db_session, _item())
        espion = _user(uid="arch-9", tenant="tenant-B")
        with pytest.raises(HTTPException) as exc:
            routes.get_project("prj-A1", current_user=espion, db=db_session)
        assert exc.value.status_code == 404
        # Même id chez l'autre bureau = SA propre ligne, jamais d'écrasement.
        _pousse(db_session, _item(nom="Projet du bureau B"), utilisateur=espion)
        _pousse(db_session, _item(), utilisateur=_user())  # remettre la session sur A…
        delta_a = routes.list_projects(since=None, limit=500,
                                       current_user=_user(), db=db_session)
        assert {x.id: x.name for x in delta_a.projects}["prj-A1"] == "Anbau Familie Meyer"


class TestDeltaEtValidation:
    def test_since_strict_et_truncated_dit(self, db_session):
        _pousse(db_session, _item(pid="p1", maj=T0))
        _pousse(db_session, _item(pid="p2", maj=T0 + timedelta(hours=1)))
        delta = routes.list_projects(since=T0, limit=500,
                                     current_user=_user(), db=db_session)
        assert [x.id for x in delta.projects] == ["p2"]
        assert delta.truncated is False
        page = routes.list_projects(since=None, limit=1,
                                    current_user=_user(), db=db_session)
        assert page.truncated is True and len(page.projects) == 1

    def test_nom_vide_refuse(self):
        with pytest.raises(ValidationError):
            _item(nom="")

    def test_payload_forme_controlee(self):
        with pytest.raises(ValidationError):
            _item(payload={"note": "x" * 3000})          # texte démesuré
        with pytest.raises(ValidationError):
            _item(payload={"team": ["ok", {"nid": 1}]})  # liste de non-textes
        with pytest.raises(ValidationError):
            _item(payload={"obj": {"nested": True}})     # objet imbrique = non relais

    def test_batch_vide_refuse(self):
        with pytest.raises(ValidationError):
            ProjectSyncBatchRequest(items=[])
