"""§81 — Table `collab_docs` : état binaire CRDT persistant (V2.7 étape 2).

Dernier état complet par salle cloisonnée (PK = « tenant:salle »). Pas de
PG spécifique hors types courants ; opération ignorée hors PostgreSQL
(SQLite : create_all ciblé dans les tests, LF allembic hors dialecte).

Revision ID: 20260809_09
Revises: 20260809_08
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "20260809_09"
down_revision = "20260809_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "collab_docs",
        sa.Column("id", sa.String(length=256), primary_key=True),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("room", sa.String(length=80), nullable=False),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_collab_docs_tenant_id", "collab_docs", ["tenant_id"])


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_collab_docs_tenant_id", table_name="collab_docs")
    op.drop_table("collab_docs")
