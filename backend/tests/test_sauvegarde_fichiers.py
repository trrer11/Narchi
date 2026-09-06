"""§133 — Sauvegarde des FICHIERS (photos/vidéos) : export + preuve de
restauration, testés RÉELLEMENT (bash + vrai tar, hors Docker).

Complète l'export base §113 : le volume `narchi_storage` (médias §118) est
HORS de la base — un bureau qui restaure sa base mais perd le volume perd
ses preuves de chantier. Ces tests éprouvent :
  - export : tar.gz + manifeste + statut de vérité atomique (succès/échec) ;
  - intégrité : tar illisible ou incomplet = copie écartée (code 65) ;
  - volume absent = dit (pas un faux échec) ;
  - rotation : les plus anciennes partent ;
  - preuve de restauration : extraction jetable + comparaison au manifeste.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / "infra" / "backups"
EXPORT = INFRA / "export-fichiers-visible.sh"
VERIFIER = INFRA / "verifier-fichiers.sh"


def _bash() -> str | None:
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash indisponible dans ce bac à sable")
    return bash


def _faire_storage(base: Path, *, nb_bureaux: int = 2, nb_fichiers: int = 3) -> Path:
    """Crée un faux volume (structure §118 : media/<bureau>/<id>) avec des
    fichiers INCOMPRESSIBLES (os.urandom — comme de vraies photos/vidéos) :
    le tar.gz reste > MIN_BYTES (512), sinon le gzip comprimerait des
    données répétitives à quelques dizaines d'octets."""
    import os

    storage = base / "storage"
    for b in range(nb_bureaux):
        (storage / "media" / f"bureau-{b}").mkdir(parents=True)
    for i in range(nb_fichiers):
        b = i % nb_bureaux
        (storage / "media" / f"bureau-{b}" / f"f{i}.jpg").write_bytes(os.urandom(2000))
    return storage


def _run_export(storage: Path, out: Path, **env_extra) -> subprocess.CompletedProcess:
    bash = _bash()
    env = {"PATH": "/usr/bin:/bin", "STORAGE_DIR": str(storage), "OUT_DIR": str(out)}
    env.update(env_extra)
    return subprocess.run(
        [bash, str(EXPORT)],
        capture_output=True, text=True, env=env, timeout=60,
    )


class TestExportFichiers:
    def test_export_reele_manifeste_et_statut(self, tmp_path):
        storage = _faire_storage(tmp_path / "s", nb_bureaux=2, nb_fichiers=3)
        out = tmp_path / "out"
        out.mkdir()
        proc = _run_export(storage, out)
        assert proc.returncode == 0, proc.stderr
        archives = sorted(out.glob("narchi-fichiers-*.tar.gz"))
        assert len(archives) == 1
        meta = Path(str(archives[0]) + ".meta.json")
        assert meta.is_file()
        payload = json.loads(meta.read_text(encoding="utf-8"))
        assert payload["fichiers"] == 3
        assert payload["dossiers"] == 3  # media + 2 bureaux
        statut = json.loads((out / "dernier_export_fichiers.json").read_text(encoding="utf-8"))
        assert statut["exit_code"] == 0
        assert statut["fichiers"] == 3
        assert statut["fichier"].startswith("narchi-fichiers-")
        # Le tar contient réellement les 3 fichiers.
        listing = subprocess.run(
            ["tar", "-tzf", str(archives[0])], capture_output=True, text=True, timeout=30,
        )
        assert listing.returncode == 0
        entrées_fichiers = [l for l in listing.stdout.splitlines() if not l.endswith("/")]
        assert len(entrées_fichiers) == 3

    def test_volume_absent_est_dit_pas_un_faux_echec(self, tmp_path):
        out = tmp_path / "out"
        out.mkdir()
        proc = _run_export(tmp_path / "inexistant", out)
        assert proc.returncode == 0  # « rien à sauvegarder » n'est PAS un échec
        statut = json.loads((out / "dernier_export_fichiers.json").read_text(encoding="utf-8"))
        assert statut["exit_code"] == 0
        assert statut["fichiers"] == 0
        assert "absent" in proc.stdout

    def test_archive_tronquee_est_ecartee(self, tmp_path):
        storage = _faire_storage(tmp_path / "s", nb_bureaux=1, nb_fichiers=2)
        out = tmp_path / "out"
        out.mkdir()
        # MIN_BYTES énorme → toute archive « plausible » est écartée (code 65).
        proc = _run_export(storage, out, MIN_BYTES="999999999")
        assert proc.returncode == 65
        statut = json.loads((out / "dernier_export_fichiers.json").read_text(encoding="utf-8"))
        assert statut["exit_code"] == 65
        assert not list(out.glob("narchi-fichiers-*.tar.gz"))  # rien publié

    def test_rotation_garde_les_plus_recentes(self, tmp_path):
        import time

        storage = _faire_storage(tmp_path / "s", nb_bureaux=1, nb_fichiers=1)
        out = tmp_path / "out"
        out.mkdir()
        for _ in range(3):
            proc = _run_export(storage, out, KEEP="2")
            assert proc.returncode == 0, proc.stderr
            time.sleep(1.1)  # le nom porte l'horodatage à la seconde : on évite la collision
        archives = sorted(out.glob("narchi-fichiers-*.tar.gz"))
        assert len(archives) == 2  # KEEP=2 : la plus ancienne a été supprimée


class TestPreuveRestauration:
    def test_restauration_complete_identique_au_manifeste(self, tmp_path):
        storage = _faire_storage(tmp_path / "s", nb_bureaux=2, nb_fichiers=3)
        out = tmp_path / "out"
        out.mkdir()
        proc = _run_export(storage, out)
        assert proc.returncode == 0, proc.stderr
        archives = sorted(out.glob("narchi-fichiers-*.tar.gz"))
        bash = _bash()
        env = {"PATH": "/usr/bin:/bin", "OUT_DIR": str(out), "TMPDIR_ROOT": str(tmp_path / "verif")}
        v = subprocess.run(
            [bash, str(VERIFIER), str(archives[0])],
            capture_output=True, text=True, env=env, timeout=60,
        )
        assert v.returncode == 0, v.stderr
        assert "IDENTIQUE" in v.stdout

    def test_manifeste_trafique_refuse(self, tmp_path):
        storage = _faire_storage(tmp_path / "s", nb_bureaux=1, nb_fichiers=2)
        out = tmp_path / "out"
        out.mkdir()
        proc = _run_export(storage, out)
        assert proc.returncode == 0, proc.stderr
        archives = sorted(out.glob("narchi-fichiers-*.tar.gz"))
        meta = Path(str(archives[0]) + ".meta.json")
        # On trafique le manifeste (attendu 2 → 999) : la preuve doit ÉCHOUER.
        meta.write_text('{"fichiers":999,"dossiers":1,"exporte_utc":"x"}', encoding="utf-8")
        bash = _bash()
        env = {"PATH": "/usr/bin:/bin", "OUT_DIR": str(out), "TMPDIR_ROOT": str(tmp_path / "verif")}
        v = subprocess.run(
            [bash, str(VERIFIER), str(archives[0])],
            capture_output=True, text=True, env=env, timeout=60,
        )
        assert v.returncode == 1  # comparaison échoue : on ne prétend pas OK

    def test_archive_corrompue_refusee(self, tmp_path):
        storage = _faire_storage(tmp_path / "s", nb_bureaux=1, nb_fichiers=1)
        out = tmp_path / "out"
        out.mkdir()
        proc = _run_export(storage, out)
        assert proc.returncode == 0, proc.stderr
        archives = sorted(out.glob("narchi-fichiers-*.tar.gz"))
        # On corrompt l'archive (bytes inversés) : le verifier doit dire CORROMPU.
        archives[0].write_bytes(b"ceci n'est pas un tar.gz" * 100)
        bash = _bash()
        env = {"PATH": "/usr/bin:/bin", "OUT_DIR": str(out), "TMPDIR_ROOT": str(tmp_path / "verif")}
        v = subprocess.run(
            [bash, str(VERIFIER), str(archives[0])],
            capture_output=True, text=True, env=env, timeout=60,
        )
        assert v.returncode == 65
        assert "CORROMPU" in v.stderr  # verdict d'échec : sur stderr (convention §113)


class TestWiring:
    def test_compose_monte_sauvegardes_et_scripts_sur_backend(self):
        text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        assert "narchi_storage:/app/storage" in text
        assert "./infra/backups:/narchi-backup:ro" in text
        assert "./sauvegardes:/sauvegardes" in text

    def test_windows_wrappers_referencent_le_bon_script(self):
        ps1 = (ROOT / "scripts" / "SAUVEGARDER_LES_FICHIERS.ps1").read_text(encoding="ascii")
        bat = (ROOT / "scripts" / "SAUVEGARDER_LES_FICHIERS.bat").read_text(encoding="ascii")
        assert "export-fichiers-visible.sh" in ps1
        assert "dernier_export_fichiers.json" in ps1  # vérité affichée, jamais devinée
        assert "SAUVEGARDER_LES_FICHIERS.ps1" in bat
