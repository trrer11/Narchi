"""§163 — Synchro des VE-Varianten : table ve_variant_mirrors.

Les VE-Varianten (§160) vivaient en localStorage (un seul poste). Même
vérité partagée que project_mirrors (§118) : id appareil (upsert
idempotent), updated_at porté par l'appareil (LWW), pierre tombale. Le
payload JSON porte la variante complète ; seuls id/name sont des colonnes.

Table neuve, additive. Ignorée proprement hors PostgreSQL (tests SQLite).

Revision ID: 20260817_19
Revises: 20260813_18
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op

revision = "20260817_19"
down_revision = "20260813_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "ve_variant_mirrors",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "id"),
    )
    op.create_index("ix_ve_variant_mirrors_tenant_id", "ve_variant_mirrors", ["tenant_id"])
    op.create_index("ix_ve_variant_mirrors_deleted_at", "ve_variant_mirrors", ["deleted_at"])
    op.create_index("ix_ve_variant_mirrors_updated_at", "ve_variant_mirrors", ["updated_at"])
    op.create_index(
        "ix_ve_variant_mirrors_tenant_updated",
        "ve_variant_mirrors",
        ["tenant_id", "updated_at"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_ve_variant_mirrors_tenant_updated", table_name="ve_variant_mirrors")
    op.drop_index("ix_ve_variant_mirrors_updated_at", table_name="ve_variant_mirrors")
    op.drop_index("ix_ve_variant_mirrors_deleted_at", table_name="ve_variant_mirrors")
    op.drop_index("ix_ve_variant_mirrors_tenant_id", table_name="ve_variant_mirrors")
    op.drop_table("ve_variant_mirrors")
