"""
NARCHI V5 — German Construction Price Database API 2026
=======================================================
Expose la base BKI/STLB-Bau/Destatis 2026 via REST API.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field

from app.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.german_price_service import GermanPriceService
from app.models.german_price import (
    DeRegion2026,
    DePriceIndex2026,
    DeLaborRate2026,
    DeMaterialPrice2026,
    DeBuildingBenchmark2026,
    DePriceItem2026,
    DeSupplier2026,
    DeSustainabilityData,
)

router = APIRouter(prefix="/api/v5/prices/de", tags=["German Construction Prices 2026"])


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class RegionResponse(BaseModel):
    code: str
    bundesland: str
    stadt: Optional[str]
    name_de: str
    name_fr: Optional[str]
    cost_index: float
    lohn_index: float
    material_index: float
    markt_lage: Optional[str]
    mietpreis_m2: Optional[float]

    model_config = ConfigDict(from_attributes=True)


class PriceIndexResponse(BaseModel):
    index_code: str
    bezeichnung: str
    basis_jahr: int
    q1_2024: Optional[float]
    q2_2024: Optional[float]
    q3_2024: Optional[float]
    q4_2024: Optional[float]
    q1_2025: Optional[float]
    q2_2025: Optional[float]
    q3_2025: Optional[float]
    q4_2025: Optional[float]
    q1_2026_est: Optional[float]
    jahres_aenderung_pct: Optional[float]

    model_config = ConfigDict(from_attributes=True)


class LaborRateResponse(BaseModel):
    gewerk_code: str
    gewerk_de: str
    gewerk_fr: Optional[str]
    mindestlohn: float
    lohn_fach_w: Optional[float]
    lohn_polier_w: Optional[float]
    svs_west: Optional[float]
    svs_muenchen: Optional[float]
    svs_frankfurt: Optional[float]
    svs_berlin: Optional[float]

    model_config = ConfigDict(from_attributes=True)


class MaterialPriceResponse(BaseModel):
    material_code: str
    bezeichnung_de: str
    bezeichnung_fr: Optional[str]
    kategorie: Optional[str]
    einheit: str
    preis_basis: float
    preis_min: Optional[float]
    preis_max: Optional[float]
    lieferant_typ: Optional[str]
    co2_kg_per_unit: Optional[float]
    recycling_pct: Optional[float]
    din_en_norm: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class BenchmarkResponse(BaseModel):
    gebaeudeart_code: str
    gebaeudeart_de: str
    gebaeudeart_fr: Optional[str]
    bgf_von_m2: Optional[int]
    bgf_bis_m2: Optional[int]
    kosten_pro_m2_basis: float
    kg_verteilung: Dict[str, float]
    typische_geschosse: Optional[int]

    model_config = ConfigDict(from_attributes=True)


class QuickEstimateRequest(BaseModel):
    gebaeudeart_code: str = Field(..., description="Code type bâtiment (EFH, MFH, BUERO, etc.)")
    bgf_m2: float = Field(..., gt=0, description="Surface brute de plancher en m²")
    region_code: str = Field(default="BW_STU", description="Code région (défaut: Stuttgart)")
    standard: str = Field(default="mittel", description="einfach, mittel, gehoben, luxus")


class QuickEstimateResponse(BaseModel):
    bgf_m2: float
    gebaeudeart: str
    region_code: str
    standard: str
    kosten_pro_m2_basis: float
    regional_faktor: float
    standard_faktor: float
    total_netto: float
    total_brutto: float
    kg_breakdown: Dict[str, float]


class IfcEstimateRequest(BaseModel):
    quantities: Dict[str, float] = Field(..., description="Quantités IFC {item_code/ifc_type: quantité}")
    region_code: str = Field(default="BW_STU")
    standard: str = Field(default="mittel")


class IfcEstimatePosition(BaseModel):
    item_code: str
    bezeichnung: str
    menge: float
    einheit: str
    preis_basis: float
    preis_regional: float
    total_ligne: float
    kg_code: Optional[str]
    co2_kg: float


class IfcEstimateResponse(BaseModel):
    region_code: str
    standard: str
    total_netto: float
    total_brutto: float
    regional_faktor: float
    standard_faktor: float
    positions: List[IfcEstimatePosition]


class RegionalPriceRequest(BaseModel):
    base_price: float
    region_code: str
    price_type: str = Field(default="total", pattern="^(total|material|labor)$")


class RegionalPriceResponse(BaseModel):
    base_price: float
    regional_factor: float
    corrected_price: float
    region_code: str
    region_name: str
    price_type: str


class SearchRequest(BaseModel):
    query: str = ""
    kg_code: Optional[str] = None
    kategorie: Optional[str] = None
    limit: int = Field(default=50, le=200)


class BuildingTypeInfo(BaseModel):
    code: str
    name_de: str
    name_fr: Optional[str]
    bgf_range: str
    base_price_m2: float


class StandardInfo(BaseModel):
    code: str
    label: str


# =============================================================================
# ENDPOINTS RÉGIONS
# =============================================================================

@router.get("/regions", response_model=List[RegionResponse])
def get_regions(
    bundesland: Optional[str] = Query(None, description="Filtrer par Land"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Liste les 38 régions tarifaires Allemagne + pays limitrophes."""
    service = GermanPriceService(db)
    regions = service.get_all_regions(bundesland)
    return regions


@router.get("/regions/{region_code}", response_model=RegionResponse)
def get_region(
    region_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Détail d'une région."""
    service = GermanPriceService(db)
    region = service.get_region(region_code)
    if not region:
        raise HTTPException(404, f"Région {region_code} non trouvée")
    return region


@router.get("/regions/simple", response_model=List[Dict[str, Any]])
def get_regions_simple(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Liste simplifiée pour UI (select)."""
    service = GermanPriceService(db)
    return service.get_available_regions()


# =============================================================================
# ENDPOINTS INDICES DESTATIS
# =============================================================================

@router.get("/indices", response_model=List[PriceIndexResponse])
def get_price_indices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Tous les indices Destatis 2026 (trimestriel 2024-2026 + estimation Q1 2026)."""
    service = GermanPriceService(db)
    return service.get_price_indices()


@router.get("/indices/{index_code}", response_model=PriceIndexResponse)
def get_price_index(
    index_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Détail d'un indice spécifique."""
    service = GermanPriceService(db)
    idx = service.get_price_index(index_code)
    if not idx:
        raise HTTPException(404, f"Indice {index_code} non trouvé")
    return idx


# =============================================================================
# ENDPOINTS TAUX HORAIRES BRTV-BAU
# =============================================================================

@router.get("/labor-rates", response_model=List[LaborRateResponse])
def get_labor_rates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Tous les taux horaires 2026 (19 métiers)."""
    service = GermanPriceService(db)
    return service.get_all_labor_rates()


@router.get("/labor-rates/{gewerk_code}", response_model=LaborRateResponse)
def get_labor_rate(
    gewerk_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Taux horaire pour un corps de métier."""
    service = GermanPriceService(db)
    rate = service.get_labor_rate(gewerk_code)
    if not rate:
        raise HTTPException(404, f"Métier {gewerk_code} non trouvé")
    return rate


@router.get("/labor-rates/{gewerk_code}/svs")
def get_svs_rate(
    gewerk_code: str,
    region: str = Query("west", pattern="^(west|ost|muenchen|frankfurt|berlin)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Stundensatz kalkulatorisch (SVS) pour un métier et une région."""
    service = GermanPriceService(db)
    svs = service.get_svs_rate(gewerk_code, region)
    if svs is None:
        raise HTTPException(404, f"SVS non disponible pour {gewerk_code} / {region}")
    return {"gewerk_code": gewerk_code, "region": region, "svs": svs}


@router.post("/labor-rates/calculate")
def calculate_labor_cost(
    gewerk_code: str = Body(...),
    hours: float = Body(..., gt=0),
    region: str = Body("west", pattern="^(west|ost)$"),
    qualification: str = Body("fach", pattern="^(helfer|fach|vorarbeiter|polier)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Calcule le coût main d'œuvre pour un métier."""
    service = GermanPriceService(db)
    cost = service.calculate_labor_cost(gewerk_code, hours, region, qualification)
    if cost is None:
        raise HTTPException(404, f"Calcul impossible pour {gewerk_code}")
    return {"gewerk_code": gewerk_code, "hours": hours, "cost": cost}


# =============================================================================
# ENDPOINTS PRIX MATÉRIAUX
# =============================================================================

@router.get("/materials", response_model=List[MaterialPriceResponse])
def search_materials(
    q: str = Query("", description="Recherche full-text"),
    kategorie: Optional[str] = Query(None, description="Filtrer par catégorie"),
    kg_code: Optional[str] = Query(None, description="Filtrer par Kostengruppe"),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Recherche full-text matériaux (pg_trgm)."""
    service = GermanPriceService(db)
    return service.search_materials(q, kategorie, kg_code, limit)


@router.get("/materials/{material_code}", response_model=MaterialPriceResponse)
def get_material(
    material_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Détail d'un matériau."""
    service = GermanPriceService(db)
    mat = service.get_material_price(material_code)
    if not mat:
        raise HTTPException(404, f"Matériau {material_code} non trouvé")
    return mat


@router.get("/materials/category/{kategorie}", response_model=List[MaterialPriceResponse])
def get_materials_by_category(
    kategorie: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Matériaux par catégorie (Beton, Bewehrung, Mauerwerk, Daemmung, Holz, Stahl, etc.)."""
    service = GermanPriceService(db)
    return service.get_materials_by_category(kategorie)


@router.get("/materials/{material_code}/co2")
def get_material_co2(
    material_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """kg CO2e par unité pour un matériau."""
    service = GermanPriceService(db)
    co2 = service.get_material_co2(material_code)
    if co2 is None:
        raise HTTPException(404, f"CO2 non disponible pour {material_code}")
    return {"material_code": material_code, "co2_kg_per_unit": co2}


# =============================================================================
# ENDPOINTS BENCHMARKS BÂTIMENTS
# =============================================================================

@router.get("/benchmarks", response_model=List[BenchmarkResponse])
def get_benchmarks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Tous les benchmarks DIN 276 par type de bâtiment."""
    service = GermanPriceService(db)
    return service.get_all_benchmarks()


@router.get("/building-types", response_model=List[BuildingTypeInfo])
def get_building_types(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Types de bâtiments disponibles pour estimation rapide."""
    service = GermanPriceService(db)
    return service.get_building_types()


# =============================================================================
# ENDPOINTS ESTIMATION RAPIDE
# =============================================================================

@router.post("/estimate/quick", response_model=QuickEstimateResponse)
def quick_estimate(
    req: QuickEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Estimation rapide par type de bâtiment.
    Utilise la fonction SQL de_quick_estimate_2026().
    """
    service = GermanPriceService(db)
    try:
        result = service.quick_estimate(
            req.gebaeudeart_code,
            req.bgf_m2,
            req.region_code,
            req.standard
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/estimate/from-ifc", response_model=IfcEstimateResponse)
def estimate_from_ifc(
    req: IfcEstimateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Estimation depuis quantités IFC.
    Clés acceptées : item_code STLB, ifc_type, ifc_entity.
    """
    service = GermanPriceService(db)
    try:
        result = service.estimate_from_ifc_quantities(
            req.quantities,
            req.region_code,
            req.standard
        )
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))


# =============================================================================
# ENDPOINTS PRIX RÉGIONAL CORRIGÉ
# =============================================================================

@router.post("/regional-price", response_model=RegionalPriceResponse)
def get_regional_price(
    req: RegionalPriceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Corrige un prix de base selon la région."""
    service = GermanPriceService(db)
    result = service.correct_price_for_region(
        req.base_price,
        req.region_code,
        req.price_type
    )
    return result


# =============================================================================
# ENDPOINTS RECHERCHE PRIX
# =============================================================================

@router.post("/search", response_model=List[MaterialPriceResponse])
def search_prices(
    req: SearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Recherche full-text prix matériaux."""
    service = GermanPriceService(db)
    return service.search_prices(req.query, req.kg_code, req.kategorie, req.limit)


@router.get("/items/kg/{kg_code}")
def get_price_items_by_kg(
    kg_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Items STLB-Bau par Kostengruppe."""
    service = GermanPriceService(db)
    return service.get_price_items_by_kg(kg_code)


@router.get("/items/{item_code}")
def get_price_item(
    item_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Item STLB par son code."""
    service = GermanPriceService(db)
    item = service.get_price_item(item_code)
    if not item:
        raise HTTPException(404, f"Item {item_code} non trouvé")
    return item


@router.get("/items/ifc/{ifc_entity}")
def get_price_items_by_ifc(
    ifc_entity: str,
    ifc_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Items STLB mappés sur une entité/type IFC."""
    service = GermanPriceService(db)
    return service.get_price_items_by_ifc(ifc_entity, ifc_type)


# =============================================================================
# ENDPOINTS DURABILITÉ & FOURNISSEURS
# =============================================================================

@router.get("/materials/{material_code}/sustainability")
def get_sustainability(
    material_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Données EPD/GWP pour un matériau (EN 15804+A2)."""
    service = GermanPriceService(db)
    data = service.get_sustainability_data(material_code)
    if not data:
        raise HTTPException(404, f"Données durabilité non disponibles pour {material_code}")
    return data


@router.get("/materials/{material_code}/suppliers")
def get_suppliers_for_material(
    material_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fournisseurs proposant un matériau."""
    service = GermanPriceService(db)
    return service.get_suppliers_for_material(material_code)


# =============================================================================
# ENDPOINTS MÉTADONNÉES
# =============================================================================

@router.get("/standards", response_model=List[StandardInfo])
def get_standards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Standards disponibles pour estimation."""
    return [{"code": s, "label": s.capitalize()} for s in ["einfach", "mittel", "gehoben", "luxus"]]


@router.get("/kostengruppen")
def get_kostengruppen(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Liste des Kostengruppen DIN 276."""
    service = GermanPriceService(db)
    return service.get_kostengruppen()


@router.get("/gewerke")
def get_gewerke(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Corps de métier (Gewerke) disponibles."""
    service = GermanPriceService(db)
    return service.get_gewerke()


@router.get("/categories")
def get_material_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Catégories de matériaux disponibles."""
    sql = """
        SELECT DISTINCT kategorie FROM de_material_prices_2026
        WHERE kategorie IS NOT NULL ORDER BY kategorie
    """
    result = db.execute(text(sql))
    return [row[0] for row in result]