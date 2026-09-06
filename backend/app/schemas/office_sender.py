from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class OfficeSenderUpsert(BaseModel):
    name: str = Field(default="", max_length=300)
    street: str = Field(default="", max_length=300)
    zip: str = Field(default="", max_length=20)
    city: str = Field(default="", max_length=120)
    country: str = Field(default="DE", max_length=2)
    vat_id: str = Field(default="", max_length=30)
    iban: str = Field(default="", max_length=42)
    bic: str = Field(default="", max_length=11)
    account_name: str = Field(default="", max_length=300)
    email: str = Field(default="", max_length=300)
    contact_name: str = Field(default="", max_length=300)
    contact_phone: str = Field(default="", max_length=100)
    contact_email: str = Field(default="", max_length=300)


class OfficeSenderOut(BaseModel):
    name: str = ""
    street: str = ""
    zip: str = ""
    city: str = ""
    country: str = "DE"
    vat_id: str = ""
    iban: str = ""
    iban_display: str = ""
    bic: str = ""
    account_name: str = ""
    email: str = ""
    contact_name: str = ""
    contact_phone: str = ""
    contact_email: str = ""
    ready: bool = False
    violations: List[str] = Field(default_factory=list)
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    empty: bool = True
