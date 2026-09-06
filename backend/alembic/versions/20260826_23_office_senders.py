"""§265 office_senders — Büro-Absender XRechnung

Revision ID: 20260826_23
Revises: 20260826_22
"""
import sqlalchemy as sa
from alembic import op

revision = "20260826_23"
down_revision = "20260826_22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "office_senders",
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("street", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("zip", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("city", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("country", sa.String(length=2), nullable=False, server_default="DE"),
        sa.Column("vat_id", sa.String(length=30), nullable=False, server_default=""),
        sa.Column("iban", sa.String(length=34), nullable=False, server_default=""),
        sa.Column("bic", sa.String(length=11), nullable=False, server_default=""),
        sa.Column("account_name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("email", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("contact_name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("contact_phone", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("contact_email", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("tenant_id"),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_table("office_senders")
