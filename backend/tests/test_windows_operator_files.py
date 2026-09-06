"""§53 — Noms auto-explicites des fichiers opérateur Windows.

L'utilisateur ne doit plus JAMAIS hésiter sur le fichier à double-cliquer :
chaque .bat dit ce qu'il fait, les numéros 1-4 trient les actions du plus
courant au plus dangereux, et le mode destructeur a son propre fichier
(plus de /FULL_RESET caché dans un second mode du même script).

Ces tests épinglent le nommage, l'absence des anciens noms confus et la
résolution de toutes les références internes .bat → .ps1/.bat.
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Cartographie officielle §53 (ancien nom → nouveau nom).
RENAMES = {
    "DEPLOY_PROD.bat": "1_DEMARRER_NARCHI.bat",
    "RESTART_NARCHI.bat": "2_REDEMARRER_NARCHI_RAPIDE.bat",
    "RESET_AND_DEPLOY_PROD.bat": None,  # scindé en 3_ et 4_
    "COLLECT_DIAGNOSTICS.bat": "DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat",
    "AFFICHER_MES_MDP_NARCHI.bat": "AFFICHER_MES_MOTS_DE_PASSE.bat",
    "scripts/BACKUP_NARCHI_NOW.bat": "scripts/SAUVEGARDER_LA_BASE_MAINTENANT.bat",
    "scripts/BACKUP_NARCHI_NOW.ps1": "scripts/SAUVEGARDER_LA_BASE_MAINTENANT.ps1",
    "scripts/RESTORE_NARCHI_DB.bat": "scripts/RESTAURER_LA_BASE.bat",
    "scripts/RESTORE_NARCHI_DB.ps1": "scripts/RESTAURER_LA_BASE.ps1",
}

SPLIT_FILES = ["3_REPARER_NARCHI_SANS_PERTE.bat", "4_TOUT_EFFACER_ET_REDEMARRER.bat"]


def _all_bats() -> list[Path]:
    return sorted(
        p for p in ROOT.rglob("*.bat") if ".git" not in p.parts and "node_modules" not in p.parts
    )


class TestCanonicalNames:
    def test_old_confusing_names_are_gone(self):
        for old in RENAMES:
            assert not (ROOT / old).exists(), f"ancien nom encore présent : {old}"
        # Références mortes historiques (README citait des fichiers inexistants)
        for dead in ("REPAIR_OWNER_LOGIN.bat", "REPAIR_FRONTEND_LOGIN_LOOP.bat"):
            assert not (ROOT / dead).exists()

    def test_new_names_exist(self):
        for new in RENAMES.values():
            if new:
                assert (ROOT / new).is_file(), f"nouveau nom manquant : {new}"
        for split in SPLIT_FILES:
            assert (ROOT / split).is_file(), f" fichier issu de la scission manquant : {split}"

    def test_numbered_core_sequence_complete(self):
        for prefix in ("1_DEMARRER", "2_REDEMARRER", "3_REPARER", "4_TOUT_EFFACER"):
            matches = [p.name for p in ROOT.glob(f"{prefix}*.bat")]
            assert len(matches) == 1, f"préfixe {prefix} : {matches}"


class TestReaderFriendlySemantics:
    def test_daily_driver_passes_arguments_through(self):
        bat = (ROOT / "1_DEMARRER_NARCHI.bat").read_text(encoding="ascii")
        assert "DEPLOY_PROD.ps1" in bat  # moteur interne conservé sous son nom
        assert " %*" in bat  # propage -NoCache / -ResetData aux appelants 3_ et 4_

    def test_repair_keeps_data_and_rebuilds_without_cache(self):
        bat = (ROOT / "3_REPARER_NARCHI_SANS_PERTE.bat").read_text(encoding="ascii")
        assert '"%ROOT%\\1_DEMARRER_NARCHI.bat" -NoCache' in bat
        assert "-ResetData" not in bat  # JAMAIS de suppression ici
        assert "CONSERVE" in bat

    def test_full_reset_is_isolated_and_confirmed(self):
        bat = (ROOT / "4_TOUT_EFFACER_ET_REDEMARRER.bat").read_text(encoding="ascii")
        assert '"%ROOT%\\1_DEMARRER_NARCHI.bat" -ResetData -NoCache' in bat
        # Deux confirmations obligatoires avant la moindre suppression.
        assert bat.count("choice /C ON") >= 2
        assert "postgres_v6_data" in bat  # archive legacy explicitement épargnée

    def test_dangerous_file_is_shouted_not_hidden(self):
        bat = (ROOT / "4_TOUT_EFFACER_ET_REDEMARRER.bat").read_text(encoding="ascii")
        assert "DESTRUCT" in bat.upper()
        assert "SERONT PERDUES" in bat


class TestBatInternalReferencesResolve:
    """Chaque référence .bat/.ps1 écrite dans un .bat doit exister réellement."""

    REF_PATTERN = re.compile(r"(?:%\{0,2}~?dp0\\?|%ROOT%\\)?(?P<ref>[A-Za-z0-9_][A-Za-z0-9_.\\-]*\.(?:ps1|bat))")

    @pytest.mark.parametrize("bat", _all_bats(), ids=lambda p: str(p.relative_to(ROOT)))
    def test_references_exist(self, bat: Path):
        text = bat.read_text(encoding="ascii")
        # Consommer d'abord les préfixes cmd (%~dp0, %ROOT%\) qui précèdent
        # immédiatement un nom de fichier, sinon il reste un faux « dp0… ».
        text = re.sub(r"%~dp0\\?(?=[A-Za-z0-9_])", "", text)
        text = re.sub(r"%ROOT%\\(?=[A-Za-z0-9_])", "", text)
        missing = []
        for match in re.finditer(r"([A-Za-z0-9_][A-Za-z0-9_.\\-]*\.(?:ps1|bat))", text):
            ref = match.group(1).replace("\\", "/")
            candidates = [bat.parent / ref, ROOT / ref, bat.parent / ref.split("/")[-1]]
            if not any(candidate.exists() for candidate in candidates):
                missing.append(ref)
        assert not missing, f"{bat.relative_to(ROOT)} : références cassées {missing}"


class TestEmbeddedAutonomousBats:
    """Les .bat « 100% autonomes » embarquent du PowerShell en Base64 :
    il ne doit référencer AUCUN ancien nom (sinon l'utilisateur chercherait
    un fichier inexistant en cas d'erreur)."""

    @staticmethod
    def _decoded_ps(bat_path: Path) -> str:
        text = bat_path.read_text(encoding="ascii")
        match = re.search(r"-EncodedCommand\s+([A-Za-z0-9+/=]+)", text)
        assert match, f"{bat_path.name} : bloc -EncodedCommand introuvable"
        return base64.b64decode(match.group(1)).decode("utf-16-le")

    @pytest.mark.parametrize(
        "bat_name",
        ["2_REDEMARRER_NARCHI_RAPIDE.bat", "AFFICHER_MES_MOTS_DE_PASSE.bat"],
    )
    def test_embedded_ps_uses_new_names(self, bat_name: str):
        ps = self._decoded_ps(ROOT / bat_name)
        for old in ("DEPLOY_PROD.bat", "RESET_AND_DEPLOY", "COLLECT_DIAGNOSTICS.bat"):
            assert old not in ps, f"{bat_name} : ancien nom {old} dans le PS embarqué"

    def test_quick_restart_ps_is_functional(self):
        ps = self._decoded_ps(ROOT / "2_REDEMARRER_NARCHI_RAPIDE.bat")
        assert "docker compose --env-file $envp start" in ps
        assert "up -d" in ps
        assert "1_DEMARRER_NARCHI.bat" in ps  # consigne d'erreur à jour


class TestDocumentationKeptHonest:
    def test_readme_mentions_new_names_and_no_dead_reference(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        for name in (
            "1_DEMARRER_NARCHI.bat",
            "2_REDEMARRER_NARCHI_RAPIDE.bat",
            "3_REPARER_NARCHI_SANS_PERTE.bat",
            "4_TOUT_EFFACER_ET_REDEMARRER.bat",
            "SAUVEGARDER_LA_BASE_MAINTENANT.bat",
            "RESTAURER_LA_BASE.bat",
        ):
            assert name in readme, f"README ne cite pas {name}"
        # Les deux fichiers REPAIR_* n'ont jamais existé : le README ne doit
        # plus promettre leur existence.
        assert "REPAIR_OWNER_LOGIN.bat" not in readme
        assert "REPAIR_FRONTEND_LOGIN_LOOP.bat" not in readme
        # La correspondance anciens-nouveaux noms est documentée.
        assert "Correspondance avec les anciens noms" in readme
