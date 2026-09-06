"""
revit_reader · Liest die Bauteile aus einem aktiven Revit-Dokument
und produziert einen NARCHI-kompatiblen pandas-DataFrame.

Verwendet die Revit-API direkt über pyRevit's `revit` Modul.
Funktioniert in Revit 2021-2026.

Wichtige Revit-API-Klassen verwendet:
  - FilteredElementCollector  : alle Bauteile holen
  - BuiltInCategory           : Filter nach Architektur-Kategorien
  - Element.LookupParameter   : Parameter-Werte lesen
  - HostObjectUtils           : Wand-Außen/Innen-Erkennung
  - Material.MaterialClass    : Material-Info
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional

# pyRevit / Revit API imports (gegen IronPython 2.7 oder CPython 3.x kompatibel)
try:
    from pyrevit import revit, DB, script
    from pyrevit.compat import get_elementid_value_func
    HAS_REVIT = True
except ImportError:
    HAS_REVIT = False
    # Fallback Stub für Tests ohne Revit
    class _Stub:
        def __getattr__(self, name): return _Stub()
        def __call__(self, *a, **kw): return _Stub()
    revit = DB = script = _Stub()
    def get_elementid_value_func(): return lambda x: 0


# Mapping Revit BuiltInCategory → NARCHI Class + KG-hint
REVIT_CATEGORY_MAP = {
    # KG 300 Baukonstruktion
    "OST_Walls":               ("IfcWall",             None),       # IsExternal entscheidet
    "OST_Floors":              ("IfcSlab",             "FLOOR"),
    "OST_Roofs":               ("IfcRoof",             None),
    "OST_StructuralFoundation":("IfcFooting",          "FOOTING_BEAM"),
    "OST_StructuralColumns":   ("IfcColumn",           None),
    "OST_Columns":             ("IfcColumn",           None),
    "OST_StructuralFraming":   ("IfcBeam",             None),
    "OST_Doors":               ("IfcDoor",             None),
    "OST_Windows":             ("IfcWindow",           None),
    "OST_Stairs":              ("IfcStair",            None),
    "OST_StairsRailing":       ("IfcRailing",          None),
    "OST_Ramps":               ("IfcRamp",             None),
    "OST_CurtainWallPanels":   ("IfcCurtainWall",      None),
    "OST_CurtainWallMullions": ("IfcMember",           "MULLION"),
    # KG 400 Technische Anlagen
    "OST_PipeCurves":          ("IfcPipeSegment",      None),
    "OST_PipeFitting":         ("IfcPipeFitting",      None),
    "OST_DuctCurves":          ("IfcDuctSegment",      None),
    "OST_DuctFitting":         ("IfcDuctFitting",      None),
    "OST_DuctTerminal":        ("IfcAirTerminal",      None),
    "OST_CableTray":           ("IfcCableCarrierSegment", None),
    "OST_Conduit":             ("IfcCableCarrierSegment", None),
    "OST_LightingFixtures":    ("IfcLightFixture",     None),
    "OST_LightingDevices":     ("IfcLightFixture",     None),
    "OST_PlumbingFixtures":    ("IfcSanitaryTerminal", None),
    "OST_ElectricalFixtures":  ("IfcOutlet",           None),
    "OST_ElectricalEquipment": ("IfcSwitchingDevice",  None),
    "OST_MechanicalEquipment": ("IfcUnitaryEquipment", None),
    # KG 600 Ausstattung
    "OST_Furniture":           ("IfcFurniture",        None),
    "OST_FurnitureSystems":    ("IfcSystemFurnitureElement", None),
    "OST_Casework":            ("IfcFurniture",        None),
    "OST_SpecialityEquipment": ("IfcFurniture",        None),
    # Räume
    "OST_Rooms":               ("IfcSpace",            None),
    "OST_MEPSpaces":           ("IfcSpace",            None),
    # KG 500 Außenanlagen
    "OST_Site":                ("IfcSite",             None),
    "OST_Planting":            ("IfcGeographicElement","TERRAIN"),
    "OST_Parking":             ("IfcTransportElement", "PARKING"),
}


def _get_param_double(elem, builtin_param) -> Optional[float]:
    """Liest einen numerischen Parameter (Length, Area, Volume) — sicher."""
    try:
        p = elem.get_Parameter(builtin_param)
        if p and p.HasValue:
            return p.AsDouble()
    except Exception:
        pass
    return None


def _get_param_string(elem, builtin_param) -> Optional[str]:
    """Liest einen String-Parameter."""
    try:
        p = elem.get_Parameter(builtin_param)
        if p and p.HasValue:
            return p.AsString() or p.AsValueString()
    except Exception:
        pass
    return None


def _get_named_param(elem, name: str) -> Optional[Any]:
    """Liest einen Parameter anhand seines deutschen oder englischen Namens."""
    try:
        p = elem.LookupParameter(name)
        if not p or not p.HasValue:
            return None
        st = p.StorageType
        if str(st) == "Double":
            return p.AsDouble()
        elif str(st) == "Integer":
            return p.AsInteger()
        elif str(st) == "String":
            return p.AsString()
        elif str(st) == "ElementId":
            return p.AsElementId().IntegerValue
    except Exception:
        pass
    return None


def _is_wall_external(elem, doc) -> Optional[bool]:
    """
    Bestimmt ob eine Wand außen oder innen liegt.
    Mehrere Heuristiken kombiniert.
    """
    if not HAS_REVIT:
        return None
    try:
        # Direkter Wall-Parameter "Function"
        wt = doc.GetElement(elem.GetTypeId())
        if wt:
            f = wt.LookupParameter("Function")
            if f and f.HasValue:
                # 0=Interior, 1=Exterior, 2=Foundation, 3=Retaining, 4=Soffit, 5=Core-shaft
                v = f.AsInteger()
                if v == 1:  # Exterior
                    return True
                if v == 0:  # Interior
                    return False
    except Exception:
        pass
    # Fallback: Type Name
    try:
        type_name = (elem.Name or "").lower()
        if any(k in type_name for k in ("ext", "außen", "aussen", "fassade", "exterior")):
            return True
        if any(k in type_name for k in ("int", "innen", "interior", "partition")):
            return False
    except Exception:
        pass
    return None


def _is_loadbearing(elem) -> Optional[bool]:
    """Liest StructuralUsage / Tragend-Flag."""
    if not HAS_REVIT:
        return None
    try:
        p = elem.LookupParameter("Structural")
        if p and p.HasValue:
            return bool(p.AsInteger())
        # Function = 1 = Exterior; aber pour bearing on regarde structural usage
        if hasattr(elem, "StructuralUsage"):
            return str(elem.StructuralUsage) not in ("NonBearing", "None")
    except Exception:
        pass
    return None


def _get_material_name(elem, doc) -> Optional[str]:
    """Holt den Namen des Hauptmaterials des Elements."""
    if not HAS_REVIT:
        return None
    try:
        mat_ids = elem.GetMaterialIds(False)  # False = nicht-Paint
        if mat_ids and mat_ids.Count > 0:
            mat = doc.GetElement(list(mat_ids)[0])
            if mat:
                return mat.Name
    except Exception:
        pass
    # Type-Material-Property
    try:
        type_id = elem.GetTypeId()
        type_elem = doc.GetElement(type_id)
        if type_elem:
            for pname in ("Structural Material", "Material", "Material und Oberflächen"):
                p = type_elem.LookupParameter(pname)
                if p and p.HasValue:
                    mat_id = p.AsElementId()
                    mat = doc.GetElement(mat_id)
                    if mat:
                        return mat.Name
    except Exception:
        pass
    return None


def _get_classification(elem, doc) -> tuple:
    """
    Sucht den Klassifikations-Code (Assembly Code OmniClass, oder
    benutzerdefinierte DIN276 Parameter).
    """
    if not HAS_REVIT:
        return (None, None)
    # 1. Direkter benutzerdefinierter "DIN276" Parameter (Bestpraxis)
    din = _get_named_param(elem, "DIN276")
    if din:
        return (str(din), "DIN276")
    type_id = elem.GetTypeId()
    type_elem = doc.GetElement(type_id) if type_id else None
    if type_elem:
        din = _get_named_param(type_elem, "DIN276")
        if din:
            return (str(din), "DIN276")
        # 2. Assembly Code (OmniClass)
        try:
            ac = type_elem.LookupParameter("Assembly Code")
            if ac and ac.HasValue:
                code = ac.AsString()
                if code:
                    return (code, "OmniClass")
        except Exception:
            pass
    return (None, None)


def _convert_internal_to_meters(value: float, unit_type: str = "length") -> float:
    """
    Revit speichert intern in Feet (für Länge) und Square Feet (für Fläche).
    Wir konvertieren auf SI-Einheiten (m, m², m³).
    """
    if value is None:
        return 0.0
    if unit_type == "length":
        return value * 0.3048      # ft → m
    if unit_type == "area":
        return value * 0.092903    # ft² → m²
    if unit_type == "volume":
        return value * 0.0283168   # ft³ → m³
    return value


def _get_storey(elem, doc) -> Optional[str]:
    """Hole das zugeordnete Geschoss (Level) eines Elements."""
    if not HAS_REVIT:
        return None
    try:
        level_id = elem.LevelId
        if level_id and level_id.IntegerValue >= 0:
            level = doc.GetElement(level_id)
            if level:
                return level.Name
    except Exception:
        pass
    # Fallback : reference level
    try:
        p = elem.LookupParameter("Reference Level")
        if p and p.HasValue:
            level_id = p.AsElementId()
            level = doc.GetElement(level_id)
            if level:
                return level.Name
    except Exception:
        pass
    return None


def _process_element(elem, doc, narchi_class: str, predefined: Optional[str]) -> Dict[str, Any]:
    """Konvertiert ein Revit-Element in einen NARCHI-DataFrame-Eintrag."""
    if not HAS_REVIT:
        return {}

    # Identité
    row: Dict[str, Any] = {
        "GlobalId": str(elem.UniqueId),
        "Class": narchi_class,
        "Category": elem.Category.Name if elem.Category else "",
        "Name": elem.Name if hasattr(elem, "Name") else "",
        "PredefinedType": predefined,
    }

    # TypeName
    try:
        type_elem = doc.GetElement(elem.GetTypeId())
        row["TypeName"] = type_elem.Name if type_elem else None
    except Exception:
        row["TypeName"] = None

    # Storey
    row["Storey"] = _get_storey(elem, doc)

    # Material
    row["Material"] = _get_material_name(elem, doc)

    # IsExternal pour les murs
    if narchi_class in ("IfcWall", "IfcWallStandardCase"):
        row["IsExternal"] = _is_wall_external(elem, doc)
    elif narchi_class in ("IfcDoor", "IfcWindow"):
        # Hosting wall — utiliser son IsExternal
        try:
            host = elem.Host
            if host:
                row["IsExternal"] = _is_wall_external(host, doc)
        except Exception:
            pass

    # LoadBearing
    if narchi_class in ("IfcWall", "IfcColumn", "IfcBeam"):
        row["Pset_WallCommon.LoadBearing"] = _is_loadbearing(elem)

    # Géométrie (en mètres SI)
    area_internal = _get_param_double(elem, DB.BuiltInParameter.HOST_AREA_COMPUTED) if HAS_REVIT else None
    if area_internal is None:
        area_internal = _get_named_param(elem, "Area")
    row["Area"] = _convert_internal_to_meters(area_internal or 0, "area")

    vol_internal = _get_param_double(elem, DB.BuiltInParameter.HOST_VOLUME_COMPUTED) if HAS_REVIT else None
    if vol_internal is None:
        vol_internal = _get_named_param(elem, "Volume")
    row["Volume"] = _convert_internal_to_meters(vol_internal or 0, "volume")

    length_internal = _get_param_double(elem, DB.BuiltInParameter.CURVE_ELEM_LENGTH) if HAS_REVIT else None
    if length_internal is None:
        length_internal = _get_named_param(elem, "Length")
    row["Length"] = _convert_internal_to_meters(length_internal or 0, "length")

    width = _get_named_param(elem, "Width")
    row["Width"] = _convert_internal_to_meters(width or 0, "length") if width else 0

    height = _get_named_param(elem, "Height") or _get_named_param(elem, "Unconnected Height")
    row["Height"] = _convert_internal_to_meters(height or 0, "length") if height else 0

    thickness = _get_named_param(elem, "Width") if narchi_class in ("IfcWall",) else None
    row["Thickness"] = _convert_internal_to_meters(thickness or 0, "length") if thickness else 0

    row["Count"] = 1

    # Klassifikation
    code, source = _get_classification(elem, doc)
    row["ClassificationCode"] = code
    row["ClassificationSource"] = source

    # U-Wert (Wärmedurchgangskoeffizient) für GEG-Check
    u_wert = _get_named_param(elem, "Heat Transfer Coefficient (U)") or \
             _get_named_param(elem, "U-Wert") or \
             _get_named_param(elem, "U-Value")
    if u_wert:
        # Revit speichert U-Werte teilweise in BTU/(h·ft²·°F) — Konvertierung
        # 1 BTU/(h·ft²·°F) ≈ 5.678 W/(m²·K)
        # Aber meistens schon in W/(m²·K) bei deutschen Templates
        if u_wert > 10:
            u_wert = u_wert / 5.678  # vermutlich imperial
        row["Pset_WallCommon.ThermalTransmittance"] = u_wert

    return row


def read_active_document(doc=None) -> "pd.DataFrame":
    """
    Hauptfunktion: liest das aktive Revit-Modell und gibt einen NARCHI-DataFrame zurück.

    Returns
    -------
    pandas.DataFrame mit NARCHI-Standard-Spalten.
    """
    import pandas as pd

    if not HAS_REVIT:
        raise RuntimeError(
            "pyRevit / Revit-API nicht verfügbar.\n"
            "Dieses Modul muss innerhalb von Revit über pyRevit ausgeführt werden."
        )

    if doc is None:
        doc = revit.doc

    rows: List[Dict[str, Any]] = []
    for ost_name, (narchi_class, predefined) in REVIT_CATEGORY_MAP.items():
        try:
            cat = getattr(DB.BuiltInCategory, ost_name)
            collector = DB.FilteredElementCollector(doc) \
                .OfCategory(cat) \
                .WhereElementIsNotElementType()
            for elem in collector:
                try:
                    row = _process_element(elem, doc, narchi_class, predefined)
                    if row:
                        rows.append(row)
                except Exception as e:
                    # Ein Element-Fehler darf den ganzen Lauf nicht abbrechen
                    script.get_logger().warning(f"Element {elem.Id} : {e}")
        except (AttributeError, Exception) as e:
            # Kategorie existiert in dieser Revit-Version nicht
            continue

    df = pd.DataFrame(rows)

    # Spalten harmonisieren mit NARCHI Standard
    std_cols = ["GlobalId", "Class", "Category", "Name", "TypeName", "Material",
                "Storey", "IsExternal", "PredefinedType",
                "Area", "Volume", "Length", "Width", "Height", "Thickness",
                "Perimeter", "Count", "ClassificationCode", "ClassificationSource"]
    for col in std_cols:
        if col not in df.columns:
            df[col] = None
    if "Perimeter" not in df.columns:
        df["Perimeter"] = 0
    # Reorder
    other_cols = sorted(c for c in df.columns if c not in std_cols)
    df = df[[c for c in std_cols if c in df.columns] + other_cols]
    return df


def write_din276_to_elements(doc, mapped_df: "pd.DataFrame", param_name: str = "DIN276") -> int:
    """
    Bidirektional: schreibt die zugeordneten DIN-276-Codes zurück in die
    Revit-Bauteile als benutzerdefiniertes Parameter.

    Parameters
    ----------
    doc : Document Revit
    mapped_df : DataFrame avec colonnes GlobalId et DIN276_KG
    param_name : Name des Parameters (Standard "DIN276")

    Returns
    -------
    Anzahl der erfolgreich geschriebenen Elemente.
    """
    if not HAS_REVIT:
        return 0
    if "GlobalId" not in mapped_df.columns or "DIN276_KG" not in mapped_df.columns:
        raise ValueError("DataFrame benötigt Spalten GlobalId und DIN276_KG")

    n_written = 0
    with DB.Transaction(doc, "NARCHI: DIN276-Codes schreiben") as tx:
        tx.Start()
        try:
            for _, row in mapped_df.iterrows():
                elem = doc.GetElement(row["GlobalId"])
                if elem is None:
                    continue
                p = elem.LookupParameter(param_name)
                if p and not p.IsReadOnly:
                    p.Set(str(row["DIN276_KG"]))
                    n_written += 1
            tx.Commit()
        except Exception as e:
            tx.RollBack()
            raise e
    return n_written
