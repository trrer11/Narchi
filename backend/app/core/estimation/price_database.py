"""
NARCHI V5 — Base de données de prix du marché allemand (Baukosten 2026).

Modèle de données aligné sur DIN 276 (Kostengruppen), DIN 277 (BGF/NGF/BRI)
et la fiscalité allemande (USt 19 % § 12 UStG).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON, Boolean, Column, Date, DateTime, ForeignKey, Integer,
    Numeric, String, Text, UniqueConstraint, Index, func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship

from app.database import Base


class PriceRegion(str, Enum):
    """Zones tarifaires du marché allemand (Regionalfaktoren BKI 2026).

    La valeur de l'énum est le code stable persisté en base ; ne pas
    renommer sans migration de données.
    """

    # Métropoles (indices de coût les plus élevés du marché)
    MUENCHEN = "de_by_muenchen"
    STUTTGART = "de_bw_stuttgart"
    FRANKFURT = "de_he_frankfurt"
    HAMBURG = "de_hh_hamburg"
    BERLIN = "de_be_berlin"
    KOELN = "de_nw_koeln"
    DUESSELDORF = "de_nw_duesseldorf"
    # Bundesländer hors grandes agglomérations
    BADEN_WUERTTEMBERG = "de_bw"
    BAYERN = "de_by"
    HESSEN = "de_he"
    NIEDERSACHSEN = "de_ni"
    NORDRHEIN_WESTFALEN = "de_nw"
    RHEINLAND_PFALZ = "de_rp"
    SAARLAND = "de_sl"
    SCHLESWIG_HOLSTEIN = "de_sh"
    BRANDENBURG = "de_bb"
    MECKLENBURG_VORPOMMERN = "de_mv"
    SACHSEN = "de_sn"
    SACHSEN_ANHALT = "de_st"
    THUERINGEN = "de_th"


class WorkCategory(str, Enum):
    """Kostengruppen exploitables par l'estimation (DIN 276, niveaux 3/4).

    KG 200-500 : coûts de construction propres ; les lots IFC mappés ici
    correspondent à la nomenclature allemande des Gewerke.
    """

    KG210_BAU_GRUND = "kg210_grundstueck_vorbereitung"       # Baugrundkosten
    KG300_BAUWERK = "kg300_bauwerk"                          # Agrégat fallback
    KG310_GRUENDUNG = "kg310_gruendung"                      # Fondations, semelles
    KG320_ROHBAU_WAENDE = "kg320_aussenwaende_rohbau"        # Tragende Außenwände
    KG330_INNENWAENDE = "kg330_innenwaende"                  # Nichttragende Wände
    KG340_DECKEN = "kg340_decken"                            # Plafonds / dalles
    KG350_DACHWERK = "kg350_dachwerk"                        # Charpente
    KG360_DACHHAUT = "kg360_dachhaut"                        # Dachabdichtung/-deckung
    KG361_FENSTER = "kg361_fenster_aussentueren"             # Fenster, Außentüren
    KG362_INNENTUEREN = "kg362_innentueren"                  # Türen, Zargen innen
    KG363_BELAEGE_WAND = "kg363_wandbelaege"                 # Wandbeläge
    KG364_BELAEGE_BODEN = "kg364_fussboden"                  # Fußbodenbeläge
    KG365_WAERMEDAEMMUNG = "kg365_waermedaemmung"            # Wärmedämmung / EnEV
    KG366_TREPPEN = "kg366_treppen_gelaender"                # Treppen, Geländer
    KG367_STAHLBAU = "kg367_stahlbau"                        # Stahltragwerk
    KG368_HOLZBAU = "kg368_holzbau"                          # Holztragwerk
    KG400_TGA = "kg400_technische_anlagen"                   # Agrégat TGA
    KG410_ABWASSER = "kg410_abwasser_wasser"                 # Sanitär
    KG420_HEIZUNG = "kg420_heizung"                          # Heizanlagen
    KG430_LUEFTUNG = "kg430_lueftung"                        # Lüftung / Klima
    KG440_ELEKTRO = "kg440_elektro"                          # Stark-/Schwachstrom
    KG500_AUSSENANLAGEN = "kg500_aussenanlagen"              # Außenanlagen


class PriceUnit(str, Enum):
    ML = "m"
    M2 = "m2"
    M3 = "m3"
    U = "st"          # Stück
    ENS = "pauschal"  # Pauschal
    KG = "kg"
    T = "t"
    H = "h"


class PriceItem(Base):
    __tablename__ = "price_items"
    __table_args__ = (
        UniqueConstraint("reference_code", "region", "valid_from"),
        Index("idx_price_items_search", "category", "ifc_type_mapping", "region"),
    )

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    reference_code = Column(String(50), nullable=False)
    designation = Column(Text, nullable=False)
    description_detail = Column(Text)
    category = Column(String(50), nullable=False)
    subcategory = Column(String(100))
    ifc_type_mapping = Column(String(100))
    ifc_material_filter = Column(String(200))
    unit = Column(String(10), nullable=False)
    unit_price_ht = Column(Numeric(12, 4), nullable=False)
    unit_price_ttc = Column(Numeric(12, 4))
    # Taux d'imposition allemand standard : USt 19 % (§ 12 Abs. 1 UStG).
    tva_rate = Column(Numeric(5, 2), default=Decimal("19.00"))
    material_cost = Column(Numeric(12, 4))
    labor_cost = Column(Numeric(12, 4))
    equipment_cost = Column(Numeric(12, 4))
    overhead_rate = Column(Numeric(5, 2))
    margin_rate = Column(Numeric(5, 2))
    region = Column(String(50), nullable=False)
    valid_from = Column(Date, nullable=False)
    valid_to = Column(Date)
    price_index_ref = Column(String(20))
    price_index_base = Column(Numeric(8, 2))
    source = Column(String(50))
    source_confidence = Column(Numeric(3, 2), default=Decimal("1.00"))
    tags = Column(JSON, default=list)
    tenant_id = Column(PG_UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    history = relationship("PriceItemHistory", back_populates="item")


class PriceItemHistory(Base):
    __tablename__ = "price_items_history"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    item_id = Column(PG_UUID(as_uuid=True), ForeignKey("price_items.id"))
    old_price = Column(Numeric(12, 4))
    new_price = Column(Numeric(12, 4))
    change_reason = Column(String(200))
    changed_at = Column(DateTime, default=func.now())
    changed_by = Column(String(100))

    item = relationship("PriceItem", back_populates="history")


class PriceIndexHistory(Base):
    __tablename__ = "price_index_history"
    __table_args__ = (UniqueConstraint("index_code", "reference_date"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    index_code = Column(String(20), nullable=False)
    index_name = Column(String(100))
    reference_date = Column(Date, nullable=False)
    index_value = Column(Numeric(8, 2), nullable=False)
    published_at = Column(DateTime, default=func.now())


class TenantPriceLibrary(Base):
    __tablename__ = "tenant_price_libraries"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(PG_UUID(as_uuid=True), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    base_region = Column(String(50))
    is_active = Column(Boolean, default=True)
    category_coefficients = Column(JSON, default=dict)
    supplier_discounts = Column(JSON, default=dict)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
