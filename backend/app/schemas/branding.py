"""§77 — Schémas du branding bureau (logo + nom pour le PDF « waw »)."""

from typing import Optional

from pydantic import BaseModel, Field


class BrandingUpsertIn(BaseModel):
    """État COMPLET voulu — null retire le champ. Jamais de fusion opaque :
    le frontend renvoie l'état courant complet (GET → édition → PUT)."""

    office_name: Optional[str] = Field(default=None, max_length=120)
    # Garde-fou transport (~large) ; la VRAIE limite (512 ko BINAIRES) et les
    # octets magiques sont vérifiés après décodage dans la route.
    logo_data_url: Optional[str] = Field(default=None, max_length=1_500_000)


class BrandingLogoOut(BaseModel):
    mime: str
    bytes: int
    data_url: str


class BrandingOut(BaseModel):
    """Lecture honnête : tous champs à null si jamais configuré."""

    office_name: Optional[str] = None
    logo: Optional[BrandingLogoOut] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
