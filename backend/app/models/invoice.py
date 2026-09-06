"""§116 — Factures / E-Rechnung (XRechnung) PERSISTÉES et NUMÉROTÉES.

Demande client : « finis d'abord la E-Rechnung ». Le constructeur XML
§114 (app/services/xrechnung.py, ZÉRO dépendance, Decimal partout)
fabriquait un XML à partir d'arguments ; rien ne survivait : pas de
facture en base, pas de numéro, pas de cycle de vie. Cette table est le
REGISTRE des factures du bureau :

  - Brouillon (« draft ») : saisie incomplète autorisée, modifiable,
    SUPPRIMABLE (c'est du papier brouillon, rien d'officiel).
  - Émise (« issued ») : le serveur attribue le NUMÉRO et la DATE à
    l'émission puis FIGE la facture (GoBD : une facture émise ne se
    réécrit jamais — corriger = storno + nouvelle facture).
  - Stornée (« cancelled ») : marquée, JAMAIS effacée, numéro conservé
    (une absence de numéro dans la chaîne alerterait toute révision
    fiscale — la continuité de la numérotation est une exigence).

NUMÉROTATION : chaîne continue PAR BUREAU et PAR ANNÉE
« RE-2026-0001, RE-2026-0002… » portée par InvoiceCounter (une ligne par
( tenant_id, année ) — compteur monotone, sans recyclage). Le compteur
n'est consommé QUE si l'émission réussit : un essai refusé (violations)
ne laisse PAS de trou dans la chaîne.

ARGENT : tout est stocké en CHAÎNES décimales (« 100.01 »), jamais en
float — la règle §114 tient en base comme dans le XML. Les totaux sont
recalculés par le serveur à chaque écriture (jamais de total fourni par
le client, jamais de total « figé au feeling »).
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Column,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
)
from sqlalchemy.types import JSON

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


STATUTS = ("draft", "issued", "cancelled")


class Invoice(HasTenantColumn, Base):
    __tablename__ = "invoices"

    # Clé composite (tenant_id, id) : garde structurelle inter-bureaux,
    # pattern éprouvé §115 (BaustelleIssue).
    id = Column(String, nullable=False, default=generate_uuid)
    project_id = Column(String, nullable=True)  # rattachement optionnel
    status = Column(String, nullable=False, default="draft", index=True)

    # Attribués À L'ÉMISSION (brouillon : vides — on ne simule pas un vrai
    # numéro tant que la facture n'est pas officielle).
    rechnungsnummer = Column(String(40), nullable=True)
    issue_date = Column(String(10), nullable=True)  # « AAAA-MM-JJ » (jour UTC serveur)
    profile = Column(String(20), nullable=False, default="xrechnung")  # §114 : profil unique

    # Acheteur (BG-7) — Leitweg-ID = buyer_reference (BT-10).
    buyer_name = Column(String(300), nullable=False)
    buyer_street = Column(String(300), nullable=False, default="")
    buyer_zip = Column(String(20), nullable=False, default="")
    buyer_city = Column(String(120), nullable=False, default="")
    buyer_country = Column(String(2), nullable=False, default="DE")
    buyer_reference = Column(String(100), nullable=False, default="")  # Leitweg-ID

    # Vendeur = le bureau (BG-4). USt-IdNr JAMAIS inventée (XR-13 §114).
    seller_name = Column(String(300), nullable=False, default="")
    seller_street = Column(String(300), nullable=False, default="")
    seller_zip = Column(String(20), nullable=False, default="")
    seller_city = Column(String(120), nullable=False, default="")
    seller_country = Column(String(2), nullable=False, default="DE")
    seller_vat_id = Column(String(30), nullable=False, default="")
    # §123 — BG-16 « PAYMENT INSTRUCTIONS » (BR-DE-1 obligatoire XRechnung,
    # mesuré au validateur officiel KoSIT) : le compte de règlement se
    # SAISIT (jamais inventé) ; vide = la facture XRechnung refuse d'émettre.
    seller_iban = Column(String(34), nullable=False, default="")
    seller_bic = Column(String(11), nullable=False, default="")
    seller_account_name = Column(String(300), nullable=False, default="")
    # §123 (suite KoSIT) — adresses électroniques Peppol (BT-34/BT-49),
    # contact vendeur (BR-DE-2, BG-6 : BT-41/42/43), processus (R005, BT-23).
    seller_email = Column(String(300), nullable=False, default="")
    buyer_email = Column(String(300), nullable=False, default="")
    seller_contact_name = Column(String(300), nullable=False, default="")
    seller_contact_phone = Column(String(100), nullable=False, default="")
    seller_contact_email = Column(String(300), nullable=False, default="")
    processus = Column(String(300), nullable=False, default="")

    currency = Column(String(3), nullable=False, default="EUR")

    # Livraison/période/échéance (BT-72 / BT-73-74 / BT-9) — chaînes ISO.
    delivery_date = Column(String(10), nullable=True)
    period_start = Column(String(10), nullable=True)
    period_end = Column(String(10), nullable=True)
    due_date = Column(String(10), nullable=True)

    # Lignes : [{designation, quantite, unite, prix_unitaire_ht, taux_tva}]
    # quantité/prix/taux = CHAÎNES décimales (float interdit partout).
    lines = Column(JSON, nullable=False, default=list)
    notes = Column(JSON, nullable=False, default=list)

    # Totaux serveur (chaînes) : affichage liste — le XML les RECALCULE.
    total_net = Column(String(24), nullable=False, default="0.00")
    total_tva = Column(String(24), nullable=False, default="0.00")
    total_brut = Column(String(24), nullable=False, default="0.00")

    created_by = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), nullable=False)
    issued_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(String(500), nullable=False, default="")
    # §264 — dernier verdict KoSIT (CII+UBL). Jamais un ACCEPTABLE local.
    kosit_last = Column(JSON, nullable=True)
    kosit_checked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "id"),
        Index("ix_invoices_tenant_status", "tenant_id", "status"),
        Index("ix_invoices_tenant_number", "tenant_id", "rechnungsnummer"),
    )


class InvoiceCounter(HasTenantColumn, Base):
    """Chaîne de numérotation continue par (bureau, année).

    Une ligne = un prochain numéro. L'incrément se fait dans la même
    transaction que l'émission de la facture : pas de trou, pas de doublon
    (l'index unique partiel de la migration 20260812_16 coiffe le tout).
    """

    __tablename__ = "invoice_counters"

    year = Column(Integer, nullable=False)
    next_seq = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "year"),
    )
