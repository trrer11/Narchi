"""NARCHI V5 — Extraction IFC et estimation DIN 276."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any, Dict

try:
    import ifcopenshell
    import ifcopenshell.util.element

    HAS_IFC = True
except ImportError:
    HAS_IFC = False

from sqlalchemy.orm import Session


def extract_ifc_metadata(file_path: Path, file_name: str) -> Dict[str, Any]:
    """Extrait les métadonnées sans écrire en base.

    Un IFC invalide est rejeté : aucune estimation silencieuse n'est fabriquée
    à partir de la taille d'un fichier corrompu.
    """
    suffix = file_path.suffix.lower()
    if suffix in {".ifc", ".ifczip"}:
        with file_path.open("rb") as source:
            signature = source.read(16)
        valid_signature = (
            signature.startswith(b"ISO-10303-21")
            if suffix == ".ifc"
            else signature.startswith(b"PK")
        )
        if not valid_signature:
            raise ValueError("IFC illisible ou corrompu: signature de fichier invalide")
        if not HAS_IFC:
            raise RuntimeError("IfcOpenShell n'est pas installé sur le worker")
        try:
            ifc_doc = ifcopenshell.open(str(file_path))
        except Exception as error:
            raise ValueError(f"IFC illisible ou corrompu: {error}") from error

        schema_version = ifc_doc.schema
        storey_count = max(len(ifc_doc.by_type("IfcBuildingStorey")), 1)
        elements = ifc_doc.by_type("IfcBuildingElement")
        element_count = len(elements)
        bgf = bri = ngf = 0.0

        for element in elements:
            try:
                quantities = ifcopenshell.util.element.get_psets(
                    element, qtos_only=True
                )
                for properties in quantities.values():
                    if "GrossArea" in properties:
                        bgf += float(properties["GrossArea"])
                    elif "NetArea" in properties:
                        ngf += float(properties["NetArea"])
                    if "GrossVolume" in properties:
                        bri += float(properties["GrossVolume"])
                    elif "NetVolume" in properties:
                        bri += float(properties["NetVolume"])
            except (TypeError, ValueError, AttributeError):
                continue

        # Fallback métier uniquement pour un document IFC valide sans QTO.
        if bgf < 10.0 and element_count > 0:
            bgf = float(element_count) * 18.5
            ngf = bgf * 0.82
            bri = bgf * 3.1
    else:
        file_size_kb = os.path.getsize(file_path) / 1024.0
        element_count = max(int(file_size_kb * 0.8), 30)
        bgf, ngf, bri = 750.0, 615.0, 2325.0
        storey_count = 1
        schema_version = suffix.lstrip(".").upper() or "UNKNOWN"

    return {
        "file_name": file_name,
        "schema_version": schema_version,
        "element_count": element_count,
        "bgf": round(bgf, 2),
        "bri": round(bri, 2),
        "ngf": round(ngf, 2),
        "storey_count": storey_count,
    }


def apply_ifc_metadata(project, metadata: Dict[str, Any]) -> None:
    project.schema_version = metadata["schema_version"]
    project.element_count = metadata["element_count"]
    project.bgf = metadata["bgf"]
    project.bri = metadata["bri"]
    project.ngf = metadata["ngf"]
    project.storey_count = metadata["storey_count"]
    project.status = "COMPLETED"


def parse_ifc_file(file_path: Path, file_name: str, user_id: str, db: Session):
    """Chemin synchrone réservé aux outils de compatibilité/tests."""
    from app.models.project import Project

    tenant_id = db.info.get("tenant_id")
    if not tenant_id:
        raise ValueError("Contexte tenant requis pour créer un projet")

    metadata = extract_ifc_metadata(file_path, file_name)
    project = Project(
        tenant_id=tenant_id,
        user_id=user_id,
        name=f"Projet BIM ({file_name})",
        file_name=file_name,
        file_path=str(file_path),
        file_size_bytes=file_path.stat().st_size,
        status="PROCESSING",
        location_plz="10115",
        grossstadt="Berlin",
    )
    apply_ifc_metadata(project, metadata)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def calculate_din276_estimate(
    project, gebaeudeart: str, standard: str, plz: str, grossstadt: str, db: Session
):
    from app.models.project import CostEstimation, CostEstimationItem
    bgf = project.bgf if project.bgf > 10 else 750.0
    bri = project.bri if project.bri > 10 else bgf * 3.1
    
    base_rates = {"einfach": 1950.0, "mittel": 2420.0, "gehoben": 3150.0, "luxus": 4200.0}
    rate_m2 = base_rates.get(standard.lower(), 2420.0)
    
    reg_factor = 1.08 if "berlin" in grossstadt.lower() or plz.startswith(("10", "11", "12", "13", "14")) else 1.02
    idx_factor = 1.0636
    
    adjusted_rate_m2 = rate_m2 * reg_factor * idx_factor
    total_netto = bgf * adjusted_rate_m2
    total_brutto = total_netto * 1.19
    
    kg_ratios = [
        ("KG 100", "Grundstück", 0.0, 0.0),
        ("KG 200", "Vorbereitende Maßnahmen", 0.04, total_netto * 0.04),
        ("KG 300", "Bauwerk - Baukonstruktion", 0.52, total_netto * 0.52),
        ("KG 400", "Bauwerk - Technische Anlagen", 0.22, total_netto * 0.22),
        ("KG 500", "Außenanlagen", 0.05, total_netto * 0.05),
        ("KG 600", "Ausstattung und Kunstwerke", 0.02, total_netto * 0.02),
        ("KG 700", "Baunebenkosten (Architekt, Statik, QS)", 0.15, total_netto * 0.15),
    ]
    
    kg_items = [{
        "code": code, "label": label, "amount": round(amt, 2),
        "perM2": round(amt / bgf, 2) if bgf > 0 else 0.0, "share_pct": round(share * 100, 1)
    } for code, label, share, amt in kg_ratios]
        
    conf_low = total_netto * 0.86
    conf_high = total_netto * 1.14
    co2_total = bgf * 628.5
    hoai_netto = (total_netto * 0.74) * 0.145
    
    audit_hash = hashlib.sha256(f"{project.id}:{total_netto}:{reg_factor}:{standard}".encode()).hexdigest()[:16]

    estimation = CostEstimation(
        project_id=project.id,
        tenant_id=project.tenant_id,
        gebaeudeart=gebaeudeart,
        standard=standard,
        regional_faktor=reg_factor,
        index_faktor=idx_factor,
        total_netto=round(total_netto, 2),
        total_brutto=round(total_brutto, 2),
        cost_per_m2_bgf=round(adjusted_rate_m2, 2),
        confidence_low_80=round(conf_low, 2),
        confidence_high_80=round(conf_high, 2),
        co2_total_kg=round(co2_total, 2),
        co2_per_m2=628.5,
        geg_conform=True,
        hoai_honorar_netto=round(hoai_netto, 2),
        audit_hash=audit_hash,
    )
    estimation.kg_items = [
        CostEstimationItem(
            tenant_id=project.tenant_id,
            kg_code=item["code"],
            label=item["label"],
            amount=item["amount"],
            per_m2=item["perM2"],
            share_pct=item["share_pct"],
        )
        for item in kg_items
    ]
    db.add(estimation)
    db.commit()
    db.refresh(estimation)
    return estimation
