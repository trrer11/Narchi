"""§77 — API Branding du bureau : le logo TON logo sur le PDF Kostenschätzung.

Honnêteté gravée dans le code :
- PNG/JPEG vérifiés par OCTETS MAGIQUES — ni extension ni Content-Type ne
  suffisent ; un faux PNG est rejeté AVEC la raison ;
- plafond 512 ko BINAIRES (un logo de couverture n'a jamais besoin de plus) ;
- SVG REFUSÉ explicitement — il peut embarquer un <script> (XSS) ;
- écriture = état complet (null retire), jamais de PATCH ambigu ;
- lecture pour tout le bureau ; écriture réservée au propriétaire (owner).
"""

import base64
import binascii
import re
from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.middlewares.dos_guard import verify_dos_protection
from app.models.tenant_branding import TenantBranding
from app.models.user import User
from app.schemas.branding import BrandingLogoOut, BrandingOut, BrandingUpsertIn

router = APIRouter(prefix="/api/v5/branding", tags=["Büro-Branding (PDF-Logo)"])

MAX_LOGO_BYTES = 512 * 1024  # 512 ko binaires — même limite annoncée dans l'UI
_DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$")
_MAGIC = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}


def _row_for(db: Session, tenant_id: str) -> Optional[TenantBranding]:
    return db.execute(
        select(TenantBranding).where(TenantBranding.tenant_id == tenant_id)
    ).scalars().first()


def _to_out(row: Optional[TenantBranding]) -> BrandingOut:
    if row is None:
        return BrandingOut()
    logo = None
    if row.logo_mime and row.logo_b64:
        logo = BrandingLogoOut(
            mime=row.logo_mime,
            bytes=int(row.logo_bytes or 0),
            data_url=f"data:{row.logo_mime};base64,{row.logo_b64}",
        )
    return BrandingOut(
        office_name=row.office_name,
        logo=logo,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        updated_by=row.updated_by,
    )


def _decode_logo(data_url: str) -> Tuple[str, bytes, str]:
    """Décode et VALIDE un data-URL logo. Chaque rejet porte sa raison —
    l'utilisateur corrige au lieu de deviner."""
    match = _DATA_URL_RE.match(data_url.strip())
    if not match:
        raise HTTPException(
            422,
            "Format refusé : seuls PNG et JPEG (data:…;base64,…) sont acceptés — "
            "SVG aus Sicherheitsgründen nicht (Skript-Risiko).",
        )
    mime, payload = match.group(1), match.group(2)
    try:
        raw = base64.b64decode(payload, validate=True)
    except binascii.Error:
        raise HTTPException(422, "Base64 ungültig — Datei beschädigt oder manipuliert.")
    if len(raw) > MAX_LOGO_BYTES:
        raise HTTPException(
            422,
            f"Logo zu groß: {len(raw)} B > {MAX_LOGO_BYTES} B (max. 512 kB, "
            "wie in den Einstellungen angegeben).",
        )
    if not raw.startswith(_MAGIC[mime]):
        raise HTTPException(
            422,
            f"Inhalt ist kein echtes {mime.split('/')[1].upper()} — geprüft per "
            "Magic-Bytes, nicht per Dateiname.",
        )
    return mime, raw, payload


@router.get("", response_model=BrandingOut)
def get_branding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Branding du tenant — nulls honnêtes si jamais configuré."""
    return _to_out(_row_for(db, current_user.tenant_id))


@router.put("", response_model=BrandingOut,
            dependencies=[Depends(verify_dos_protection)])
def put_branding(
    payload: BrandingUpsertIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Écrit l'état COMPLET (upsert) : null retire le champ correspondant —
    c'est ainsi que « Logo entfernen » fonctionne, sans route cachée."""
    if current_user.role != "owner":
        raise HTTPException(
            403, "Nur der Büro-Eigentümer (owner) darf das Branding ändern."
        )

    office_name = (payload.office_name or "").strip() or None

    logo_mime: Optional[str] = None
    logo_b64: Optional[str] = None
    logo_bytes: Optional[int] = None
    if payload.logo_data_url is not None:
        logo_mime, raw, logo_b64 = _decode_logo(payload.logo_data_url)
        logo_bytes = len(raw)

    row = _row_for(db, current_user.tenant_id)
    if row is None:
        row = TenantBranding(tenant_id=current_user.tenant_id)
        db.add(row)
    row.office_name = office_name
    row.logo_mime = logo_mime
    row.logo_b64 = logo_b64
    row.logo_bytes = logo_bytes
    row.updated_by = current_user.id
    row.updated_at = datetime.now(timezone.utc)  # posé ici : déterministe, testé
    db.commit()
    return _to_out(row)
