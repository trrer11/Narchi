"""§118 — Synchro des Projets : table project_mirrors.

Plainte client : « je ne peux pas voir un projet importé sur l'autre
compte ». Sans vérité partagée des Projets, le Mangel synchronisé
(§115/§117) restait « garé » faute de projet local. Mêmes lois que
baustelle_issues : id client (upsert idempotent), updated_at porté par
l'appareil (LWW), pierre tombale pour les suppressions. Le payload JSON
porte la fiche complète ; seuls id/name sont des colonnes.

(Les médias photo/vidéo §118 vivent en FICHIERS dans le volume
narchi_storage — aucune colonne binaire : la sauvegarde PostgreSQL §113
reste instantanée.)

Table neuve, additive. Ignorée proprement hors PostgreSQL (tests SQLite).

Revision ID: 20260812_17
Revises: 20260812_16
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_17"
down_revision = "20260812_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "project_mirrors",
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
    op.create_index("ix_project_mirrors_tenant_id", "project_mirrors", ["tenant_id"])
    op.create_index("ix_project_mirrors_deleted_at", "project_mirrors", ["deleted_at"])
    op.create_index("ix_project_mirrors_updated_at", "project_mirrors", ["updated_at"])
    op.create_index(
        "ix_project_mirrors_tenant_updated",
        "project_mirrors",
        ["tenant_id", "updated_at"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_project_mirrors_tenant_updated", table_name="project_mirrors")
    op.drop_index("ix_project_mirrors_updated_at", table_name="project_mirrors")
    op.drop_index("ix_project_mirrors_deleted_at", table_name="project_mirrors")
    op.drop_index("ix_project_mirrors_tenant_id", table_name="project_mirrors")
    op.drop_table("project_mirrors")
