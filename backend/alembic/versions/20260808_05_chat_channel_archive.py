"""§59 — Archivage doux des canaux projet orphelins (chat_channels.archived_at).

Constat utilisateur (capture 2026-08-07) : la messagerie listait 6 canaux
« meuble final.ifc » identiques. Cause : chaque import IFC régénère côté
frontend un nouvel identifiant de projet, et ``ensure_channels`` crée un
canal ``ch-project-<id>`` par identifiant — les canaux des incarnations
supprimées/remplacées du projet restaient visibles POUR TOUJOURS (aucun code
ne supprimait ni ne masquait un canal projet).

Décision data (charte « aucune perte silencieuse ») : cette colonne permet de
MASQUER un canal projet disparu du catalogue actif sans jamais détruire
l'historique — la réconciliation dans ``ensure_channels`` archive et
désarchive en fonction du catalogue transmis par le frontend ; seul le
chemin EXPLICITE (catalogue non vide envoyé par l'app) réconcilie, jamais le
repli « 20 derniers projets ».

L'opération est ignorée proprement hors dialecte PostgreSQL (tests SQLite,
où ``Base.metadata.create_all`` fournit déjà la colonne).

Revision ID: 20260808_05
Revises: 20260808_04
Create Date: 2026-08-07
"""

import sqlalchemy as sa
from alembic import op

revision = "20260808_05"
down_revision = "20260808_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.add_column(
        "chat_channels",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_chat_channels_archived_at",
        "chat_channels",
        ["archived_at"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_chat_channels_archived_at", table_name="chat_channels")
    op.drop_column("chat_channels", "archived_at")
