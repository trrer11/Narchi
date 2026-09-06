"""Estimation éclair : transformation directe « takeoff navigateur → devis BOQ ».

Contrairement au pipeline projet complet (upload IFC → parsing → calcul), ce
point d'entrée accepte les métrés déjà extraits côté navigateur par le Worker
et renvoie immédiatement les positions agrégées par Kostengruppe (DIN 276)
avec prix régionalisés, TVA 19 %, fourchette et score de plausibilité.
"""

import re
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.auth_routes import get_current_user
from app.core.estimation.gaeb_export import build_gaeb_x31, build_gaeb_x31_kostengruppen
from app.core.estimation.price_database import PriceRegion
from app.core.estimation.quick_estimate import QuickElement, estimate_quick
from app.database import get_db
from app.middlewares.dos_guard import verify_dos_protection
from app.models.user import User
from app.services.office_price_service import tenant_price_map
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/v5/estimation", tags=["Quick Estimation DIN 276"])


class QuickElementIn(BaseModel):
    """Métré d'un élément IFC transmis par le Worker (borné anti-DoS)."""

    ifc_type: str = Field(min_length=3, max_length=64)
    name: str = Field(default="", max_length=256)
    level: str = Field(default="", max_length=64)
    material_hint: str = Field(default="", max_length=256)
    area_m2: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    volume_m3: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    length_m: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    count: int = Field(default=1, ge=0, le=100_000)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class QuickEstimateRequest(BaseModel):
    elements: List[QuickElementIn] = Field(min_length=1, max_length=20_000)
    region: PriceRegion = PriceRegion.NIEDERSACHSEN
    bgf_m2: Optional[float] = Field(default=None, gt=0, le=10_000_000)


@router.post("/quick", dependencies=[Depends(verify_dos_protection)])
def create_quick_estimate(
    req: QuickEstimateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bgf = Decimal(str(req.bgf_m2)) if req.bgf_m2 is not None else None

    # §50 — PRIORITÉ aux prix réels du bureau (indexés Destatis officiel) :
    # une seule lecture tenant, puis résolution mémoire par le moteur.
    price_map = tenant_price_map(db, tenant_id=current_user.tenant_id)
    resolver = price_map.get if price_map else None
    return estimate_quick(_to_quick_elements(req.elements), req.region, bgf, resolver)


def _to_quick_elements(items: List[QuickElementIn]) -> List[QuickElement]:
    return [
        QuickElement(
            ifc_type=item.ifc_type,
            name=item.name,
            level=item.level,
            material_hint=item.material_hint,
            net_area=Decimal(str(item.area_m2)) if item.area_m2 is not None else None,
            net_volume=Decimal(str(item.volume_m3)) if item.volume_m3 is not None else None,
            net_length=Decimal(str(item.length_m)) if item.length_m is not None else None,
            count=item.count,
            confidence=item.confidence,
        )
        for item in items
    ]


class GaebExportRequest(BaseModel):
    """Même entrée que l'estimation éclair + nom du projet pour l'export GAEB."""

    elements: List[QuickElementIn] = Field(min_length=1, max_length=20_000)
    region: PriceRegion = PriceRegion.NIEDERSACHSEN
    project_name: str = Field(default="NARCHI Kostenschätzung", min_length=1, max_length=256)


@router.post("/gaeb-x31", dependencies=[Depends(verify_dos_protection)])
def export_gaeb_x31(
    req: GaebExportRequest,
    current_user: User = Depends(get_current_user),  # noqa: ARG001 — auth requise
):
    """Exporte le devis DIN 276 au format d'échange allemand GAEB X31 (.x31)."""
    estimate = estimate_quick(_to_quick_elements(req.elements), req.region)
    xml = build_gaeb_x31(
        project_name=req.project_name.strip() or "NARCHI Kostenschätzung",
        lines=estimate["lines"],
        region=req.region.value,
    )
    slug = re.sub(r"[^A-Za-z0-9]+", "-", req.project_name).strip("-")[:60] or "narchi"
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}.x31"'},
    )


class GaebKgLineIn(BaseModel):
    """Position pauschale d'une Kostengruppe (montant netto, borné)."""

    code: str = Field(min_length=3, max_length=3, pattern=r"^\d{3}$")
    label: str = Field(min_length=1, max_length=300)
    amount: float = Field(ge=0, le=10**12)


class GaebKgGroupIn(BaseModel):
    """Une Kostengruppe (200/300/400/500/700) et ses lignes pauschales."""

    code: str = Field(min_length=3, max_length=3, pattern=r"^\d{3}$")
    label: str = Field(min_length=1, max_length=300)
    lines: List[GaebKgLineIn] = Field(min_length=1, max_length=200)


class GaebDin276Request(BaseModel):
    """Kostenschätzung DIN 276 issue du moteur (montants réels, bornés anti-DoS)."""

    project_name: str = Field(min_length=1, max_length=256)
    din276: str = Field(default="2018", pattern=r"^(2018|2008)$")
    kostengruppen: List[GaebKgGroupIn] = Field(min_length=1, max_length=12)


@router.post("/gaeb-din276", dependencies=[Depends(verify_dos_protection)])
def export_gaeb_din276(
    req: GaebDin276Request,
    current_user: User = Depends(get_current_user),  # noqa: ARG001 — auth requise
):
    """§74 — V2.5 : export GAEB X31 (DA XML 3.2) d'une Kostenschätzung DIN 276.

    Positions PAUSCHALES dont le DetailTxt porte la mention « Richtwert » —
    jamais présentées comme un devis d'exécution."""
    xml = build_gaeb_x31_kostengruppen(
        project_name=req.project_name.strip() or "NARCHI Kostenschätzung",
        din276=req.din276,
        kostengruppen=[g.model_dump() for g in req.kostengruppen],
    )
    slug = re.sub(r"[^A-Za-z0-9]+", "-", req.project_name).strip("-")[:60] or "narchi"
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-din276.x31"'},
    )
