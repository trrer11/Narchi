"""§80 — Colonne `users.avatar_key` : avatar de compte persistant (self-service
PATCH /api/v5/members/me), dans la hiérarchie Büro 3 niveaux.

Revision ID: 20260809_08
Revises: 20260809_07
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "20260809_08"
down_revision = "20260809_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.add_column("users", sa.Column("avatar_key", sa.String(length=64), nullable=True))


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_column("users", "avatar_key")
