"""§91 — Table `gaeb_offers` : offres d'entreprises (GAEB entrant).

Montants en centimes entiers, XML brut conservé (audit), compteurs
calculés à l'import et stockés — pas de recompte divergent ensuite.

Revision ID: 20260810_12
Revises: 20260809_11
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "20260810_12"
down_revision = "20260809_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "gaeb_offers",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("room", sa.String(80), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("filename", sa.String(200), nullable=False, server_default=""),
        sa.Column("dp", sa.String(4), nullable=False, server_default="31"),
        sa.Column("cur", sa.String(4), nullable=False, server_default="EUR"),
        sa.Column("xml_raw", sa.LargeBinary(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("items_json", sa.Text(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("ohne_preis_count", sa.Integer(), nullable=False),
        sa.Column("gp_total_cents", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_by_name", sa.String(140), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_gaeb_offers_tenant_id", "gaeb_offers", ["tenant_id"])
    op.create_index("ix_gaeb_offers_room", "gaeb_offers", ["room"])


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_gaeb_offers_room", table_name="gaeb_offers")
    op.drop_index("ix_gaeb_offers_tenant_id", table_name="gaeb_offers")
    op.drop_table("gaeb_offers")
