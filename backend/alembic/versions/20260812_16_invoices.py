"""§116 — E-Rechnung : registre des factures (tables invoices + invoice_counters).

Demande client « finis d'abord la E-Rechnung » : le constructeur XML §114
était sans mémoire. Désormais les factures vivent en base avec le cycle
de vie GoBD : brouillon (modifiable/supprimable), émise (numéro
« RE-AAAA-NNNN » + date serveur, figée), stornée (marquée, JAMAIS
effacée, numéro conservé — une chaîne de numéros avec trou est un signal
d'alerte en révision fiscale).

  - invoices : clé composite (tenant_id, id) — garde structurelle
    inter-bureaux (pattern §115) ; argent en CHAÎNES décimales, totaux
    recalculés côté serveur, profil « xrechnung » unique (dit).
  - index UNIQUE PARTIEL (tenant_id, rechnungsnummer) : coiffe la
    numérotation même sous émissions concurrentes (PostgreSQL-only) ;
    le brouillon a rechnungsnummer NULL → non couvert, comme voulu.
  - invoice_counters : (tenant_id, année) → prochain numéro, consommé
    uniquement à l'émission réussie (jamais de trou à cause d'un 422).

Tables neuves, additives : aucune donnée existante altérée. Ignorées
proprement hors dialecte PostgreSQL (tests SQLite : create_all suffit).

Revision ID: 20260812_16
Revises: 20260812_15
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_16"
down_revision = "20260812_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_table(
        "invoices",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("rechnungsnummer", sa.String(length=40), nullable=True),
        sa.Column("issue_date", sa.String(length=10), nullable=True),
        sa.Column("profile", sa.String(length=20), nullable=False, server_default="xrechnung"),
        sa.Column("buyer_name", sa.String(length=300), nullable=False),
        sa.Column("buyer_street", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("buyer_zip", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("buyer_city", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("buyer_country", sa.String(length=2), nullable=False, server_default="DE"),
        sa.Column("buyer_reference", sa.String(length=100), nullable=False, server_default=""),
        sa.Column("seller_name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("seller_street", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("seller_zip", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("seller_city", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("seller_country", sa.String(length=2), nullable=False, server_default="DE"),
        sa.Column("seller_vat_id", sa.String(length=30), nullable=False, server_default=""),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column("delivery_date", sa.String(length=10), nullable=True),
        sa.Column("period_start", sa.String(length=10), nullable=True),
        sa.Column("period_end", sa.String(length=10), nullable=True),
        sa.Column("due_date", sa.String(length=10), nullable=True),
        sa.Column("lines", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("notes", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("total_net", sa.String(length=24), nullable=False, server_default="0.00"),
        sa.Column("total_tva", sa.String(length=24), nullable=False, server_default="0.00"),
        sa.Column("total_brut", sa.String(length=24), nullable=False, server_default="0.00"),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.String(length=500), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("tenant_id", "id"),
    )
    op.create_index("ix_invoices_tenant_id", "invoices", ["tenant_id"])
    op.create_index("ix_invoices_status", "invoices", ["status"])
    op.create_index("ix_invoices_project_id", "invoices", ["project_id"])
    op.create_index("ix_invoices_tenant_status", "invoices", ["tenant_id", "status"])
    op.create_index(
        "ix_invoices_tenant_number", "invoices", ["tenant_id", "rechnungsnummer"]
    )
    # Garde-fou GoBD sous concurrence : un (bureau, numéro) n'existe
    # qu'UNE fois (brouillons : numéro NULL → exclus de l'index, voulu).
    op.create_index(
        "uq_invoices_tenant_rechnungsnummer",
        "invoices",
        ["tenant_id", "rechnungsnummer"],
        unique=True,
        postgresql_where=sa.text("rechnungsnummer IS NOT NULL"),
    )

    op.create_table(
        "invoice_counters",
        sa.Column("tenant_id", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("next_seq", sa.Integer(), nullable=False, server_default="1"),
        sa.PrimaryKeyConstraint("tenant_id", "year"),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_table("invoice_counters")
    op.drop_index("uq_invoices_tenant_rechnungsnummer", table_name="invoices")
    op.drop_index("ix_invoices_tenant_number", table_name="invoices")
    op.drop_index("ix_invoices_tenant_status", table_name="invoices")
    op.drop_index("ix_invoices_project_id", table_name="invoices")
    op.drop_index("ix_invoices_status", table_name="invoices")
    op.drop_index("ix_invoices_tenant_id", table_name="invoices")
    op.drop_table("invoices")
