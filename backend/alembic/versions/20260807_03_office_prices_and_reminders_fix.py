"""§50 — Bibliothèque de prix du bureau + CORRECTIF table reminders (§46)

Revision ID: 20260807_03
Revises: 20260805_02
Create Date: 2026-08-07

1) Crée ``office_prices`` : positions tarifaires propres à chaque bureau
   (import CSV/GAEB X31), cloisonnées par tenant, indexées Destatis à l'usage.
2) CORRECTIF CRITIQUE §46 : la table ``reminders`` n'avait JAMAIS eu de
   migration — en prod Docker elle n'existait pas (le worker tournait dans le
   vide, /sync aurait levé UndefinedTable). Créée ici, idempotente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260807_03"
down_revision: Union[str, Sequence[str], None] = "20260805_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(inspector: sa.engine.reflection.Inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_table(inspector, "office_prices"):
        op.create_table(
            "office_prices",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("tenant_id", sa.String(), nullable=False),
            sa.Column("uploaded_by", sa.String(), nullable=False),
            sa.Column("oz", sa.String(length=64), nullable=False),
            sa.Column("kurztext", sa.String(length=500), nullable=False),
            sa.Column("langtext", sa.String(), nullable=True),
            sa.Column("einheit", sa.String(length=24), nullable=False),
            sa.Column("einheitspreis_netto", sa.Numeric(14, 2), nullable=False),
            sa.Column("preisstand_jahr", sa.Integer(), nullable=False),
            sa.Column("kostengruppe", sa.String(length=64), nullable=True),
            sa.Column("kg_confiance", sa.Float(), nullable=True),
            sa.Column("source_file", sa.String(length=255), nullable=False),
            sa.Column("source_kind", sa.String(length=8), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "oz", name="uq_office_prices_tenant_oz"),
        )
        op.create_index("ix_office_prices_tenant_id", "office_prices", ["tenant_id"])
        op.create_index("ix_office_prices_uploaded_by", "office_prices", ["uploaded_by"])
        op.create_index("ix_office_prices_kostengruppe", "office_prices", ["kostengruppe"])
        op.create_index("ix_office_prices_tenant_kg", "office_prices", ["tenant_id", "kostengruppe"])

    # CORRECTIF §46 : la table reminders n'existait qu'en mémoire de tests.
    if not _has_table(inspector, "reminders"):
        op.create_table(
            "reminders",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("user_id", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("remind_before_h", sa.Float(), nullable=False),
            sa.Column("note", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("fired_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("email_sent", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_reminders_user_id", "reminders", ["user_id"])
        op.create_index("ix_reminders_starts_at", "reminders", ["starts_at"])
        op.create_index("ix_reminders_status", "reminders", ["status"])
        op.create_index("ix_reminders_user_status", "reminders", ["user_id", "status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _has_table(inspector, "office_prices"):
        op.drop_table("office_prices")
    # Jamais de drop sur reminders ici : le downgrade ne doit pas détruire les
    # rappels déjà synchronisés par les bureaux (données de production).
