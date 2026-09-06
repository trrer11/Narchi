# -*- coding: utf-8 -*-
"""§115 — API Mängel serveur (synchro inter-appareils, étape 1).

Ce qui est éprouvé ici, pour de vrai :
  - cloisonnement tenant (lecture 404 hors bureau — la garde §80 tient) ;
  - upsert idempotent par id client + dernière-écriture-gagne (horodatage
    appareil), avec verdict EXPLICITE applied/server_updated_at ;
  - delta ?since= avec tombstones INCLUSES (sinon un appareil garderait
    un Mangel supprimé ailleurs — c'est exactement la panne que la
    pierre tombale empêche) ;
  - validation stricte (jour ISO, gravité/status contrôlés, float-free) ;
  - limite plafonnée, truncated dit honnêtement ;
  - created_by tracé, logs absents de toute donnée sensible inutile.
"""
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

from app.api import issue_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.baustelle_issue import BaustelleIssue  # noqa: E402
from app.models.project import Project  # noqa: F401,E402 (tables référencées)
from app.models.user import User  # noqa: F401,E402
from app.schemas.baustelle_issue import (  # noqa: E402
    IssueBatchRequest,
    IssueSyncItem,
)

UTC = timezone.utc
T0 = datetime(2026, 8, 12, 10, 0, 0, tzinfo=UTC)


def _aware(dt: datetime) -> datetime:
    # SQLite rend des datetime NAÏVES même pour DateTime(timezone=True) ;
    # PostgreSQL rend des conscientes. Normalisé ici — le 1er jet comparait
    # naïf vs conscient (TypeError), attrapé par le test lui-même.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [User.__table__, Project.__table__, BaustelleIssue.__table__]
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


def _item(iid="m-1", project="prj-A1", titre="Riss Treppenlauf", maj=T0, **kw):
    params = dict(
        id=iid, project_id=project, day="2026-08-10", title=titre,
        description="", zone="Treppenhaus", severity="major", status="open",
        photo_ids=["ph-1", "ph-2"], video_ids=["vid-1"], updated_at=maj,
    )
    params.update(kw)
    return IssueSyncItem(**params)


class TestPushBatch:
    def test_creation_complete_et_tracee(self, db_session):
        out = routes.push_batch(
            IssueBatchRequest(items=[_item()]),
            current_user=_user("arch-7"), db=db_session,
        )
        assert out.results[0].applied is True
        assert out.results[0].server_updated_at == T0
        row = db_session.query(BaustelleIssue).filter_by(id="m-1").one()
        assert row.tenant_id == "tenant-A"
        assert row.created_by == "arch-7"          # qui a créé = tracé
        assert row.photo_ids == ["ph-1", "ph-2"]   # ids seulement (étape 3 = blobs)
        assert row.video_ids == ["vid-1"]

    def test_upsert_idempotent_meme_horodatage(self, db_session):
        req = IssueBatchRequest(items=[_item(titre="premier jet")])
        routes.push_batch(req, current_user=_user(), db=db_session)
        out = routes.push_batch(
            IssueBatchRequest(items=[_item(titre="doublon renvoyé")]),
            current_user=_user(), db=db_session,
        )
        # Même updated_at → décliné franchement, pas de dérive silencieuse.
        assert out.results[0].applied is False
        rows = db_session.query(BaustelleIssue).filter_by(id="m-1").all()
        assert len(rows) == 1 and rows[0].title == "premier jet"

    def test_derniere_ecriture_gagne_plus_recent_puis_plus_ancien(self, db_session):
        récent = _item(titre="corrigé", maj=T0 + timedelta(hours=2))
        assert routes.push_batch(
            IssueBatchRequest(items=[récent]), current_user=_user(), db=db_session
        ).results[0].applied is True
        vieux = _item(titre="obsolète", maj=T0)  # horodatage plus ancien
        out = routes.push_batch(
            IssueBatchRequest(items=[vieux]), current_user=_user(), db=db_session
        )
        assert out.results[0].applied is False
        assert out.results[0].server_updated_at == T0 + timedelta(hours=2)
        row = db_session.query(BaustelleIssue).filter_by(id="m-1").one()
        assert row.title == "corrigé"

    def test_isolation_tenant_lecture_et_upsert(self, db_session):
        routes.push_batch(
            IssueBatchRequest(items=[_item()]), current_user=_user(), db=db_session
        )
        espion = _user(uid="autre", tenant="tenant-B")
        # GET direct hors tenant → 404 (pas une fuite, pas un résidu).
        with pytest.raises(HTTPException) as exc:
            routes.get_issue("m-1", current_user=espion, db=db_session)
        assert exc.value.status_code == 404
        # …et un « upsert » du même id par l'autre bureau CRÉE sa propre
        # ligne au lieu d'écraser la nôtre — jamais d'écriture croisée.
        routes.push_batch(
            IssueBatchRequest(items=[_item(titre="copie B")]),
            current_user=espion, db=db_session,
        )
        # Le handler a ré-ancré la session sur « tenant-B » (comme le
        # middleware en prod) : la requête CRUE ci-dessous doit d'abord se
        # ré-ancrer sur tenant-A — c'est exactement le comportement de
        # chaque requête en production (contexte posé par requête).
        db_session.info["tenant_id"] = "tenant-A"
        a = db_session.query(BaustelleIssue).filter_by(id="m-1", tenant_id="tenant-A").one()
        assert a.title == "Riss Treppenlauf"
        delta_b = routes.list_issues(since=None, project_id=None, limit=500,
                                     current_user=espion, db=db_session)
        assert [i.title for i in delta_b.issues] == ["copie B"]


class TestListDelta:
    def _seed(self, db):
        for k in range(3):
            routes.push_batch(
                IssueBatchRequest(items=[_item(iid=f"m-{k}", maj=T0 + timedelta(minutes=k))]),
                current_user=_user(), db=db,
            )

    def test_liste_complete_sans_since(self, db_session):
        self._seed(db_session)
        out = routes.list_issues(since=None, project_id=None, limit=500,
                                 current_user=_user(), db=db_session)
        assert len(out.issues) == 3
        assert out.server_time is not None      # curseur fourni par le serveur
        assert out.truncated is False
        assert [i.id for i in out.issues] == ["m-0", "m-1", "m-2"]  # ordre stable

    def test_delta_depuis_since(self, db_session):
        self._seed(db_session)
        out = routes.list_issues(since=T0, project_id=None, limit=500,
                                 current_user=_user(), db=db_session)
        assert [i.id for i in out.issues] == ["m-1", "m-2"]  # > since strict

    def test_filtre_projet(self, db_session):
        routes.push_batch(IssueBatchRequest(items=[
            _item(iid="m-a", project="prj-A1"), _item(iid="m-b", project="prj-A2"),
        ]), current_user=_user(), db=db_session)
        out = routes.list_issues(since=None, project_id="prj-A2", limit=500,
                                 current_user=_user(), db=db_session)
        assert [i.id for i in out.issues] == ["m-b"]

    def test_limite_plafonnee_et_truncated_dit(self, db_session):
        self._seed(db_session)
        out = routes.list_issues(since=None, project_id=None, limit=2,
                                 current_user=_user(), db=db_session)
        assert len(out.issues) == 2 and out.truncated is True  # dit, jamais muet

    def test_tombstone_incluse_dans_le_delta(self, db_session):
        self._seed(db_session)
        routes.delete_issue("m-1", current_user=_user(), db=db_session)
        out = routes.list_issues(since=T0, project_id=None, limit=500,
                                 current_user=_user(), db=db_session)
        par_id = {i.id: i for i in out.issues}
        assert par_id["m-1"].deleted_at is not None   # l'autre appareil APPREND la suppression
        assert _aware(par_id["m-1"].updated_at) > T0  # tombstone = écriture fraîche du delta
        # Une seconde suppression est idempotente (date figée, pas de voile).
        routes.delete_issue("m-1", current_user=_user(), db=db_session)
        again = routes.list_issues(since=T0, project_id=None, limit=500,
                                   current_user=_user(), db=db_session)
        assert {i.id: i.deleted_at for i in again.issues}["m-1"] == par_id["m-1"].deleted_at


class TestValidation:
    def test_jour_non_iso_refuse(self):
        with pytest.raises(ValidationError):
            _item(day="10.08.2026")

    def test_gravite_et_statut_controles(self):
        with pytest.raises(ValidationError):
            _item(severity="enorme")
        with pytest.raises(ValidationError):
            _item(status="fermé")

    def test_titre_vide_refuse(self):
        with pytest.raises(ValidationError):
            _item(titre=" " * 0)

    def test_media_ids_abusifs_refuses(self):
        with pytest.raises(ValidationError):
            _item(photo_ids=["x" * 200])

    def test_batch_vide_refuse(self):
        with pytest.raises(ValidationError):
            IssueBatchRequest(items=[])

    def test_upsert_recent_ressuscite_la_tombstone(self, db_session):
        # §117 — trou réel trouvé en écrivant le moteur navigateur :
        # l'upsert appliqué ne vidait PAS deleted_at → la ligne gardait un
        # contenu frais MORT (divergence muette). Épinglé : l'écriture la
        # plus récente fait REVIVRE la ligne (LWW vrai, même contre une
        # suppression).
        routes.push_batch(IssueBatchRequest(items=[_item()]),
                          current_user=_user(), db=db_session)
        routes.delete_issue("m-1", current_user=_user(), db=db_session)
        resurrection = _item(titre="édité hors-ligne pendant la suppression",
                             # FUTUR (pas T0+2j) : la tombe est écrite à now(),
                             # la résurrection doit être STRICTEMENT plus récente.
                             maj=datetime.now(UTC) + timedelta(days=1))
        out = routes.push_batch(IssueBatchRequest(items=[resurrection]),
                                current_user=_user(), db=db_session)
        assert out.results[0].applied is True
        delta = routes.list_issues(since=None, project_id=None, limit=500,
                                   current_user=_user(), db=db_session)
        par_id = {i.id: i for i in delta.issues}
        assert par_id["m-1"].deleted_at is None        # revit, honnêtement
        assert par_id["m-1"].title == "édité hors-ligne pendant la suppression"

    def test_upsert_ancien_ne_ressuscite_pas(self, db_session):
        # Garde de la résurrection : une écriture PLUS ANCIENNE que la
        # suppression est déclinée → la tombstone reste debout, le delta
        # des autres appareils continue d'annoncer la suppression.
        routes.push_batch(IssueBatchRequest(items=[_item()]),
                          current_user=_user(), db=db_session)
        routes.delete_issue("m-1", current_user=_user(), db=db_session)
        vieux = _item(titre="fantôme du passé", maj=T0 - timedelta(days=1))
        out = routes.push_batch(IssueBatchRequest(items=[vieux]),
                                current_user=_user(), db=db_session)
        assert out.results[0].applied is False
        delta = routes.list_issues(since=None, project_id=None, limit=500,
                                   current_user=_user(), db=db_session)
        par_id = {i.id: i for i in delta.issues}
        assert par_id["m-1"].deleted_at is not None
        assert par_id["m-1"].title == "Riss Treppenlauf"  # contenu pré-suppression

    def test_statut_in_review_accepte_depuis_cockpit(self, db_session):
        # §117 — le cockpit connaît trois statuts (open / in-review /
        # resolved) ; le serveur §115 n'en acceptait que deux → tout Mangel
        # « in-review » aurait ÉCHOUÉ en silence à la synchro. Épinglé :
        # le relais est accepté et RELU tel quel au delta.
        out = routes.push_batch(
            IssueBatchRequest(items=[_item(status="in-review")]),
            current_user=_user(), db=db_session,
        )
        assert out.results[0].applied is True
        delta = routes.list_issues(since=None, project_id=None, limit=500,
                                   current_user=_user(), db=db_session)
        assert {i.id: i.status for i in delta.issues}["m-1"] == "in-review"
