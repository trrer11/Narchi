# -*- coding: utf-8 -*-
"""
§108 — Gestion des conversations (owner/admin uniquement) : renommage et
suppression, avec les limites HONNÊTES du modèle (nom DM = identité du
contact, figée).

§110 — demande client : « owner et admin doivent pouvoir supprimer UNE
DISCUSSION » — toutes, pas seulement les messages directs. Les canaux
équipe/projet sont auto-assurés (id déterministe → ensure les recrée) :
la suppression pose donc une PIERRE TOMBALE, sans laquelle le canal
renaîtrait à la prochaine synchro — jamais de « supprimé » qui revient.
"""
from __future__ import annotations

import hashlib
import os
import sys
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

from app.api import chat_routes as routes  # noqa: E402
from app.database import Base  # noqa: E402
from app.models.chat import (  # noqa: E402
    ChatChannel,
    ChatChannelMember,
    ChatChannelTombstone,
    ChatMessage,
)
from app.models.project import Project  # noqa: F401,E402 (tables référencées)
from app.models.user import User  # noqa: F401,E402
from app.schemas.chat import EnsureChannelsRequest, RenameChannelRequest  # noqa: E402


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [
        User.__table__, Project.__table__,
        ChatChannel.__table__, ChatChannelMember.__table__, ChatMessage.__table__,
        ChatChannelTombstone.__table__,
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    session = sessionmaker(bind=engine)()
    session.info["tenant_id"] = "tenant-A"
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)


def _user(uid="owner-1", tenant="tenant-A", role="owner"):
    return SimpleNamespace(id=uid, tenant_id=tenant, email=f"{uid}@narchi.de",
                           name=uid, role=role)


def _seed(db, *, cid, kind, name, tenant="tenant-A", members=("owner-1",)):
    ch = ChatChannel(id=cid, tenant_id=tenant, kind=kind, name=name)
    db.add(ch)
    db.flush()
    for uid in members:
        db.add(ChatChannelMember(channel_id=cid, user_id=uid, tenant_id=tenant))
    db.commit()
    return ch


class TestRenameChannel:
    def test_owner_renames_project_channel_durably(self, db_session):
        _seed(db_session, cid="ch-project-p1", kind="project", name="Altbau")
        out = routes.rename_channel(
            "ch-project-p1", RenameChannelRequest(name="  Altbau EG — Bestand  "),
            current_user=_user(), db=db_session,
        )
        assert out.name == "Altbau EG — Bestand"
        # Durable : un ensure ultérieur n'écrase pas le nom choisi.
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "p1", "name": "Altbau"}]),
            current_user=_user(), db=db_session,
        )
        row = db_session.get(ChatChannel, "ch-project-p1")
        assert row.name == "Altbau EG — Bestand"

    def test_admin_allowed_architect_refused(self, db_session):
        _seed(db_session, cid="ch-team-x", kind="team", name="Équipe")
        out = routes.rename_channel(
            "ch-team-x", RenameChannelRequest(name="Büro-Team"),
            current_user=_user(role="admin"), db=db_session,
        )
        assert out.name == "Büro-Team"
        with pytest.raises(HTTPException) as err:
            routes.rename_channel(
                "ch-team-x", RenameChannelRequest(name="Hack"),
                current_user=_user(uid="arch-1", role="architect"), db=db_session,
            )
        assert err.value.status_code == 403
        # guest pareil — jamais de dérogation silencieuse.
        with pytest.raises(HTTPException) as err2:
            routes.rename_channel(
                "ch-team-x", RenameChannelRequest(name="Hack"),
                current_user=_user(uid="g-1", role="guest"), db=db_session,
            )
        assert err2.value.status_code == 403

    def test_direct_rename_refused_and_other_tenant_404(self, db_session):
        _seed(db_session, cid="ch-dm-1", kind="direct", name="Fatou")
        with pytest.raises(HTTPException) as err:
            routes.rename_channel(
                "ch-dm-1", RenameChannelRequest(name="Chef"),
                current_user=_user(), db=db_session,
            )
        assert err.value.status_code == 400
        with pytest.raises(HTTPException) as err2:
            routes.rename_channel(
                "ch-dm-1", RenameChannelRequest(name="X"),
                current_user=_user(tenant="tenant-B"), db=db_session,
            )
        assert err2.value.status_code == 404
        # Nom tout blanc → 422 (le strip est vérifié en route, pas au schéma).
        _seed(db_session, cid="ch-team-ws", kind="team", name="Équipe")
        with pytest.raises(HTTPException) as err3:
            routes.rename_channel(
                "ch-team-ws", RenameChannelRequest(name="   "),
                current_user=_user(), db=db_session,
            )
        assert err3.value.status_code == 422


class TestDeleteChannel:
    def test_owner_deletes_direct_channel_cascade_messages(self, db_session):
        ch = _seed(db_session, cid="ch-dm-1", kind="direct", name="Fatou")
        db_session.add(ChatMessage(
            id="m-1", channel_id=ch.id, tenant_id="tenant-A",
            author_id="owner-1", author_name="Owner", text="vertraulich",
        ))
        db_session.commit()
        out = routes.delete_channel("ch-dm-1", current_user=_user(), db=db_session)
        assert out == {"ok": True, "id": "ch-dm-1", "deletedMessages": 1}
        assert db_session.get(ChatChannel, "ch-dm-1") is None
        assert db_session.query(ChatChannelMember).filter_by(channel_id="ch-dm-1").count() == 0
        assert db_session.query(ChatMessage).filter_by(channel_id="ch-dm-1").count() == 0

    def test_owner_deletes_project_channel_forever_tombstone_no_respawn(self, db_session):
        """§110 — le cœur de la demande : supprimer un canal PROJET, et
        qu'il ne renaisse JAMAIS d'une synchro (sinon = théâtre)."""
        ch = _seed(db_session, cid="ch-project-p1", kind="project", name="Altbau")
        db_session.add(ChatMessage(
            id="m-1", channel_id=ch.id, tenant_id="tenant-A",
            author_id="owner-1", author_name="Owner", text="Abnahme Freitag?",
        ))
        db_session.commit()
        out = routes.delete_channel("ch-project-p1", current_user=_user(), db=db_session)
        assert out == {"ok": True, "id": "ch-project-p1", "deletedMessages": 1}
        assert db_session.get(ChatChannel, "ch-project-p1") is None
        # La pierre tombale est posée, traçable (qui a supprimé).
        stone = db_session.get(ChatChannelTombstone, "ch-project-p1")
        assert stone is not None and stone.deleted_by == "owner-1"
        # SYNCHRO ultérieure avec le projet toujours au catalogue : le
        # canal ne revient PAS (avant §110 il renaissait, fraude ressentie).
        remaining = routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "p1", "name": "Altbau"}]),
            current_user=_user(), db=db_session,
        )
        assert db_session.get(ChatChannel, "ch-project-p1") is None
        assert all(c.id != "ch-project-p1" for c in remaining)

    def test_owner_deletes_team_channel_forever_no_respawn(self, db_session):
        """Le canal ÉQUIPE a un id déterministe « ch-team-<digest> » : on
        épingle la non-résurrection sur l'id EXACT que ensure recréerait."""
        team_id = f"ch-team-{hashlib.sha256('tenant-A'.encode()).hexdigest()[:16]}"
        _seed(db_session, cid=team_id, kind="team", name="Équipe")
        out = routes.delete_channel(team_id, current_user=_user(role="admin", uid="adm-1"), db=db_session)
        assert out["ok"] is True
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[]),
            current_user=_user(), db=db_session,
        )
        assert db_session.get(ChatChannel, team_id) is None

    def test_direct_delete_leaves_no_tombstone(self, db_session):
        """Une DM n'est jamais auto-assurée : pas besoin de pierre tombale —
        son absence épingle que le mécanisme reste cantonné aux auto-gérés."""
        _seed(db_session, cid="ch-dm-1", kind="direct", name="Fatou")
        routes.delete_channel("ch-dm-1", current_user=_user(), db=db_session)
        assert db_session.query(ChatChannelTombstone).count() == 0

    def test_delete_requires_manager_role_and_own_tenant(self, db_session):
        _seed(db_session, cid="ch-dm-1", kind="direct", name="Fatou")
        with pytest.raises(HTTPException) as err:
            routes.delete_channel(
                "ch-dm-1", current_user=_user(uid="arch-1", role="architect"), db=db_session,
            )
        assert err.value.status_code == 403
        with pytest.raises(HTTPException) as err2:
            routes.delete_channel(
                "ch-dm-1", current_user=_user(tenant="tenant-B"), db=db_session,
            )
        assert err2.value.status_code == 404
        # admin : autorisé, exactement comme owner (demande client).
        out = routes.delete_channel(
            "ch-dm-1", current_user=_user(uid="adm-1", role="admin"), db=db_session,
        )
        assert out["ok"] is True
