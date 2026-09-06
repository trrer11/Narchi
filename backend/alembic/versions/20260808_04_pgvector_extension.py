"""§51 — Extension pgvector : le RAG normatif vit désormais dans PostgreSQL.

Remplace le serveur vectoriel externe (Qdrant) par l'extension ``vector`` du
même cluster PostgreSQL 16 que le reste des données NARCHI :

- une seule base à sauvegarder (pgBackRest couvre aussi les embeddings) ;
- une surface réseau de moins, aucun service supplémentaire à nourrir ;
- DSGVO : les vecteurs tenant restent dans le même périmètre que les données.

Honnêteté technique : cette migration crée UNIQUEMENT l'extension. Les tables
``langchain_pg_collection`` / ``langchain_pg_embedding`` sont créées à la
première utilisation par ``langchain_postgres.PGVector`` (``use_jsonb=True``,
``pre_delete_collection=False``) — le diagnostic d'exécution les signale donc
légitimement « absentes » tant qu'aucun audit IA n'a été lancé.

L'opération est ignorée proprement hors dialecte PostgreSQL (tests SQLite).

Revision ID: 20260808_04
Revises: 20260807_03
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "20260808_04"
down_revision = "20260807_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # L'extension est fournie par l'image db (pgvector/pgvector:0.8.6-pg16).
    # IF NOT EXISTS : ré-exécution et restauration de sauvegarde sans risque.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # CASCADE : les colonnes/tables vectorielles éventuelles suivent
    # l'extension — un downgrade est un retour complet en arrière.
    op.execute("DROP EXTENSION IF EXISTS vector CASCADE")
