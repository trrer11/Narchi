"""NARCHI V5 — SQLAlchemy, PostgreSQL obligatoire en production, PgBouncer-ready."""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings
from app.core.context import tenant_id_context

DATABASE_URL = settings.DATABASE_URL
IS_POSTGRES = DATABASE_URL.lower().startswith(("postgresql://", "postgresql+"))
IS_PRODUCTION = settings.ENVIRONMENT.lower() == "production"

if IS_PRODUCTION and not IS_POSTGRES:
    raise RuntimeError(
        "Configuration refusée: PostgreSQL est obligatoire en production; aucun fallback SQLite"
    )


def _create_database_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
            echo=settings.DEBUG,
        )

    common = {
        "pool_pre_ping": True,
        "echo": settings.DEBUG,
    }
    if settings.DB_USE_PGBOUNCER:
        # PgBouncer détient le pool physique. NullPool évite la multiplication
        # workers × (pool_size + overflow) côté application.
        return create_engine(url, poolclass=NullPool, **common)

    return create_engine(
        url,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=5,
        pool_recycle=1800,
        **common,
    )


writer_engine = _create_database_engine(DATABASE_URL)
reader_url = settings.READER_DATABASE_URL or DATABASE_URL
reader_engine = (
    writer_engine if reader_url == DATABASE_URL else _create_database_engine(reader_url)
)
engine = writer_engine


class RoutingSession(Session):
    """Écritures vers le writer, lectures vers la réplique configurée."""

    def get_bind(self, mapper=None, clause=None, **kwargs):
        if (
            self._flushing
            or self.info.get("force_writer")
            or (clause is not None and getattr(clause, "is_dml", False))
        ):
            return writer_engine
        return reader_engine


SessionLocal = sessionmaker(
    class_=RoutingSession,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)

Base = declarative_base()


def get_db():
    """Dépendance transactionnelle avec propagation du tenant courant."""
    db = SessionLocal()
    tenant_id = tenant_id_context.get()
    if tenant_id:
        db.info["tenant_id"] = tenant_id
    try:
        yield db
    finally:
        db.close()
