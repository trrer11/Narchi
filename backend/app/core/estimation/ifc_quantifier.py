"""
NARCHI V5 — IFC Quantifier.
Extrait les quantités de construction (métrés) depuis un modèle IFC.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger

logger = get_logger("estimation.ifc_quantifier")


@dataclass
class ElementQuantity:
    element_id: str
    element_type: str
    element_name: str
    level: str = "Sans niveau"
    material: str = "Non défini"
    net_length: Optional[Decimal] = None
    net_area: Optional[Decimal] = None
    gross_area: Optional[Decimal] = None
    net_volume: Optional[Decimal] = None
    gross_volume: Optional[Decimal] = None
    perimeter: Optional[Decimal] = None
    count: int = 1
    source: str = "ifc_base_quantities"
    confidence: float = 1.0
    custom_properties: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProjectQuantities:
    project_id: str
    project_name: str
    quantities_by_type: Dict[str, List[ElementQuantity]]
    totals: Dict[str, Decimal]
    warnings: List[str]
    missing_data: List[str]
    total_elements: int = 0


class IFCQuantifier:
    """Extracteur de métrés IFC simplifié (base quantities + fallback géométrique)."""

    def __init__(self, ifc_model: Any, unit_scale: float = 1.0):
        self.ifc_model = ifc_model
        self.unit_scale = unit_scale

    def quantify_project(self, project_id: str = "") -> ProjectQuantities:
        quantities_by_type: Dict[str, List[ElementQuantity]] = {}

        handlers = {
            "IfcWall": self._extract_wall_quantities,
            "IfcSlab": self._extract_slab_quantities,
            "IfcBeam": self._extract_beam_quantities,
            "IfcColumn": self._extract_column_quantities,
            "IfcWindow": self._extract_opening_quantities,
            "IfcDoor": self._extract_opening_quantities,
            "IfcSpace": self._extract_space_quantities,
        }

        for ifc_type, handler in handlers.items():
            elements = self.ifc_model.by_type(ifc_type)
            for element in elements:
                qty = handler(element)
                if qty:
                    quantities_by_type.setdefault(ifc_type, []).append(qty)

        totals = self._compute_totals(quantities_by_type)
        missing = self._detect_missing_data(quantities_by_type)

        return ProjectQuantities(
            project_id=project_id,
            project_name=self._get_project_name(),
            quantities_by_type=quantities_by_type,
            totals=totals,
            warnings=[],
            missing_data=missing,
            total_elements=sum(len(q) for q in quantities_by_type.values()),
        )

    def _extract_wall_quantities(self, wall: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(wall)
        return ElementQuantity(
            element_id=getattr(wall, "GlobalId", ""),
            element_type="IfcWall",
            element_name=getattr(wall, "Name", "Mur sans nom"),
            level=self._get_element_level(wall),
            material=self._get_primary_material(wall),
            net_length=self._to_decimal(base_qty.get("Length")),
            net_area=self._to_decimal(base_qty.get("NetSideArea")),
            net_volume=self._to_decimal(base_qty.get("NetVolume")),
            gross_volume=self._to_decimal(base_qty.get("GrossVolume")),
        )

    def _extract_slab_quantities(self, slab: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(slab)
        return ElementQuantity(
            element_id=getattr(slab, "GlobalId", ""),
            element_type="IfcSlab",
            element_name=getattr(slab, "Name", "Dalle sans nom"),
            level=self._get_element_level(slab),
            material=self._get_primary_material(slab),
            net_area=self._to_decimal(base_qty.get("NetArea")),
            gross_area=self._to_decimal(base_qty.get("GrossArea")),
            net_volume=self._to_decimal(base_qty.get("NetVolume")),
        )

    def _extract_beam_quantities(self, beam: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(beam)
        return ElementQuantity(
            element_id=getattr(beam, "GlobalId", ""),
            element_type="IfcBeam",
            element_name=getattr(beam, "Name", "Poutre"),
            level=self._get_element_level(beam),
            material=self._get_primary_material(beam),
            net_length=self._to_decimal(base_qty.get("Length")),
            net_volume=self._to_decimal(base_qty.get("NetVolume")),
            gross_volume=self._to_decimal(base_qty.get("GrossVolume")),
        )

    def _extract_column_quantities(self, column: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(column)
        return ElementQuantity(
            element_id=getattr(column, "GlobalId", ""),
            element_type="IfcColumn",
            element_name=getattr(column, "Name", "Poteau"),
            level=self._get_element_level(column),
            material=self._get_primary_material(column),
            net_length=self._to_decimal(base_qty.get("Length")),
            net_volume=self._to_decimal(base_qty.get("NetVolume")),
        )

    def _extract_opening_quantities(self, element: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(element)
        ifc_type = element.is_a()
        return ElementQuantity(
            element_id=getattr(element, "GlobalId", ""),
            element_type=ifc_type,
            element_name=getattr(element, "Name", f"{ifc_type} sans nom"),
            level=self._get_element_level(element),
            material=self._get_primary_material(element),
            net_area=self._to_decimal(base_qty.get("Area")),
            net_length=self._to_decimal(base_qty.get("Width") or base_qty.get("Height")),
            count=1,
        )

    def _extract_space_quantities(self, space: Any) -> Optional[ElementQuantity]:
        base_qty = self._get_base_quantities(space)
        return ElementQuantity(
            element_id=getattr(space, "GlobalId", ""),
            element_type="IfcSpace",
            element_name=getattr(space, "Name", getattr(space, "LongName", "Local")),
            level=self._get_element_level(space),
            material="N/A",
            net_area=self._to_decimal(base_qty.get("NetFloorArea") or base_qty.get("FloorArea")),
            gross_area=self._to_decimal(base_qty.get("GrossFloorArea")),
            net_volume=self._to_decimal(base_qty.get("NetVolume")),
            perimeter=self._to_decimal(base_qty.get("Perimeter")),
        )

    def _get_base_quantities(self, element: Any) -> Dict[str, float]:
        quantities: Dict[str, float] = {}
        try:
            for definition in getattr(element, "IsDefinedBy", []):
                if not definition.is_a("IfcRelDefinesByProperties"):
                    continue
                prop_def = definition.RelatingPropertyDefinition
                if not prop_def.is_a("IfcElementQuantity"):
                    continue
                for quantity in prop_def.Quantities:
                    name = getattr(quantity, "Name", "")
                    if quantity.is_a("IfcQuantityLength"):
                        quantities[name] = quantity.LengthValue * self.unit_scale
                    elif quantity.is_a("IfcQuantityArea"):
                        quantities[name] = quantity.AreaValue * (self.unit_scale ** 2)
                    elif quantity.is_a("IfcQuantityVolume"):
                        quantities[name] = quantity.VolumeValue * (self.unit_scale ** 3)
                    elif quantity.is_a("IfcQuantityCount"):
                        quantities[name] = quantity.CountValue
        except Exception as error:
            logger.debug("Invalid IFC quantity set", extra={"error": str(error)})
        return quantities

    def _get_element_level(self, element: Any) -> str:
        try:
            for rel in getattr(element, "ContainedInStructure", []):
                container = rel.RelatingStructure
                if container.is_a("IfcBuildingStorey"):
                    return getattr(container, "Name", getattr(container, "LongName", "Niveau inconnu"))
        except Exception as error:
            logger.debug("IFC level lookup failed", extra={"error": str(error)})
        return "Sans niveau"

    def _get_primary_material(self, element: Any) -> str:
        try:
            import ifcopenshell.util.element
            material = ifcopenshell.util.element.get_material(element)
            if material and hasattr(material, "Name"):
                return material.Name or "Inconnu"
        except Exception as error:
            logger.debug("IFC material lookup failed", extra={"error": str(error)})
        return "Non défini"

    def _compute_totals(self, quantities_by_type: Dict[str, List[ElementQuantity]]) -> Dict[str, Decimal]:
        totals: Dict[str, Decimal] = {}
        for type_name, quantities in quantities_by_type.items():
            type_area = sum((q.net_area or Decimal(0)) for q in quantities)
            type_volume = sum((q.net_volume or Decimal(0)) for q in quantities)
            type_length = sum((q.net_length or Decimal(0)) for q in quantities)
            type_count = sum(q.count for q in quantities)
            if type_area > 0:
                totals[f"{type_name}_area_m2"] = type_area
            if type_volume > 0:
                totals[f"{type_name}_volume_m3"] = type_volume
            if type_length > 0:
                totals[f"{type_name}_length_ml"] = type_length
            totals[f"{type_name}_count"] = Decimal(type_count)
        return totals

    def _detect_missing_data(self, quantities_by_type: Dict[str, List[ElementQuantity]]) -> List[str]:
        missing = []
        for type_name, quantities in quantities_by_type.items():
            no_geometry = [
                q for q in quantities
                if q.net_area is None and q.net_volume is None and q.net_length is None
            ]
            if no_geometry:
                missing.append(f"{len(no_geometry)} {type_name}(s) sans quantités géométriques")
        return missing

    def _get_project_name(self) -> str:
        try:
            return self.ifc_model.by_type("IfcProject")[0].Name or "Projet sans nom"
        except Exception:
            return "Projet inconnu"

    def _to_decimal(self, value: Optional[float]) -> Optional[Decimal]:
        if value is None:
            return None
        return Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
