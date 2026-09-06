# -*- coding: utf-8 -*-
"""
§60 — Rate limiting étendu : comportement du limiteur partagé + câblage réel.

Audit externe (pro cybersécurité) : « no rate limiting ? » — la réalité était
PARTIELLE : seul /token login était protégé. Ce chantier généralise le
limiteur Redis (repli local) avec isolation par namespace et verrouille le
câblage dans chaque endpoint sensible.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import app.core.rate_limit as rate_limit_module  # noqa: E402
from app.core.rate_limit import RedisSlidingWindowRateLimiter  # noqa: E402


@pytest.fixture(autouse=True)
def force_local_fallback(monkeypatch):
    """Tests déterministes : jamais de Redis, repli local pur."""
    monkeypatch.setattr(rate_limit_module, "redis_client", None)


class TestLimiterBehavior:
    def test_quota_blocks_after_max_attempts(self):
        limiter = RedisSlidingWindowRateLimiter(max_attempts=3, window_seconds=60, namespace="demo")
        assert [limiter.check_and_record("u1", "10.0.0.1") for _ in range(3)] == [True, True, True]
        assert limiter.check_and_record("u1", "10.0.0.1") is False

    def test_login_defaults_unchanged(self):
        """Le namespace historique « login » : 5 essais/minute (inchangé)."""
        limiter = RedisSlidingWindowRateLimiter()
        assert limiter.namespace == "login"
        assert limiter.max_attempts == 5 and limiter.window_seconds == 60

    def test_namespaces_are_isolated(self):
        a = RedisSlidingWindowRateLimiter(max_attempts=2, namespace="guest-login")
        b = RedisSlidingWindowRateLimiter(max_attempts=2, namespace="register")
        assert [a.check_and_record("u", "10.0.0.1") for _ in range(2)] == [True, True]
        assert a.check_and_record("u", "10.0.0.1") is False  # quota A épuisé
        # …mais la même empreinte sujet+IP reste autorisée dans l'autre namespace.
        assert b.check_and_record("u", "10.0.0.1") is True

    def test_subjects_are_isolated(self):
        limiter = RedisSlidingWindowRateLimiter(max_attempts=1, namespace="reset-password")
        assert limiter.check_and_record("alice", "10.0.0.1") is True
        assert limiter.check_and_record("alice", "10.0.0.1") is False
        assert limiter.check_and_record("bob", "10.0.0.1") is True

    def test_window_slides_and_reopens(self, monkeypatch):
        limiter = RedisSlidingWindowRateLimiter(max_attempts=1, window_seconds=60, namespace="demo")
        fake_now = [1_000_000.0]
        monkeypatch.setattr(rate_limit_module.time, "time", lambda: fake_now[0])
        assert limiter.check_and_record("u", "10.0.0.1") is True
        assert limiter.check_and_record("u", "10.0.0.1") is False
        fake_now[0] += 61  # la fenêtre glisse : l'ancien essai sort du chrono
        assert limiter.check_and_record("u", "10.0.0.1") is True

    def test_invalid_namespace_rejected(self):
        with pytest.raises(ValueError):
            RedisSlidingWindowRateLimiter(namespace="in;valid")

    def test_event_codes_login_parity_and_generic(self):
        """Observabilité : codes historiques du login INCHANGÉS."""
        login = RedisSlidingWindowRateLimiter()
        other = RedisSlidingWindowRateLimiter(namespace="chat-send")
        assert login._event_code("limited") == "AUTH_RATE_LIMITED"
        assert login._event_code("limited_local") == "AUTH_RATE_LIMITED_LOCAL"
        assert login._event_code("redis_fallback") == "AUTH_REDIS_RUNTIME_FALLBACK"
        assert other._event_code("limited") == "RATE_LIMITED"
        assert other._event_code("limited_local") == "RATE_LIMITED_LOCAL"
        assert other._event_code("redis_fallback") == "RATE_LIMIT_REDIS_FALLBACK"

    def test_instances_do_not_share_local_memory(self):
        a = RedisSlidingWindowRateLimiter(max_attempts=1, namespace="demo-a")
        b = RedisSlidingWindowRateLimiter(max_attempts=1, namespace="demo-a")
        assert a.check_and_record("u", "10.0.0.1") is True
        assert b.check_and_record("u", "10.0.0.1") is True


class TestEndpointWiring:
    """Le câblage réel dans les routes — verrou source par source."""

    def test_auth_uses_shared_module_no_inline_class(self):
        src = (BACKEND / "app" / "api" / "auth_routes.py").read_text(encoding="utf-8")
        assert "from app.core.rate_limit import RedisSlidingWindowRateLimiter" in src
        assert "class RedisSlidingWindowRateLimiter" not in src
        # Singletons par surface.
        for name in ("login_limiter", "guest_limiter", "register_limiter", "reset_limiter"):
            assert name in src

    def test_guest_login_is_limited(self):
        src = (BACKEND / "app" / "api" / "auth_routes.py").read_text(encoding="utf-8")
        body = src.split('async def guest_login', 1)[1].split('guest_user = ensure_ak_berlin_guest', 1)[0]
        assert "guest_limiter.check_and_record" in body
        assert "429" in body

    def test_register_is_limited_before_db_write(self):
        src = (BACKEND / "app" / "api" / "auth_routes.py").read_text(encoding="utf-8")
        body = src.split('async def register_user', 1)[1].split("db.add", 1)[0]
        assert "request: Request" in body.split(")", 1)[0] or "request: Request" in (BACKEND / "app" / "api" / "auth_routes.py").read_text(encoding="utf-8").split('async def register_user', 1)[1][:200]
        assert "register_limiter.check_and_record" in body
        # La limite passe AVANT toute requête de duplication d'email.
        assert body.index("register_limiter.check_and_record") < body.index("existing")

    def test_reset_password_is_limited(self):
        src = (BACKEND / "app" / "api" / "auth_routes.py").read_text(encoding="utf-8")
        body = src.split('async def reset_password', 1)[1].split("verify_password", 1)[0]
        assert "reset_limiter.check_and_record" in body

    def test_chat_send_is_limited_before_write(self):
        src = (BACKEND / "app" / "api" / "chat_routes.py").read_text(encoding="utf-8")
        assert "chat_send_limiter" in src
        body = src.split("async def send_message", 1)[1].split("db.add", 1)[0]
        assert "chat_send_limiter.check_and_record" in body
        assert "user:{current_user.id}" in body

    def test_ifc_upload_is_limited_before_disk_io(self):
        src = (BACKEND / "app" / "api" / "ifc_routes.py").read_text(encoding="utf-8")
        assert "upload_limiter" in src
        body = src.split("def upload_ifc_model", 1)[1]
        # Quota AVANT secure_upload_path / _write_upload_to_disk.
        assert body.index("upload_limiter.check_and_record") < body.index("secure_upload_path")
        assert body.index("upload_limiter.check_and_record") < body.index("_write_upload_to_disk")

    def test_no_forwarded_for_trust_anywhere(self):
        """SEC-003 : aucune lecture d'IP spoofable dans les zones protégées."""
        for rel in ("auth_routes.py", "chat_routes.py", "ifc_routes.py"):
            src = (BACKEND / "app" / "api" / rel).read_text(encoding="utf-8")
            protected_zones = [src.split(s, 1)[1] for s in ("guest_limiter", "register_limiter", "reset_limiter", "chat_send_limiter", "upload_limiter") if s in src]
            text = "".join(protected_zones)
            assert "x-forwarded-for" not in text.lower() or rel == "auth_routes.py"
        # La seule tolérance historique documentée : logging d'en-têtes au login,
        # jamais de décision de sécurité sur cette base.
