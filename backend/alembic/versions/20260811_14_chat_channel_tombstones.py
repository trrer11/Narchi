"""§110 — Pierres tombales des canaux auto-gérés supprimés (chat_channel_tombstones).

Demande client (11 août 2026) : « owner et admin doivent pouvoir supprimer
une DISCUSSION » — toutes les discussions, pas seulement les messages
directs. Or les canaux équipe/projet sont AUTO-GÉRÉS : leur identifiant
est déterministe et ``ensure_channels`` (synchro à chaque ouverture de la
messagerie) recrée tout canal absent. Supprimer sans pierre tombale =
théâtre : le canal renaîtrait à la prochaine synchro, sous les yeux du
client.

Cette table mémorise les ids supprimés explicitement ;
``_ensure_base_channels`` les saute désormais (suppression réelle et
durable). Aucune donnée existante n'est altérée (table neuve, additive).

L'opération est ignorée proprement hors dialecte PostgreSQL (tests
SQLite, où ``Base.metadata.create_all`` fournit déjà la table).

Revision ID: 20260811_14
Revises: 20260810_13
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op

revision = "20260811_14"
down_revision = "20260810_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "chat_channel_tombstones",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("deleted_by", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_chat_channel_tombstones_tenant_id",
        "chat_channel_tombstones",
        ["tenant_id"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index(
        "ix_chat_channel_tombstones_tenant_id",
        table_name="chat_channel_tombstones",
    )
    op.drop_table("chat_channel_tombstones")
