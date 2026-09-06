"""§51 — Pile RAG pgvector : Qdrant doit être RÉELLEMENT parti.

Pas de PostgreSQL ni de langchain requis : contrats source + chaîne de
migration + logique pure de construction de l'URL de connexion. Le runtime
complet est vérifié au build Docker (image narchi-postgres).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
MIGRATION_PATH = (
    BACKEND / "alembic" / "versions" / "20260808_04_pgvector_extension.py"
)
AI_SERVICE_PATH = BACKEND / "app" / "services" / "ai_audit_service.py"
CONFIG_PATH = BACKEND / "app" / "config.py"
DIAG_PATH = BACKEND / "app" / "scripts" / "runtime_diagnostics.py"
COMPOSE_PATH = ROOT / "docker-compose.yml"


def _load_migration():
    spec = importlib.util.spec_from_file_location("migration_20260808_04", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class _FakeDialect:
    def __init__(self, name: str):
        self.name = name


class _FakeBind:
    def __init__(self, dialect_name: str):
        self.dialect = _FakeDialect(dialect_name)


class _FakeOp:
    """Capture les op.execute() déclenchés par la migration."""

    def __init__(self, dialect_name: str):
        self._bind = _FakeBind(dialect_name)
        self.executed: list[str] = []

    def get_bind(self):
        return self._bind

    def execute(self, statement):
        self.executed.append(str(statement))


class TestMigrationChain:
    def test_revision_links_to_previous_live_head(self):
        migration = _load_migration()
        assert migration.revision == "20260808_04"
        assert migration.down_revision == "20260807_03"

    def test_upgrade_creates_vector_extension_on_postgresql(self):
        migration = _load_migration()
        fake_op = _FakeOp("postgresql")
        real_op = migration.op
        migration.op = fake_op
        try:
            migration.upgrade()
        finally:
            migration.op = real_op
        assert any(
            "CREATE EXTENSION IF NOT EXISTS vector" in statement
            for statement in fake_op.executed
        ), f"CREATE EXTENSION manquant : {fake_op.executed}"

    def test_upgrade_is_noop_outside_postgresql(self):
        migration = _load_migration()
        fake_op = _FakeOp("sqlite")
        real_op = migration.op
        migration.op = fake_op
        try:
            migration.upgrade()
            migration.downgrade()
        finally:
            migration.op = real_op
        assert fake_op.executed == []

    def test_downgrade_drops_extension_cascade(self):
        migration = _load_migration()
        fake_op = _FakeOp("postgresql")
        real_op = migration.op
        migration.op = fake_op
        try:
            migration.downgrade()
        finally:
            migration.op = real_op
        assert any(
            "DROP EXTENSION IF EXISTS vector" in statement
            for statement in fake_op.executed
        )


class TestAIServiceSwitchedToPGVector:
    def test_no_qdrant_reference_remains_in_ai_service(self):
        source = AI_SERVICE_PATH.read_text(encoding="utf-8")
        assert "qdrant" not in source.lower()

    def test_pgvector_import_and_usage(self):
        source = AI_SERVICE_PATH.read_text(encoding="utf-8")
        assert "from langchain_postgres import PGVector" in source
        assert "PGVector.from_documents(" in source
        assert "use_jsonb=True" in source

    def test_tenant_collection_isolation_preserved(self):
        source = AI_SERVICE_PATH.read_text(encoding="utf-8")
        # Hachage irréversible de l'id tenant + préfixe inchangé : aucune
        # recherche croisée possible entre tenants.
        assert "sha256(tenant_id.encode()).hexdigest()[:24]" in source
        assert 'f"ifc_hybrid_audit_{tenant_digest}"' in source

    def test_honest_mock_rag_preserved(self):
        source = AI_SERVICE_PATH.read_text(encoding="utf-8")
        # Le mode sans clé OpenAI doit continuer d'être marqué [Mock RAG] —
        # jamais une fausse réponse présentée comme réelle.
        assert "[Mock RAG]" in source
        assert '"dummy"' in source

    def test_connection_string_built_from_database_url(self):
        source = AI_SERVICE_PATH.read_text(encoding="utf-8")
        assert "build_pgvector_connection(settings.DATABASE_URL)" in source


class TestConfigurationCleaned:
    def test_config_has_no_qdrant_settings(self):
        source = CONFIG_PATH.read_text(encoding="utf-8")
        assert "QDRANT_URL" not in source
        assert "QDRANT_API_KEY" not in source

    def test_runtime_diagnostics_reports_pgvector(self):
        source = DIAG_PATH.read_text(encoding="utf-8")
        assert "qdrant" not in source.lower()
        assert "_pgvector_diagnostic" in source
        assert '"rag_vector_store": "pgvector"' in source
        # La création paresseuse des tables doit être dite honnêtement.
        assert "embeddings_table_present" in source


class TestRequirementsPinned:
    @pytest.mark.parametrize("filename", ["requirements-api.txt", "requirements.txt"])
    def test_vector_requirements(self, filename: str):
        text = (BACKEND / filename).read_text(encoding="utf-8")
        # Les lignes commentaires (historique §51) sont exclues de la vérif.
        dependency_lines = [
            line.strip().lower()
            for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        assert not any("qdrant" in line for line in dependency_lines)
        assert "langchain-postgres==0.0.17" in text
        assert "psycopg[binary]==" in text
        # langchain-postgres 0.0.17 exige pgvector python <0.4,>=0.2.5.
        assert "pgvector==0.3.6" in text
        assert "asyncpg==" in text

    def test_both_requirement_files_pin_identical_versions(self):
        api = (BACKEND / "requirements-api.txt").read_text(encoding="utf-8")
        full = (BACKEND / "requirements.txt").read_text(encoding="utf-8")
        for needle in (
            "langchain-postgres==0.0.17",
            "pgvector==0.3.6",
        ):
            assert needle in api
            assert needle in full


class TestConnectionStringBuilder:
    def test_rewrites_default_scheme(self):
        from app.services.rag_connection import build_pgvector_connection

        assert build_pgvector_connection(
            "postgresql://u:p@pgbouncer:5432/db"
        ) == "postgresql+psycopg://u:p@pgbouncer:5432/db"

    def test_rewrites_psycopg2_scheme(self):
        from app.services.rag_connection import build_pgvector_connection

        assert build_pgvector_connection(
            "postgresql+psycopg2://u:p@db:5432/x"
        ) == "postgresql+psycopg://u:p@db:5432/x"

    def test_keeps_psycopg_scheme_unchanged(self):
        from app.services.rag_connection import build_pgvector_connection

        url = "postgresql+psycopg://u:p@db:5432/x"
        assert build_pgvector_connection(url) == url

    def test_rewrites_legacy_postgres_scheme(self):
        from app.services.rag_connection import build_pgvector_connection

        assert build_pgvector_connection(
            "postgres://u:p@db:5432/x"
        ) == "postgresql+psycopg://u:p@db:5432/x"

    def test_other_dialects_untouched_and_empty_is_safe(self):
        from app.services.rag_connection import build_pgvector_connection

        assert build_pgvector_connection("sqlite:///dev.db") == "sqlite:///dev.db"
        assert build_pgvector_connection("") == ""


class TestComposeStack:
    def test_no_qdrant_service_or_env_in_compose(self):
        text = COMPOSE_PATH.read_text(encoding="utf-8")
        # Les commentaires d'historique §51 sont tolérés ; pas la config réelle.
        assert "\n  qdrant:" not in text
        assert "QDRANT_URL" not in text
        assert "QDRANT_API_KEY" not in text
        assert "qdrant_v5_data:" not in text.split("volumes:")[0]

    def test_db_builds_local_pgvector_image(self):
        text = COMPOSE_PATH.read_text(encoding="utf-8")
        assert "./infra/postgres" in text
        assert "postgres_v7_data:/var/lib/postgresql/data" in text
