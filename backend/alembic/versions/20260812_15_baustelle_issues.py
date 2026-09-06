"""§115 — Mängel serveur : table baustelle_issues (synchro inter-appareils, étape 1).

Carte blanche du client confirmée (« GO ») : la synchro téléphone ↔ bureau
est l'étape suivante de mon propre rapport §112/P1. Cette table est la
VÉRITÉ PARTAGÉE : ids fournis par les clients (upsert idempotent),
updated_at porté par l'appareil (dernier-écrivain-gagne, limite dite :
horloge déréglée = son tort documenté), suppression en pierre tombale
(deleted_at) pour que le delta des autres appareils apprenne la
suppression — physiquement effacer rendrait le delta muet.

Table neuve, additive : aucune donnée existante altérée. Ignorée
proprement hors dialecte PostgreSQL (tests SQLite, create_all suffit).

Revision ID: 20260812_15
Revises: 20260811_14
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_15"
down_revision = "20260811_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "baustelle_issues",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("day", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("zone", sa.String(), nullable=False, server_default=""),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("photo_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("video_ids", sa.JSON(), nullable=False, server_default="[]"),
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
    op.create_index("ix_baustelle_issues_tenant_id", "baustelle_issues", ["tenant_id"])
    op.create_index("ix_baustelle_issues_project_id", "baustelle_issues", ["project_id"])
    op.create_index("ix_baustelle_issues_deleted_at", "baustelle_issues", ["deleted_at"])
    op.create_index("ix_baustelle_issues_updated_at", "baustelle_issues", ["updated_at"])
    op.create_index(
        "ix_baustelle_issues_tenant_project", "baustelle_issues", ["tenant_id", "project_id"]
    )
    op.create_index(
        "ix_baustelle_issues_tenant_updated", "baustelle_issues", ["tenant_id", "updated_at"]
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for nom in (
        "ix_baustelle_issues_tenant_updated",
        "ix_baustelle_issues_tenant_project",
        "ix_baustelle_issues_updated_at",
        "ix_baustelle_issues_deleted_at",
        "ix_baustelle_issues_project_id",
        "ix_baustelle_issues_tenant_id",
    ):
        op.drop_index(nom, table_name="baustelle_issues")
    op.drop_table("baustelle_issues")
