"""§202 office_blob_mirrors

Revision ID: 20260823_20
Revises: 20260817_19
"""
import sqlalchemy as sa
from alembic import op

revision = "20260823_20"
down_revision = "20260817_19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "office_blob_mirrors",
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "kind"),
    )
    op.create_index("ix_office_blob_mirrors_updated_at", "office_blob_mirrors", ["updated_at"])
    op.create_index(
        "ix_office_blob_mirrors_tenant_updated",
        "office_blob_mirrors",
        ["tenant_id", "updated_at"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_office_blob_mirrors_tenant_updated", table_name="office_blob_mirrors")
    op.drop_index("ix_office_blob_mirrors_updated_at", table_name="office_blob_mirrors")
    op.drop_table("office_blob_mirrors")
