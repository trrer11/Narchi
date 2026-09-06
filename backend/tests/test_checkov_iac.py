"""§143 — Cohérence du scan IaC Checkov (garde-fou veine §137/§141/§142).

Vérifie que le script existe, que les skips sont DOCUMENTÉS (pas masqués), et
que le skip inline du Dockerfile postgres est présent avec sa raison.
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


class TestCheckovIaC:
    def test_script_rejouable_et_skip_documente(self):
        script = (ROOT / "scripts" / "verifier-checkov.sh").read_text(encoding="utf-8")
        assert "CKV_DOCKER_2" in script  # HEALTHCHECK (skip documenté)
        assert "docker-compose.yml" in script  # la RAISON du skip est écrite

    def test_dockerfile_postgres_skip_inline_documente(self):
        df = (ROOT / "infra" / "postgres" / "Dockerfile").read_text(encoding="utf-8")
        assert "checkov:skip=CKV_DOCKER_8" in df
        # La raison est écrite À CÔTÉ du skip (jamais un skip muet).
        assert "postgres" in df and "root" in df.lower()

    def test_dockerfiles_presents(self):
        for f in ("backend/Dockerfile", "frontend/Dockerfile", "infra/postgres/Dockerfile", "Dockerfile.monorepo"):
            assert (ROOT / f).is_file(), f"{f} manquant"
