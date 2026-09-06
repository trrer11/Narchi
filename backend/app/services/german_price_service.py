"""
NARCHI V5 — German Construction Price Database Service 2026
===========================================================
Service d'accès à la base BKI/STLB-Bau/Destatis 2026 intégrée.
Fournit : prix régionaux, estimation rapide, recherche, estimation IFC.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, List, Dict, Any
from uuid import UUID

from sqlalchemy import text, func, select
from sqlalchemy.orm import Session

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
from app.services.money import eur


@dataclass
class RegionalPriceResult:
    """Résultat d'un prix corrigé par région."""
    base_price: float
    regional_factor: float
    corrected_price: float
    region_code: str
    region_name: str
    price_type: str


@dataclass
class QuickEstimateResult:
    """Résultat estimation rapide par type bâtiment."""
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


@dataclass
class IfcEstimateResult:
    """Résultat estimation depuis quantités IFC."""
    region_code: str
    standard: str
    total_netto: float
    total_brutto: float
    regional_faktor: float
    standard_faktor: float
    positions: List[Dict[str, Any]]


class GermanPriceService:
    """
    Service principal pour la base de prix construction allemande 2026.
    Toutes les méthodes utilisent les fonctions SQL optimisées côté serveur.
    """

    def __init__(self, db: Session):
        self.db = db

    # =========================================================================
    # RÉGIONS & INDICES
    # =========================================================================

    def get_region(self, region_code: str) -> Optional[DeRegion2026]:
        """Récupère une région par son code."""
        return self.db.query(DeRegion2026).filter(DeRegion2026.code == region_code).first()

    def get_all_regions(self, bundesland: Optional[str] = None) -> List[DeRegion2026]:
        """Liste toutes les régions, optionnellement filtrées par Bundesland."""
        q = self.db.query(DeRegion2026)
        if bundesland:
            q = q.filter(DeRegion2026.bundesland == bundesland)
        return q.order_by(DeRegion2026.bundesland, DeRegion2026.code).all()

    def get_regional_factor(self, region_code: str, price_type: str = 'total') -> float:
        """
        Retourne le facteur régional pour un type de prix.
        price_type: 'total' (défaut), 'material', 'labor'
        """
        region = self.get_region(region_code)
        if not region:
            return 1.000

        if price_type == 'material':
            return float(region.material_index)
        elif price_type == 'labor':
            return float(region.lohn_index)
        return float(region.cost_index)

    def correct_price_for_region(
        self,
        base_price: float,
        region_code: str,
        price_type: str = 'total'
    ) -> RegionalPriceResult:
        """Corrige un prix de base selon la région."""
        region = self.get_region(region_code)
        if not region:
            factor = 1.000
            region_name = "Inconnu (fallback 1.000)"
        else:
            if price_type == 'material':
                factor = float(region.material_index)
            elif price_type == 'labor':
                factor = float(region.lohn_index)
            else:
                factor = float(region.cost_index)
            region_name = region.name_de

        return RegionalPriceResult(
            base_price=base_price,
            regional_factor=factor,
            # §145 — HALF_UP, pas banker's rounding : 100,005 → 100,01
            # (jamais 100,00).
            corrected_price=float(eur(Decimal(str(base_price)) * Decimal(str(factor)))),
            region_code=region_code,
            region_name=region_name,
            price_type=price_type
        )

    def get_price_indices(self) -> List[DePriceIndex2026]:
        """Tous les indices Destatis 2026."""
        return self.db.query(DePriceIndex2026).order_by(DePriceIndex2026.index_code).all()

    def get_price_index(self, index_code: str) -> Optional[DePriceIndex2026]:
        """Un indice spécifique par son code."""
        return self.db.query(DePriceIndex2026).filter(DePriceIndex2026.index_code == index_code).first()

    # =========================================================================
    # TAUX HORAIRES MO (BRTV-Bau 2026)
    # =========================================================================

    def get_labor_rate(self, gewerk_code: str) -> Optional[DeLaborRate2026]:
        """Taux horaire pour un corps de métier."""
        return self.db.query(DeLaborRate2026).filter(DeLaborRate2026.gewerk_code == gewerk_code).first()

    def get_all_labor_rates(self) -> List[DeLaborRate2026]:
        """Tous les taux horaires 2026."""
        return self.db.query(DeLaborRate2026).order_by(DeLaborRate2026.gewerk_de).all()

    def get_svs_rate(self, gewerk_code: str, region: str = 'west') -> Optional[float]:
        """
        Retourne le Stundensatz kalkulatorisch (SVS) pour un métier et une région.
        region: 'west', 'ost', 'muenchen', 'frankfurt', 'berlin'
        """
        rate = self.get_labor_rate(gewerk_code)
        if not rate:
            return None

        attr_map = {
            'west': 'svs_west',
            'ost': 'svs_ost',
            'muenchen': 'svs_muenchen',
            'frankfurt': 'svs_frankfurt',
            'berlin': 'svs_berlin',
        }
        attr = attr_map.get(region.lower(), 'svs_west')
        value = getattr(rate, attr, None)
        return float(value) if value else None

    def calculate_labor_cost(
        self,
        gewerk_code: str,
        hours: float,
        region: str = 'west',
        qualification: str = 'fach'  # 'helfer', 'fach', 'vorarbeiter', 'polier'
    ) -> Optional[float]:
        """Calcule le coût main d'œuvre pour un métier."""
        rate = self.get_labor_rate(gewerk_code)
        if not rate:
            return None

        # Tarif horaire selon qualification
        attr_map = {
            'helfer': 'lohn_helfer_w' if region == 'west' else 'lohn_fach_o',
            'fach': 'lohn_fach_w' if region == 'west' else 'lohn_fach_o',
            'vorarbeiter': 'lohn_vorarbeiter_w' if region == 'west' else 'lohn_polier_o',
            'polier': 'lohn_polier_w' if region == 'west' else 'lohn_polier_o',
        }
        attr = attr_map.get(qualification, 'lohn_fach_w' if region == 'west' else 'lohn_fach_o')
        hourly = getattr(rate, attr, None)
        if not hourly:
            return None

        # §145 — hourly est un Numeric(6,2) → Decimal ; HALF_UP, pas
        # round() banker's : 43,75 × 1,5 = 65,625 → 65,63 (jamais 65,62).
        return float(eur(hourly * Decimal(str(hours))))

    # =========================================================================
    # PRIX MATÉRIAUX
    # =========================================================================

    def get_material_price(self, material_code: str) -> Optional[DeMaterialPrice2026]:
        """Prix matériau par son code."""
        return self.db.query(DeMaterialPrice2026).filter(DeMaterialPrice2026.material_code == material_code).first()

    def search_materials(
        self,
        query: str = '',
        kategorie: Optional[str] = None,
        kg_code: Optional[str] = None,
        limit: int = 50
    ) -> List[DeMaterialPrice2026]:
        """
        Recherche full-text matériaux.
        Utilise la fonction SQL optimisée avec pg_trgm.
        """
        sql = text("""
            SELECT * FROM de_search_prices_2026(:query, :kg_code, :kategorie, :limit)
        """)
        result = self.db.execute(sql, {
            'query': query,
            'kg_code': kg_code,
            'kategorie': kategorie,
            'limit': limit
        })
        return [DeMaterialPrice2026(**dict(row)) for row in result.mappings()]

    def get_materials_by_category(self, kategorie: str) -> List[DeMaterialPrice2026]:
        """Matériaux par catégorie (Beton, Bewehrung, Mauerwerk, etc.)."""
        return self.db.query(DeMaterialPrice2026).filter(
            DeMaterialPrice2026.kategorie == kategorie
        ).order_by(DeMaterialPrice2026.bezeichnung_de).all()

    def get_material_co2(self, material_code: str) -> Optional[float]:
        """Retourne kg CO2e par unité pour un matériau."""
        mat = self.get_material_price(material_code)
        return float(mat.co2_kg_per_unit) if mat and mat.co2_kg_per_unit else None

    def get_material_recycling_pct(self, material_code: str) -> Optional[float]:
        """Retourne % recyclage pour un matériau."""
        mat = self.get_material_price(material_code)
        return float(mat.recycling_pct) if mat and mat.recycling_pct else None

    # =========================================================================
    # BENCHMARKS BÂTIMENTS DIN 276
    # =========================================================================

    def get_benchmark(self, gebaeudeart_code: str, bgf_m2: float) -> Optional[DeBuildingBenchmark2026]:
        """Benchmark pour un type bâtiment et une surface donnée."""
        return self.db.query(DeBuildingBenchmark2026).filter(
            DeBuildingBenchmark2026.gebaeudeart_code == gebaeudeart_code,
            (DeBuildingBenchmark2026.bgf_von_m2.is_(None)) | (DeBuildingBenchmark2026.bgf_von_m2 <= bgf_m2),
            (DeBuildingBenchmark2026.bgf_bis_m2.is_(None)) | (DeBuildingBenchmark2026.bgf_bis_m2 >= bgf_m2)
        ).order_by(DeBuildingBenchmark2026.bgf_von_m2.desc().nullslast()).first()

    def get_all_benchmarks(self) -> List[DeBuildingBenchmark2026]:
        """Tous les benchmarks bâtiment."""
        return self.db.query(DeBuildingBenchmark2026).order_by(DeBuildingBenchmark2026.gebaeudeart_de).all()

    # =========================================================================
    # ESTIMATION RAPIDE (Fonction SQL)
    # =========================================================================

    def quick_estimate(
        self,
        gebaeudeart_code: str,
        bgf_m2: float,
        region_code: str = 'BW_STU',
        standard: str = 'mittel'
    ) -> QuickEstimateResult:
        """
        Estimation rapide par type de bâtiment.
        Utilise la fonction SQL de_quick_estimate_2026().
        """
        sql = text("""
            SELECT * FROM de_quick_estimate_2026(
                :gebaeudeart_code, :bgf_m2, :region_code, :standard
            )
        """)
        result = self.db.execute(sql, {
            'gebaeudeart_code': gebaeudeart_code,
            'bgf_m2': bgf_m2,
            'region_code': region_code,
            'standard': standard
        }).scalar()

        if not result:
            raise ValueError(f"Aucun benchmark pour {gebaeudeart_code}")

        data = result if isinstance(result, dict) else json.loads(result)
        return QuickEstimateResult(
            bgf_m2=data['bgf_m2'],
            gebaeudeart=data['gebaeudeart'],
            region_code=data['region_code'],
            standard=data['standard'],
            kosten_pro_m2_basis=data['kosten_pro_m2_basis'],
            regional_faktor=data['regional_faktor'],
            standard_faktor=data['standard_faktor'],
            total_netto=data['total_netto'],
            total_brutto=data['total_brutto'],
            kg_breakdown=data['kg_breakdown']
        )

    # =========================================================================
    # ESTIMATION DEPUIS QUANTITÉS IFC (Fonction SQL)
    # =========================================================================

    def estimate_from_ifc_quantities(
        self,
        quantities: Dict[str, float],
        region_code: str = 'BW_STU',
        standard: str = 'mittel'
    ) -> IfcEstimateResult:
        """
        Estimation depuis un dictionnaire de quantités IFC.
        Clés acceptées : item_code STLB, ifc_type, ifc_entity
        """
        sql = text("""
            SELECT * FROM de_estimate_by_ifc_2026(
                :quantities, :region_code, :standard
            )
        """)
        result = self.db.execute(sql, {
            'quantities': json.dumps(quantities),
            'region_code': region_code,
            'standard': standard
        }).scalar()

        if not result:
            raise ValueError("Échec estimation IFC")

        data = result if isinstance(result, dict) else json.loads(result)
        return IfcEstimateResult(
            region_code=data['region_code'],
            standard=data['standard'],
            total_netto=data['total_netto'],
            total_brutto=data['total_brutto'],
            regional_faktor=data['regional_faktor'],
            standard_faktor=data['standard_faktor'],
            positions=data['positions']
        )

    # =========================================================================
    # RECHERCHE PRIX (Fonction SQL)
    # =========================================================================

    def search_prices(
        self,
        query: str = '',
        kg_code: Optional[str] = None,
        kategorie: Optional[str] = None,
        limit: int = 50
    ) -> List[DeMaterialPrice2026]:
        """Recherche full-text prix matériaux."""
        return self.search_materials(query, kategorie, kg_code, limit)

    def get_price_items_by_kg(self, kg_code: str) -> List[DePriceItem2026]:
        """Items STLB-Bau par Kostengruppe."""
        return self.db.query(DePriceItem2026).filter(
            DePriceItem2026.kg_code == kg_code
        ).order_by(DePriceItem2026.item_code).all()

    def get_price_item(self, item_code: str) -> Optional[DePriceItem2026]:
        """Item STLB par son code."""
        return self.db.query(DePriceItem2026).filter(
            DePriceItem2026.item_code == item_code
        ).first()

    def get_price_items_by_ifc(self, ifc_entity: str, ifc_type: Optional[str] = None) -> List[DePriceItem2026]:
        """Items STLB mappés sur une entité/type IFC."""
        q = self.db.query(DePriceItem2026).filter(
            DePriceItem2026.ifc_entity == ifc_entity
        )
        if ifc_type:
            q = q.filter(DePriceItem2026.ifc_type == ifc_type)
        return q.order_by(DePriceItem2026.item_code).all()

    # =========================================================================
    # DURABILITÉ & FOURNISSEURS
    # =========================================================================

    def get_sustainability_data(self, material_code: str) -> Optional[DeSustainabilityData]:
        """Données EPD/GWP pour un matériau."""
        return self.db.query(DeSustainabilityData).filter(
            DeSustainabilityData.material_code == material_code
        ).first()

    def get_suppliers_for_material(self, material_code: str) -> List[DeSupplier2026]:
        """Fournisseurs proposant un matériau."""
        sql = text("""
            SELECT s.* FROM de_suppliers_2026 s
            WHERE :material_code = ANY(s.material_codes)
            ORDER BY s.name
        """)
        result = self.db.execute(sql, {'material_code': material_code})
        return [DeSupplier2026(**dict(row)) for row in result.mappings()]

    # =========================================================================
    # PRIX RÉGIONAL CORRIGÉ (Fonction SQL)
    # =========================================================================

    def get_regional_price(
        self,
        base_price: float,
        region_code: str,
        price_type: str = 'total'
    ) -> float:
        """Prix corrigé par région via fonction SQL."""
        sql = text("SELECT de_get_regional_price_2026(:price, :region, :ptype)")
        return self.db.execute(sql, {
            'price': base_price,
            'region': region_code,
            'ptype': price_type
        }).scalar()

    # =========================================================================
    # MÉTHODES UTILITAIRES
    # =========================================================================

    def get_available_standards(self) -> List[str]:
        return ['einfach', 'mittel', 'gehoben', 'luxus']

    def get_available_regions(self) -> List[Dict[str, str]]:
        """Liste simplifiée régions pour UI."""
        regions = self.get_all_regions()
        return [
            {'code': r.code, 'name': r.name_de, 'bundesland': r.bundesland, 'cost_index': float(r.cost_index)}
            for r in regions
        ]

    def get_building_types(self) -> List[Dict[str, Any]]:
        """Types de bâtiments disponibles pour estimation."""
        benchmarks = self.get_all_benchmarks()
        return [
            {
                'code': b.gebaeudeart_code,
                'name_de': b.gebaeudeart_de,
                'name_fr': b.gebaeudeart_fr,
                'bgf_range': f"{b.bgf_von_m2 or 0}-{b.bgf_bis_m2 or '∞'} m²",
                'base_price_m2': float(b.kosten_pro_m2_basis)
            }
            for b in benchmarks
        ]

    def get_kostengruppen(self) -> List[Dict[str, str]]:
        """Liste des Kostengruppen DIN 276 avec items."""
        sql = text("""
            SELECT DISTINCT kg_code, kg_label_de, kg_label_fr
            FROM de_price_items_2026
            WHERE kg_code IS NOT NULL
            ORDER BY kg_code
        """)
        result = self.db.execute(sql)
        return [
            {'code': row[0], 'label_de': row[1], 'label_fr': row[2]}
            for row in result
        ]

    def get_gewerke(self) -> List[Dict[str, str]]:
        """Corps de métier (Gewerke) disponibles."""
        sql = text("""
            SELECT DISTINCT gewerk_code, gewerk_de, gewerk_fr
            FROM de_price_items_2026
            WHERE gewerk_code IS NOT NULL
            ORDER BY gewerk_de
        """)
        result = self.db.execute(sql)
        return [
            {'code': row[0], 'label_de': row[1], 'label_fr': row[2]}
            for row in result
        ]