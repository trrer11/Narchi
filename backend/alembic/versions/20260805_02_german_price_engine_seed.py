"""Tables ORM d'estimation + seeding prix marché allemand 2026.

Revision ID: 20260805_02
Revises: 20260715_01
Create Date: 2026-08-05

- Crée les tables ORM du moteur d'estimation (price_items & cie) absentes
  de la chaîne vivante — avec défaut USt 19 % natif (§ 12 UStG).
- Seed les 18 zones tarifaires (de_regions_2026) en cohérence avec les
  Regionalfaktoren du Kalkulationskern NARCHI.
- Seed les prix de référence par Kostengruppe (de_price_items_2026 et
  price_items × 18 zones). Source interne NARCHI (narchi_referenz_2026).
Idempotent : les lignes marquées « narchi_referenz_2026 » sont purgées avant
réinsertion ; les tables existantes ne sont jamais recréées.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# env.py place la racine backend dans sys.path : import de données pures,
# sans dépendance réseau ni session — compatible `alembic --sql` (offline).
from app.core.estimation.german_price_seed import GERMAN_REFERENCE_PRICES

revision: str = "20260805_02"
down_revision: Union[str, Sequence[str], None] = "20260715_01"
branch_labels = None
depends_on = None

SEED_SOURCE = "narchi_referenz_2026"
SEED_TENANT = "system"
VALID_FROM = date(2026, 1, 1)

# (code de_regions ≤ 10 car., code PriceRegion ORM, Bundesland, Stadt,
#  nom DE, nom FR, cost/lohn/material index, PLZ-Bereich, markt_lage)
DE_REGIONS = [
    ("MUENCHEN", "de_by_muenchen", "Bayern", "München", "München (Landeshauptstadt)", "Munich", "1.142", "1.148", "1.103", "80-81", "sehr_angespannt"),
    ("STUTTGART", "de_bw_stuttgart", "Baden-Württemberg", "Stuttgart", "Stuttgart (Landeshauptstadt)", "Stuttgart", "1.124", "1.131", "1.094", "70-72", "sehr_angespannt"),
    ("FRANKFURT", "de_he_frankfurt", "Hessen", "Frankfurt am Main", "Frankfurt a.M.", "Francfort", "1.096", "1.102", "1.071", "60-61", "angespannt"),
    ("HAMBURG", "de_hh_hamburg", "Hamburg", "Hamburg", "Hamburg (Freie und Hansestadt)", "Hambourg", "1.088", "1.094", "1.066", "20-22", "angespannt"),
    ("BERLIN", "de_be_berlin", "Berlin", "Berlin", "Berlin (Landeshauptstadt)", "Berlin", "1.072", "1.078", "1.055", "10-14", "angespannt"),
    ("KOELN", "de_nw_koeln", "Nordrhein-Westfalen", "Köln", "Köln", "Cologne", "1.054", "1.058", "1.041", "50-51", "normal"),
    ("DUSSELDORF", "de_nw_duesseldorf", "Nordrhein-Westfalen", "Düsseldorf", "Düsseldorf (Landeshauptstadt)", "Düsseldorf", "1.049", "1.053", "1.038", "40-41", "normal"),
    ("BW", "de_bw", "Baden-Württemberg", None, "Baden-Württemberg (Fläche)", "Bade-Wurtemberg", "1.036", "1.040", "1.021", "68-79, 88-89", "normal"),
    ("BY", "de_by", "Bayern", None, "Bayern (Fläche)", "Bavière", "1.024", "1.028", "1.012", "82-87, 90-97", "normal"),
    ("HE", "de_he", "Hessen", None, "Hessen (Fläche)", "Hesse", "1.018", "1.021", "1.008", "34-36, 61-65", "normal"),
    ("NW", "de_nw", "Nordrhein-Westfalen", None, "Nordrhein-Westfalen (Fläche)", "Rhénanie-du-Nord-Westphalie", "1.006", "1.009", "0.998", "42-49, 52-59", "normal"),
    ("SH", "de_sh", "Schleswig-Holstein", None, "Schleswig-Holstein", "Schleswig-Holstein", "1.002", "1.004", "0.996", "23-25", "normal"),
    ("RP", "de_rp", "Rheinland-Pfalz", None, "Rheinland-Pfalz", "Rhénanie-Palatinat", "0.998", "0.999", "0.994", "54-56, 66-68", "normal"),
    ("NI", "de_ni", "Niedersachsen", None, "Niedersachsen", "Basse-Saxe", "0.994", "0.994", "0.993", "26-31, 37-39, 49", "normal"),
    ("BB", "de_bb", "Brandenburg", None, "Brandenburg", "Brandebourg", "0.968", "0.961", "0.971", "01-03, 14-16", "normal"),
    ("SL", "de_sl", "Saarland", None, "Saarland", "Sarre", "0.956", "0.949", "0.965", "66-66", "normal"),
    ("SN", "de_sn", "Sachsen", None, "Sachsen", "Saxe", "0.934", "0.922", "0.951", "01-09, 08", "ruhig"),
    ("MV", "de_mv", "Mecklenburg-Vorpommern", None, "Mecklenburg-Vorpommern", "Mecklembourg-Poméranie-Occidentale", "0.928", "0.916", "0.947", "17-19", "ruhig"),
    ("TH", "de_th", "Thüringen", None, "Thüringen", "Thuringe", "0.921", "0.908", "0.944", "98-99", "ruhig"),
    ("ST", "de_st", "Sachsen-Anhalt", None, "Sachsen-Anhalt", "Saxe-Anhalt", "0.918", "0.905", "0.941", "06-07, 38-39", "ruhig"),
]

# Correspondance catégorie interne → code KG affiché + libellé DE.
KG_DISPLAY = {
    "kg210_grundstueck_vorbereitung": ("KG 210", "Baugrund, Herrichten"),
    "kg310_gruendung": ("KG 310", "Gründung"),
    "kg320_aussenwaende_rohbau": ("KG 320", "Tragende Außenwände"),
    "kg330_innenwaende": ("KG 330", "Innenwände"),
    "kg340_decken": ("KG 340", "Decken"),
    "kg350_dachwerk": ("KG 350", "Dachwerk"),
    "kg360_dachhaut": ("KG 360", "Dachabdichtung, -deckung"),
    "kg361_fenster_aussentueren": ("KG 361", "Fenster, Außentüren"),
    "kg362_innentueren": ("KG 362", "Innentüren"),
    "kg363_wandbelaege": ("KG 363", "Wandbeläge"),
    "kg364_fussboden": ("KG 364", "Fußbodenbeläge"),
    "kg365_waermedaemmung": ("KG 365", "Wärmedämmung"),
    "kg366_treppen_gelaender": ("KG 366", "Treppen, Geländer"),
    "kg367_stahlbau": ("KG 367", "Stahlbau"),
    "kg368_holzbau": ("KG 368", "Holzbau"),
    "kg410_abwasser_wasser": ("KG 410", "Abwasser, Wasser, Gas"),
    "kg420_heizung": ("KG 420", "Heizung"),
    "kg430_lueftung": ("KG 430", "Lüftung"),
    "kg440_elektro": ("KG 440", "Elektroanlagen"),
    "kg500_aussenanlagen": ("KG 500", "Außenanlagen"),
}


def _inspector():
    return sa.inspect(op.get_bind())


def _create_estimation_tables() -> None:
    existing = set(_inspector().get_table_names())

    if "price_items" not in existing:
        op.create_table(
            "price_items",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("reference_code", sa.String(50), nullable=False),
            sa.Column("designation", sa.Text, nullable=False),
            sa.Column("description_detail", sa.Text),
            sa.Column("category", sa.String(50), nullable=False),
            sa.Column("subcategory", sa.String(100)),
            sa.Column("ifc_type_mapping", sa.String(100)),
            sa.Column("ifc_material_filter", sa.String(200)),
            sa.Column("unit", sa.String(10), nullable=False),
            sa.Column("unit_price_ht", sa.Numeric(12, 4), nullable=False),
            sa.Column("unit_price_ttc", sa.Numeric(12, 4)),
            # Défaut natif marché allemand : USt 19 % (§ 12 Abs. 1 UStG).
            sa.Column("tva_rate", sa.Numeric(5, 2), default=19.00),
            sa.Column("material_cost", sa.Numeric(12, 4)),
            sa.Column("labor_cost", sa.Numeric(12, 4)),
            sa.Column("equipment_cost", sa.Numeric(12, 4)),
            sa.Column("overhead_rate", sa.Numeric(5, 2)),
            sa.Column("margin_rate", sa.Numeric(5, 2)),
            sa.Column("region", sa.String(50), nullable=False),
            sa.Column("valid_from", sa.Date, nullable=False),
            sa.Column("valid_to", sa.Date),
            sa.Column("price_index_ref", sa.String(20)),
            sa.Column("price_index_base", sa.Numeric(8, 2)),
            sa.Column("source", sa.String(50)),
            sa.Column("source_confidence", sa.Numeric(3, 2), default=1.00),
            sa.Column("tags", postgresql.JSON, default=list),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
            sa.UniqueConstraint("reference_code", "region", "valid_from"),
        )
        op.create_index("idx_price_items_search", "price_items", ["category", "ifc_type_mapping", "region"])

    if "price_items_history" not in existing:
        op.create_table(
            "price_items_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("price_items.id")),
            sa.Column("old_price", sa.Numeric(12, 4)),
            sa.Column("new_price", sa.Numeric(12, 4)),
            sa.Column("change_reason", sa.String(200)),
            sa.Column("changed_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("changed_by", sa.String(100)),
        )

    if "price_index_history" not in existing:
        op.create_table(
            "price_index_history",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("index_code", sa.String(20), nullable=False),
            sa.Column("index_name", sa.String(100)),
            sa.Column("reference_date", sa.Date, nullable=False),
            sa.Column("index_value", sa.Numeric(8, 2), nullable=False),
            sa.Column("published_at", sa.DateTime, server_default=sa.func.now()),
            sa.UniqueConstraint("index_code", "reference_date"),
        )

    if "estimation_versions" not in existing:
        op.create_table(
            "estimation_versions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("estimation_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("version_number", sa.Integer, nullable=False),
            sa.Column("version_label", sa.String(100)),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("estimation_data", postgresql.JSON, nullable=False),
            sa.Column("total_ht", sa.Numeric(14, 2)),
            sa.Column("total_ttc", sa.Numeric(14, 2)),
            sa.Column("element_count", sa.Integer),
            sa.Column("confidence_score", sa.Numeric(3, 2)),
            sa.Column("created_by", sa.String(200)),
            sa.Column("change_reason", sa.Text),
            sa.Column("parent_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("estimation_versions.id"), nullable=True),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        )

    if "tenant_price_libraries" not in existing:
        op.create_table(
            "tenant_price_libraries",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("base_region", sa.String(50)),
            sa.Column("is_active", sa.Boolean, default=True),
            sa.Column("category_coefficients", postgresql.JSON, default=dict),
            sa.Column("supplier_discounts", postgresql.JSON, default=dict),
            sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        )


def _seed_regions() -> None:
    regions_table = sa.table(
        "de_regions_2026",
        sa.column("code", sa.String), sa.column("bundesland", sa.String),
        sa.column("stadt", sa.String), sa.column("name_de", sa.String),
        sa.column("name_fr", sa.String), sa.column("cost_index", sa.Numeric),
        sa.column("lohn_index", sa.Numeric), sa.column("material_index", sa.Numeric),
        sa.column("plz_bereich", sa.String), sa.column("markt_lage", sa.String),
        sa.column("gueltig_ab", sa.Date), sa.column("tenant_id", sa.String),
    )
    op.execute(
        regions_table.delete().where(regions_table.c.tenant_id == SEED_TENANT)
    )
    op.bulk_insert(regions_table, [
        {
            "code": code, "bundesland": bundesland, "stadt": stadt,
            "name_de": name_de, "name_fr": name_fr,
            "cost_index": Decimal(cost), "lohn_index": Decimal(lohn),
            "material_index": Decimal(material), "plz_bereich": plz,
            "markt_lage": lage, "gueltig_ab": VALID_FROM, "tenant_id": SEED_TENANT,
        }
        for (code, _orm, bundesland, stadt, name_de, name_fr,
             cost, lohn, material, plz, lage) in DE_REGIONS
    ])


def _seed_de_price_items() -> None:
    items_table = sa.table(
        "de_price_items_2026",
        sa.column("id", postgresql.UUID), sa.column("item_code", sa.String),
        sa.column("bezeichnung_de", sa.String), sa.column("kg_code", sa.String),
        sa.column("kg_label_de", sa.String), sa.column("ifc_entity", sa.String),
        sa.column("ifc_type", sa.String), sa.column("einheit", sa.String),
        sa.column("preis_basis", sa.Numeric), sa.column("material_anteil_pct", sa.Numeric),
        sa.column("lohn_anteil_pct", sa.Numeric), sa.column("gueltig_q", sa.String),
        sa.column("keywords", postgresql.ARRAY(sa.Text())),
    )
    op.execute(
        items_table.delete().where(
            items_table.c.keywords.contains(["narchi_referenz_2026"])
        )
    )
    rows = []
    for (reference_code, designation, category, material_filter,
         ifc_type, unit, base_price, material_share, labor_share) in GERMAN_REFERENCE_PRICES:
        kg_code, kg_label = KG_DISPLAY.get(category, ("KG 300", "Bauwerk"))
        rows.append({
            "id": uuid.uuid4(),
            "item_code": reference_code,
            "bezeichnung_de": designation,
            "kg_code": kg_code,
            "kg_label_de": kg_label,
            "ifc_entity": ifc_type,
            "ifc_type": ifc_type,
            "einheit": unit,
            "preis_basis": Decimal(base_price),
            "material_anteil_pct": (Decimal(material_share) * 100).quantize(Decimal("0.1")),
            "lohn_anteil_pct": (Decimal(labor_share) * 100).quantize(Decimal("0.1")),
            "gueltig_q": "Q1/2026",
            "keywords": ["narchi_referenz_2026", "din276", "deutschland"],
        })
    op.bulk_insert(items_table, rows)


def _seed_price_items() -> None:
    price_table = sa.table(
        "price_items",
        sa.column("id", postgresql.UUID), sa.column("reference_code", sa.String),
        sa.column("designation", sa.Text), sa.column("category", sa.String),
        sa.column("ifc_type_mapping", sa.String), sa.column("ifc_material_filter", sa.String),
        sa.column("unit", sa.String), sa.column("unit_price_ht", sa.Numeric),
        sa.column("tva_rate", sa.Numeric), sa.column("material_cost", sa.Numeric),
        sa.column("labor_cost", sa.Numeric), sa.column("region", sa.String),
        sa.column("valid_from", sa.Date), sa.column("price_index_ref", sa.String),
        sa.column("source", sa.String), sa.column("source_confidence", sa.Numeric),
        sa.column("tags", postgresql.JSON), sa.column("tenant_id", postgresql.UUID),
    )
    op.execute(
        price_table.delete().where(price_table.c.source == SEED_SOURCE)
    )
    rows = []
    for (_de_code, region_orm, _bl, _st, _nd, _nf, cost, _lohn, _mat, _plz, _lage) in DE_REGIONS:
        factor = Decimal(cost)
        for (reference_code, designation, category, material_filter,
             ifc_type, unit, base_price, material_share, labor_share) in GERMAN_REFERENCE_PRICES:
            regional = (Decimal(base_price) * factor).quantize(Decimal("0.0001"))
            rows.append({
                "id": uuid.uuid4(),
                "reference_code": f"{reference_code}-{region_orm}",
                "designation": designation,
                "category": category,
                "ifc_type_mapping": ifc_type,
                "ifc_material_filter": material_filter,
                "unit": unit,
                "unit_price_ht": regional,
                "tva_rate": Decimal("19.00"),
                "material_cost": (regional * Decimal(material_share)).quantize(Decimal("0.0001")),
                "labor_cost": (regional * Decimal(labor_share)).quantize(Decimal("0.0001")),
                "region": region_orm,
                "valid_from": VALID_FROM,
                "price_index_ref": "BPI-Hochbau-2021",
                "source": SEED_SOURCE,
                "source_confidence": Decimal("0.85"),
                "tags": ["din276", "deutschland", "2026", "referenz"],
                "tenant_id": None,
            })
    op.bulk_insert(price_table, rows)


def upgrade() -> None:
    _create_estimation_tables()
    _seed_regions()
    _seed_de_price_items()
    _seed_price_items()


def downgrade() -> None:
    price_table = sa.table("price_items", sa.column("source", sa.String))
    op.execute(price_table.delete().where(price_table.c.source == SEED_SOURCE))
    items_table = sa.table("de_price_items_2026", sa.column("keywords", postgresql.ARRAY(sa.Text())))
    op.execute(items_table.delete().where(items_table.c.keywords.contains(["narchi_referenz_2026"])))
    regions_table = sa.table("de_regions_2026", sa.column("tenant_id", sa.String))
    op.execute(regions_table.delete().where(regions_table.c.tenant_id == SEED_TENANT))
    op.drop_table("tenant_price_libraries")
    op.drop_table("estimation_versions")
    op.drop_table("price_index_history")
    op.drop_table("price_items_history")
    op.drop_table("price_items")
