"""§116 — Schémas de l'API Factures / E-Rechnung.

Argent = CHAÎNES décimales (« 123.45 »), positives, ≤ 6 décimales : un
float JSON serait silencieusement arrondi par IEEE 754 — interdit chez
Narchi (règle §114, tenue jusque dans le contrat d'API). Les dates sont
des chaînes ISO « AAAA-MM-JJ » contrôlées, jamais de texte libre.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.services.xrechnung import CATEGORIES_TVA_SUPPORTEES, UNITE_CODES

_DATE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DECIMAL_6 = re.compile(r"^\d{1,12}(\.\d{1,6})?$")
_PAYS = re.compile(r"^[A-Z]{2}$")
_DEVISE = re.compile(r"^[A-Z]{3}$")


def _decimal_6(v: str, nom: str) -> str:
    """Chaîne décimale SANS signe, ≤ 6 décimales — sinon ValueError propre."""
    if not isinstance(v, str) or not _DECIMAL_6.match(v):
        raise ValueError(
            f"{nom}: chaîne décimale positive attendue « 123.45 » (≤ 6 décimales), reçu « {v} »"
        )
    return v


class InvoiceLineIn(BaseModel):
    """Une ligne de facture (BG-25). Unité contrôlée DÈS LA SAISIE : la
    table supportée est honnêtement courte (§114) — mieux vaut un 422
    explicite qu'un XML refusé plus tard."""

    designation: str = Field(min_length=1, max_length=500)
    quantite: str
    unite: str
    prix_unitaire_ht: str
    taux_tva: str
    categorie_tva: str = "S"

    @field_validator("quantite")
    @classmethod
    def _qte(cls, v: str) -> str:
        v = _decimal_6(v, "quantite")
        if Decimal(v) <= 0:
            raise ValueError("quantite: > 0 exigé (0 = rien à facturer)")
        return v

    @field_validator("prix_unitaire_ht")
    @classmethod
    def _prix(cls, v: str) -> str:
        return _decimal_6(v, "prix_unitaire_ht")

    @field_validator("taux_tva")
    @classmethod
    def _taux(cls, v: str) -> str:
        v = _decimal_6(v, "taux_tva")
        if Decimal(v) > 100:
            raise ValueError("taux_tva: > 100 % n'existe pas")
        return v

    @field_validator("unite")
    @classmethod
    def _unite(cls, v: str) -> str:
        if v not in UNITE_CODES:
            raise ValueError(
                f"unite « {v} » hors table supportée {sorted(UNITE_CODES)} (BT-130) — élargissement sur besoin réel"
            )
        return v

    @field_validator("categorie_tva")
    @classmethod
    def _categorie(cls, v: str) -> str:
        if v not in CATEGORIES_TVA_SUPPORTEES:
            raise ValueError(
                f"categorie_tva « {v} » non supportée §114-116 (supporté : S) — on le dit au lieu de mapper au hasard"
            )
        return v


class InvoiceUpsert(BaseModel):
    """Création/édition d'un BROUILLON. Perroquet minimal : buyer_name +
    au moins une ligne. Tout le reste peut rester vide — le rapport de
    validation dit précisément ce qui manque AVANT l'émission."""

    buyer_name: str = Field(min_length=1, max_length=300)
    buyer_street: str = Field(default="", max_length=300)
    buyer_zip: str = Field(default="", max_length=20)
    buyer_city: str = Field(default="", max_length=120)
    buyer_country: str = Field(default="DE")
    buyer_reference: str = Field(default="", max_length=100)  # Leitweg-ID

    seller_name: str = Field(default="", max_length=300)
    seller_street: str = Field(default="", max_length=300)
    seller_zip: str = Field(default="", max_length=20)
    seller_city: str = Field(default="", max_length=120)
    seller_country: str = Field(default="DE")
    seller_vat_id: str = Field(default="", max_length=30)
    # §123 — champs mesurés obligatoires par le validateur officiel KoSIT
    # (XRechnung 3.0.2) : compte de règlement (BG-16, BR-DE-1), adresses
    # électroniques (BT-34/BT-49, Peppol R010/R020), contact vendeur
    # (BG-6, BR-DE-2), processus métier (BT-23, R005 — valeur canonique
    # PEPPOL billing proposée, modifiable ; DITE, jamais masquée).
    seller_iban: str = Field(default="", max_length=34)
    seller_bic: str = Field(default="", max_length=11)
    seller_account_name: str = Field(default="", max_length=300)
    seller_email: str = Field(default="", max_length=300)
    buyer_email: str = Field(default="", max_length=300)
    seller_contact_name: str = Field(default="", max_length=300)
    seller_contact_phone: str = Field(default="", max_length=100)
    seller_contact_email: str = Field(default="", max_length=300)
    processus: str = Field(
        default="urn:fdc:peppol.eu:2017:poacc:billing:01:1.0", max_length=300
    )

    currency: str = Field(default="EUR")
    project_id: Optional[str] = Field(default=None, max_length=64)

    delivery_date: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    due_date: Optional[str] = None

    notes: List[str] = Field(default_factory=list, max_length=10)
    lines: List[InvoiceLineIn] = Field(min_length=1, max_length=200)

    @field_validator("buyer_country", "seller_country")
    @classmethod
    def _pays(cls, v: str) -> str:
        if not _PAYS.match(v):
            raise ValueError(f"pays: code ISO alpha-2 MAJUSCULE attendu (« DE »), reçu « {v} »")
        return v

    @field_validator("currency")
    @classmethod
    def _devise(cls, v: str) -> str:
        if not _DEVISE.match(v):
            raise ValueError(f"currency: code ISO 3 lettres attendu (« EUR »), reçu « {v} »")
        return v

    @field_validator("delivery_date", "period_start", "period_end", "due_date")
    @classmethod
    def _dates(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _DATE_ISO.match(v):
            raise ValueError(f"date « {v} » invalide — format AAAA-MM-JJ exigé")
        return v

    @field_validator("notes")
    @classmethod
    def _notes(cls, v: List[str]) -> List[str]:
        for n in v:
            if not n.strip() or len(n) > 1000:
                raise ValueError("note vide ou > 1000 caractères")
        return v

    def lignes_decimal(self) -> List[tuple[Decimal, Decimal, Decimal]]:
        """(quantite, prix, taux) en Decimal — jamais de float en sortie."""
        out: List[tuple[Decimal, Decimal, Decimal]] = []
        for li in self.lines:
            try:
                out.append((Decimal(li.quantite), Decimal(li.prix_unitaire_ht), Decimal(li.taux_tva)))
            except InvalidOperation as exc:  # garde-fou (validateurs déjà passés)
                raise ValueError("décimal illisible") from exc
        return out


class InvoiceOut(BaseModel):
    id: str
    status: Literal["draft", "issued", "cancelled"]
    rechnungsnummer: Optional[str]
    issue_date: Optional[str]
    profile: str
    project_id: Optional[str]
    buyer_name: str
    buyer_street: str
    buyer_zip: str
    buyer_city: str
    buyer_country: str
    buyer_reference: str
    seller_name: str
    seller_street: str
    seller_zip: str
    seller_city: str
    seller_country: str
    seller_vat_id: str
    seller_iban: str
    seller_bic: str
    seller_account_name: str
    seller_email: str
    buyer_email: str
    seller_contact_name: str
    seller_contact_phone: str
    seller_contact_email: str
    processus: str
    currency: str
    delivery_date: Optional[str]
    period_start: Optional[str]
    period_end: Optional[str]
    due_date: Optional[str]
    lines: List[InvoiceLineIn]
    notes: List[str]
    total_net: str
    total_tva: str
    total_brut: str
    created_by: str
    created_at: Optional[datetime]
    updated_at: datetime
    issued_at: Optional[datetime]
    cancelled_at: Optional[datetime]
    cancel_reason: str
    kosit_last: Optional[dict] = None
    kosit_checked_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class InvoiceListResponse(BaseModel):
    invoices: List[InvoiceOut]
    total: int  # compteur de CETTE page — dit honnêtement (limit appliqué)


class ValidationReport(BaseModel):
    """Bilan de conformité EN 16931/XRechnung AVANT émission. ok=False →
    la liste des violations NOMMÉES (codes NARCHI-XR-… §114), jamais un
    vague « invalide »."""

    ok: bool
    violations: List[str]


class CancelRequest(BaseModel):
    reason: str = Field(default="", max_length=500)
