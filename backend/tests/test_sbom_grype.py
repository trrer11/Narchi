"""§146 — Cohérence du SBOM + scan CVE (syft/grype), garde-fou veine §137.

Vérifie que le script existe, référence les bons manifests, et que pypdf est
bien épinglé à une version PATCHÉE (les 2 CVE Medium sur 6.14.2 sont corrigées
en 6.15.0+). Un downgrade silencieux de pypdf ferait échouer ce test.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


class TestSbomGrype:
    def test_script_rejouable(self):
        script = (ROOT / "scripts" / "verifier-sbom-grype.sh").read_text(encoding="utf-8")
        assert "syft" in script and "grype" in script
        assert "backend/requirements.txt" in script
        assert "--fail-on high" in script  # seuil dit (HIGH/CRITICAL bloquants)

    def test_pypdf_epingle_au_moins_6_15(self):
        """Les 2 CVE (GHSA-fp3f-mc75-235c, GHSA-fwg2-594c-jp42) touchent
        pypdf < 6.15.0. La version épinglée doit être ≥ 6.15.0."""
        for f in ("backend/requirements.txt", "backend/requirements-api.txt"):
            texte = (ROOT / f).read_text(encoding="utf-8")
            m = re.search(r"pypdf==(\d+)\.(\d+)\.(\d+)", texte)
            assert m, f"pypdf non épinglé dans {f}"
            maj, min_, pat = int(m.group(1)), int(m.group(2)), int(m.group(3))
            assert (maj, min_, pat) >= (6, 15, 0), f"pypdf {m.group(0)} vulnérable dans {f}"

    def test_workflow_ci_reference_le_script(self):
        wf = (ROOT / ".github" / "workflows" / "security.yml").read_text(encoding="utf-8")
        assert "sbom-grype" in wf
        assert "scripts/verifier-sbom-grype.sh" in wf
