"""NARCHI V5 — Provisioning explicite des comptes bootstrap."""

from __future__ import annotations

import os
import secrets

from sqlalchemy.orm import Session

from app.config import settings
from app.core.logging import anonymize_identifier, get_logger
from app.core.security.passwords import get_password_hash, verify_password

logger = get_logger("security.admin")


def _get_user_model():
    from app.models.user import User

    return User


def _enabled(name: str) -> bool:
    return os.getenv(name, "").lower() in {"true", "1", "yes"}


def _sync_passwords_enabled() -> bool:
    """Ré-alignement auto des mots de passe bootstrap sur l'environnement.

    Activé via NARCHI_SYNC_BOOTSTRAP_PASSWORDS=true (défaut du docker-compose).
    Même pattern que Grafana (GF_SECURITY_ADMIN_PASSWORD) : pour un déploiement
    auto-hébergé, le fichier .env est la source de vérité de l'opérateur.
    Indispensable car PostgreSQL conserve dans son volume le hash du mot de
    passe du PREMIER démarrage, alors qu'un nouveau dossier de déploiement
    régénère des mots de passe aléatoires dans un .env vierge — sans
    synchronisation, le compte owner devient définitivement inutilisable
    (401 au login) après chaque réinstallation.
    """
    return _enabled("NARCHI_SYNC_BOOTSTRAP_PASSWORDS")


def ensure_ak_berlin_guest(db: Session):
    """Crée le compte invité sans mot de passe public réutilisable."""
    User = _get_user_model()
    guest = (
        db.query(User)
        .execution_options(skip_tenant_filter=True)
        .filter(User.email == settings.AK_BERLIN_GUEST_EMAIL)
        .first()
    )
    if guest is not None:
        return guest

    guest = User(
        id=settings.AK_BERLIN_GUEST_ID,
        email=settings.AK_BERLIN_GUEST_EMAIL,
        hashed_password=get_password_hash(secrets.token_urlsafe(48)),
        name=settings.AK_BERLIN_GUEST_NAME,
        role="guest",
        company=settings.AK_BERLIN_GUEST_COMPANY,
        ak_member_id="AKB-GUEST-001",
        tenant_id="tenant-guest-kammer",
        is_active=True,
        is_guest=True,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    logger.info(
        "AK Berlin guest account provisioned",
        extra={"event_code": "ADMIN_GUEST_PROVISIONED"},
    )
    return guest


def ensure_default_admins(db: Session):
    """Provisionne les admins uniquement sur demande explicite.

    Les comptes existants ne sont jamais modifiés. Les mots de passe doivent
    provenir du gestionnaire de secrets du déploiement.
    """
    if not _enabled("NARCHI_SEED_DEFAULT_ADMINS"):
        logger.info(
            "Default admin provisioning disabled",
            extra={"event_code": "ADMIN_PROVISIONING_DISABLED"},
        )
        return None

    credentials = [
        (
            os.getenv("NARCHI_ADMIN_EMAIL", "admin@narchi.de"),
            os.getenv("NARCHI_ADMIN_PASSWORD", ""),
            "Architecte Principal (Directeur)",
            "tenant-narchi-berlin",
        ),
        (
            os.getenv("NARCHI_OWNER_EMAIL", "owner@narchi.io"),
            os.getenv("NARCHI_OWNER_PASSWORD", ""),
            "Propriétaire Narchi",
            "tenant-narchi-office",
        ),
    ]

    if any(len(password) < 16 for _, password, _, _ in credentials):
        raise RuntimeError(
            "NARCHI_ADMIN_PASSWORD et NARCHI_OWNER_PASSWORD (16 caractères minimum) "
            "sont requis pour le provisioning"
        )

    User = _get_user_model()
    last_created = None
    for email, password, name, tenant_id in credentials:
        existing = (
            db.query(User)
            .execution_options(skip_tenant_filter=True)
            .filter(User.email == email)
            .first()
        )
        if existing is not None:
            if _sync_passwords_enabled():
                # Auto-guérison : ré-aligne le hash stocké sur le mot de passe
                # ACTUEL de l'environnement (aucun secret n'est journalisé).
                if not verify_password(password, existing.hashed_password):
                    existing.hashed_password = get_password_hash(password)
                    db.commit()
                    logger.info(
                        "Bootstrap admin password synchronized with environment",
                        extra={
                            "event_code": "ADMIN_PASSWORD_SYNCHRONIZED",
                            "subject_ref": anonymize_identifier(email),
                        },
                    )
                else:
                    logger.info(
                        "Bootstrap admin already in sync with environment",
                        extra={
                            "event_code": "ADMIN_PASSWORD_ALREADY_IN_SYNC",
                            "subject_ref": anonymize_identifier(email),
                        },
                    )
            else:
                logger.info(
                    "Bootstrap admin already exists; unchanged",
                    extra={
                        "event_code": "ADMIN_ACCOUNT_ALREADY_EXISTS",
                        "subject_ref": anonymize_identifier(email),
                    },
                )
            continue

        admin = User(
            id=f"USR-ADMIN-{secrets.token_hex(6).upper()}",
            email=email,
            hashed_password=get_password_hash(password),
            name=name,
            role="owner",
            company="NARCHI Principal Office",
            tenant_id=tenant_id,
            is_active=True,
            is_guest=False,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        last_created = admin
        logger.info(
            "Bootstrap admin created",
            extra={
                "event_code": "ADMIN_ACCOUNT_CREATED",
                "subject_ref": anonymize_identifier(email),
                "tenant_id": tenant_id,
            },
        )

    return last_created


ensure_default_admin = ensure_default_admins
