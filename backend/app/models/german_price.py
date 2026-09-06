"""
NARCHI V5 — German Construction Price Database Models 2026
==========================================================
Modèles SQLAlchemy pour la base BKI/STLB-Bau/Destatis 2026.
Toutes les tables héritent de HasTenantColumn pour isolation multi-tenant.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, Integer, Numeric, Text, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB, VARCHAR
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn
import uuid


def generate_uuid():
    return str(uuid.uuid4())


# =============================================================================
# TABLE 1 : RÉGIONS ET INDICES DE COÛT 2026
# =============================================================================
class DeRegion2026(HasTenantColumn, Base):
    """38 zones tarifaires Allemagne + pays limitrophes."""
    __tablename__ = 'de_regions_2026'

    code = Column(VARCHAR(10), primary_key=True)
    bundesland = Column(VARCHAR(60), nullable=False, index=True)
    stadt = Column(VARCHAR(60), nullable=True)
    name_de = Column(VARCHAR(120), nullable=False)
    name_fr = Column(VARCHAR(120), nullable=True)
    cost_index = Column(Numeric(5, 3), nullable=False, default=1.000)
    lohn_index = Column(Numeric(5, 3), nullable=False, default=1.000)
    material_index = Column(Numeric(5, 3), nullable=False, default=1.000)
    einwohner = Column(Integer, nullable=True)
    plz_bereich = Column(VARCHAR(50), nullable=True)
    markt_lage = Column(VARCHAR(20), nullable=True, index=True)
    mietpreis_m2 = Column(Numeric(6, 2), nullable=True)
    notes = Column(Text, nullable=True)
    gueltig_ab = Column(Date, nullable=False)

    def __repr__(self):
        return f"<DeRegion2026 {self.code}: {self.name_de} (Index: {self.cost_index})>"


# =============================================================================
# TABLE 2 : INDICES DE PRIX CONSTRUCTION 2026 (Destatis)
# =============================================================================
class DePriceIndex2026(Base):
    """Baupreisindex Destatis Base 2020=100. Trimestres 2024-2026 + estimation."""
    __tablename__ = 'de_price_index_2026'

    id = Column(Integer, primary_key=True, autoincrement=True)
    index_code = Column(VARCHAR(30), nullable=False, unique=True, index=True)
    bezeichnung = Column(VARCHAR(200), nullable=False)
    basis_jahr = Column(Integer, nullable=False, default=2020)
    q1_2024 = Column(Numeric(7, 2), nullable=True)
    q2_2024 = Column(Numeric(7, 2), nullable=True)
    q3_2024 = Column(Numeric(7, 2), nullable=True)
    q4_2024 = Column(Numeric(7, 2), nullable=True)
    q1_2025 = Column(Numeric(7, 2), nullable=True)
    q2_2025 = Column(Numeric(7, 2), nullable=True)
    q3_2025 = Column(Numeric(7, 2), nullable=True)
    q4_2025 = Column(Numeric(7, 2), nullable=True)
    q1_2026_est = Column(Numeric(7, 2), nullable=True)
    jahres_aenderung_pct = Column(Numeric(5, 2), nullable=True)
    quelle = Column(VARCHAR(50), nullable=False, default='Destatis')

    def __repr__(self):
        return f"<DePriceIndex2026 {self.index_code}: {self.bezeichnung}>"


# =============================================================================
# TABLE 3 : TAUX HORAIRES MO 2026 — BRTV-Bau
# =============================================================================
class DeLaborRate2026(Base):
    """Taux horaires BRTV-Bau 2026. 19 métiers × 5 régions + SVS."""
    __tablename__ = 'de_labor_rates_2026'

    id = Column(Integer, primary_key=True, autoincrement=True)
    gewerk_code = Column(VARCHAR(30), nullable=False, unique=True, index=True)
    gewerk_de = Column(VARCHAR(120), nullable=False)
    gewerk_fr = Column(VARCHAR(120), nullable=True)
    gewerk_en = Column(VARCHAR(120), nullable=True)
    mindestlohn = Column(Numeric(6, 2), nullable=False, default=16.00)
    lohn_helfer_w = Column(Numeric(6, 2), nullable=True)
    lohn_fach_w = Column(Numeric(6, 2), nullable=True)
    lohn_vorarbeiter_w = Column(Numeric(6, 2), nullable=True)
    lohn_polier_w = Column(Numeric(6, 2), nullable=True)
    lohn_fach_o = Column(Numeric(6, 2), nullable=True)
    lohn_polier_o = Column(Numeric(6, 2), nullable=True)
    svs_west = Column(Numeric(6, 2), nullable=True)
    svs_ost = Column(Numeric(6, 2), nullable=True)
    svs_muenchen = Column(Numeric(6, 2), nullable=True)
    svs_frankfurt = Column(Numeric(6, 2), nullable=True)
    svs_berlin = Column(Numeric(6, 2), nullable=True)
    jahresarbeitsstunden = Column(Integer, nullable=False, default=1700)
    tarifvertrag = Column(VARCHAR(100), nullable=True)
    gueltig_ab = Column(Date, nullable=False)

    def __repr__(self):
        return f"<DeLaborRate2026 {self.gewerk_code}: {self.gewerk_de}>"

    def get_svs(self, region: str = 'west') -> float:
        """Retourne le SVS pour une région."""
        attr_map = {
            'west': 'svs_west', 'ost': 'svs_ost', 'muenchen': 'svs_muenchen',
            'frankfurt': 'svs_frankfurt', 'berlin': 'svs_berlin'
        }
        attr = attr_map.get(region.lower(), 'svs_west')
        return float(getattr(self, attr)) if getattr(self, attr) else 0.0


# =============================================================================
# TABLE 4 : PRIX MATÉRIAUX 2026
# =============================================================================
class DeMaterialPrice2026(Base):
    """Prix moyens fournisseurs Allemagne avec CO₂ + recyclage."""
    __tablename__ = 'de_material_prices_2026'

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    material_code = Column(VARCHAR(30), nullable=False, unique=True, index=True)
    bezeichnung_de = Column(VARCHAR(200), nullable=False)
    bezeichnung_fr = Column(VARCHAR(200), nullable=True)
    kategorie = Column(VARCHAR(60), nullable=True, index=True)
    einheit = Column(VARCHAR(15), nullable=False)
    preis_basis = Column(Numeric(12, 3), nullable=False)
    preis_min = Column(Numeric(12, 3), nullable=True)
    preis_max = Column(Numeric(12, 3), nullable=True)
    lieferant_typ = Column(VARCHAR(50), nullable=True, index=True)
    co2_kg_per_unit = Column(Numeric(10, 3), nullable=True)
    recycling_pct = Column(Numeric(5, 1), nullable=True)
    din_en_norm = Column(VARCHAR(50), nullable=True)
    gueltig_q = Column(VARCHAR(10), nullable=False, default='Q1/2026')

    def __repr__(self):
        return f"<DeMaterialPrice2026 {self.material_code}: {self.bezeichnung_de} ({self.einheit})>"


# =============================================================================
# TABLE 5 : BENCHMARKS BÂTIMENTS DIN 276
# =============================================================================
class DeBuildingBenchmark2026(Base):
    """Benchmarks DIN 276 par type de bâtiment."""
    __tablename__ = 'de_building_benchmarks_2026'

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    gebaeudeart_code = Column(VARCHAR(30), nullable=False, index=True)
    gebaeudeart_de = Column(VARCHAR(120), nullable=False)
    gebaeudeart_fr = Column(VARCHAR(120), nullable=True)
    bgf_von_m2 = Column(Integer, nullable=True)
    bgf_bis_m2 = Column(Integer, nullable=True)
    kosten_pro_m2_basis = Column(Numeric(10, 2), nullable=False)
    kosten_min_m2 = Column(Numeric(10, 2), nullable=True)
    kosten_max_m2 = Column(Numeric(10, 2), nullable=True)
    kg_verteilung = Column(JSONB, nullable=True)
    typische_geschosse = Column(Integer, nullable=True)
    typische_nutzung = Column(VARCHAR(200), nullable=True)
    quelle = Column(VARCHAR(100), nullable=True)
    gueltig_q = Column(VARCHAR(10), nullable=False, default='Q1/2026')

    def __repr__(self):
        return f"<DeBuildingBenchmark2026 {self.gebaeudeart_code}: {self.gebaeudeart_de}>"


# =============================================================================
# TABLE 6 : ITEMS STLB-BAU DÉTAILLÉS PAR KOSTENGRUPPE
# =============================================================================
class DePriceItem2026(Base):
    """Items STLB-Bau 2026 par Kostengruppe DIN 276 avec mapping IFC."""
    __tablename__ = 'de_price_items_2026'

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    item_code = Column(VARCHAR(30), nullable=False, index=True)
    stlb_code = Column(VARCHAR(30), nullable=True)
    bezeichnung_de = Column(VARCHAR(300), nullable=False)
    bezeichnung_fr = Column(VARCHAR(300), nullable=True)
    beschreibung_de = Column(Text, nullable=True)
    kg_code = Column(VARCHAR(10), nullable=False, index=True)
    kg_label_de = Column(VARCHAR(120), nullable=True)
    kg_label_fr = Column(VARCHAR(120), nullable=True)
    gewerk_code = Column(VARCHAR(30), nullable=True, index=True)
    gewerk_de = Column(VARCHAR(120), nullable=True)
    ifc_entity = Column(VARCHAR(50), nullable=True, index=True)
    ifc_type = Column(VARCHAR(50), nullable=True, index=True)
    einheit = Column(VARCHAR(20), nullable=False)
    preis_basis = Column(Numeric(12, 3), nullable=False)
    preis_min = Column(Numeric(12, 3), nullable=True)
    preis_max = Column(Numeric(12, 3), nullable=True)
    material_anteil_pct = Column(Numeric(5, 1), nullable=True)
    lohn_anteil_pct = Column(Numeric(5, 1), nullable=True)
    geraet_anteil_pct = Column(Numeric(5, 1), nullable=True)
    co2_kg_per_unit = Column(Numeric(10, 3), nullable=True)
    recycling_pct = Column(Numeric(5, 1), nullable=True)
    din_norm = Column(VARCHAR(50), nullable=True)
    gueltig_q = Column(VARCHAR(10), nullable=False, default='Q1/2026')
    schwierigkeit = Column(VARCHAR(20), nullable=True)
    keywords = Column(ARRAY(Text), nullable=True)

    def __repr__(self):
        return f"<DePriceItem2026 {self.item_code}: {self.bezeichnung_de[:50]}>"


# =============================================================================
# TABLE 7 : FOURNISSEURS
# =============================================================================
class DeSupplier2026(Base):
    """Fournisseurs matériaux Allemagne."""
    __tablename__ = 'de_suppliers_2026'

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    supplier_code = Column(VARCHAR(30), nullable=False, unique=True)
    name = Column(VARCHAR(200), nullable=False)
    kategorie = Column(VARCHAR(60), nullable=True)
    region_code = Column(VARCHAR(10), nullable=True)
    ort = Column(VARCHAR(120), nullable=True)
    plz = Column(VARCHAR(10), nullable=True)
    telefon = Column(VARCHAR(50), nullable=True)
    email = Column(VARCHAR(200), nullable=True)
    web = Column(VARCHAR(300), nullable=True)
    lieferant_typ = Column(VARCHAR(50), nullable=True)
    material_codes = Column(ARRAY(Text), nullable=True)
    zahlungsziel_tage = Column(Integer, nullable=True, default=30)
    skonto_pct = Column(Numeric(4, 2), nullable=True, default=2.00)
    mindestbestellwert = Column(Numeric(10, 2), nullable=True)
    lieferradius_km = Column(Integer, nullable=True)
    zertifizierungen = Column(ARRAY(Text), nullable=True)
    co2_reporting = Column(sa.Boolean, nullable=False, default=False)
    gueltig_ab = Column(Date, nullable=False)

    def __repr__(self):
        return f"<DeSupplier2026 {self.supplier_code}: {self.name}>"


# =============================================================================
# TABLE 8 : DONNÉES DURABILITÉ (EPD, GWP)
# =============================================================================
class DeSustainabilityData(Base):
    """Données environnementales EPD (EN 15804+A2)."""
    __tablename__ = 'de_sustainability_data'

    id = Column(UUID(as_uuid=True), primary_key=True, default=generate_uuid)
    material_code = Column(VARCHAR(30), nullable=False, index=True)
    epd_nummer = Column(VARCHAR(100), nullable=True)
    gwp_a1a3_kg_co2e = Column(Numeric(10, 3), nullable=True)
    gwp_a4_kg_co2e = Column(Numeric(10, 3), nullable=True)
    gwp_a5_kg_co2e = Column(Numeric(10, 3), nullable=True)
    gwp_b_kg_co2e = Column(Numeric(10, 3), nullable=True)
    gwp_c_kg_co2e = Column(Numeric(10, 3), nullable=True)
    gwp_d_kg_co2e = Column(Numeric(10, 3), nullable=True)
    ap_kg_so2e = Column(Numeric(10, 3), nullable=True)
    ep_kg_po4e = Column(Numeric(10, 3), nullable=True)
    pop_kg_ethene = Column(Numeric(10, 3), nullable=True)
    adpe_kg_sbe = Column(Numeric(10, 3), nullable=True)
    adpf_mj = Column(Numeric(10, 3), nullable=True)
    duree_vie_ans = Column(Integer, nullable=True)
    recyclable = Column(sa.Boolean, nullable=False, default=False)
    recyclage_pct_fin_vie = Column(Numeric(5, 1), nullable=True)
    epd_verifieur = Column(VARCHAR(100), nullable=True)
    epd_valide_jusqu = Column(Date, nullable=True)
    source = Column(VARCHAR(100), nullable=True)

    def __repr__(self):
        return f"<DeSustainabilityData {self.material_code}>"