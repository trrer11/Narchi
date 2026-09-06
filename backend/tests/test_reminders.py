# -*- coding: utf-8 -*-
"""
NARCHI V5 — §46 Serverseitige Terminerinnerungen : tests du moteur PUR,
du cycle worker et des routes (app FastAPI dédiée, dépendances surchargées).

Le cycle de vie COMPLET est prouvé ici : sync → déclenchement (canal réel)
→ pull in-app « NARCHI rouvert » → re-sync (suppression) → re-armement.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import importlib.util
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.core.reminder_engine import (  # noqa: E402
    SmtpConfig,
    dispatch_reminder,
    due_reminders,
    expired_reminders,
    human_delta_de,
    mask_email,
    render_email_de,
    schedule_changed,
    smtp_config_from_settings,
)
from app.database import Base, get_db  # noqa: E402
from app.models.reminder import Reminder  # noqa: E402
from app.models.user import User  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.services.reminder_service import run_reminder_cycle  # noqa: E402


def _load_reminder_routes():
    """
    app/api/__init__.py importe auth/ifc/chat (redis, ifcopenshell…) : en
    test on charge UNIQUEMENT notre routeur, directement depuis le fichier —
    même code, zéro chaîne lourde.
    """
    path = Path(__file__).resolve().parents[1] / "app" / "api" / "reminder_routes.py"
    spec = importlib.util.spec_from_file_location("reminder_routes_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.router


reminders_router = _load_reminder_routes()

# Tables réellement touchées par le cycle (évite JSONB/ARRAY Postgres hors scope).
REMINDER_TABLES = [User.__table__, Reminder.__table__]


def _mk_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=REMINDER_TABLES)
    return engine

UTC = timezone.utc
# Ancrage temporel DYNAMIQUE : la constante était figée au 2026-08-10 09:00
# UTC — périmètre par construction (dès que l'horloge réelle dépassait cette
# heure, les rappels « dans 1 h » étaient déjà passés et le cycle sonnait).
# Découverte §91 : échec reproductible prouvé AU HEAD §90 sans aucun
# changement en cours → dette de test, pas de régression produit.
NOW = datetime.now(UTC).replace(microsecond=0)


def mk_reminder(**over) -> SimpleNamespace:
    base = dict(
        id="e1",
        title="Besprechung Bauherr",
        kind="termin",
        starts_at=NOW + timedelta(hours=25),
        remind_before_h=24.0,
        note="Unterlagen mitbringen",
        status="pending",
        fired_at=None,
        email_sent=False,
    )
    base.update(over)
    return SimpleNamespace(**base)


# ---------------------------------------------------------------------------
# Moteur pur
# ---------------------------------------------------------------------------


def test_due_only_when_moment_reached_and_event_not_passed():
    future = mk_reminder(id="e0", starts_at=NOW + timedelta(hours=30), remind_before_h=24)  # rappel dans 6 h
    now_due = mk_reminder(id="e1", starts_at=NOW + timedelta(hours=23), remind_before_h=24)  # rappel passé d'1 h, RDV encore devant
    late_but_useful = mk_reminder(id="e2", starts_at=NOW + timedelta(minutes=10), remind_before_h=2)
    passed = mk_reminder(id="e3", starts_at=NOW - timedelta(minutes=1), remind_before_h=24)
    already = mk_reminder(id="e4", status="fired")

    due = due_reminders([future, now_due, late_but_useful, passed, already], NOW)
    ids = [r.id for r in due]
    assert now_due.id in ids
    assert "e2" in ids  # serveur relancé en retard → encore utile
    assert future.id not in ids
    assert "e3" not in ids  # rendez-vous passé → JAMAIS sonné après coup
    assert "e4" not in ids


def test_expired_targets_pending_past_event_only():
    passed = mk_reminder(starts_at=NOW - timedelta(minutes=5))
    alive = mk_reminder(id="e2")
    fired = mk_reminder(id="e3", status="fired", starts_at=NOW - timedelta(days=1))
    expired = expired_reminders([passed, alive, fired], NOW)
    assert [r.id for r in expired] == [passed.id]


def test_schedule_changed_detects_meaningful_edits():
    row = mk_reminder()
    assert not schedule_changed(
        row, title=row.title, kind=row.kind, starts_at=row.starts_at,
        remind_before_h=row.remind_before_h, note=row.note,
    )
    assert schedule_changed(
        row, title=row.title, kind=row.kind, starts_at=row.starts_at + timedelta(hours=1),
        remind_before_h=row.remind_before_h, note=row.note,
    )
    # Naïf (SQLite) == conscient (API) : pas de ré-armement farfelu
    assert not schedule_changed(
        mk_reminder(starts_at=NOW.replace(tzinfo=None) + timedelta(hours=25)),
        title=row.title, kind=row.kind, starts_at=row.starts_at,
        remind_before_h=row.remind_before_h, note=row.note,
    )


def test_smtp_config_honest_disabled_without_host():
    assert smtp_config_from_settings(SimpleNamespace(SMTP_HOST="", SMTP_PORT=587, SMTP_USER="", SMTP_PASSWORD="", SMTP_FROM="", SMTP_USE_TLS=True)) is None
    cfg = smtp_config_from_settings(
        SimpleNamespace(SMTP_HOST="smtp.example.de", SMTP_PORT=587, SMTP_USER="", SMTP_PASSWORD="", SMTP_FROM="", SMTP_USE_TLS=True)
    )
    assert cfg is not None and cfg.sender == "narchi-reminders@localhost"


def test_email_rendering_de_real_data_only():
    r = mk_reminder()
    subject, body = render_email_de(r, now=NOW, app_url="https://localhost:8080")
    assert r.title in subject and r.title in body
    # Attendu CALCULÉ depuis l'ancrage dynamique (la chaîne figée
    # « 11.08.2026 · 10:00 » datait de l'ancienne date constante — §91).
    expected_when = (NOW + timedelta(hours=25)).strftime("%d.%m.%Y · %H:%M")
    assert expected_when in body, "l'heure affichée est celle du rappel, rien d'inventé"
    assert "(in 1 Tag)" in body
    assert "in 1 Tag" in body
    assert "Termin" in body and "Unterlagen mitbringen" in body
    assert "localhost" not in subject
    assert "verspätet" not in body  # déclenché à l'heure → pas d'excuse

    # Déclenché très en retard (reste 20 min sur 24 h demandées) → dit honnêtement
    r2 = mk_reminder(starts_at=NOW + timedelta(minutes=20), remind_before_h=24)
    _, body2 = render_email_de(r2, now=NOW, app_url="https://localhost:8080")
    assert "verspätet" in body2
    assert "in 20 Minuten" in body2


def test_human_delta_de_ranges():
    assert human_delta_de(timedelta(minutes=45)) == "in 45 Minuten"
    assert human_delta_de(timedelta(hours=3)) == "in 3 Stunden"
    assert human_delta_de(timedelta(hours=26)) == "in 1 Tag"
    assert human_delta_de(timedelta(days=3)) == "in 3 Tagen"


def test_mask_email_never_leaks_full_address():
    assert mask_email("architekt@buero-hannover.de") == "ar***@buero-hannover.de"
    assert mask_email("a@b.de") == "a***@b.de"
    assert mask_email("") is None and mask_email("invalid") is None


# ---------------------------------------------------------------------------
# dispatch_reminder — canaux HONNÊTES
# ---------------------------------------------------------------------------


def test_dispatch_without_smtp_is_inapp_only_never_a_silent_sent():
    r = mk_reminder()
    channel = dispatch_reminder(r, user_email="a@b.de", cfg=None, now=NOW, app_url="http://localhost")
    assert channel == "inapp"
    assert r.status == "fired" and r.fired_at == NOW and r.email_sent is False


def test_dispatch_with_smtp_sends_and_marks():
    sent = []

    def fake_mailer(cfg, to, subject, body):
        sent.append((cfg, to, subject, body))

    cfg = SmtpConfig(host="smtp.example.de", sender="narchi@example.de")
    r = mk_reminder()
    channel = dispatch_reminder(r, user_email="chef@buero.de", cfg=cfg, now=NOW, app_url="http://localhost", mailer=fake_mailer)
    assert channel == "email" and r.email_sent is True
    assert sent[0][1] == "chef@buero.de"
    assert "Besprechung Bauherr" in sent[0][3]


def test_dispatch_smtp_failure_still_fires_inapp_and_reports():
    def bad_mailer(*_args):
        raise OSError("connection refused")

    r = mk_reminder()
    channel = dispatch_reminder(
        r, user_email="a@b.de", cfg=SmtpConfig(host="smtp.example.de"), now=NOW, app_url="http://localhost", mailer=bad_mailer
    )
    assert channel == "email_failed"
    assert r.status == "fired" and r.email_sent is False  # in-app reste vrai


# ---------------------------------------------------------------------------
# Routes + cycle worker (app dédiée, SQLite mémoire)
# ---------------------------------------------------------------------------


@pytest.fixture()
def rc():
    engine = _mk_engine()
    TestingSession = sessionmaker(bind=engine, autoflush=False)
    db = TestingSession()
    user = User(id="u1", email="chef@buero.de", name="Chef", hashed_password="x", role="owner", tenant_id="t1")
    db.add(user)
    db.commit()

    app = FastAPI()
    app.include_router(reminders_router)
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    # Worker cycle uses its own session factory : monkeypatché ici.
    import app.services.reminder_service as svc

    original = svc.SessionLocal
    svc.SessionLocal = TestingSession
    try:
        yield TestClient(app), db, user
    finally:
        svc.SessionLocal = original
        app.dependency_overrides.clear()
        db.close()


def payload(entry_id="e1", **kw):
    base = {
        "entry_id": entry_id,
        "title": "Besprechung Bauherr",
        "kind": "termin",
        "starts_at": (NOW + timedelta(hours=25)).isoformat(),
        "remind_before_h": 24,
        "note": "Unterlagen",
    }
    base.update(kw)
    return base


def test_full_server_reminder_lifecycle(rc):
    client, db, _user = rc

    # 1) Sync de 2 rappels (un à 24 h, un à 1 h)
    r = client.post("/api/v5/reminders/sync", json={"reminders": [payload("e1"), payload("e2", starts_at=(NOW + timedelta(hours=2)).isoformat(), remind_before_h=1)]})
    assert r.status_code == 200
    body = r.json()
    assert body["synced"] == 2 and body["retired"] == 0
    # Canaux HONNÊTES : SMTP par défaut absent → e-mail désactivé, dit.
    assert body["channels"]["email_enabled"] is False
    assert body["channels"]["inapp_enabled"] is True
    assert body["channels"]["email_recipient"] == "ch***@buero.de"

    # 2) Rien n'est encore déclenché (e1 rappel dans 1 h, e2 dans 1 h pile ?)
    assert client.get("/api/v5/reminders/due").json() == []

    # 3) Cycle worker : e2 (rappel 1 h avant RDV dans 2 h… pas encore) — e1
    # (rappel 24 h avant RDV dans 25 h → sonne dans 1 h) : aucun ne sonne.
    stats = run_reminder_cycle(_settings_stub())
    assert stats["due"] == 0

    # 4) On avance le temps : e2 bascule « due » quand le rappel 1 h est passé.
    #    On simule en déplaçant le RDV de e2 à maintenant + 30 min (re-sync → ré-armement).
    r = client.post(
        "/api/v5/reminders/sync",
        json={"reminders": [payload("e1"), payload("e2", starts_at=(utcnow_plus(30)).isoformat(), remind_before_h=1)]},
    )
    assert r.status_code == 200
    stats = run_reminder_cycle(_settings_stub())
    assert stats["due"] == 1 and stats["inapp"] == 1 and stats["email"] == 0  # SMTP off → in-app (honnête)

    # 5) Pull in-app « NARCHI rouvert » : e2 visible, e1 non.
    due = client.get("/api/v5/reminders/due").json()
    assert [d["entry_id"] for d in due] == ["e2"]
    assert due[0]["email_sent"] is False
    assert "Besprechung" in due[0]["title"]

    # 6) Idempotence : 2e cycle → rien de nouveau (déjà fired).
    assert run_reminder_cycle(_settings_stub())["due"] == 0

    # 7) Suppression côté client → re-sync retire le pending (e1) mais GARDE le fired (e2, transparence 48 h).
    r = client.post("/api/v5/reminders/sync", json={"reminders": []})
    assert r.status_code == 200 and r.json()["retired"] == 1
    assert [d["entry_id"] for d in client.get("/api/v5/reminders/due").json()] == ["e2"]

    # 8) Ré-armement : l'événement e2 reporté à +2 h → fired effacé, pending recréé.
    r = client.post("/api/v5/reminders/sync", json={"reminders": [payload("e2", starts_at=(utcnow_plus(120)).isoformat(), remind_before_h=1)]})
    assert r.status_code == 200
    assert client.get("/api/v5/reminders/due").json() == []


def utcnow_plus(minutes: int) -> datetime:
    return datetime.now(UTC) + timedelta(minutes=minutes)


def _settings_stub():
    return SimpleNamespace(
        SMTP_HOST="", SMTP_PORT=587, SMTP_USER="", SMTP_PASSWORD="", SMTP_FROM="", SMTP_USE_TLS=True,
        REMINDER_POLL_SECONDS=60, CORS_ORIGINS=["http://localhost:8080"],
    )


def test_sync_requires_shape():
    # Sans auth surchargée l'override couvre — ici on valide Pydantic : titre vide refusé.
    engine = _mk_engine()
    TestingSession = sessionmaker(bind=engine, autoflush=False)
    db = TestingSession()
    user = User(id="u2", email="x@y.de", name="X", hashed_password="x", role="architect", tenant_id="t2")
    db.add(user)
    db.commit()
    app = FastAPI()
    app.include_router(reminders_router)
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    try:
        bad = payload("e9", title="")
        r = client.post("/api/v5/reminders/sync", json={"reminders": [bad]})
        assert r.status_code == 422
    finally:
        db.close()
