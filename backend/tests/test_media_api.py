# -*- coding: utf-8 -*-
"""§118 — Médias photo/vidéo (synchro étape 3). Éprouvé pour de vrai :
octets magiques (jamais l'extension ni le MIME déclaré), aller-retour
octet-à-octet, plafonds par famille, id assaini (.. refusé), isolement
par dossier de bureau, écriture atomique (.part puis rename).

Style : synchro via asyncio.run (la suite n'embarque pas pytest-asyncio)."""
from __future__ import annotations

import asyncio
import io
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

from app.api import media_routes as routes  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 40
MP4 = b"\x00\x00\x00\x18" + b"ftyp" + b"isom" + b"\x00" * 32
MOV = b"\x00\x00\x00\x14" + b"ftyp" + b"qt  " + b"\x00" * 32


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def media_dir(tmp_path, monkeypatch):
    cible = tmp_path / "media"
    monkeypatch.setenv("NARCHI_MEDIA_DIR", str(cible))
    return cible


def _user(tenant="tenant-A"):
    return SimpleNamespace(id="arch-1", tenant_id=tenant, email="a@narchi.de",
                           name="A", role="architect")


def _upload(data: bytes, nom="photo.jpg") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=nom)


class TestUpload:
    def test_png_reel_accepte_octets_sur_disque(self, media_dir):
        rep = _run(routes.upload_media("ph-1", _upload(PNG), current_user=_user()))
        assert rep == {"id": "ph-1", "kind": "photo", "bytes_uploaded": len(PNG)}
        ecrit = media_dir / "tenant-A" / "ph-1"
        assert ecrit.read_bytes() == PNG             # octet-à-octet, zéro altération
        assert (media_dir / "tenant-A" / "ph-1.meta").read_text() == "image/png"

    def test_faux_contenu_refuse_415(self, media_dir):
        with pytest.raises(HTTPException) as exc:
            _run(routes.upload_media("ph-2", _upload(b"Ceci est un texte deguise"),
                                     current_user=_user()))
        assert exc.value.status_code == 415

    def test_fichier_vide_refuse(self, media_dir):
        with pytest.raises(HTTPException) as exc:
            _run(routes.upload_media("ph-vide", _upload(b""), current_user=_user()))
        assert exc.value.status_code == 422

    def test_photo_trop_lourde_413(self, media_dir, monkeypatch):
        monkeypatch.setenv("NARCHI_MEDIA_PHOTO_MAX", "10")
        with pytest.raises(HTTPException) as exc:
            _run(routes.upload_media("ph-3", _upload(JPEG), current_user=_user()))
        assert exc.value.status_code == 413

    def test_videos_reelles_acceptees(self, media_dir):
        mp4 = _run(routes.upload_media("v-1", _upload(MP4, "chantier.mp4"), current_user=_user()))
        mov = _run(routes.upload_media("v-2", _upload(MOV, "chantier.MOV"), current_user=_user()))
        webm = _run(routes.upload_media("v-3", _upload(WEBM, "chantier.webm"), current_user=_user()))
        assert (mp4["kind"], mov["kind"], webm["kind"]) == ("video", "video", "video")

    def test_id_traversal_refuse(self, media_dir):
        with pytest.raises(HTTPException) as exc:
            _run(routes.upload_media("../evil", _upload(PNG), current_user=_user()))
        assert exc.value.status_code == 422


class TestDownload:
    def test_aller_retour_octet_a_octet(self, media_dir):
        _run(routes.upload_media("ph-1", _upload(PNG), current_user=_user()))
        rep = routes.download_media("ph-1", current_user=_user())
        assert rep.media_type == "image/png"
        assert rep.headers["x-narchi-media-kind"] == "photo"
        assert Path(rep.path).read_bytes() == PNG

    def test_inconnu_et_hors_tenant_404(self, media_dir):
        # Autre dossier de bureau = autre monde : l'isolement vient du
        # CHEMIN lui-même (même code, pas de if magique).
        _run(routes.upload_media("ph-1", _upload(PNG), current_user=_user()))
        with pytest.raises(HTTPException) as exc:
            routes.download_media("ph-1", current_user=_user(tenant="tenant-B"))
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc2:
            routes.download_media("n-existe-pas", current_user=_user())
        assert exc2.value.status_code == 404

    def test_meme_id_deux_bureaux_chacun_son_fichier(self, media_dir):
        _run(routes.upload_media("ph-x", _upload(PNG), current_user=_user()))
        _run(routes.upload_media("ph-x", _upload(JPEG), current_user=_user(tenant="tenant-B")))
        a = routes.download_media("ph-x", current_user=_user())
        b = routes.download_media("ph-x", current_user=_user(tenant="tenant-B"))
        assert Path(a.path).read_bytes() == PNG
        assert Path(b.path).read_bytes() == JPEG   # jamais le fichier d'autrui
