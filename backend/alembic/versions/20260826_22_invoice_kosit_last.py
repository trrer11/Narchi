"""§264 invoices.kosit_last — last official KoSIT CII+UBL verdict

Revision ID: 20260826_22
Revises: 20260825_21
"""
import sqlalchemy as sa
from alembic import op

revision = "20260826_22"
down_revision = "20260825_21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.add_column("invoices", sa.Column("kosit_last", sa.JSON(), nullable=True))
    op.add_column(
        "invoices",
        sa.Column("kosit_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_column("invoices", "kosit_checked_at")
    op.drop_column("invoices", "kosit_last")
