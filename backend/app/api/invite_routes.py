"""§68 — API Einladungen : inviter des testeurs/collègues par LIEN SIGNÉ.

Flux :
  1. L'owner crée une invitation → JWT (72 h) + ligne `tenant_invites`.
  2. Il copie le lien `<origine>/?invite=<jeton>` et l'envoie (WhatsApp,
     e-mail — pas de serveur SMTP requis pour la bêta).
  3. Le destinataire ouvre le lien, saisit nom/e-mail/mot de passe →
   `/accept` crée son compte DANS le tenant de l'émetteur (role
   « architect »).

Sécurité (doctrine §60) :
  - jeton JWT HS256 signé avec la MÊME clé que les jetons de session
    (`app.core.security.SECRET_KEY` : refus de clé faible en prod §60,
    aléatoire par boot en dev — les invitations meurent au redémarrage,
    comme les sessions), revendication `purpose` dédiée (jamais un jeton
    de session), expiration 72 h doublement vérifiée (JWT + colonne) ;
  - usage unique (jti ↔ ligne) + révocation ; aucune donnée n'est jamais
    supprimée (`used_at`/`revoked_at` datés) ;
  - anti-spam fenêtre glissante §60 sur `/accept` (namespace « invite »,
    IP strictement ASGI) ;
  - seul le rôle `owner` crée/liste/révoque ; filtre tenant explicite
    partout (et intercepteur global en lecture).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.rate_limit import RedisSlidingWindowRateLimiter
from app.core.security import SECRET_KEY as _JWT_SECRET, get_current_user, get_password_hash
from app.database import get_db
from app.models.tenant_invite import TenantInvite
from app.models.user import User

logger = get_logger("api.invites")

router = APIRouter(prefix="/api/v5/invites", tags=["Tenant-Einladungen"])

INVITE_TTL_HOURS = 72
_JWT_ALG = "HS256"
_JWT_PURPOSE = "tenant-invite"

# §60 — fenêtre glissante dédiée (Redis + repli local thread-safe).
invite_accept_limiter = RedisSlidingWindowRateLimiter(
    max_attempts=10, window_seconds=60, namespace="invite"
)


# ---------------------------------------------------------------- schémas
class InviteCreateRequest(BaseModel):
    invited_email: str | None = Field(default=None, max_length=320)


class InviteCreateOut(BaseModel):
    invite_id: str
    invite_path: str  # chemin SPA relatif ; l'UI préfixe window.location.origin
    expires_at: datetime


class InviteListItem(BaseModel):
    id: str
    invited_email: str | None
    created_at: datetime | None
    expires_at: datetime
    used_at: datetime | None
    used_by_email: str | None
    revoked_at: datetime | None
    state: str  # offen | benutzt | abgelaufen | widerrufen


class InviteAcceptRequest(BaseModel):
    token: str = Field(min_length=16, max_length=4096)
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    company: str | None = Field(default=None, max_length=160)


class InviteAcceptOut(BaseModel):
    email: str
    tenant_id: str
    message: str


# ---------------------------------------------------------------- helpers
def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _encode_invite_token(*, tenant_id: str, jti: str, expires_at: datetime) -> str:
    payload = {
        "purpose": _JWT_PURPOSE,
        "tenant_id": tenant_id,
        "jti": jti,
        "exp": expires_at,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


def _decode_invite_token(token: str) -> dict:
    try:
        claims = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=400,
            detail="Einladungslink ungültig oder abgelaufen — bitte einen neuen Link anfordern.",
        ) from exc
    if claims.get("purpose") != _JWT_PURPOSE:
        raise HTTPException(status_code=400, detail="Kein Einladungs-Token.")
    if not claims.get("tenant_id") or not claims.get("jti"):
        raise HTTPException(status_code=400, detail="Einladungs-Token unvollständig.")
    return claims


def _require_owner(current_user: User) -> None:
    # §80 — la Geschäftsführung (admin) gère aussi les invitations
    # (spécification utilisateur : « le gérant crée les comptes invité »).
    if current_user.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nur Eigentümer oder Geschäftsführung verwalten Einladungen.",
        )


def _state_of(row: TenantInvite, now: datetime) -> str:
    if row.revoked_at is not None:
        return "widerrufen"
    if row.used_at is not None:
        return "benutzt"
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        return "abgelaufen"
    return "offen"


# ---------------------------------------------------------------- routes
@router.post("", response_model=InviteCreateOut, status_code=status.HTTP_201_CREATED)
def create_invite(
    req: InviteCreateRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_owner(current_user)
    import uuid

    now = _now_utc()
    expires_at = now + timedelta(hours=INVITE_TTL_HOURS)
    jti = uuid.uuid4().hex
    invited_email = (req.invited_email or "").strip().lower() or None if req else None
    row = TenantInvite(
        tenant_id=current_user.tenant_id,
        jti=jti,
        invited_email=invited_email,
        created_by=current_user.id,
        expires_at=expires_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    token = _encode_invite_token(tenant_id=current_user.tenant_id, jti=jti, expires_at=expires_at)
    logger.info(
        "Einladung créée",
        extra={
            "event_code": "INVITE_CREATED",
            "tenant_id": current_user.tenant_id,
            "invite_id": row.id,
            "has_target_email": bool(invited_email),
        },
    )
    return InviteCreateOut(invite_id=row.id, invite_path=f"/?invite={token}", expires_at=expires_at)


@router.get("", response_model=list[InviteListItem])
def list_invites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_owner(current_user)
    rows = (
        db.query(TenantInvite)
        .filter(TenantInvite.tenant_id == current_user.tenant_id)
        .order_by(TenantInvite.created_at.desc())
        .limit(100)
        .all()
    )
    now = _now_utc()
    return [
        InviteListItem(
            id=row.id,
            invited_email=row.invited_email,
            created_at=row.created_at,
            expires_at=row.expires_at,
            used_at=row.used_at,
            used_by_email=row.used_by_email,
            revoked_at=row.revoked_at,
            state=_state_of(row, now),
        )
        for row in rows
    ]


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_owner(current_user)
    # Filtre tenant EXPLICITE : impossible de révoquer l'invitation d'un
    # autre bureau même en devinant l'id (et l'intercepteur filtre déjà).
    row = (
        db.query(TenantInvite)
        .filter(TenantInvite.id == invite_id, TenantInvite.tenant_id == current_user.tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden.")
    if row.used_at is not None:
        raise HTTPException(status_code=400, detail="Bereits verwendete Einladung kann nicht widerrufen werden.")
    if row.revoked_at is None:
        row.revoked_at = _now_utc()
        db.commit()
        logger.info(
            "Einladung révoquée",
            extra={"event_code": "INVITE_REVOKED", "tenant_id": current_user.tenant_id, "invite_id": row.id},
        )
    return None


@router.post("/accept", response_model=InviteAcceptOut)
def accept_invite(
    request: Request,
    req: InviteAcceptRequest,
    db: Session = Depends(get_db),
):
    # §60 — anti-spam AVANT toute validation coûteuse (IP ASGI only).
    ip_address = request.client.host if request.client else "unknown"
    email = req.email.strip().lower()
    if not invite_accept_limiter.check_and_record(f"invite:{email}", ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Zu viele Versuche. Bitte spaeter erneut versuchen.",
        )

    claims = _decode_invite_token(req.token)
    row = (
        db.query(TenantInvite)
        .filter(TenantInvite.jti == claims["jti"], TenantInvite.tenant_id == claims["tenant_id"])
        .first()
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Einladung nicht gefunden.")
    now = _now_utc()
    if row.revoked_at is not None:
        raise HTTPException(status_code=410, detail="Diese Einladung wurde widerrufen.")
    if row.used_at is not None:
        raise HTTPException(status_code=410, detail="Diese Einladung wurde bereits verwendet.")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires < now:
        raise HTTPException(status_code=410, detail="Diese Einladung ist abgelaufen — bitte einen neuen Link anfordern.")

    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Cette adresse e-mail est déjà utilisée.")

    new_user = User(
        email=email,
        hashed_password=get_password_hash(req.password),
        name=req.name.strip(),
        company=(req.company or None),
        tenant_id=claims["tenant_id"],
        role="architect",
    )
    db.add(new_user)
    row.used_at = now
    row.used_by_email = email
    db.commit()
    logger.info(
        "Einladung acceptée",
        extra={
            "event_code": "INVITE_ACCEPTED",
            "tenant_id": claims["tenant_id"],
            "invite_id": row.id,
            "user_email_hash": email[:2] + "***",
        },
    )
    return InviteAcceptOut(
        email=email,
        tenant_id=claims["tenant_id"],
        message="Konto erstellt — Sie können sich jetzt anmelden.",
    )
