"""§265 — Stammdaten Absender XRechnung (une fiche par bureau)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.office_sender import OfficeSender
from app.models.user import User
from app.schemas.office_sender import OfficeSenderOut, OfficeSenderUpsert
from app.services.office_sender import group_iban, normalize_sender, sender_violations

router = APIRouter(prefix="/api/v5/office-sender", tags=["Büro-Absender §265"])


def _out(row: OfficeSender | None) -> OfficeSenderOut:
    if row is None:
        empty = normalize_sender({})
        return OfficeSenderOut(
            **empty,
            iban_display="",
            ready=False,
            violations=sender_violations(empty),
            empty=True,
        )
    data = normalize_sender(
        {
            "name": row.name,
            "street": row.street,
            "zip": row.zip,
            "city": row.city,
            "country": row.country,
            "vat_id": row.vat_id,
            "iban": row.iban,
            "bic": row.bic,
            "account_name": row.account_name,
            "email": row.email,
            "contact_name": row.contact_name,
            "contact_phone": row.contact_phone,
            "contact_email": row.contact_email,
        }
    )
    viol = sender_violations(data)
    empty = not any(data[k] for k in ("name", "iban", "vat_id", "email", "street"))
    return OfficeSenderOut(
        **data,
        iban_display=group_iban(data["iban"]),
        ready=len(viol) == 0,
        violations=viol,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        updated_by=row.updated_by,
        empty=empty,
    )


@router.get("", response_model=OfficeSenderOut)
def get_sender(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.info["tenant_id"] = current_user.tenant_id
    row = db.query(OfficeSender).filter(OfficeSender.tenant_id == current_user.tenant_id).first()
    return _out(row)


@router.put("", response_model=OfficeSenderOut)
def put_sender(
    payload: OfficeSenderUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in {"owner", "admin"}:
        raise HTTPException(
            403,
            "Nur Inhaber oder Admin dürfen die Büro-Stammdaten ändern — "
            "sonst schreibt jeder eine andere USt-IdNr in die XRechnung.",
        )
    db.info["tenant_id"] = current_user.tenant_id
    data = normalize_sender(payload.model_dump())
    if data["iban"] and any(v.startswith("NARCHI-ABS-06") for v in sender_violations(data)):
        raise HTTPException(422, "IBAN unleserlich — Format prüfen, Narchi korrigiert sie nicht.")
    row = db.query(OfficeSender).filter(OfficeSender.tenant_id == current_user.tenant_id).first()
    if row is None:
        row = OfficeSender(tenant_id=current_user.tenant_id)
        db.add(row)
    for key, val in data.items():
        setattr(row, key, val)
    row.updated_by = current_user.id
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _out(row)
