"""§141 — Cohérence du verrou « jamais de secret versionné » (gitleaks).

Garde-fou dans la veine §137 : la config `.gitleaks.toml` et le script
rejouable doivent être présents et cohérents — sinon le verrou anti-secret
serait inopérant sans que rien ne le signale.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


class TestGitleaksVerrou:
    def test_config_existe_avec_allowlists_documentees(self):
        cfg = (ROOT / ".gitleaks.toml").read_text(encoding="utf-8")
        # Les 2 faux positifs §141 sont allowlistés EXPLICITEMENT (documentés).
        assert "loadtest/locustfile" in cfg
        assert "byte_count=16" in cfg
        # Le commentaire dit POURQUOI (on ne masque pas, on documente).
        assert "charge-test-pass" in cfg  # mot de passe de test, cité

    def test_script_rejouable_epingle_par_sha(self):
        script = (ROOT / "scripts" / "verifier-gitleaks.sh").read_text(encoding="utf-8")
        assert "GITLEAKS_VERSION=\"8.30.1\"" in script
        assert "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" in script
        assert "sha256sum" in script  # la vérification d'empreinte est réelle

    def test_workflow_ci_reference_le_script(self):
        wf = (ROOT / ".github" / "workflows" / "security.yml").read_text(encoding="utf-8")
        assert "gitleaks-secret-scan" in wf
        assert "scripts/verifier-gitleaks.sh" in wf
        # Le job est HONNÊTE : marqué « PRÉPARÉ » (pas exécuté depuis GitHub).
        assert "PRÉPARÉ" in wf
