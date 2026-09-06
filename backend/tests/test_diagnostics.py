import json
import logging
import re

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.context import request_id_context
from app.core.logging import (
    NarchiJsonFormatter,
    SensitiveDataFilter,
    anonymize_identifier,
    redact_log_value,
    redact_text,
)
from app.middlewares.request_diagnostics import RequestDiagnosticsMiddleware


def test_sensitive_values_are_redacted_recursively():
    payload = {
        "password": "VerySecretPassword!",
        "nested": {
            "authorization": "Bearer abcdefghijklmnopqrstuvwxyz",
            "safe_status": 401,
        },
    }
    cleaned = redact_log_value(payload)
    serialized = json.dumps(cleaned)
    assert "VerySecretPassword" not in serialized
    assert "abcdefghijklmnopqrstuvwxyz" not in serialized
    assert cleaned["nested"]["safe_status"] == 401


def test_text_redacts_jwt_and_url_credentials():
    source = (
        "Bearer abcdefghijklmnopqrstuvwxyz "
        "postgresql://narchi:my-database-password@db:5432/narchi "
        "eyJabcdefghijk.abcdefghijk.abcdefghijk "
        "private.person@example.com"
    )
    cleaned = redact_text(source)
    assert "my-database-password" not in cleaned
    assert "eyJabcdefghijk" not in cleaned
    assert "private.person@example.com" not in cleaned
    assert "[REDACTED]" in cleaned
    assert "[REDACTED_EMAIL]" in cleaned


def test_json_formatter_includes_event_and_request_id_without_secret():
    token = request_id_context.set("req-diagnostic-123")
    try:
        record = logging.LogRecord(
            name="narchi.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=42,
            msg="Login failed password=NeverWriteThis",
            args=(),
            exc_info=None,
        )
        record.event_code = "AUTH_TEST_FAILED"
        record.password = "NeverWriteThis"
        assert SensitiveDataFilter().filter(record)
        formatter = NarchiJsonFormatter("%(levelname)s %(name)s %(message)s")
        output = json.loads(formatter.format(record))
        assert output["event_code"] == "AUTH_TEST_FAILED"
        assert output["request_id"] == "req-diagnostic-123"
        assert "NeverWriteThis" not in json.dumps(output)
    finally:
        request_id_context.reset(token)


def test_anonymous_identifier_is_stable_and_not_the_email(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "x" * 64)
    first = anonymize_identifier(" Owner@Narchi.io ")
    second = anonymize_identifier("owner@narchi.io")
    assert first == second
    assert "owner" not in first
    assert re.fullmatch(r"[0-9a-f]{16}", first)


def test_request_middleware_returns_a_correlation_id():
    application = FastAPI()
    application.add_middleware(RequestDiagnosticsMiddleware)

    @application.get("/probe")
    async def probe(request: Request):
        return {"request_id": request.state.request_id}

    client = TestClient(application)
    response = client.get("/probe")
    assert response.status_code == 200
    correlation_id = response.headers["X-Narchi-Request-ID"]
    assert re.fullmatch(r"[0-9a-f]{32}", correlation_id)
    assert response.json()["request_id"] == correlation_id


def test_request_middleware_accepts_a_valid_existing_id():
    application = FastAPI()
    application.add_middleware(RequestDiagnosticsMiddleware)

    @application.get("/probe")
    async def probe():
        return {"ok": True}

    response = TestClient(application).get(
        "/probe", headers={"X-Narchi-Request-ID": "client-request-1234"}
    )
    assert response.headers["X-Narchi-Request-ID"] == "client-request-1234"
