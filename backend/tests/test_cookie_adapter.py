from fastapi import Request

from app.core.security.cookie_adapter import CookieSecurityAdapter


def make_request(host: str, scheme: str = "http") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": scheme,
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"host", host.encode())],
            "client": ("127.0.0.1", 50000),
            "server": (host, 80),
        }
    )


def test_production_localhost_http_cookie_not_secure(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    adapter = CookieSecurityAdapter()
    profile = adapter.get_profile(make_request("localhost:8080"))
    assert profile.httponly is True
    assert profile.secure is False
    assert profile.samesite == "lax"


def test_http_never_sets_secure_even_in_production(monkeypatch):
    """§198 — Secure sur HTTP = cookie jete. E2E + LAN + Docker."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    adapter = CookieSecurityAdapter()
    for host in (
        "host.docker.internal:8080",
        "narchi.localhost:8080",
        "app.narchi.de",
        "192.168.1.20:8080",
    ):
        profile = adapter.get_profile(make_request(host, scheme="http"))
        assert profile.secure is False, host
        assert profile.httponly is True


def test_https_remote_cookie_is_secure(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    adapter = CookieSecurityAdapter()
    profile = adapter.get_profile(make_request("app.narchi.de", scheme="https"))
    assert profile.secure is True
    assert profile.httponly is True


def test_https_localhost_cookie_is_secure(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    adapter = CookieSecurityAdapter()
    profile = adapter.get_profile(make_request("localhost", scheme="https"))
    assert profile.secure is True
