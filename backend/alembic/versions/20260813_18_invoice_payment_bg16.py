"""§123 — E-Rechnung : champs XRechnung 3.0.2 mesurés OBLIGATOIRES par le
validateur officiel KoSIT (configuration du 31/01/2026) :

- BG-16 « PAYMENT INSTRUCTIONS » (BR-DE-1) : IBAN vendeur (BT-84),
  titulaire (BT-85), BIC (BT-86) ;
- adresses électroniques (Peppol R010/R020) : seller_email (BT-34),
  buyer_email (BT-49) ;
- « SELLER CONTACT » (BR-DE-2, BG-6) : nom (BT-41), téléphone (BT-42),
  e-mail (BT-43) ;
- processus métier (R005, BT-23) : colonne processus.

Additive, valeurs vides par défaut : ces données se SAISISSENT, jamais
inventées ; manquantes = le profil XRechnung refuse d'émettre (les codes
NARCHI-XR-41…45 le disent à l'écran, comme la Leitweg-ID au §116).

PostgreSQL only (tests SQLite créent le modèle à jour).

Revision ID: 20260813_18
Revises: 20260812_17
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op

revision = "20260813_18"
down_revision = "20260812_17"
branch_labels = None
depends_on = None

_COLONNES = (
    sa.Column("seller_iban", sa.String(length=34), nullable=False, server_default=""),
    sa.Column("seller_bic", sa.String(length=11), nullable=False, server_default=""),
    sa.Column("seller_account_name", sa.String(length=300), nullable=False, server_default=""),
    sa.Column("seller_email", sa.String(length=300), nullable=False, server_default=""),
    sa.Column("buyer_email", sa.String(length=300), nullable=False, server_default=""),
    sa.Column("seller_contact_name", sa.String(length=300), nullable=False, server_default=""),
    sa.Column("seller_contact_phone", sa.String(length=100), nullable=False, server_default=""),
    sa.Column("seller_contact_email", sa.String(length=300), nullable=False, server_default=""),
    sa.Column("processus", sa.String(length=300), nullable=False, server_default=""),
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for col in _COLONNES:
        op.add_column("invoices", col)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for col in reversed(_COLONNES):
        op.drop_column("invoices", col.name)

