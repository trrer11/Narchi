# -*- coding: utf-8 -*-
"""
§59 — Archivage doux des canaux projet orphelins : réconciliation + liste.

Constat réel (capture 2026-08-07) : 6 canaux « meuble final.ifc » identiques
dans la messagerie — chaque import IFC régénère un identifiant projet côté
frontend, et chacun laissait son canal visible à jamais. Le correctif doit
prouver : masquage SANS suppression, résurrection possible, repli jamais
destructeur, multi-tenant verrouillé, chaîne alembic 20260808_05.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.database import Base  # noqa: E402
from app.models.chat import ChatChannel, ChatChannelMember, ChatChannelTombstone, ChatMessage  # noqa: E402
from app.models.project import Project  # noqa: F401,E402  (tables référencées)
from app.models.user import User  # noqa: F401,E402

MIGRATION_PATH = BACKEND / "alembic" / "versions" / "20260808_05_chat_channel_archive.py"


def _load_chat_routes():
    """Chat_routes chargé directement (redis présent ; on évite le paquet
    app.api qui tire la chaîne lourde ifcopenshell & co)."""
    path = BACKEND / "app" / "api" / "chat_routes.py"
    spec = importlib.util.spec_from_file_location("chat_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Tables nécessaires UNIQUEMENT : d'autres modèles du metadata utilisent
    # des types PostgreSQL (JSONB) que SQLite ne sait pas compiler ici.
    tables = [
        User.__table__, Project.__table__,
        ChatChannel.__table__, ChatChannelMember.__table__, ChatMessage.__table__,
        ChatChannelTombstone.__table__,  # §110 — ensure la consulte (saut des supprimés)
    ]
    Base.metadata.create_all(bind=engine, tables=tables)
    session = sessionmaker(bind=engine)()
    session.info["tenant_id"] = "tenant-A"
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)


def _owner():
    return SimpleNamespace(id="owner-1", tenant_id="tenant-A", email="o@narchi.de", name="Owner")


def _seed_channel(db, *, tenant="tenant-A", cid, kind, name, project_id=None, members=("owner-1",)):
    channel = ChatChannel(id=cid, tenant_id=tenant, kind=kind, name=name, project_id=project_id)
    channel.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db.add(channel)
    db.flush()
    for uid in members:
        db.add(ChatChannelMember(channel_id=cid, user_id=uid, tenant_id=tenant))
    db.commit()
    return channel


def _visible_ids(db, user=None):
    routes = _load_chat_routes()
    rows = routes.list_channels(Response(), cursor=None, limit=50, current_user=user or _owner(), db=db)
    return [row.id for row in rows]


class TestReconcileArchives:
    """Le VRAI mécanisme du bug utilisateur : ensure avec catalogue explicite."""

    def test_orphan_channel_archived_not_deleted(self, db_session):
        routes = _load_chat_routes()
        old = _seed_channel(db_session, cid="ch-project-old", kind="project", name="meuble final.ifc", project_id="old")
        msg = ChatMessage(
            id="m-1", tenant_id="tenant-A", channel_id="ch-project-old",
            author_id="owner-1", author_name="Owner", text="message précieux",
        )
        db_session.add(msg)
        from app.schemas.chat import EnsureChannelsRequest
        req = EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "new", "name": "meuble final.ifc"}])
        result = routes.ensure_channels(req, current_user=_owner(), db=db_session)

        # Le nouveau canal existe, l'ancien est MASQUÉ de la liste retournée.
        assert "ch-project-new" in [row.id for row in result]
        assert "ch-project-old" not in [row.id for row in result]

        # …mais rien n'est détruit : ligne + message intacts en base.
        db_session.expire_all()
        old = db_session.get(ChatChannel, "ch-project-old")
        assert old.archived_at is not None
        assert db_session.query(ChatMessage).filter_by(channel_id="ch-project-old").count() == 1

    def test_channel_resurrects_when_project_returns(self, db_session):
        routes = _load_chat_routes()
        from app.schemas.chat import EnsureChannelsRequest
        _seed_channel(db_session, cid="ch-project-old", kind="project", name="meuble final.ifc", project_id="old")
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "new", "name": "meuble final.ifc"}]),
            current_user=_owner(), db=db_session,
        )
        assert db_session.get(ChatChannel, "ch-project-old").archived_at is not None

        # Le projet « old » réapparaît dans le catalogue : le canal revient.
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "old", "name": "meuble final.ifc"}]),
            current_user=_owner(), db=db_session,
        )
        db_session.expire_all()
        assert db_session.get(ChatChannel, "ch-project-old").archived_at is None
        assert db_session.get(ChatChannel, "ch-project-new").archived_at is not None

    def test_team_and_direct_channels_never_archived(self, db_session):
        routes = _load_chat_routes()
        from app.schemas.chat import EnsureChannelsRequest
        _seed_channel(db_session, cid="ch-team-x", kind="team", name="Équipe")
        _seed_channel(db_session, cid="ch-direct-y", kind="direct", name="DM")
        _seed_channel(db_session, cid="ch-project-old", kind="project", name="P", project_id="old")
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "new", "name": "P"}]),
            current_user=_owner(), db=db_session,
        )
        db_session.expire_all()
        assert db_session.get(ChatChannel, "ch-team-x").archived_at is None
        assert db_session.get(ChatChannel, "ch-direct-y").archived_at is None
        assert db_session.get(ChatChannel, "ch-project-old").archived_at is not None

    def test_fallback_path_reconciles_nothing(self, db_session):
        """Catalogue vide = période de chargement ou repli : JAMAIS d'archivage."""
        routes = _load_chat_routes()
        from app.schemas.chat import EnsureChannelsRequest
        _seed_channel(db_session, cid="ch-project-old", kind="project", name="P", project_id="old")
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[]),
            current_user=_owner(), db=db_session,
        )
        db_session.expire_all()
        assert db_session.get(ChatChannel, "ch-project-old").archived_at is None

    def test_tenant_isolation_write_asserted(self, db_session):
        routes = _load_chat_routes()
        from sqlalchemy import select
        from app.schemas.chat import EnsureChannelsRequest
        _seed_channel(db_session, tenant="tenant-B", cid="ch-project-b", kind="project", name="P-B", project_id="old", members=())
        routes.ensure_channels(
            EnsureChannelsRequest(users=["owner-1"], projects=[{"id": "new", "name": "P"}]),
            current_user=_owner(), db=db_session,
        )
        # 1) Depuis une session tenant-A, le canal tenant-B est même INVISIBLE
        #    en lecture (intercepteur global with_loader_criteria).
        assert db_session.get(ChatChannel, "ch-project-b") is None
        # 2) Vue « super » (bypass documenté du même intercepteur) : la ligne
        #    EXISTE toujours et la réconciliation n'a rien modifié chez lui.
        row = db_session.execute(
            select(ChatChannel).where(ChatChannel.id == "ch-project-b"),
            execution_options={"skip_tenant_filter": True},
        ).scalar_one()
        assert row.tenant_id == "tenant-B"
        assert row.archived_at is None

    def test_list_channels_hides_only_archived(self, db_session):
        _seed_channel(db_session, cid="ch-a", kind="project", name="Vivant", project_id="a")
        _seed_channel(db_session, cid="ch-b", kind="project", name="Morte", project_id="b")
        dead = db_session.get(ChatChannel, "ch-b")
        dead.archived_at = datetime(2026, 2, 2, tzinfo=timezone.utc)
        db_session.commit()
        ids = _visible_ids(db_session)
        assert "ch-a" in ids
        assert "ch-b" not in ids


class TestMigration05:
    """Chaîne alembic : 20260808_05 suit 20260808_04, garde SQLite no-op."""

    @staticmethod
    def _load_migration():
        spec = importlib.util.spec_from_file_location("migration_20260808_05", MIGRATION_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    class _FakeDialect:
        def __init__(self, name):
            self.name = name

    class _FakeBind:
        def __init__(self, dialect_name):
            self.dialect = TestMigration05._FakeDialect(dialect_name)

    class _FakeOp:
        def __init__(self, dialect_name):
            self._bind = TestMigration05._FakeBind(dialect_name)
            self.calls: list[tuple] = []

        def get_bind(self):
            return self._bind

        def add_column(self, table, column):
            self.calls.append(("add_column", table, str(column.name)))

        def create_index(self, name, table, columns):
            self.calls.append(("create_index", name, table, list(columns)))

        def drop_index(self, name, table_name=None):
            self.calls.append(("drop_index", name, table_name))

        def drop_column(self, table, name):
            self.calls.append(("drop_column", table, name))

    def test_revision_links_to_previous_live_head(self):
        migration = self._load_migration()
        assert migration.revision == "20260808_05"
        assert migration.down_revision == "20260808_04"

    def test_upgrade_adds_column_and_index_on_postgresql(self):
        migration = self._load_migration()
        fake_op = self._FakeOp("postgresql")
        real_op = migration.op
        migration.op = fake_op
        try:
            migration.upgrade()
        finally:
            migration.op = real_op
        assert ("add_column", "chat_channels", "archived_at") in fake_op.calls
        assert any(c[0] == "create_index" and "archived_at" in c[3] for c in fake_op.calls)

    def test_upgrade_and_downgrade_are_noops_outside_postgresql(self):
        migration = self._load_migration()
        for dialect in ("sqlite", "mysql"):
            fake_op = self._FakeOp(dialect)
            real_op = migration.op
            migration.op = fake_op
            try:
                migration.upgrade()
                migration.downgrade()
            finally:
                migration.op = real_op
            assert fake_op.calls == []


# ------------------------- §82 — avatar contenu dans /users ------------------


def test_chat_users_transporte_le_contenu_avatar(db_session):
    """Un collègue qui pose une photo/emoji doit la transporter dans /users :
    c'est la voie de propagation §83 utilisée par tous les rôles (chat)."""
    routes = _load_chat_routes()
    import json as j
    alice = User(id="u-a", email="a@büro.de", hashed_password="x", name="Anna A",
                 role="architect", tenant_id="tenant-A", is_active=True,
                 avatar_key="a@büro.de",
                 avatar_json=j.dumps({"kind": "emoji", "emoji": "🦉"}))
    ben = User(id="u-b", email="b@büro.de", hashed_password="x", name="Ben B",
               role="architect", tenant_id="tenant-A", is_active=True)
    etranger = User(id="u-c", email="c@fremd.de", hashed_password="x", name="Fremd",
                    role="owner", tenant_id="tenant-B", is_active=True,
                    avatar_key="c@fremd.de",
                    avatar_json=j.dumps({"kind": "photo",
                                         "photo": "data:image/jpeg;base64,AAAA"}))
    db_session.add_all([alice, ben, etranger])
    db_session.commit()

    out = routes.list_team_users(current_user=_owner(), db=db_session)
    by_id = {u.id: u for u in out}
    assert set(by_id) == {"u-a", "u-b"}      # cloisonné : jamais l'étranger
    assert by_id["u-a"].avatar_key == "a@büro.de"
    assert j.loads(by_id["u-a"].avatar_json) == {"kind": "emoji", "emoji": "🦉"}
    assert by_id["u-b"].avatar_json is None
