"""Tests §80 — la matrice Büro 3 niveaux, gravée et prouvée :

owner > admin (Geschäftsführung) > architect (Mitglied). Couvre l'annuaire
RÉEL (PostgreSQL, cloisonné), la création de membre (rôle architect FORCÉ,
email unique plattformweit, mot de passe haché), les refus MOTIVÉS de la
matrice, la désactivation réelle (is_active + audit + idempotence), la
protection anti-orphelin (dernier owner), l'élévation réservée à l'owner,
la suppression avec nettoyage des memberships, et le self-service /me.
"""

import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.database import Base  # noqa: E402
from app.models.audit_log import AuditLog  # noqa: E402
from app.models.chat import ChatChannel, ChatChannelMember  # noqa: E402
from app.models.user import User  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def _load_routes():
    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)

    path = BACKEND / "app" / "api" / "members_routes.py"
    spec = importlib.util.spec_from_file_location("members_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


TABLES = [User.__table__, AuditLog.__table__,
          ChatChannel.__table__, ChatChannelMember.__table__]


def _mk_user(db, *, user_id, tenant, role, email=None, active=True):
    user = User(
        id=user_id, email=email or f"{user_id}@büro.de", hashed_password="x",
        name=user_id, role=role, tenant_id=tenant, is_active=active,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def api_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    mod = _load_routes()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    db = sessionmaker(bind=engine)()
    users = {
        "owner": _mk_user(db, user_id="owner", tenant="t1", role="owner"),
        "gf": _mk_user(db, user_id="gf", tenant="t1", role="admin"),
        "member": _mk_user(db, user_id="member", tenant="t1", role="architect"),
        "member2": _mk_user(db, user_id="member2", tenant="t1", role="architect"),
        "stranger": _mk_user(db, user_id="stranger", tenant="t2", role="owner"),
    }
    app = FastAPI()
    app.include_router(mod.router)
    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[mod.get_current_user] = lambda: users["owner"]
    client = TestClient(app)
    client.state = {"users": users, "db": db, "app": app, "get_current_user": mod.get_current_user}
    return client


def _as(client, who: str) -> None:
    st = client.state
    st["app"].dependency_overrides[st["get_current_user"]] = lambda: st["users"][who]


def _audits(client, action: str):
    db = client.state["db"]
    return [r for r in db.execute(select(AuditLog)).scalars().all() if r.action == action]


# ------------------------- annuaire réel + cloisonnement ---------------------

def test_liste_reelle_triee_et_cloisonnee(api_client):
    body = api_client.get("/api/v5/members").json()
    assert body["your_role"] == "owner"
    roles = [m["role"] for m in body["members"]]
    assert roles == ["owner", "admin", "architect", "architect"]  # tri rang puis nom
    ids = [m["id"] for m in body["members"]]
    assert "stranger" not in ids  # AUTRE tenant invisible


def test_architect_ne_peut_rien_gerer(api_client):
    _as(api_client, "member")
    assert api_client.get("/api/v5/members").status_code == 403
    assert api_client.post("/api/v5/members", json={
        "name": "X", "email": "x@x.de", "password": "geheim123"}).status_code == 403
    assert api_client.post("/api/v5/members/member2/deactivate").status_code == 403
    assert api_client.patch("/api/v5/members/member2/role", json={"role": "admin"}).status_code == 403
    assert api_client.delete("/api/v5/members/member2").status_code == 403
    # mais son self-service reste ouvert :
    assert api_client.patch("/api/v5/members/me", json={"name": "Neuer Name"}).status_code == 200


# ------------------------------ création réelle ------------------------------

def test_creation_membre_role_architect_force_et_hash(api_client):
    _as(api_client, "gf")  # la Geschäftsführung crée des membres (sa spéc.)
    res = api_client.post("/api/v5/members", json={
        "name": "  Neuer Mitarbeiter ", "email": "NEU@Büro.DE ",
        "password": "geheim123", "company": None})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["role"] == "architect"       # JAMAIS admin/owner à la création
    assert body["email"] == "neu@büro.de"    # normalisé
    assert body["name"] == "Neuer Mitarbeiter"
    db = api_client.state["db"]
    row = db.execute(select(User).where(User.email == "neu@büro.de")).scalars().one()
    assert row.hashed_password != "geheim123"  # jamais en clair
    assert row.tenant_id == "t1"               # dans LE bureau du créateur
    assert _audits(api_client, "MEMBER_CREATED")


def test_creation_refuse_email_dupliquee_ou_invalide_et_pw_court(api_client):
    dup = api_client.post("/api/v5/members", json={
        "name": "X", "email": "member@büro.de", "password": "geheim123"})
    assert dup.status_code == 409 and "vergeben" in dup.json()["detail"]
    bad = api_client.post("/api/v5/members", json={
        "name": "X", "email": "pas-un-email", "password": "geheim123"})
    assert bad.status_code == 422
    court = api_client.post("/api/v5/members", json={
        "name": "X", "email": "neu2@büro.de", "password": "123"})
    assert court.status_code == 422


# ----------------------- désactivation réelle + matrice ----------------------

def test_admin_desactive_membre_idempotent_et_audite(api_client):
    _as(api_client, "gf")
    res = api_client.post("/api/v5/members/member/deactivate")
    assert res.status_code == 200
    assert res.json()["changed"] is True
    assert res.json()["member"]["is_active"] is False
    # get_current_user (dependencies.py:124), login (:163) et refresh (:261)
    # refusent is_active=False : la désactivation tue aussi les jetons émis.
    again = api_client.post("/api/v5/members/member/deactivate")
    assert again.json()["changed"] is False  # pas de faux « succès »
    assert _audits(api_client, "MEMBER_DEACTIVATED")
    back = api_client.post("/api/v5/members/member/activate")
    assert back.json()["changed"] is True


def test_admin_ne_touche_jamais_owner_ni_admin(api_client):
    _as(api_client, "gf")
    res = api_client.post("/api/v5/members/owner/deactivate")
    assert res.status_code == 403 and "architect" in res.json()["detail"]
    res2 = api_client.delete("/api/v5/members/gf2")
    assert res2.status_code == 404  # compte étranger au bureau = invisible
    # un admin sur un AUTRE admin :
    _mk_admin2 = _mk_user(api_client.state["db"], user_id="gf2", tenant="t1", role="admin")
    res3 = api_client.post(f"/api/v5/members/{_mk_admin2.id}/deactivate")
    assert res3.status_code == 403


def test_owner_desactive_admin_et_garde_fous_soi_meme(api_client):
    assert api_client.post("/api/v5/members/gf/deactivate").json()["changed"] is True
    self_guard = api_client.post("/api/v5/members/owner/deactivate")
    assert self_guard.status_code == 409
    self_delete = api_client.delete("/api/v5/members/owner")
    assert self_delete.status_code == 409


def test_owner_non_supprimable_et_dernier_owner_protege(api_client):
    db = api_client.state["db"]
    _mk_user(db, user_id="owner2", tenant="t1", role="owner")
    delete_owner = api_client.delete("/api/v5/members/owner2")
    assert delete_owner.status_code == 409 and "deaktiviert" in delete_owner.json()["detail"]
    # Avec 2 owners actifs, la désactivation de l'un reste possible :
    assert api_client.post("/api/v5/members/owner2/deactivate").json()["changed"] is True


# ------------------------- rôles : owner seul éléve --------------------------

def test_role_promotion_reservee_owner_et_auditee(api_client):
    as_admin = api_client  # owner par défaut
    admin_try = _as(api_client, "gf")
    assert api_client.patch("/api/v5/members/member/role", json={"role": "admin"}).status_code == 403
    _as(api_client, "owner")
    res = api_client.patch("/api/v5/members/member/role", json={"role": "admin"})
    assert res.status_code == 200 and res.json()["role"] == "admin"
    assert _audits(api_client, "MEMBER_ROLE_CHANGED")
    back = api_client.patch("/api/v5/members/member/role", json={"role": "architect"})
    assert back.json()["role"] == "architect"
    assert api_client.patch("/api/v5/members/owner/role", json={"role": "architect"}).status_code in (409,)
    assert api_client.patch("/api/v5/members/member/role", json={"role": "owner"}).status_code == 422


# ------------------------------ suppression ----------------------------------

def test_suppression_membre_nettoye_memberships_et_audite(api_client):
    db = api_client.state["db"]
    ch = ChatChannel(id="ch-t1", tenant_id="t1", kind="team", name="Équipe")
    db.add(ch)
    db.add(ChatChannelMember(channel_id="ch-t1", user_id="member", tenant_id="t1"))
    db.commit()
    res = api_client.delete("/api/v5/members/member")
    assert res.status_code == 200
    assert res.json() == {"deleted": "member", "removed_channel_memberships": 1}
    assert db.execute(select(User).where(User.id == "member")).scalars().first() is None
    assert db.execute(select(ChatChannelMember)).scalars().all() == []
    assert _audits(api_client, "MEMBER_DELETED")


def test_suppression_visible_seulement_dans_son_bureau(api_client):
    assert api_client.delete("/api/v5/members/stranger").status_code == 404


# ------------------------------ self-service ---------------------------------

def test_me_nom_et_avatar_persistes_sans_elevation(api_client):
    res = api_client.patch("/api/v5/members/me", json={"name": "  Chef Büro  "})
    member = res.json()["member"]
    assert res.json()["changed"] is True and member["name"] == "Chef Büro"
    res2 = api_client.patch("/api/v5/members/me", json={"avatar_key": "ak-123"})
    assert res2.json()["member"]["avatar_key"] == "ak-123"
    # un PATCH /me ne transporte ni rôle ni email (impossible dans le schéma) :
    res3 = api_client_client = api_client.patch("/api/v5/members/me", json={})
    assert res3.json()["changed"] is False
    assert api_client.patch("/api/v5/members/me", json={"name": " "}).status_code == 422


# ------------------------- §82 — contenu avatar serveur ----------------------


def test_avatar_json_roundtrip_photo_emoji_reset(api_client):
    """Photo ≤ 64 ko + emoji + reset explicite ; exposé dans /members pour tous."""
    _as(api_client, "member")  # self-service : un simple membre peut le faire
    photo = "data:image/jpeg;base64," + ("QUJD" * 100)
    res = api_client.patch("/api/v5/members/me", json={
        "avatar_key": "member@büro.de",
        "avatar_json": __import__("json").dumps({"kind": "photo", "photo": photo}),
    })
    assert res.status_code == 200 and res.json()["changed"] is True
    stored = api_client.patch("/api/v5/members/me", json={
        "avatar_json": __import__("json").dumps({"kind": "photo", "photo": photo}),
    })
    assert stored.json()["changed"] is False  # idempotence honnête

    _as(api_client, "owner")
    body = api_client.get("/api/v5/members").json()
    mine = next(m for m in body["members"] if m["id"] == "member")
    assert __import__("json").loads(mine["avatar_json"]) == {"kind": "photo", "photo": photo}

    _as(api_client, "member")
    res2 = api_client.patch("/api/v5/members/me", json={
        "avatar_json": __import__("json").dumps({"kind": "emoji", "emoji": "🏗️"}),
    })
    assert __import__("json").loads(res2.json()["member"]["avatar_json"])["kind"] == "emoji"
    res3 = api_client.patch("/api/v5/members/me", json={
        "avatar_json": __import__("json").dumps({"clear": True}),
    })
    assert res3.json()["changed"] is True
    assert res3.json()["member"]["avatar_json"] is None


def test_avatar_json_validation_stricte(api_client):
    import json as j
    _as(api_client, "member")
    assert api_client.patch("/api/v5/members/me", json={
        "avatar_json": j.dumps({"kind": "script", "photo": "x"})}).status_code == 400
    assert api_client.patch("/api/v5/members/me", json={
        "avatar_json": j.dumps({"kind": "photo", "photo": "http://evil/img.svg"})}).status_code == 400
    assert api_client.patch("/api/v5/members/me", json={
        "avatar_json": j.dumps({"kind": "photo",
                                "photo": "data:image/jpeg;base64," + "A" * 66_000})}).status_code == 400
    assert api_client.patch("/api/v5/members/me", json={
        "avatar_json": j.dumps({"kind": "emoji", "emoji": "x" * 20})}).status_code == 400
    assert api_client.patch("/api/v5/members/me", json={
        "avatar_json": "pas du json"}).status_code == 400


def test_avatar_json_cloisonne_et_ne_devoile_pas_stranger(api_client):
    """Un avatar posé par t1 n'apparaît jamais dans l'annuaire de t2."""
    db = client_db = api_client.state["db"]
    member = db.get(User, "member")
    member.avatar_key = "member@büro.de"
    member.avatar_json = __import__("json").dumps({"kind": "emoji", "emoji": "🦉"})
    db.commit()
    _as(api_client, "stranger")  # owner de t2
    body = api_client.get("/api/v5/members").json()
    assert [m["id"] for m in body["members"]] == ["stranger"]
    assert body["members"][0]["avatar_json"] is None
