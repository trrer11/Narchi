# -*- coding: utf-8 -*-
"""§125 — Purge des médias orphelins. Éprouvé pour de vrai : on crée de
VRAIS fichiers dans un dossier temporaire, on fait vieillir leurs dates de
modification, on alimente une VRAIE base SQLite (vivants, tombes récentes,
tombes âgées), et on vérifie que l'outil ne supprime JAMAIS ce qu'un
appareil hors-ligne pourrait encore réclamer. Mode par défaut = simulation.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.database import Base  # noqa: E402
from app.models.baustelle_issue import BaustelleIssue  # noqa: E402
from app.services import media_purge  # noqa: E402

UTC = timezone.utc
MAINTENANT = time.time()


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[BaustelleIssue.__table__])
    fabrique = sessionmaker(bind=engine)
    session = fabrique()
    yield session
    session.close()


def _issue(db, *, mid="m-1", photos=(), videos=(), supprime_il_y_a_jours=None, tenant="tenant-A"):
    deleted = (
        datetime.now(UTC) - timedelta(days=supprime_il_y_a_jours)
        if supprime_il_y_a_jours is not None
        else None
    )
    db.add(
        BaustelleIssue(
            tenant_id=tenant,
            id=mid,
            project_id="p-1",
            day="2026-08-10",
            title="Riss am Fenster",
            severity="minor",
            photo_ids=list(photos),
            video_ids=list(videos),
            created_by="u1",
            deleted_at=deleted,
            updated_at=datetime.now(UTC),
        )
    )
    db.commit()


def _fichier(root: Path, tenant: str, nom: str, *, age_jours: float, avec_meta=True) -> Path:
    d = root / tenant
    d.mkdir(parents=True, exist_ok=True)
    p = d / nom
    p.write_bytes(b"\xff\xd8\xff\xe0" + bytes(range(200)))  # JPEG minimal
    if avec_meta:
        (d / f"{nom}.meta").write_text("image/jpeg", encoding="ascii")
    vieux = MAINTENANT - age_jours * 86400
    for cible in ([p, d / f"{nom}.meta"] if avec_meta else [p]):
        if cible.exists():
            os.utime(cible, (vieux, vieux))
    return p


def _refs(db):
    return media_purge.collecter_references(db)


# ---------------------------------------------------------------------------


def test_fichier_vivant_jamais_touche_meme_tres_vieux(db, tmp_path):
    _issue(db, photos=["photo-vivante"])              # Mangel vivant
    _fichier(tmp_path, "tenant-A", "photo-vivante", age_jours=365)
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert plan.candidats == [] and plan.conserves_vivants == 1


def test_tombale_recente_protege_le_fichier(db, tmp_path):
    _issue(db, photos=["photo-tombe"], supprime_il_y_a_jours=5)   # < horizon 30 j
    _fichier(tmp_path, "tenant-A", "photo-tombe", age_jours=60)
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert plan.candidats == [] and plan.conserves_tombale_recente == 1


def test_tombale_agee_libere_fichier_et_meta_simulation_puis_acte(db, tmp_path):
    _issue(db, photos=["photo-vieille"], supprime_il_y_a_jours=45)  # > horizon
    f = _fichier(tmp_path, "tenant-A", "photo-vieille", age_jours=50)
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert len(plan.candidats) == 2  # le fichier + son .meta
    assert all(media_purge.RAISON_TOMBALE == c.raison for c in plan.candidats)
    assert f.exists()  # SIMULATION : rien n'a bougé — c'est la règle d'or
    n, octets = media_purge.appliquer(plan)
    assert n == 2 and octets > 0
    assert not f.exists() and not (f.parent / "photo-vieille.meta").exists()


def test_jamais_reference_vieux_purge_mais_jeune_conserve(db, tmp_path):
    _fichier(tmp_path, "tenant-A", "orphelin-vieux", age_jours=90, avec_meta=False)
    _fichier(tmp_path, "tenant-A", "orphelin-jeune", age_jours=2, avec_meta=False)
    v, r, a = _refs(db)  # base vide : jamais référencés
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    noms = {c.chemin.name for c in plan.candidats}
    assert noms == {"orphelin-vieux"}
    assert plan.candidats[0].raison == media_purge.RAISON_JAMAIS_REF
    assert plan.conserves_trop_jeunes == 1


def test_priorite_vivant_sur_tombale_agee(db, tmp_path):
    _issue(db, mid="m-vivant", photos=["partagee"])                       # vivant
    _issue(db, mid="m-tombe", photos=["partagee"], supprime_il_y_a_jours=80)  # âgé
    _fichier(tmp_path, "tenant-A", "partagee", age_jours=100)
    v, r, a = _refs(db)
    assert "partagee" in v and "partagee" not in a  # priorité vivant, épinglée
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert plan.candidats == [] and plan.conserves_vivants == 1


def test_part_abandonne_purge_apres_24h_seulement(db, tmp_path):
    d = tmp_path / "tenant-A"
    d.mkdir(parents=True)
    vieux = d / "upload-7.part"
    vieux.write_bytes(b"xyz")
    os.utime(vieux, (MAINTENANT - 3 * 86400, MAINTENANT - 3 * 86400))  # 3 j
    frais = d / "upload-en-cours.part"
    frais.write_bytes(b"xy")
    os.utime(frais, (MAINTENANT - 3600, MAINTENANT - 3600))  # 1 h
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert [c.chemin.name for c in plan.candidats] == ["upload-7.part"]
    assert plan.candidats[0].raison == media_purge.RAISON_PART


def test_meta_orphelin_vieux_purge_et_meta_accole_indemne(db, tmp_path):
    d = tmp_path / "tenant-A"
    d.mkdir(parents=True)
    meta_seul = d / "sans-fichier.meta"
    meta_seul.write_text("image/jpeg", encoding="ascii")
    os.utime(meta_seul, (MAINTENANT - 90 * 86400, MAINTENANT - 90 * 86400))
    _fichier(tmp_path, "tenant-A", "vivant-cons", age_jours=2)  # jeune → conservé
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    noms = {c.chemin.name for c in plan.candidats}
    assert "sans-fichier.meta" in noms
    assert "vivant-cons.meta" not in noms and "vivant-cons" not in noms


def test_nom_inattendu_jamais_propose(db, tmp_path):
    _fichier(tmp_path, "tenant-A", "..traverse", age_jours=400, avec_meta=False)
    _fichier(tmp_path, "tenant-A", "note du papetier.txt", age_jours=400, avec_meta=False)
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT)
    assert plan.candidats == []
    assert len(plan.ignores_nom_inattendu) == 2  # dit, jamais touché


def test_seul_tenant_borne_la_portee(db, tmp_path):
    _fichier(tmp_path, "tenant-A", "vieux-a", age_jours=99, avec_meta=False)
    _fichier(tmp_path, "tenant-B", "vieux-b", age_jours=99, avec_meta=False)
    v, r, a = _refs(db)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT, seul_tenant="tenant-A")
    assert {c.chemin.name for c in plan.candidats} == {"vieux-a"}


def test_collecter_references_trois_horloges(db):
    _issue(db, mid="m1", photos=["vivant-x"], videos=["vivant-v"])
    _issue(db, mid="m2", photos=["recent-x"], supprime_il_y_a_jours=3)
    _issue(db, mid="m3", photos=["agee-x"], supprime_il_y_a_jours=60)
    v, r, a = media_purge.collecter_references(db, horizon_jours=30)
    assert v == {"vivant-x", "vivant-v"}
    assert r == {"recent-x"}
    assert a == {"agee-x"}


def test_horizon_parametrable_respecte(db, tmp_path):
    # Un bureau peut choisir 90 jours : ce qui est âgé à 30 j devient protégé.
    _issue(db, photos=["photo-45"], supprime_il_y_a_jours=45)
    _fichier(tmp_path, "tenant-A", "photo-45", age_jours=50)
    v, r, a = media_purge.collecter_references(db, horizon_jours=90)
    plan = media_purge.analyser(tmp_path, v, r, a, maintenant=MAINTENANT, horizon_jours=90)
    assert plan.candidats == [] and plan.conserves_tombale_recente == 1


def test_cli_simulation_par_defaut(db, tmp_path, monkeypatch, capsys):
    import app.database as appdb

    monkeypatch.setattr(appdb, "SessionLocal", sessionmaker(bind=db.get_bind()))
    _fichier(tmp_path, "tenant-A", "orphelin-cli", age_jours=100, avec_meta=False)
    rc = media_purge._main(["--root", str(tmp_path)])
    sortie = capsys.readouterr().out
    assert rc == 0
    assert "SIMULATION" in sortie and "Rien supprimé" in sortie
    assert (tmp_path / "tenant-A" / "orphelin-cli").exists()  # intact


def test_cli_supprimer_agit_et_le_dit(db, tmp_path, monkeypatch, capsys):
    import app.database as appdb

    monkeypatch.setattr(appdb, "SessionLocal", sessionmaker(bind=db.get_bind()))
    f = _fichier(tmp_path, "tenant-A", "orphelin-cli2", age_jours=100, avec_meta=False)
    rc = media_purge._main(["--root", str(tmp_path), "--supprimer"])
    sortie = capsys.readouterr().out
    assert rc == 0 and "PURGE RÉELLE" in sortie
    assert not f.exists()
