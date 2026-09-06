"""§82 — Colonne `users.avatar_json` : contenu réel de l'avatar (JSON).

La propagation de l'image entre comptes/navigateurs exige que le CONTENU
(pas seulement la clé §80) soit serveur. JSON texte validé à l'écriture
(photo ≤ 64 ko, emoji court), exposé via /members et /chat/users.

Revision ID: 20260809_10
Revises: 20260809_09
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "20260809_10"
down_revision = "20260809_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.add_column("users", sa.Column("avatar_json", sa.Text(), nullable=True))


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_column("users", "avatar_json")
