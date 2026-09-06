"""§265 — Une fiche Absender par bureau (XRechnung). Snapshot reste sur la facture."""
from __future__ import annotations

from sqlalchemy import Column, DateTime, PrimaryKeyConstraint, String

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class OfficeSender(HasTenantColumn, Base):
    __tablename__ = "office_senders"

    name = Column(String(300), nullable=False, default="")
    street = Column(String(300), nullable=False, default="")
    zip = Column(String(20), nullable=False, default="")
    city = Column(String(120), nullable=False, default="")
    country = Column(String(2), nullable=False, default="DE")
    vat_id = Column(String(30), nullable=False, default="")
    iban = Column(String(34), nullable=False, default="")
    bic = Column(String(11), nullable=False, default="")
    account_name = Column(String(300), nullable=False, default="")
    email = Column(String(300), nullable=False, default="")
    contact_name = Column(String(300), nullable=False, default="")
    contact_phone = Column(String(100), nullable=False, default="")
    contact_email = Column(String(300), nullable=False, default="")
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (PrimaryKeyConstraint("tenant_id"),)
