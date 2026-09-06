"""§246 Passkeys — Registrierung (eingeloggt) + Anmeldung."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_current_user
from app.core.security.cookie_adapter import cookie_adapter
from app.database import get_db
from app.models.user import User
from app.models.webauthn_credential import WebAuthnCredential
from app.services import webauthn_service as wa

router = APIRouter(prefix="/api/v5/auth/passkeys", tags=["Passkeys"])

ACCESS_TOKEN_TTL_MINUTES = 15
REFRESH_TOKEN_TTL_DAYS = 7


class CredentialBody(BaseModel):
    credential: dict = Field(...)
    device_name: str | None = None
    email: str | None = None


def _emit_session(response: Response, request: Request, user: User) -> dict:
    access = create_access_token(
        data={"sub": user.id, "role": user.role, "type": "access"},
        user=user,
        expires_delta=timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
    )
    refresh = create_access_token(
        data={"sub": user.id, "type": "refresh"},
        user=user,
        expires_delta=timedelta(days=REFRESH_TOKEN_TTL_DAYS),
    )
    cookie_adapter.set_session_cookie(
        response, request, "narchi_session", access, max_age=ACCESS_TOKEN_TTL_MINUTES * 60
    )
    cookie_adapter.set_session_cookie(
        response,
        request,
        "narchi_refresh_token",
        refresh,
        max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
    )
    return {
        "access_token": access,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
        "user_info": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "tenant_id": user.tenant_id,
        },
    }


@router.get("/status")
def passkey_status():
    return {
        "library": "webauthn" if wa.webauthn_available() else "none",
        "verify": wa.webauthn_available(),
        "note": "localhost HTTP erlaubt WebAuthn. LAN ohne HTTPS oft nicht.",
    }


@router.post("/register/options")
def register_options(request: Request, current: User = Depends(get_current_user)):
    return wa.registration_options(current.id, current.email, current.name or current.email, request)


@router.post("/register/verify")
def register_verify(
    body: CredentialBody,
    request: Request,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expected = wa.pop_challenge("reg", current.id)
    if not expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Passkey-Challenge abgelaufen. Neu starten.")
    try:
        cred_id, pubkey, sign_count = wa.verify_registration(body.credential, expected, request)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Passkey ungültig: {type(exc).__name__}") from exc

    row = WebAuthnCredential(
        id=str(uuid.uuid4()),
        tenant_id=current.tenant_id,
        user_id=current.id,
        credential_id=cred_id,
        public_key=pubkey,
        sign_count=sign_count,
        device_name=(body.device_name or "")[:120] or None,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@router.get("/")
def list_passkeys(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(WebAuthnCredential)
        .filter(WebAuthnCredential.user_id == current.id)
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "device_name": r.device_name,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
            }
            for r in rows
        ]
    }


@router.delete("/{cred_pk}")
def delete_passkey(cred_pk: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = (
        db.query(WebAuthnCredential)
        .filter(WebAuthnCredential.id == cred_pk, WebAuthnCredential.user_id == current.id)
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Passkey nicht gefunden.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/login/options")
def login_options(request: Request, body: dict, db: Session = Depends(get_db)):
    email = str(body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="E-Mail fehlt.")
    user = db.query(User).filter(User.email == email).first()
    ids: list[bytes] = []
    if user:
        ids = [r.credential_id for r in db.query(WebAuthnCredential).filter(WebAuthnCredential.user_id == user.id)]
    # Immer Optionen — keine Konto-Enumeration über 404.
    return wa.assertion_options(email, ids, request)


@router.post("/login/verify")
def login_verify(body: CredentialBody, request: Request, response: Response, db: Session = Depends(get_db)):
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="E-Mail fehlt.")
    expected = wa.pop_challenge("login", email)
    if not expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Passkey-Challenge abgelaufen.")
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Anmeldung abgelehnt.")
    raw_id = body.credential.get("rawId") or body.credential.get("id")
    if not isinstance(raw_id, str):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Credential ohne id.")
    try:
        cred_bytes = wa.b64url_decode(raw_id)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Credential-id ungültig.") from exc
    row = (
        db.query(WebAuthnCredential)
        .filter(WebAuthnCredential.user_id == user.id, WebAuthnCredential.credential_id == cred_bytes)
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unbekannter Passkey.")
    try:
        new_count = wa.verify_assertion(body.credential, expected, bytes(row.public_key), int(row.sign_count), request)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Passkey ungültig: {type(exc).__name__}") from exc
    row.sign_count = new_count
    row.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return _emit_session(response, request, user)
