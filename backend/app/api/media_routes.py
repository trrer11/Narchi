# §118 — Étape 3 de la synchro : les FICHIERS photo/vidéo eux-mêmes.
#
# Plainte client : « la synchronisation de photos et vidéos ne fonctionne
# pas ». Jusqu'ici seuls les IDENTIFIANTS voyageaient (§115 — dit). Désormais
# les blobs sont versés ici, côté serveur, dans le volume partagé existant
# (narchi_storage → /app/storage/media/<bureau>/<id>) — LA BASE n'ingère
# pas de binaire (elle reste sauvegardable en 8 ko, §113).
#
#   POST /api/v5/media/{id}   multipart : vérifie les OCTETS MAGIQUES
#                             (jamais l'extension ni le MIME déclaré),
#                             taille plafonnée par famille ;
#   GET  /api/v5/media/{id}   → le fichier (404 hors bureau, naturellement
#                             isolé par le chemin) ; idempotence : un même
#                             id ré-versé remplace, pas de doublon.
#
# Ce qui n'est PAS là, dit : pas de suppression à la volée ici — la purge
# est un acte D'EXPLOITATION explicite, pas un effet de bord d'API :
# `python -m app.services.media_purge` (§125, simulation par défaut,
# conservateur : rien qu'un appareil hors-ligne pourrait réclamer n'est
# touché, horizon 30 j) ; pas de vignettes (le fichier PART tel quel — la
# vérité avant la beauté) ; le volume médias n'est pas couvert par la
# sauvegarde PostgreSQL (§113) — jalon « sauvegarde .bat du volume
# fichiers » toujours ouvert (backlog dit, docs/PROMPT_RELEVE_IA.md).
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from starlette.responses import FileResponse

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.database import get_db  # noqa: F401  (cohérent avec les autres routes auth)
from app.models.user import User

router = APIRouter(prefix="/api/v5/media", tags=["Médias (sync étape 3) §118"])
logger = get_logger("media")

_ID_SUR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_TENANT_SUR = re.compile(r"[^A-Za-z0-9._-]+")


def _media_root() -> Path:
    return Path(os.environ.get("NARCHI_MEDIA_DIR", "/app/storage/media"))


def _photo_max() -> int:
    return int(os.environ.get("NARCHI_MEDIA_PHOTO_MAX", str(25 * 1024 * 1024)))


def _video_max() -> int:
    return int(os.environ.get("NARCHI_MEDIA_VIDEO_MAX", str(300 * 1024 * 1024)))


# Signatures d'octets RÉELLES (extension/MIME déclarés = mensonge possible).
def _detecter(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\xff\xd8\xff"):
        return ("photo", "image/jpeg")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("photo", "image/png")
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("photo", "image/webp")
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ("photo", "image/gif")
    if data.startswith(b"BM"):
        return ("photo", "image/bmp")
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return ("video", "video/webm")
    if len(data) >= 12 and data[4:8] == b"ftyp":
        marque = data[8:12]
        if marque == b"qt  ":
            return ("video", "video/quicktime")
        # isom/iso2/avc1/mp41/mp42/M4V /dash… : famille MP4
        return ("video", "video/mp4")
    return None


def _chemins(tenant_id: str, media_id: str) -> tuple[Path, Path]:
    if not _ID_SUR.match(media_id):
        raise HTTPException(status_code=422, detail="id de média illisible")
    tenant_dir = _TENANT_SUR.sub("_", tenant_id)
    base = _media_root() / tenant_dir
    return base / media_id, base / f"{media_id}.meta"


@router.post("/{media_id}", status_code=201)
async def upload_media(
    media_id: str,
    file: UploadFile,
    current_user: User = Depends(get_current_user),
):
    lu = await file.read(_video_max() + 1)
    if not lu:
        raise HTTPException(status_code=422, detail="Datei ist leer — rien à verser")
    detecte = _detecter(lu)
    if detecte is None:
        raise HTTPException(
            status_code=415,
            detail="Inhalt nicht erkannt (magic bytes) — nur echte JPG/PNG/WebP/GIF/BMP oder MP4/WebM/MOV",
        )
    kind, mime = detecte
    limite = _photo_max() if kind == "photo" else _video_max()
    if len(lu) > limite:
        raise HTTPException(
            status_code=413,
            detail=f"Datei zu groß ({len(lu)} octets > {limite} für {kind})",
        )
    chemin, meta = _chemins(current_user.tenant_id, media_id)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    # Écriture atomique : jamais de fichier tronqué visible en lecture.
    tmp = chemin.with_name(chemin.name + ".part")
    with open(tmp, "wb") as fh:
        fh.write(lu)
    os.replace(tmp, chemin)
    meta.write_text(mime, encoding="ascii")
    logger.info(
        "media.upload tenant=%s id=%s kind=%s bytes=%s",
        current_user.tenant_id, media_id, kind, len(lu),
    )
    return {"id": media_id, "kind": kind, "bytes_uploaded": len(lu)}


@router.get("/{media_id}")
def download_media(
    media_id: str,
    current_user: User = Depends(get_current_user),
):
    chemin, meta = _chemins(current_user.tenant_id, media_id)
    if not chemin.is_file():
        raise HTTPException(status_code=404, detail="Medium hier nicht vorhanden")
    mime = meta.read_text(encoding="ascii").strip() if meta.is_file() else "application/octet-stream"
    kind = "video" if mime.startswith("video/") else "photo"
    return FileResponse(
        chemin,
        media_type=mime,
        headers={"X-Narchi-Media-Kind": kind},
    )
