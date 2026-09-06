"""§86 — Table `collab_doc_snapshots` : historique de versions Notiz.

Instantanés binaires CRDT complets (rejouables bit-pour-bit), 25 max par
salle (plafond affiché côté UI — jamais de rétention silencieuse).

Revision ID: 20260809_11
Revises: 20260809_10
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "20260809_11"
down_revision = "20260809_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "collab_doc_snapshots",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("doc_id", sa.String(256), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False),
        sa.Column("room", sa.String(80), nullable=False),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("chars", sa.Integer(), nullable=False),
        sa.Column("preview", sa.String(120), nullable=False, server_default=""),
        sa.Column("trigger", sa.String(8), nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.Column("created_by_name", sa.String(140), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_collab_doc_snapshots_doc_id", "collab_doc_snapshots", ["doc_id"])
    op.create_index("ix_collab_doc_snapshots_tenant_id", "collab_doc_snapshots", ["tenant_id"])


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_collab_doc_snapshots_tenant_id", table_name="collab_doc_snapshots")
    op.drop_index("ix_collab_doc_snapshots_doc_id", table_name="collab_doc_snapshots")
    op.drop_table("collab_doc_snapshots")
