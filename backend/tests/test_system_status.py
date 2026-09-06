# -*- coding: utf-8 -*-
"""§178 — Statut système profond : la preuve de fiabilité (DB + capacités)."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import system_status_routes as routes  # noqa: E402


def _db_ok():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    return sessionmaker(bind=engine)()


class _DbErreur:
    """Simule une base indisponible : execute() lève."""

    def execute(self, *_args, **_kwargs):
        raise RuntimeError("database down")


def test_statut_operationnel_base_saine():
    out = routes.system_status(db=_db_ok())
    assert out["status"] == "operational"
    assert out["database"] == "ok"
    assert out["version"]  # non vide
    assert out["capabilities"]["xrechnung_kosit"] is True
    assert out["capabilities"]["peppol_network"] is False  # DIFFÉRÉ, dit
    assert out["llm"]["mode"] in {"off", "ollama", "cloud"}
    assert out["server_time"]


def test_statut_degrade_base_indisponible():
    out = routes.system_status(db=_DbErreur())
    assert out["status"] == "degraded"
    assert out["database"] == "error"
