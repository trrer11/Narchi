"""§147 — Cohérence du gate mypy (garde-fou veine §137/§141/§142/§146).

Vérifie que le script existe, cible les 6 fichiers monétaires, utilise
`--no-incremental` (cache incrémental = RAM zombie observée §147) et `--strict`.
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

FICHIERS = [
    "money.py",
    "xrechnung.py",
    "ubl.py",
    "versand.py",
    "offer_compare.py",
    "lv_positions.py",
]


class TestMypyGate:
    def test_script_rejouable_strict_no_incremental(self):
        script = (ROOT / "scripts" / "verifier-mypy.sh").read_text(encoding="utf-8")
        assert "--strict" in script
        assert "--no-incremental" in script  # le cache sature la RAM (§147)

    def test_script_cible_les_6_fichiers_monetaires(self):
        script = (ROOT / "scripts" / "verifier-mypy.sh").read_text(encoding="utf-8")
        for f in FICHIERS:
            assert f"app/services/{f}" in script

    def test_fichiers_monetaires_existent(self):
        for f in FICHIERS:
            assert (ROOT / "backend" / "app" / "services" / f).is_file()
