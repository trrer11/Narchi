"""§51 — Sauvegardes pgBackRest : contrats d'infrastructure + comportement.

Le pipeline critique (backup-job.sh) est testé RÉELLEMENT : exécution bash
avec un binaire pgbackrest bouchonné, JSON produit parsé — succès ET échec.
Docker n'est pas requis pour ces tests.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / "infra" / "postgres"
COMPOSE_PATH = ROOT / "docker-compose.yml"

CRON_FIELD = r"(?:\d+|\*)(?:[-,/]\d+)*(?:,\d+(?:[-,/]\d+)*)*"


def _cron_line_pattern() -> re.Pattern:
    five_fields = r"\s+".join([CRON_FIELD] * 5)
    return re.compile(rf"^{five_fields}\s+(\S+)\s+(.+)$")


class TestInfraFilesExist:
    @pytest.mark.parametrize(
        "filename",
        [
            "Dockerfile",
            "pgbackrest.conf.template",
            "render-pgbackrest-conf.sh",
            "entrypoint-narchi-db.sh",
            "backup-job.sh",
            "backup-crontab",
        ],
    )
    def test_file_present(self, filename: str):
        assert (INFRA / filename).is_file(), f"{filename} manquant"


class TestDockerfile:
    def test_base_image_is_pinned_pgvector_pg16(self):
        text = (INFRA / "Dockerfile").read_text(encoding="utf-8")
        assert re.search(r"^FROM pgvector/pgvector:0\.8\.6-pg16\s*$", text, re.M)

    def test_installs_pgbackrest_and_cron(self):
        text = (INFRA / "Dockerfile").read_text(encoding="utf-8")
        assert "pgbackrest" in text
        assert "cron" in text
        assert "--no-install-recommends" in text

    def test_pgbackrest_log_directory_is_created(self):
        # Bug réel évité : sans /var/log/pgbackrest, stanza-create échoue au
        # premier démarrage.
        text = (INFRA / "Dockerfile").read_text(encoding="utf-8")
        assert "/var/log/pgbackrest" in text
        assert "/var/spool/pgbackrest" in text

    def test_entrypoint_and_archive_settings(self):
        text = (INFRA / "Dockerfile").read_text(encoding="utf-8")
        assert 'ENTRYPOINT ["/usr/local/bin/entrypoint-narchi-db.sh"]' in text
        assert "wal_level=replica" in text
        assert "archive_mode=on" in text
        assert "archive_timeout=300" in text
        assert "pgbackrest --stanza=narchi archive-push %p" in text


class TestPgbackrestConfTemplate:
    def test_placeholders_and_retention(self):
        text = (INFRA / "pgbackrest.conf.template").read_text(encoding="utf-8")
        assert "pg1-user=__POSTGRES_USER__" in text
        assert "pg1-database=__POSTGRES_DB__" in text
        assert "repo1-retention-full=2" in text
        assert "repo1-path=/var/lib/pgbackrest" in text

    def test_rendered_template_has_no_placeholder_left(self):
        text = (INFRA / "pgbackrest.conf.template").read_text(encoding="utf-8")
        rendered = text.replace("__POSTGRES_USER__", "narchi").replace(
            "__POSTGRES_DB__", "narchi_v3"
        )
        assert "__" not in rendered
        assert "pg1-user=narchi" in rendered
        assert "pg1-database=narchi_v3" in rendered

    def test_render_script_performs_same_substitutions(self):
        text = (INFRA / "render-pgbackrest-conf.sh").read_text(encoding="utf-8")
        assert "s|__POSTGRES_USER__|${POSTGRES_USER}|g" in text
        assert "s|__POSTGRES_DB__|${POSTGRES_DB}|g" in text
        assert "pgbackrest.conf.template" in text


class TestCrontab:
    def _entries(self):
        raw = (INFRA / "backup-crontab").read_text(encoding="utf-8")
        return [
            line.split("#", 1)[0].strip()
            for line in raw.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]

    def test_two_entries_with_valid_cron_syntax(self):
        entries = self._entries()
        assert len(entries) == 2
        pattern = _cron_line_pattern()
        for entry in entries:
            match = pattern.match(entry)
            assert match, f"ligne cron invalide : {entry!r}"
            assert match.group(1) == "postgres"

    def test_schedule_full_sunday_incr_weekdays(self):
        entries = self._entries()
        full = [entry for entry in entries if "backup-job.sh full" in entry]
        incr = [entry for entry in entries if "backup-job.sh incr" in entry]
        assert len(full) == 1 and len(incr) == 1
        assert full[0].startswith("30 3 * * 0 ")
        assert incr[0].startswith("30 3 * * 1-6 ")

    def test_output_is_logged(self):
        for entry in self._entries():
            assert "/var/lib/pgbackrest/cron.log" in entry


class TestEntrypointContract:
    def test_contract(self):
        text = (INFRA / "entrypoint-narchi-db.sh").read_text(encoding="utf-8")
        assert "set -Eeuo pipefail" in text
        assert "render-pgbackrest-conf.sh" in text
        assert "stanza-create" in text  # idempotent
        assert "NARCHI_BACKUP_CRON_ENABLED" in text
        # PID 1 doit rester postgres via l'entrypoint officiel.
        assert 'exec docker-entrypoint.sh "$@"' in text


class TestComposeWiring:
    def test_backup_volume_mounted_and_env(self):
        text = COMPOSE_PATH.read_text(encoding="utf-8")
        assert "pgbackrest_v1_data:/var/lib/pgbackrest" in text
        assert re.search(r"^  pgbackrest_v1_data:\s*$", text, re.M)
        assert "NARCHI_BACKUP_CRON_ENABLED" in text
        assert "TZ: Europe/Paris" in text

    def test_legacy_v6_volume_not_declared_anymore(self):
        text = COMPOSE_PATH.read_text(encoding="utf-8")
        # v6 protégé : non déclaré → jamais supprimé par `down -v`.
        assert not re.search(r"^  postgres_v6_data:\s*$", text, re.M)


class TestBackupJobScript:
    def test_contract_source(self):
        text = (INFRA / "backup-job.sh").read_text(encoding="utf-8")
        assert "last_backup.json" in text
        assert "exit_code" in text
        assert "--type=" in text
        assert "full|incr" in text
        # Écriture atomique : json.tmp puis mv — jamais de fichier tronqué.
        assert '.tmp' in text and "mv " in text

    @staticmethod
    def _run_script(tmp_path: Path, pgbackrest_rc: int, backup_type: str):
        """Exécute le VRAI script (chemin de sortie redirigé via sed)."""
        bash = shutil.which("bash")
        if not bash:
            pytest.skip("bash indisponible dans ce bac à sable")
        fakebin = tmp_path / "bin"
        fakebin.mkdir()
        stub = fakebin / "pgbackrest"
        stub.write_text(f"#!/usr/bin/env bash\nexit {pgbackrest_rc}\n")
        stub.chmod(0o755)
        target_dir = tmp_path / "pgbackrest"
        target_dir.mkdir()
        original = (INFRA / "backup-job.sh").read_text(encoding="utf-8")
        patched = original.replace("/var/lib/pgbackrest", str(target_dir))
        script_copy = tmp_path / "backup-job.sh"
        script_copy.write_text(patched)
        env = {"PATH": f"{fakebin}:/usr/bin:/bin"}
        proc = subprocess.run(
            [bash, str(script_copy), backup_type],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        return proc, target_dir / "last_backup.json"

    def test_success_writes_honest_json(self, tmp_path):
        proc, out = self._run_script(tmp_path, pgbackrest_rc=0, backup_type="full")
        assert proc.returncode == 0
        payload = json.loads(out.read_text(encoding="utf-8"))
        assert payload == {
            "stanza": "narchi",
            "type": "full",
            "finished_at": payload["finished_at"],
            "exit_code": 0,
        }
        assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", payload["finished_at"])

    def test_failure_is_recorded_not_hidden(self, tmp_path):
        proc, out = self._run_script(tmp_path, pgbackrest_rc=7, backup_type="incr")
        assert proc.returncode == 7
        payload = json.loads(out.read_text(encoding="utf-8"))
        assert payload["exit_code"] == 7
        assert payload["type"] == "incr"

    def test_invalid_type_rejected(self, tmp_path):
        proc, out = self._run_script(tmp_path, pgbackrest_rc=0, backup_type="bogus")
        assert proc.returncode == 64
        assert not out.exists()


class TestShellSyntax:
    @pytest.mark.parametrize(
        "script",
        ["entrypoint-narchi-db.sh", "backup-job.sh", "render-pgbackrest-conf.sh"],
    )
    def test_bash_syntax_ok(self, script: str):
        bash = shutil.which("bash")
        if not bash:
            pytest.skip("bash indisponible dans ce bac à sable")
        proc = subprocess.run(
            [bash, "-n", str(INFRA / script)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert proc.returncode == 0, proc.stderr


class TestWindowsOperatorsScripts:
    def test_backup_now_scripts(self):
        # §53 : noms français explicites (ex-BACKUP_NARCHI_NOW.*).
        ps1 = (ROOT / "scripts" / "SAUVEGARDER_LA_BASE_MAINTENANT.ps1").read_text(encoding="utf-8")
        bat = (ROOT / "scripts" / "SAUVEGARDER_LA_BASE_MAINTENANT.bat").read_text(encoding="utf-8")
        assert "narchi-backup-job.sh" in ps1
        assert "last_backup.json" in ps1  # vérité affichée, jamais devinée
        assert "SAUVEGARDER_LA_BASE_MAINTENANT.ps1" in bat

    def test_restore_scripts_are_doubly_confirmed_and_safe(self):
        # §53 : noms français explicites (ex-RESTORE_NARCHI_DB.*).
        ps1 = (ROOT / "scripts" / "RESTAURER_LA_BASE.ps1").read_text(encoding="utf-8")
        bat = (ROOT / "scripts" / "RESTAURER_LA_BASE.bat").read_text(encoding="utf-8")
        assert '--stanza=narchi --delta restore' in ps1
        # La restauration ne doit JAMAIS tourner avec postgres actif :
        assert "stop backend worker" in ps1.replace("\n", " ")
        assert "--entrypoint bash" in ps1
        # Config re-rendue dans le conteneur jetable.
        assert "render-pgbackrest-conf.sh" in ps1
        # Double confirmation explicite.
        assert "RESTAURER" in ps1 and "OUI" in ps1
        assert "RESTAURER_LA_BASE.ps1" in bat

    def test_deploy_script_migrates_v6_to_v7_without_erasing_v6(self):
        ps1 = (ROOT / "DEPLOY_PROD.ps1").read_text(encoding="utf-8")
        assert "Invoke-V6ToV7DataMigration" in ps1
        assert "postgres_v6_data" in ps1
        assert "pg_dump" in ps1 and "pg_restore" in ps1
        assert "--exit-on-error" in ps1
        # Jamais de destruction du volume LEGACY : `docker volume rm` ne peut
        # viser que le v7 partiel (artefact d'un essai interrompu), pas v6.
        for line in ps1.splitlines():
            if "volume rm" in line and not line.strip().startswith("#"):
                assert "v6" not in line, f"destruction v6 possible : {line!r}"
        # Le dump d'export est conservé sur l'hôte (preuve + repli).
        assert "narchi-v6-export" in ps1

    def test_deploy_script_migration_retries_safely_after_crash(self):
        """§54 — reprise à chaud : v7 partiel (sans marqueur) ≠ migration faite."""
        ps1 = (ROOT / "DEPLOY_PROD.ps1").read_text(encoding="utf-8")
        # Marqueur de fin écrit EN BASE après pg_restore réussi.
        assert "narchi_ops.migration_markers" in ps1
        assert "v6_to_v7" in ps1
        # Un v7 existant sans marqueur est reconstruit (événement tracé).
        assert "DB_MIGRATION_PARTIAL_V7_WIPED" in ps1
        # Les erreurs natives ne sont plus muettes : sorties capturées et
        # affichées, causes exactes dans le journal d'événements.
        for code in ("DB_MIGRATION_RUN_FAILED", "DB_MIGRATION_DUMP_FAILED", "DB_MIGRATION_RESTORE_FAILED"):
            assert code in ps1
        # Le trap d'échec affiche la cause AVANT le ZIP (rien à ouvrir).
        assert "[CAUSE]" in ps1

    def test_no_alpine_image_dependency_anywhere(self):
        """§55 — échec réel du 07/08/2026 : "No such image: postgres:16-alpine".

        La migration ET le service db-password-sync dépendaient d'une image
        externe pouvant manquer dans Docker Desktop. Désormais : zéro
        référence alpine dans le code réel (commentaires d'historique ok nulle
        part ailleurs que dans .md/CHANGELOG)."""
        ps1 = (ROOT / "DEPLOY_PROD.ps1").read_text(encoding="utf-8")
        assert "postgres:16-alpine" not in ps1
        # L'export s'appuie sur l'image NARCHI locale (toujours construite au
        # [4/8]) — jamais sur une image à télécharger.
        assert 'narchi-postgres:16-pgvector-pgbackrest' in ps1
        assert "--entrypoint docker-entrypoint.sh" in ps1
        # EAP=Stop + redirection native court-circuitait les contrôles
        # $LASTEXITCODE : la danse try/finally impose Continue dans la zone.
        assert '$ErrorActionPreference = "Continue"' in ps1
        assert "$previousEap" in ps1
        assert "} finally {" in ps1

    def test_password_sync_uses_local_image_with_psql_entrypoint(self):
        """§55 — db-password-sync ne doit plus tirer postgres:16-alpine."""
        text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        assert "image: postgres:16-alpine" not in text
        block = text.split("db-password-sync:", 1)[1].split("pgbouncer:", 1)[0]
        assert "image: narchi-postgres:16-pgvector-pgbackrest" in block
        assert 'entrypoint: ["psql"]' in block
        assert "ALTER USER" in block


class TestDockerDaemonPreflight:
    """§56 — échec réel du 07/08/2026 : daemon Docker arrêté sur le poste.

    Le [CAUSE] brut (npipe:////./pipe/dockerDesktopLinuxEngine introuvable)
    arrivait tel quel à l'écran, puis la collecte diagnostic mourait à son
    tour (NativeCommandError, ex-ligne 183) pendant que le .bat affirmait
    qu'un ZIP existait. Triple défaut corrigé + verrouillé ici."""

    @staticmethod
    def _deploy() -> str:
        return (ROOT / "DEPLOY_PROD.ps1").read_text(encoding="utf-8")

    @staticmethod
    def _collect() -> str:
        return (ROOT / "COLLECT_DIAGNOSTICS.ps1").read_text(encoding="utf-8")

    @staticmethod
    def _decoded_payload(bat_name: str) -> str:
        import base64
        text = (ROOT / bat_name).read_text(encoding="ascii")
        match = re.search(r"-EncodedCommand\s+([A-Za-z0-9+/=]+)", text)
        assert match, f"{bat_name} : bloc -EncodedCommand introuvable"
        return base64.b64decode(match.group(1)).decode("utf-16-le")

    def test_deploy_defines_daemon_probe_and_autostart(self):
        ps1 = self._deploy()
        assert "function Test-DockerDaemon" in ps1
        assert "function Ensure-DockerDaemon" in ps1

    def test_deploy_autostarts_docker_desktop_then_waits(self):
        ps1 = self._deploy()
        assert "Docker\\Docker\\Docker Desktop.exe" in ps1
        assert "Start-Process" in ps1
        assert "AddSeconds(180)" in ps1 and "Start-Sleep -Seconds 3" in ps1
        assert "DOCKER_AUTOSTART_ATTEMPT" in ps1
        assert "DOCKER_AUTOSTART_OK" in ps1

    def test_deploy_daemon_probe_neutralizes_eap_stop(self):
        body = self._deploy().split("function Test-DockerDaemon", 1)[1]
        body = body.split("function ", 1)[0]
        assert '$ErrorActionPreference = "Continue"' in body
        assert "& docker info *> $null" in body
        assert "} finally {" in body
        assert "$LASTEXITCODE -eq 0" in body

    def test_deploy_preflight_runs_before_any_install_step(self):
        ps1 = self._deploy()
        call_index = ps1.index("\nEnsure-DockerDaemon\n")
        first_step = ps1.index('Write-Step "[1/8]')
        assert call_index < first_step, "la sonde daemon doit passer AVANT [1/8]"

    def test_deploy_has_no_unwrapped_native_probe_left(self):
        ps1 = self._deploy()
        # Ancienne sonde mortelle (stderr natif + EAP=Stop) : interdite.
        assert "& docker version *> $null" not in ps1
        assert "function Test-DockerComposePlugin" in ps1

    def test_deploy_failure_messages_are_actionable(self):
        ps1 = self._deploy()
        assert "menu Demarrer" in ps1
        assert "Engine running" in ps1
        # Cause probable citée AVANT toute mention de ZIP/log.
        assert "Docker Desktop" in ps1

    def test_collect_detection_block_is_eap_safe(self):
        collect = self._collect()
        block = collect.split('Write-Ui "[2/8]', 1)[1]
        block = block.split('Add-Summary ("- Docker Desktop', 1)[0]
        assert '$ErrorActionPreference = "Continue"' in block
        assert "& docker version *> $null" in block  # toléré : DANS la danse
        assert "finally" in block

    def test_collect_disables_compose_when_daemon_down(self):
        collect = self._collect()
        idx = collect.index("if (-not $script:dockerAvailable)")
        # Sans daemon, compose est inutilisable : on force la désactivation
        # (sinon les sondes 'ps -q' hors Invoke-Capture planteraient).
        collect.index("$script:composeAvailable = $false", idx)  # lève si absent

    def test_collect_writes_docker_down_guide(self):
        collect = self._collect()
        assert "00_DOCKER_DESKTOP_ARRETE.txt" in collect
        assert "Engine running" in collect
        assert "CAUSE LA PLUS PROBABLE" in collect

    def test_start_bat_announces_zip_only_when_it_exists(self):
        bat = (ROOT / "1_DEMARRER_NARCHI.bat").read_text(encoding="ascii")
        assert 'if exist "logs\\diagnostics\\NARCHI_DIAGNOSTIC_*.zip"' in bat
        assert "deployment-latest.log" in bat
        # Ancienne affirmation mensongère (ZIP "créé" même quand la collecte
        # venait d'échouer) : bannie.
        assert "Un ZIP de diagnostic a ete cree automatiquement" not in bat

    def test_start_bat_guides_docker_desktop_first(self):
        bat = (ROOT / "1_DEMARRER_NARCHI.bat").read_text(encoding="ascii")
        assert "[CAUSE]" in bat
        assert "Docker Desktop" in bat
        assert "Engine running" in bat

    def test_quick_restart_embedded_ps_is_eap_safe(self):
        payload = self._decoded_payload("2_REDEMARRER_NARCHI_RAPIDE.bat")
        # Ancienne sonde mortelle 'docker info *>$null' nue : remplacée par
        # une fonction qui neutralise EAP=Stop.
        assert "function Test-DockerDaemon" in payload
        assert '$ErrorActionPreference="Continue"' in payload
        assert "finally" in payload
        # La séquence compose (stderr natif possible) est aussi dans la danse.
        assert "$composeRc=$LASTEXITCODE" in payload

    def test_quick_restart_autostarts_docker_and_stays_functional(self):
        payload = self._decoded_payload("2_REDEMARRER_NARCHI_RAPIDE.bat")
        assert "Docker Desktop.exe" in payload
        assert "Start-Process" in payload
        assert "AddSeconds(180)" in payload
        # Contrats historiques §53 préservés.
        assert "docker compose --env-file $envp start" in payload
        assert "up -d" in payload
        assert "DIAGNOSTIC_EN_CAS_DE_PROBLEME.bat" in payload
        assert "1_DEMARRER_NARCHI.bat" in payload
