"""§52 — Garde d'encodage : tout script Windows doit être 100 % ASCII.

Bug réel du 2026-08-07 : un tiret cadratin « — » (U+2014, octets UTF-8
E2 80 94) écrit dans DEPLOY_PROD.ps1 a été lu par Windows PowerShell 5.1 en
ANSI (CP1252), où l'octet 0x94 est un guillemet fermant. La chaîne de
caractères se fermait prématurément → cascade d'erreurs de parse, déploiement
bloqué avant même Docker.

Règle définitive : les fichiers .ps1 / .bat sont sans BOM (un BOM casserait
les .bat sous cmd.exe), donc SEUL l'ASCII-7 est interprété à l'identique par
CP1252 et UTF-8. Cette garde rend la réapparition du bug impossible.
"""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
UTF8_BOM = b"\xef\xbb\xbf"


def _windows_scripts() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*")
        if path.suffix.lower() in (".ps1", ".bat")
        and ".git" not in path.parts
        and "node_modules" not in path.parts
    )


def test_windows_scripts_exist():
    scripts = _windows_scripts()
    assert scripts, "aucun script Windows trouvé — le garde-fou serait inopérant"
    assert any(path.name == "DEPLOY_PROD.ps1" for path in scripts)


@pytest.mark.parametrize(
    "script",
    _windows_scripts(),
    ids=lambda path: str(path.relative_to(ROOT)),
)
def test_script_is_pure_ascii(script: Path):
    raw = script.read_bytes()
    offending = sorted({b for b in raw if b > 0x7F})
    assert not offending, (
        f"{script.relative_to(ROOT)} contient {len(offending)} octets non-ASCII "
        f"(ex. {offending[:8]}) : Windows PowerShell 5.1 lit les .ps1 sans BOM "
        "en ANSI et 0x92-0x94 deviennent des guillemets qui cassent le parse. "
        "Réécrire le texte en ASCII (e/accent, '-' au lieu du tiret cadratin)."
    )


@pytest.mark.parametrize(
    "script",
    [p for p in _windows_scripts() if p.suffix.lower() == ".bat"],
    ids=lambda path: str(path.relative_to(ROOT)),
)
def test_bat_has_no_utf8_bom(script: Path):
    # Un BOM UTF-8 devant @echo off casse l'exécution cmd.exe (« ï»¿@echo »).
    assert not script.read_bytes().startswith(UTF8_BOM), (
        f"{script.relative_to(ROOT)} porte un BOM UTF-8 interdit pour cmd.exe"
    )
