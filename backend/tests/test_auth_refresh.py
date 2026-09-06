"""Tests §87 — Renouvellement de session SILENCIEUX (plainte réelle :
déconnexion ~3–5 min / 15 min sans activité, reconnexion forcée).

L'endpoint /refresh existait MAIS (1) personne ne l'appelait côté client
(correction frontend) et (2) il ne vérifiait pas le pw_stamp : un refresh
cookie restait valable 7 jours APRÈS un changement de mot de passe —
faille fermée ici, avec régénération des DEUX jetons au reset-password
(la session courante continue, les autres meurent).

Prouvé ici : flux complet login → refresh (200 + expires_in affiché +
nouveau cookie), refus sans cookie / avec access-token / jeton falsifié,
pw_stamp après changement de mot de passe, compte désactivé, et
cohérence des durées centralisées (15 min / 7 jours en UN point).
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.auth_routes import ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS
from app.main import app


def _email() -> str:
    return f"refresh-{uuid.uuid4().hex[:12]}@buero.de"


def _register_and_login(client: TestClient, email: str, password: str) -> None:
    res = client.post("/api/v5/auth/register", json={
        "email": email, "password": password, "name": "Refresh Tester",
        "company": "Refresh Büro",
    })
    assert res.status_code in (200, 201), res.text
    res = client.post("/api/v5/auth/token", data={"username": email, "password": password})
    assert res.status_code == 200, res.text


def test_durees_centralisees_en_un_point():
    # La posture SOC2 reste AFFICHÉE : 15 min / 7 jours, définis une fois.
    assert ACCESS_TOKEN_TTL_MINUTES == 15
    assert REFRESH_TOKEN_TTL_DAYS == 7


def test_refresh_flux_complet_nouveau_cookie_et_expires_in():
    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)
    assert client.cookies.get("narchi_refresh_token"), "cookie refresh 7 jours posé au login"

    res = client.post("/api/v5/auth/refresh")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "success"
    assert body["expires_in"] == ACCESS_TOKEN_TTL_MINUTES * 60  # l'UI programme dessus
    new_session = client.cookies.get("narchi_session")
    assert new_session, "nouveau cookie de session posé"
    # Le jeton obtenu autorise réellement l'API (preuve fonctionnelle).
    me = client.get("/api/v5/auth/me")
    assert me.status_code == 200 and me.json()["email"] == email


def test_refresh_sans_cookie_401():
    client = TestClient(app)
    res = client.post("/api/v5/auth/refresh")
    assert res.status_code == 401
    assert "refresh" in res.json()["detail"].lower() or "rafraîchissement" in res.json()["detail"]


def test_refresh_avec_access_token_refuse_401():
    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)
    access = client.cookies.get("narchi_session")
    assert access
    fresh = TestClient(app)
    fresh.cookies.set("narchi_refresh_token", access)  # MAUVAIS type de jeton
    res = fresh.post("/api/v5/auth/refresh")
    assert res.status_code == 401
    assert "invalide" in res.json()["detail"]


def test_refresh_jeton_falsifie_401():
    client = TestClient(app)
    client.cookies.set("narchi_refresh_token", "aaa.bbb.ccc")
    res = client.post("/api/v5/auth/refresh")
    assert res.status_code == 401


def test_refresh_apres_changement_mot_de_passe_401_puis_nouveau_ok():
    """Faille fermée : l'ANCIEN refresh cookie meurt au changement de mot de
    passe (pw_stamp), et reset-password ré-émet un couple frais qui
    permet de continuer immédiatement (session courante préservée)."""
    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)
    old_refresh = client.cookies.get("narchi_refresh_token")
    assert old_refresh

    res = client.post("/api/v5/auth/reset-password",
                      json={"old_password": password, "new_password": "Nouveau#67890"})
    assert res.status_code == 200, res.text
    # Nouveau couple posé (la session COURANTE continue sans re-login).
    new_refresh = client.cookies.get("narchi_refresh_token")
    assert new_refresh and new_refresh != old_refresh

    # Un voleur avec l'ANCIEN refresh cookie : 401 pw_stamp, pas de pitié.
    thief = TestClient(app)
    thief.cookies.set("narchi_refresh_token", old_refresh)
    refused = thief.post("/api/v5/auth/refresh")
    assert refused.status_code == 401
    assert "mot de passe" in refused.json()["detail"]

    # Le NOUVEAU refresh fonctionne tout de suite.
    ok = client.post("/api/v5/auth/refresh")
    assert ok.status_code == 200 and ok.json()["expires_in"] == ACCESS_TOKEN_TTL_MINUTES * 60


def test_refresh_utilisateur_desactive_401():
    from app.database import SessionLocal

    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)

    db = SessionLocal()
    from app.models.user import User
    user = db.query(User).filter(User.email == email).first()
    user.is_active = False
    db.commit()
    db.close()

    res = client.post("/api/v5/auth/refresh")
    assert res.status_code == 401
    detail = res.json()["detail"]
    assert "inactif" in detail or "suspendu" in detail or "désactiv" in detail.lower()


# ---------------------------------------------------------------------------
# §87 — BUG DES DEUX SESSIONS SQL (câblage RÉEL, application complète) :
# get_current_user et la db de la route sont DEUX sessions distinctes →
# muter current_user + commit n'écrivait jamais. Ces tests passent par le
# vrai HTTP, pas par des dépendances injectées (qui partageaient une seule
# session et masquaient le bug dans les suites §80-§82).
# ---------------------------------------------------------------------------


def test_reset_password_persiste_vraiment_login_avec_nouveau_mot_de_passe():
    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)

    res = client.post("/api/v5/auth/reset-password",
                      json={"old_password": password, "new_password": "Nouveau#67890"})
    assert res.status_code == 200, res.text

    # Preuve PAR LE COMPORTEMENT : le nouveau mot de passe connecte…
    fresh_ok = TestClient(app)
    login_new = fresh_ok.post("/api/v5/auth/token",
                              data={"username": email, "password": "Nouveau#67890"})
    assert login_new.status_code == 200, "le nouveau mot de passe doit être ENREGISTRÉ"
    # …et l'ancien est bien mort.
    fresh_ko = TestClient(app)
    login_old = fresh_ko.post("/api/v5/auth/token",
                              data={"username": email, "password": password})
    assert login_old.status_code in (400, 401), "l'ancien mot de passe doit être INVALIDÉ"


def test_members_me_persiste_vraiment_avatar_et_nom():
    """Câblage PRODUCTION (deux sessions distinctes) — reproduit l'échec
    d'avatar chez le client : PATCH /members/me répondait changed=true
    sans jamais écrire avatar_json en base."""
    client = TestClient(app)
    email, password = _email(), "Start#12345"
    _register_and_login(client, email, password)

    emoji_spec = '{"kind":"emoji","emoji":"🦁"}'
    res = client.patch("/api/v5/members/me", json={
        "name": "Renommé Test",
        "avatar_key": email,
        "avatar_json": emoji_spec,
    })
    assert res.status_code == 200, res.text
    assert res.json()["changed"] is True

    # Relecture par un canal INDÉPENDANT (auth/me lit la base, pas
    # l'objet en mémoire de la requête PATCH).
    me = client.get("/api/v5/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body["name"] == "Renommé Test", "le nom doit persister en base"
    import json as _json
    assert _json.loads(body["avatar_json"]) == _json.loads(emoji_spec), \
        "l'avatar doit persister en base (forme canonique serveur, espaces permis)"


def test_guest_session_renouvelable_comme_tout_compte():
    """§88 — remarque client : l'invité AK Berlin utilise Narchi comme
    outil de bureau (calendrier, contacts, chat) ; l'accès étant de
    toute façon re-obtenable en 1 clic sans secret, le couper à 15 min
    était de la friction sans sécurité. Le refresh cookie est posé et
    /refresh l'accepte comme n'importe quel compte."""
    client = TestClient(app)
    res = client.post("/api/v5/auth/guest-login", json={})
    assert res.status_code == 200, res.text
    assert client.cookies.get("narchi_session"), "session invité posée"
    assert client.cookies.get("narchi_refresh_token"), \
        "§88 : refresh cookie invité (avant §88 : jamais posé)"

    refresh = client.post("/api/v5/auth/refresh")
    assert refresh.status_code == 200, refresh.text
    assert refresh.json()["expires_in"] == ACCESS_TOKEN_TTL_MINUTES * 60

    # Le nouveau jeton invité autorise réellement l'API.
    me = client.get("/api/v5/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "guest"
