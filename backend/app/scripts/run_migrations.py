"""Exécute Alembic avec des événements de diagnostic explicites."""

from __future__ import annotations

import os
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.core.logging import get_logger, setup_logging

os.environ["NARCHI_STRUCTURED_LOGGING"] = "true"
setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_format=os.getenv("ENVIRONMENT", "development").lower() == "production",
)
logger = get_logger("migrations")


def main() -> int:
    started = time.perf_counter()
    config_path = Path(os.getenv("ALEMBIC_CONFIG", "/app/alembic.ini"))
    if not config_path.exists():
        config_path = Path("alembic.ini").resolve()

    logger.info(
        "Alembic migration started",
        extra={
            "event_code": "MIGRATION_STARTED",
            "config_exists": config_path.exists(),
        },
    )
    try:
        command.upgrade(Config(str(config_path)), "head")
        database_url = os.environ["DATABASE_URL"]
        engine = create_engine(database_url, pool_pre_ping=True)
        try:
            with engine.connect() as connection:
                revisions = list(
                    connection.execute(text("SELECT version_num FROM alembic_version")).scalars()
                )
        finally:
            engine.dispose()
        logger.info(
            "Alembic migration completed",
            extra={
                "event_code": "MIGRATION_SUCCEEDED",
                "alembic_revisions": revisions,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return 0
    except Exception as error:
        logger.exception(
            "Alembic migration failed",
            extra={
                "event_code": "MIGRATION_FAILED",
                "error_type": type(error).__name__,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
