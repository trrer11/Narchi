"""§96 — Table `price_observations` : base du Preisspiegel (§95 → §96).

Revision ID: 20260810_13
Revises: 20260810_12
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "20260810_13"
down_revision = "20260810_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "price_observations",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("offer_id", sa.String(40), nullable=False),
        sa.Column("oz", sa.String(64), nullable=False),
        sa.Column("kurztext", sa.String(500), nullable=False),
        sa.Column("einheit", sa.String(24), nullable=False, server_default=""),
        sa.Column("ep_cents", sa.Integer(), nullable=False),
        sa.Column("preisstand_jahr", sa.Integer(), nullable=False),
        sa.Column("source_label", sa.String(255), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("taken_by", sa.String(64), nullable=True),
        sa.Column("taken_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "offer_id", "oz", name="uq_price_obs_tenant_offer_oz",
        ),
    )
    op.create_index(
        "ix_price_observations_tenant_id", "price_observations", ["tenant_id"],
    )
    op.create_index(
        "ix_price_obs_tenant_oz", "price_observations", ["tenant_id", "oz"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_price_obs_tenant_oz", table_name="price_observations")
    op.drop_index("ix_price_observations_tenant_id", table_name="price_observations")
    op.drop_table("price_observations")
