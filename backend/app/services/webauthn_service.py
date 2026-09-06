"""§246 Passkeys — Herausforderungen + RP-ID.

Echte Attestationsprüfung über das Paket `webauthn` (BSD).
Ohne Paket: Optionen ja, Verify = 503 ehrlich (kein Fake-Login).
"""
from __future__ import annotations

import base64
import secrets
import time
from typing import Any

from fastapi import Request

_CHALLENGES: dict[str, tuple[str, float]] = {}
_TTL_S = 300.0


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(text: str) -> bytes:
    pad = "=" * ((4 - len(text) % 4) % 4)
    return base64.urlsafe_b64decode(text + pad)


def rp_from_request(request: Request) -> tuple[str, str]:
    """RP-ID = Host ohne Port. Origin = Scheme+Host aus der Anfrage."""
    host = (request.headers.get("host") or "localhost").split(":")[0].strip().lower()
    if not host:
        host = "localhost"
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
    origin = f"{proto}://{(request.headers.get('host') or host)}"
    return host, origin


def new_challenge(kind: str, subject: str) -> str:
    raw = secrets.token_bytes(32)
    token = b64url(raw)
    key = f"{kind}:{subject}"
    now = time.time()
    dead = [k for k, (_, exp) in _CHALLENGES.items() if exp < now]
    for k in dead:
        _CHALLENGES.pop(k, None)
    _CHALLENGES[key] = (token, now + _TTL_S)
    return token


def pop_challenge(kind: str, subject: str) -> str | None:
    key = f"{kind}:{subject}"
    item = _CHALLENGES.pop(key, None)
    if not item:
        return None
    token, exp = item
    if exp < time.time():
        return None
    return token


def webauthn_available() -> bool:
    try:
        import webauthn  # noqa: F401

        return True
    except ImportError:
        return False


def registration_options(user_id: str, email: str, name: str, request: Request) -> dict[str, Any]:
    rp_id, origin = rp_from_request(request)
    challenge = new_challenge("reg", user_id)
    return {
        "rp": {"id": rp_id, "name": "NARCHI"},
        "user": {
            "id": b64url(user_id.encode("utf-8")),
            "name": email,
            "displayName": name or email,
        },
        "challenge": challenge,
        "pubKeyCredParams": [
            {"type": "public-key", "alg": -7},
            {"type": "public-key", "alg": -257},
        ],
        "timeout": 120000,
        "attestation": "none",
        "authenticatorSelection": {
            "residentKey": "preferred",
            "userVerification": "preferred",
        },
        "origin": origin,
        "library": "webauthn" if webauthn_available() else "none",
    }


def assertion_options(email: str, credential_ids: list[bytes], request: Request) -> dict[str, Any]:
    rp_id, origin = rp_from_request(request)
    challenge = new_challenge("login", email.strip().lower())
    allow = [{"type": "public-key", "id": b64url(cid)} for cid in credential_ids]
    return {
        "rpId": rp_id,
        "challenge": challenge,
        "timeout": 120000,
        "userVerification": "preferred",
        "allowCredentials": allow,
        "origin": origin,
        "library": "webauthn" if webauthn_available() else "none",
    }


def verify_registration(credential: dict[str, Any], expected_challenge: str, request: Request) -> tuple[bytes, bytes, int]:
    if not webauthn_available():
        raise RuntimeError("webauthn-Paket fehlt — Passkey-Registrierung nicht prüfbar")
    from webauthn import verify_registration_response

    rp_id, origin = rp_from_request(request)
    verification = verify_registration_response(
        credential=credential,
        expected_challenge=b64url_decode(expected_challenge),
        expected_origin=origin,
        expected_rp_id=rp_id,
        require_user_verification=False,
    )
    return (
        bytes(verification.credential_id),
        bytes(verification.credential_public_key),
        int(verification.sign_count or 0),
    )


def verify_assertion(
    credential: dict[str, Any],
    expected_challenge: str,
    public_key: bytes,
    sign_count: int,
    request: Request,
) -> int:
    if not webauthn_available():
        raise RuntimeError("webauthn-Paket fehlt — Passkey-Anmeldung nicht prüfbar")
    from webauthn import verify_authentication_response

    rp_id, origin = rp_from_request(request)
    verification = verify_authentication_response(
        credential=credential,
        expected_challenge=b64url_decode(expected_challenge),
        expected_origin=origin,
        expected_rp_id=rp_id,
        credential_public_key=public_key,
        credential_current_sign_count=sign_count,
        require_user_verification=False,
    )
    return int(verification.new_sign_count or sign_count)
