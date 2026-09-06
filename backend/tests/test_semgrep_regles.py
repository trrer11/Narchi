"""§142 — Cohérence des règles Semgrep maison (garde-fou veine §137/§141).

Vérifie que les règles existent et couvrent les interdits §60 — sinon le filet
statique serait inopérant sans que rien ne le signale.
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


class TestSemgrepRegles:
    def test_fichier_regles_existe(self):
        assert (ROOT / "semgrep" / "narchi-rules.yml").is_file()

    def test_regles_couvrent_les_interdits_s60(self):
        texte = (ROOT / "semgrep" / "narchi-rules.yml").read_text(encoding="utf-8")
        # Les 3 interdits §60 / §114 sont des règles exécutables.
        assert "narchi-no-dangerously-set-inner-html" in texte
        assert "narchi-x-forwarded-for-audit-only" in texte
        assert "narchi-no-float-money" in texte
        # L'interdit XSS est ERROR (bloquant), les autres WARNING (relecture).
        assert "severity: ERROR" in texte  # la règle XSS
        assert "severity: WARNING" in texte  # x-forwarded + float

    def test_script_rejouable_reference_les_regles(self):
        script = (ROOT / "scripts" / "verifier-semgrep.sh").read_text(encoding="utf-8")
        assert "narchi-rules.yml" in script
        assert "frontend/src" in script and "backend/app" in script
