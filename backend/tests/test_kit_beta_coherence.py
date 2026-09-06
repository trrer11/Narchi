"""§137 — Cohérence du kit beta : la documentation utilisateur/opérateur ne
doit citer QUE des fichiers qui existent réellement (règle « les fichiers
existent vraiment » du README).

Pourquoi : le guide utilisateur (GUIDE_NUTZER_DE.md) et le runbook
(RUNBOOK_BETRIEB_DE.md) citent des `.bat`/`.ps1`/`.sh`/`.md`. Si l'un d'eux
est renommé ou supprimé, la doc devient fausse sans que rien ne le signale —
un bureau beta suivrait un chemin mort. Ce test extrait les chemins de
fichiers cités (tokens backtick avec une extension connue ou un préfixe de
dossier connu) et vérifie leur existence. Les motifs d'EXEMPLE (contenant
« … », « AAAAMMJJ », « HHMMSS », etc.) sont volontairement ignorés.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

DOCS_CITES = [
    ROOT / "docs" / "GUIDE_NUTZER_DE.md",
    ROOT / "docs" / "RUNBOOK_BETRIEB_DE.md",
    ROOT / "docs" / "CONTRAT_BETA.md",
    ROOT / "docs" / "SAUVEGARDES_NARCHI.md",
]

EXTENSIONS = {".bat", ".ps1", ".sh", ".md", ".py"}
PREFIXES = ("scripts/", "scripts\\", "docs/", "docs\\", "infra/", "infra\\")

# Motifs d'exemple (noms de fichiers générés au runtime, jamais présents) :
# on les ignore pour ne pas signaler de faux « manquant ».
MARQUEURS_EXEMPLE = ("…", "AAAAMMJJ", "HHMMSS", "AAAA", "NNNN", "z. B.", "…bat")


def _chemins_cites(doc: Path) -> set[str]:
    texte = doc.read_text(encoding="utf-8")
    cites: set[str] = set()
    # Les noms de fichiers sont cités entre backticks dans les docs du kit.
    for token in re.findall(r"`([^`]+)`", texte):
        t = token.strip()
        if any(m in t for m in MARQUEURS_EXEMPLE):
            continue
        if t.startswith("."):  # ex. « `.bat` » (extension seule, pas un chemin)
            continue
        if any(t.lower().endswith(ext) for ext in EXTENSIONS):
            cites.add(t)
        elif t.startswith(PREFIXES):
            cites.add(t)
    return cites


def _resoudre(doc: Path, chemin: str) -> Path | None:
    """Résout un chemin cité vers un fichier du dépôt (tolère les variantes
    / vs \\, et un préfixe « scripts/ », « docs/ », « infra/ »)."""
    norm = chemin.replace("\\", "/").strip()
    candidats = [ROOT / norm]
    # si le chemin ne commence pas déjà par un dossier du dépôt, on tente
    # les emplacements usuels.
    if not norm.startswith(("scripts/", "docs/", "infra/", "backend/", "frontend/")):
        for base in ("scripts", "docs", "infra", "backend", "frontend"):
            candidats.append(ROOT / base / norm)
    for c in candidats:
        if c.is_file():
            return c
    return None


class TestKitBetaCoherence:
    @pytest.mark.parametrize("doc", DOCS_CITES, ids=lambda p: p.name)
    def test_doc_existe(self, doc: Path):
        assert doc.is_file(), f"{doc.name} manquant"

    @pytest.mark.parametrize("doc", DOCS_CITES, ids=lambda p: p.name)
    def test_chemins_cites_existent(self, doc: Path):
        manquants: list[str] = []
        for chemin in sorted(_chemins_cites(doc)):
            if _resoudre(doc, chemin) is None:
                manquants.append(chemin)
        assert not manquants, (
            f"{doc.name} cite des fichiers qui n'existent pas dans le dépôt : "
            f"{manquants} — la documentation mentirait à un bureau beta."
        )

    def test_guide_cite_les_4_sorties_erechnung(self):
        """Le guide utilisateur doit présenter les 4 sorties téléchargeables
        (§132), sinon la fonctionnalité livrée serait invisible pour le bureau."""
        texte = (ROOT / "docs" / "GUIDE_NUTZER_DE.md").read_text(encoding="utf-8")
        for sortie in ("XML (XRechnung", "PDF/A-3 (ZUGFeRD", "UBL (Peppol", "E-Mail-Entwurf"):
            assert sortie in texte, f"sortie « {sortie} » absente du guide utilisateur"

    def test_runbook_cite_les_9_scripts_operateur(self):
        """Le runbook doit citer les 9 .bat d'exploitation (1_ à 9_), sinon
        l'opérateur n'aurait pas le mode d'emploi des scripts livrés."""
        texte = (ROOT / "docs" / "RUNBOOK_BETRIEB_DE.md").read_text(encoding="utf-8")
        for i in range(1, 10):
            assert f"{i}_" in texte, f"script {i}_… non cité dans le runbook"
