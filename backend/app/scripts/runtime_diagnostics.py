"""Diagnostic d'exécution sans secrets, appelé par COLLECT_DIAGNOSTICS.ps1."""

from __future__ import annotations

import importlib.metadata
import json
import os
import shutil
from datetime import datetime, timezone

import redis
from sqlalchemy import text

from app.config import settings
from app.core.security.password_migration import PasswordMigrationService
from app.database import SessionLocal, engine
from app.models.user import User


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def _database_diagnostic(result: dict) -> None:
    database = {
        "status": "error",
        "driver": engine.dialect.name,
        "alembic_revisions": [],
    }
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            database["alembic_revisions"] = list(
                connection.execute(text("SELECT version_num FROM alembic_version")).scalars()
            )
        database["status"] = "ok"
    except Exception as error:
        database["error_type"] = type(error).__name__
        database["error"] = str(error)[:500]
    result["database"] = database


def _owner_diagnostic(result: dict) -> None:
    owner_email = os.getenv("NARCHI_OWNER_EMAIL", "").strip().lower()
    owner_password = os.getenv("NARCHI_OWNER_PASSWORD", "")
    diagnostic = {
        "email_configured": bool(owner_email),
        "password_configured": bool(owner_password),
        "account_exists": False,
        "account_active": False,
        "role": None,
        "hash_scheme": None,
        "credentials_match_environment": None,
    }
    if not owner_email:
        result["owner"] = diagnostic
        return

    database = SessionLocal()
    try:
        owner = (
            database.query(User)
            .filter(User.email == owner_email)
            .execution_options(skip_tenant_filter=True)
            .first()
        )
        if owner is None:
            result["owner"] = diagnostic
            return
        diagnostic["account_exists"] = True
        diagnostic["account_active"] = bool(owner.is_active)
        diagnostic["role"] = owner.role
        diagnostic["tenant_configured"] = bool(owner.tenant_id)
        diagnostic["hash_scheme"] = PasswordMigrationService.detect_scheme(
            owner.hashed_password or ""
        ).value
        if owner_password:
            verified, _new_hash = PasswordMigrationService.verify_and_migrate(
                owner_password, owner.hashed_password or ""
            )
            diagnostic["credentials_match_environment"] = bool(verified)
    except Exception as error:
        diagnostic["error_type"] = type(error).__name__
        diagnostic["error"] = str(error)[:500]
    finally:
        database.close()
    result["owner"] = diagnostic


def _redis_diagnostic(result: dict) -> None:
    status = {"status": "error"}
    try:
        client = redis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379/0"),
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        status["ping"] = bool(client.ping())
        status["status"] = "ok"
        client.close()
    except Exception as error:
        status["error_type"] = type(error).__name__
        status["error"] = str(error)[:500]
    result["redis"] = status


def _pgvector_diagnostic(result: dict) -> None:
    """§51 — Le RAG vit dans PostgreSQL (extension pgvector), pas dans un
    serveur externe : le diagnostic interroge donc la base elle-même."""
    status = {"status": "error", "store": "pgvector"}
    try:
        with engine.connect() as connection:
            status["extension_version"] = connection.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
            # to_regclass → NULL quand la table n'existe pas encore, ce qui est
            # NORMAL avant le premier audit IA (création paresseuse PGVector).
            embeddings_table = connection.execute(
                text("SELECT to_regclass('public.langchain_pg_embedding')")
            ).scalar()
        status["extension_installed"] = status["extension_version"] is not None
        status["embeddings_table_present"] = embeddings_table is not None
        if not status["extension_installed"]:
            status["status"] = "error"
            status["error"] = "extension vector absente — migration 20260808_04 non appliquée ?"
        else:
            status["status"] = "ok"
            if embeddings_table is None:
                status["note"] = "aucun audit IA exécuté pour le moment (tables créées au premier usage)"
    except Exception as error:
        status["error_type"] = type(error).__name__
        status["error"] = str(error)[:500]
    result["pgvector"] = status


def main() -> int:
    total, used, free = shutil.disk_usage(settings.BASE_DIR / "storage")
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "application": {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT,
            "log_level": settings.LOG_LEVEL,
        },
        "packages": {
            "fastapi": _package_version("fastapi"),
            "sqlalchemy": _package_version("sqlalchemy"),
            "alembic": _package_version("alembic"),
            "redis": _package_version("redis"),
            "langchain-postgres": _package_version("langchain-postgres"),
        },
        "configuration": {
            "secret_key_configured": bool(settings.SECRET_KEY),
            "legacy_salt_configured": bool(settings.LEGACY_SHA256_SALT),
            "rag_vector_store": "pgvector",
            "sentry_configured": bool(settings.SENTRY_DSN),
        },
        "storage": {
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
        },
    }
    _database_diagnostic(result)
    _owner_diagnostic(result)
    _redis_diagnostic(result)
    _pgvector_diagnostic(result)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
