"""Vérifie l'auto-guérison des mots de passe bootstrap (NARCHI_SYNC_BOOTSTRAP_PASSWORDS).

Scénario reproduit : la base (volume PostgreSQL) contient un compte owner créé
avec le mot de passe d'un ANCIEN .env, puis un nouveau déploiement arrive avec
un NOUVEAU mot de passe aléatoire. Sans synchronisation → login 401 définitif.
"""

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-with-64-hex-chars-" + "ab" * 24
os.environ.setdefault("LEGACY_SHA256_SALT", "cd" * 32)

ADMIN_EMAIL = "owner-sync-test@narchi.de"
TENANT = "tenant-narchi-office"
PASSWORD_V1 = "mot-de-passe-initial-16+"
PASSWORD_V2 = "nouveau-mot-de-passe-16+"
PASSWORD_V3 = "mot-de-passe-ignore-16++"


@pytest.fixture()
def db_session(monkeypatch):
    monkeypatch.setenv("NARCHI_SEED_DEFAULT_ADMINS", "true")
    monkeypatch.setenv("NARCHI_OWNER_EMAIL", ADMIN_EMAIL)
    monkeypatch.setenv("NARCHI_OWNER_PASSWORD", PASSWORD_V1)
    monkeypatch.setenv("NARCHI_ADMIN_EMAIL", "admin-sync-test@narchi.de")
    monkeypatch.setenv("NARCHI_ADMIN_PASSWORD", PASSWORD_V1)

    from app.database import Base
    from app.models.user import User  # noqa: F401 — enregistre le modèle

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__])
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session, engine
    session.close()
    engine.dispose()


def _get_owner(session):
    from app.models.user import User

    return (
        session.query(User)
        .execution_options(skip_tenant_filter=True)
        .filter(User.email == ADMIN_EMAIL)
        .first()
    )


def test_bootstrap_cree_le_compte_avec_le_mot_de_passe_courant(db_session):
    from app.core.security.admin import ensure_default_admins
    from app.core.security.passwords import verify_password

    session, _ = db_session
    ensure_default_admins(session)
    owner = _get_owner(session)
    assert owner is not None
    assert verify_password(PASSWORD_V1, owner.hashed_password)


def test_sync_realigne_le_mot_de_passe_sur_le_nouvel_env(db_session, monkeypatch):
    """Le cœur de l'auto-guérison : nouveau déploiement, nouveau .env."""
    from app.core.security.admin import ensure_default_admins
    from app.core.security.passwords import verify_password

    session, _ = db_session
    monkeypatch.setenv("NARCHI_SYNC_BOOTSTRAP_PASSWORDS", "true")

    ensure_default_admins(session)  # 1er déploiement : PASSWORD_V1 gravé
    monkeypatch.setenv("NARCHI_OWNER_PASSWORD", PASSWORD_V2)
    ensure_default_admins(session)  # 2e déploiement : .env régénéré

    owner = _get_owner(session)
    assert verify_password(PASSWORD_V2, owner.hashed_password), (
        "Le mot de passe du compte bootstrap doit suivre le .env courant"
    )
    assert not verify_password(PASSWORD_V1, owner.hashed_password)


def test_sans_drapeau_sync_le_compte_existant_est_preserve(db_session, monkeypatch):
    """Comportement historique conservé quand la sync est désactivée."""
    from app.core.security.admin import ensure_default_admins
    from app.core.security.passwords import verify_password

    session, _ = db_session
    monkeypatch.setenv("NARCHI_SYNC_BOOTSTRAP_PASSWORDS", "false")

    ensure_default_admins(session)  # PASSWORD_V1
    monkeypatch.setenv("NARCHI_OWNER_PASSWORD", PASSWORD_V3)
    ensure_default_admins(session)  # ne doit RIEN changer

    owner = _get_owner(session)
    assert verify_password(PASSWORD_V1, owner.hashed_password)


def test_mot_de_passe_identique_ne_reecrit_pas(db_session, monkeypatch):
    """Un .env inchangé ne déclenche aucune réécriture (hash préservé)."""
    from app.core.security.admin import ensure_default_admins

    session, _ = db_session
    monkeypatch.setenv("NARCHI_SYNC_BOOTSTRAP_PASSWORDS", "true")

    ensure_default_admins(session)
    hash_avant = _get_owner(session).hashed_password
    ensure_default_admins(session)
    assert _get_owner(session).hashed_password == hash_avant
