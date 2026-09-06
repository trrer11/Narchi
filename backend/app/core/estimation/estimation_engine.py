"""
NARCHI V5 — Kalkulationskern (moteur d'estimation, marché allemand).

Combine les métrés IFC (DIN 276 / VOB-konformes Aufmaß) avec la base de
prix allemande 2026. Tous les montants sont nets (netto) hors USt 19 % ;
le coût de référence est rapporté au BGF (DIN 277) et jamais au SHON.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from .ifc_quantifier import ElementQuantity, ProjectQuantities
from .price_database import PriceItem, PriceRegion, WorkCategory

# Taux d'imposition allemand standard (§ 12 Abs. 1 UStG) — 19 %.
UST_SATZ_STANDARD = Decimal("19.00")


@dataclass
class EstimationLine:
    line_number: str
    category: str
    designation: str
    detail: str
    quantity: Decimal
    unit: str
    unit_price_ht: Decimal
    total_ht: Decimal
    tva_rate: Decimal
    total_ttc: Decimal
    material_cost_total: Optional[Decimal] = None
    labor_cost_total: Optional[Decimal] = None
    equipment_cost_total: Optional[Decimal] = None
    ifc_elements: List[str] = field(default_factory=list)
    price_item_id: Optional[str] = None
    confidence: float = 1.0
    warnings: List[str] = field(default_factory=list)


@dataclass
class EstimationSummary:
    project_id: str
    estimation_id: str
    region: str
    lines: List[EstimationLine]
    totals_by_category: Dict[str, Decimal]
    total_netto: Decimal
    total_ust: Decimal
    total_brutto: Decimal
    kosten_pro_m2_bgf: Optional[Decimal] = None
    contingency_rate: Decimal = Decimal("0.05")
    contingency_amount: Decimal = Decimal("0")
    generated_at: str = ""
    validity_months: int = 3
    exclusions: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    confidence_score: float = 0.85

    # Alias de compatibilité ascendante (lecture seule)
    @property
    def total_ht(self) -> Decimal:
        return self.total_netto

    @property
    def total_tva(self) -> Decimal:
        return self.total_ust

    @property
    def total_ttc(self) -> Decimal:
        return self.total_brutto

    @property
    def cost_per_m2_shon(self) -> Optional[Decimal]:
        return self.kosten_pro_m2_bgf


class EstimationEngine:
    """Moteur d'estimation DIN 276 à partir des métrés IFC.

    Le mapping IFC → Kostengruppe suit la structure DIN 276 KG 300/400
    et distingue les variantes de matériau via des mots-clés allemands
    et français (les modèles IFC arrivent dans les deux langues).
    """

    IFC_TO_CATEGORY: Dict[str, Dict[str, str]] = {
        "IfcWall": {
            "default": WorkCategory.KG320_ROHBAU_WAENDE,
            "beton": WorkCategory.KG320_ROHBAU_WAENDE,
            "stahlbeton": WorkCategory.KG320_ROHBAU_WAENDE,
            "béton": WorkCategory.KG320_ROHBAU_WAENDE,
            "placo": WorkCategory.KG330_INNENWAENDE,
            "gipskarton": WorkCategory.KG330_INNENWAENDE,
            "trockenbau": WorkCategory.KG330_INNENWAENDE,
            "holz": WorkCategory.KG368_HOLZBAU,
        },
        "IfcSlab": {
            "default": WorkCategory.KG340_DECKEN,
            "holz": WorkCategory.KG368_HOLZBAU,
            "bois": WorkCategory.KG368_HOLZBAU,
            "dämmung": WorkCategory.KG365_WAERMEDAEMMUNG,
        },
        "IfcBeam": {
            "default": WorkCategory.KG340_DECKEN,
            "stahl": WorkCategory.KG367_STAHLBAU,
            "acier": WorkCategory.KG367_STAHLBAU,
            "holz": WorkCategory.KG350_DACHWERK,
            "bois": WorkCategory.KG350_DACHWERK,
        },
        "IfcColumn": {
            "default": WorkCategory.KG320_ROHBAU_WAENDE,
            "stahl": WorkCategory.KG367_STAHLBAU,
            "acier": WorkCategory.KG367_STAHLBAU,
        },
        "IfcWindow": {"default": WorkCategory.KG361_FENSTER},
        "IfcDoor": {
            "default": WorkCategory.KG362_INNENTUEREN,
            "extérieur": WorkCategory.KG361_FENSTER,
            "außen": WorkCategory.KG361_FENSTER,
        },
        "IfcRoof": {
            "default": WorkCategory.KG360_DACHHAUT,
            "dämmung": WorkCategory.KG365_WAERMEDAEMMUNG,
        },
        "IfcStair": {"default": WorkCategory.KG366_TREPPEN},
        "IfcRailing": {"default": WorkCategory.KG366_TREPPEN},
        "IfcCovering": {
            "default": WorkCategory.KG363_BELAEGE_WAND,
            "boden": WorkCategory.KG364_BELAEGE_BODEN,
            "sol": WorkCategory.KG364_BELAEGE_BODEN,
            "decke": WorkCategory.KG340_DECKEN,
        },
        "IfcFooting": {"default": WorkCategory.KG310_GRUENDUNG},
        "IfcPile": {"default": WorkCategory.KG310_GRUENDUNG},
        "IfcSpace": {"default": WorkCategory.KG300_BAUWERK},
        "IfcSanitaryTerminal": {"default": WorkCategory.KG410_ABWASSER},
        "IfcFlowSegment": {"default": WorkCategory.KG410_ABWASSER},
        "IfcAirTerminal": {"default": WorkCategory.KG430_LUEFTUNG},
        "IfcDuctSegment": {"default": WorkCategory.KG430_LUEFTUNG},
        "IfcElectricDistributionBoard": {"default": WorkCategory.KG440_ELEKTRO},
        "IfcCableSegment": {"default": WorkCategory.KG440_ELEKTRO},
        "IfcBoiler": {"default": WorkCategory.KG420_HEIZUNG},
        "IfcHeatExchanger": {"default": WorkCategory.KG420_HEIZUNG},
    }

    # Prix paramétriques allemands netto (€/unité de métré), niveau « mittel »,
    # base 2026 — valeurs internes NARCHI de pilotage (ordre de grandeur
    # marché Baukosten), remplacées par les prix du tenant dès disponibilité.
    PARAMETRIC_PRICES_EUR: Dict[str, Decimal] = {
        WorkCategory.KG210_BAU_GRUND: Decimal("21.50"),          # €/m³ Aushub
        WorkCategory.KG300_BAUWERK: Decimal("260.00"),           # €/m² BGF (agrégat)
        WorkCategory.KG310_GRUENDUNG: Decimal("298.00"),         # €/m³ C30/37
        WorkCategory.KG320_ROHBAU_WAENDE: Decimal("178.00"),     # €/m³ voile/DLB
        WorkCategory.KG330_INNENWAENDE: Decimal("62.00"),        # €/m² Trockenbau
        WorkCategory.KG340_DECKEN: Decimal("335.00"),            # €/m³ dalle C30/37
        WorkCategory.KG350_DACHWERK: Decimal("92.00"),           # €/m² Dachfläche
        WorkCategory.KG360_DACHHAUT: Decimal("98.00"),           # €/m² couverture
        WorkCategory.KG361_FENSTER: Decimal("890.00"),           # €/m² menuiserie ext.
        WorkCategory.KG362_INNENTUEREN: Decimal("465.00"),       # €/pièce (Türblatt+Zarge)
        WorkCategory.KG363_BELAEGE_WAND: Decimal("48.00"),       # €/m²
        WorkCategory.KG364_BELAEGE_BODEN: Decimal("74.00"),      # €/m² (moyen)
        WorkCategory.KG365_WAERMEDAEMMUNG: Decimal("41.00"),     # €/m² WDVS 160 mm
        WorkCategory.KG366_TREPPEN: Decimal("3890.00"),          # €/cage d'escalier
        WorkCategory.KG367_STAHLBAU: Decimal("465.00"),          # €/m² construction acier
        WorkCategory.KG368_HOLZBAU: Decimal("285.00"),           # €/m² construction bois
        WorkCategory.KG400_TGA: Decimal("520.00"),               # €/m² BGF (agrégat TGA)
        WorkCategory.KG410_ABWASSER: Decimal("9150.00"),         # Pauschal / unité logement
        WorkCategory.KG420_HEIZUNG: Decimal("8200.00"),          # Pauschal / unité logement
        WorkCategory.KG430_LUEFTUNG: Decimal("6800.00"),         # Pauschal / unité logement
        WorkCategory.KG440_ELEKTRO: Decimal("7900.00"),          # Pauschal / unité logement
        WorkCategory.KG500_AUSSENANLAGEN: Decimal("55.00"),      # €/m² terrain
    }

    # Regionalfaktoren (indice de coût, base 2026, moyenne nationale = 1.000).
    REGIONAL_COEFFICIENTS: Dict[str, Decimal] = {
        PriceRegion.MUENCHEN: Decimal("1.142"),
        PriceRegion.STUTTGART: Decimal("1.124"),
        PriceRegion.FRANKFURT: Decimal("1.096"),
        PriceRegion.HAMBURG: Decimal("1.088"),
        PriceRegion.BERLIN: Decimal("1.072"),
        PriceRegion.KOELN: Decimal("1.054"),
        PriceRegion.DUESSELDORF: Decimal("1.049"),
        PriceRegion.BADEN_WUERTTEMBERG: Decimal("1.036"),
        PriceRegion.BAYERN: Decimal("1.024"),
        PriceRegion.HESSEN: Decimal("1.018"),
        PriceRegion.NORDRHEIN_WESTFALEN: Decimal("1.006"),
        PriceRegion.SCHLESWIG_HOLSTEIN: Decimal("1.002"),
        PriceRegion.RHEINLAND_PFALZ: Decimal("0.998"),
        PriceRegion.NIEDERSACHSEN: Decimal("0.994"),
        PriceRegion.BRANDENBURG: Decimal("0.968"),
        PriceRegion.SAARLAND: Decimal("0.956"),
        PriceRegion.SACHSEN: Decimal("0.934"),
        PriceRegion.MECKLENBURG_VORPOMMERN: Decimal("0.928"),
        PriceRegion.THUERINGEN: Decimal("0.921"),
        PriceRegion.SACHSEN_ANHALT: Decimal("0.918"),
    }

    def __init__(self, session: AsyncSession):
        self.session = session

    async def compute_estimation(
        self,
        project_quantities: ProjectQuantities,
        region: PriceRegion,
        tenant_id: Optional[UUID] = None,
        contingency_rate: Decimal = Decimal("0.05"),
    ) -> EstimationSummary:
        lines: List[EstimationLine] = []
        line_counter = 0

        for ifc_type, quantities in project_quantities.quantities_by_type.items():
            for qty in quantities:
                estimation_lines = await self._estimate_element(qty, region, tenant_id)
                for line in estimation_lines:
                    line_counter += 1
                    line.line_number = f"{line_counter:04d}"
                    lines.append(line)

        totals_by_category = self._aggregate_by_category(lines)
        total_netto = sum(l.total_ht for l in lines)
        total_ust = sum(l.total_ttc - l.total_ht for l in lines)
        total_brutto = sum(l.total_ttc for l in lines)
        contingency = total_netto * contingency_rate

        # Référence surfacique : BGF (DIN 277), jamais le SHON.
        total_bgf = (
            project_quantities.totals.get("IfcSlab_area_m2")
            or project_quantities.totals.get("IfcSpace_area_m2")
        )
        kosten_pro_m2_bgf = None
        if total_bgf and total_bgf > 0:
            kosten_pro_m2_bgf = (total_netto / total_bgf).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

        confidences = [l.confidence for l in lines if lines]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.5

        from datetime import datetime
        return EstimationSummary(
            project_id=project_quantities.project_id,
            estimation_id=str(uuid4()),
            region=region,
            lines=lines,
            totals_by_category=totals_by_category,
            total_netto=total_netto.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            total_ust=total_ust.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            total_brutto=total_brutto.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            kosten_pro_m2_bgf=kosten_pro_m2_bgf,
            contingency_rate=contingency_rate,
            contingency_amount=contingency.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            generated_at=datetime.utcnow().isoformat(),
            confidence_score=avg_confidence,
        )

    async def _estimate_element(
        self,
        qty: ElementQuantity,
        region: PriceRegion,
        tenant_id: Optional[UUID],
    ) -> List[EstimationLine]:
        category = self._get_category(qty.element_type, qty.material)
        quantity, unit = self._get_primary_quantity(qty, category)
        if quantity is None or quantity <= 0:
            return []

        price_item = await self._find_best_price(category, qty.element_type, qty.material, region, tenant_id)
        if price_item is None:
            price_data = self._get_parametric_price(category, region)
            confidence = 0.5
            warnings = ["Parametrischer Referenzpreis (kein Einheitspreis gefunden)"]
        else:
            price_data = {
                "unit_price_ht": price_item.unit_price_ht,
                "material_cost": price_item.material_cost or Decimal(0),
                "labor_cost": price_item.labor_cost or Decimal(0),
                "equipment_cost": price_item.equipment_cost or Decimal(0),
                "tva_rate": price_item.tva_rate or UST_SATZ_STANDARD,
            }
            confidence = float(price_item.source_confidence or 1.0) * qty.confidence
            warnings = []

        unit_price = price_data["unit_price_ht"]
        total_ht = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        tva_rate = price_data["tva_rate"]
        total_ttc = (total_ht * (1 + tva_rate / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if qty.confidence < 0.9:
            warnings.append(f"Geschätzte Menge (Genauigkeit: {qty.confidence*100:.0f}%)")

        return [EstimationLine(
            line_number="",
            category=category,
            designation=f"{qty.element_type} — {qty.element_name}",
            detail=f"Geschoss: {qty.level} | Material: {qty.material}",
            quantity=quantity,
            unit=unit,
            unit_price_ht=unit_price,
            total_ht=total_ht,
            tva_rate=tva_rate,
            total_ttc=total_ttc,
            material_cost_total=(quantity * price_data["material_cost"]).quantize(Decimal("0.01")) if price_data.get("material_cost") else None,
            labor_cost_total=(quantity * price_data["labor_cost"]).quantize(Decimal("0.01")) if price_data.get("labor_cost") else None,
            ifc_elements=[qty.element_id],
            price_item_id=str(price_item.id) if price_item else None,
            confidence=confidence,
            warnings=warnings,
        )]

    async def _find_best_price(
        self,
        category: str,
        ifc_type: str,
        material: str,
        region: PriceRegion,
        tenant_id: Optional[UUID],
    ) -> Optional[PriceItem]:
        from datetime import date
        today = date.today()

        base_query = (
            select(PriceItem)
            .where(
                and_(
                    PriceItem.category == category,
                    or_(PriceItem.valid_to.is_(None), PriceItem.valid_to >= today),
                    PriceItem.valid_from <= today,
                )
            )
            .order_by(PriceItem.source_confidence.desc())
            .limit(1)
        )

        if tenant_id:
            query = base_query.where(
                and_(
                    PriceItem.tenant_id == tenant_id,
                    PriceItem.region == region,
                    PriceItem.ifc_material_filter.ilike(f"%{material}%"),
                )
            )
            result = await self.session.execute(query)
            item = result.scalar_one_or_none()
            if item:
                return item

        query = base_query.where(
            and_(
                PriceItem.tenant_id.is_(None),
                PriceItem.region == region,
                PriceItem.ifc_material_filter.ilike(f"%{material}%"),
            )
        )
        result = await self.session.execute(query)
        item = result.scalar_one_or_none()
        if item:
            return item

        query = base_query.where(
            and_(
                PriceItem.tenant_id.is_(None),
                PriceItem.region == region,
                PriceItem.ifc_type_mapping == ifc_type,
            )
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    def _get_category(self, ifc_type: str, material: str) -> str:
        mapping = self.IFC_TO_CATEGORY.get(ifc_type, {})
        if not mapping:
            return WorkCategory.KG300_BAUWERK
        material_lower = material.lower()
        for keyword, category in mapping.items():
            if keyword != "default" and keyword in material_lower:
                return category
        return mapping.get("default", WorkCategory.KG300_BAUWERK)

    def _get_primary_quantity(
        self, qty: ElementQuantity, category: str
    ) -> Tuple[Optional[Decimal], str]:
        """Choisit l'unité de métré pertinente selon la Kostengruppe.

        Certains Gewerke se facturent au volume (béton), d'autres à la
        surface (étanchéité, cloisons) ou au ml — la règle suit les usages
        VOB plutôt qu'un ordre fixe « surface d'abord ».
        """
        volume_first = {
            WorkCategory.KG310_GRUENDUNG,
            WorkCategory.KG320_ROHBAU_WAENDE,
            WorkCategory.KG340_DECKEN,
        }
        if category in volume_first:
            if qty.net_volume is not None and qty.net_volume > 0:
                return qty.net_volume, "m³"
        if qty.net_area is not None and qty.net_area > 0:
            return qty.net_area, "m²"
        if qty.net_volume is not None and qty.net_volume > 0:
            return qty.net_volume, "m³"
        if qty.net_length is not None and qty.net_length > 0:
            return qty.net_length, "m"
        if qty.count > 0:
            return Decimal(qty.count), "St"
        return None, ""

    def _get_parametric_price(self, category: str, region: PriceRegion) -> Dict:
        base_price = self.PARAMETRIC_PRICES_EUR.get(category, Decimal("220.00"))
        coeff = self.REGIONAL_COEFFICIENTS.get(region, Decimal("0.980"))
        return {
            "unit_price_ht": (base_price * coeff).quantize(Decimal("0.01")),
            "material_cost": None,
            "labor_cost": None,
            "equipment_cost": None,
            "tva_rate": UST_SATZ_STANDARD,
        }

    def _aggregate_by_category(self, lines: List[EstimationLine]) -> Dict[str, Decimal]:
        totals: Dict[str, Decimal] = {}
        for line in lines:
            totals[line.category] = totals.get(line.category, Decimal(0)) + line.total_ht
        return totals

    async def compute_price_range(
        self,
        project_quantities: ProjectQuantities,
        region: PriceRegion,
    ) -> Tuple[Decimal, Decimal, Decimal]:
        """Fourchette de coûts (Sicherheitsabschlag +14 % standard BKI)."""
        central = await self.compute_estimation(project_quantities, region)
        low = (central.total_netto * Decimal("0.86")).quantize(Decimal("0.01"))
        high = (central.total_netto * Decimal("1.14")).quantize(Decimal("0.01"))
        return low, central.total_netto, high
