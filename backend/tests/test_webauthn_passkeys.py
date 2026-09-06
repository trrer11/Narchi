"""§246 Passkeys — Optionen, Status, keine Fake-Verify."""
import os

os.environ["ENVIRONMENT"] = "development"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["LEGACY_SHA256_SALT"] = "dummy_salt_for_tests"

from fastapi.testclient import TestClient

from app.main import app
from app.services import webauthn_service as wa

client = TestClient(app)


def test_passkey_status_endpoint():
    r = client.get("/api/v5/auth/passkeys/status")
    assert r.status_code == 200
    body = r.json()
    assert "verify" in body
    assert body["library"] in ("webauthn", "none")


def test_register_options_requires_session():
    r = client.post("/api/v5/auth/passkeys/register/options")
    assert r.status_code in (401, 403)


def test_login_options_without_email_400():
    r = client.post("/api/v5/auth/passkeys/login/options", json={})
    assert r.status_code == 400


def test_login_options_unknown_email_still_200():
    r = client.post("/api/v5/auth/passkeys/login/options", json={"email": "niemand@example.de"})
    assert r.status_code == 200
    data = r.json()
    assert "challenge" in data
    assert data["allowCredentials"] == []
    assert data["rpId"]


def test_login_verify_expired_challenge():
    r = client.post(
        "/api/v5/auth/passkeys/login/verify",
        json={
            "email": "niemand@example.de",
            "credential": {"id": "aaa", "rawId": "aaa", "type": "public-key", "response": {}},
        },
    )
    assert r.status_code == 400


def test_challenge_roundtrip():
    tok = wa.new_challenge("login", "a@b.de")
    assert wa.pop_challenge("login", "a@b.de") == tok
    assert wa.pop_challenge("login", "a@b.de") is None


def test_b64url_roundtrip():
    raw = b"\x00\x01\xff"
    assert wa.b64url_decode(wa.b64url(raw)) == raw
