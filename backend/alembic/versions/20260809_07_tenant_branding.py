"""§77 — Table `tenant_brandings` : logo + nom du bureau pour le PDF client
(« PDF avec MON logo », V1.2 waw). Une ligne par tenant (unique gravé).

Opération ignorée proprement hors dialecte PostgreSQL (les tests SQLite
créent la table via ``Base.metadata.create_all`` ciblé).

Revision ID: 20260809_07
Revises: 20260808_06
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "20260809_07"
down_revision = "20260808_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "tenant_brandings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("office_name", sa.String(length=120), nullable=True),
        sa.Column("logo_mime", sa.String(length=32), nullable=True),
        sa.Column("logo_b64", sa.Text(), nullable=True),
        sa.Column("logo_bytes", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_brandings_tenant"),
    )
    op.create_index(
        "ix_tenant_brandings_tenant_id", "tenant_brandings", ["tenant_id"]
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_tenant_brandings_tenant_id", table_name="tenant_brandings")
    op.drop_table("tenant_brandings")
