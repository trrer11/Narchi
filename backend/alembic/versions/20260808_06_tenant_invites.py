"""§68 — Table `tenant_invites` : invitations par lien signé (72 h, usage
unique, révocables) pour ouvrir la bêta sans créer les comptes à la main.

Opération ignorée proprement hors dialecte PostgreSQL (les tests SQLite
créent la table via ``Base.metadata.create_all`` ciblé).

Revision ID: 20260808_06
Revises: 20260808_05
Create Date: 2026-08-08
"""

import sqlalchemy as sa
from alembic import op

revision = "20260808_06"
down_revision = "20260808_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "tenant_invites",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("invited_email", sa.String(length=320), nullable=True),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by_email", sa.String(length=320), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tenant_invites_jti", "tenant_invites", ["jti"], unique=True)
    op.create_index("ix_tenant_invites_tenant_created", "tenant_invites", ["tenant_id", "created_at"])
    op.create_index("ix_tenant_invites_tenant_id", "tenant_invites", ["tenant_id"])


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_tenant_invites_tenant_id", table_name="tenant_invites")
    op.drop_index("ix_tenant_invites_tenant_created", table_name="tenant_invites")
    op.drop_index("ix_tenant_invites_jti", table_name="tenant_invites")
    op.drop_table("tenant_invites")
