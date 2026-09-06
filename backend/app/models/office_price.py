"""
§50 — Bibliothèque de prix DU BUREAU (tenantbezogene Preisbibliothek).

Chaque bureau importe SES positions réelles (CSV ou GAEB X31) : elles priment
sur les Richtwerte marché NARCHI dans l'estimation éclair, après indexation
officielle Destatis vers l'année courante (§49). Cloisonnement strict par
tenant : personne ne voit jamais les prix d'un autre bureau.
"""

from sqlalchemy import Column, DateTime, Float, Index, Integer, Numeric, String, UniqueConstraint, func

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


class OfficePrice(HasTenantColumn, Base):
    __tablename__ = "office_prices"

    id = Column(String, primary_key=True)
    uploaded_by = Column(String, index=True, nullable=False)  # user_id

    oz = Column(String(64), nullable=False)            # Ordnungszahl / Pos.-Nr.
    kurztext = Column(String(500), nullable=False)
    langtext = Column(String, nullable=True)
    einheit = Column(String(24), nullable=False)       # m², m³, Stk …
    einheitspreis_netto = Column(Numeric(14, 2), nullable=False)
    preisstand_jahr = Column(Integer, nullable=False)  # millésime du prix importé

    # Kostengruppe NARCHI (clé WorkCategory) — seulement si la détection
    # par mots-clés est sans ambiguïté ; sinon NULL (jamais deviné).
    kostengruppe = Column(String(64), nullable=True, index=True)
    kg_confiance = Column(Float, nullable=True)

    source_file = Column(String(255), nullable=False)
    source_kind = Column(String(8), nullable=False)    # csv | x31

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        # Réimporter le même fichier = mettre à jour, jamais dupliquer.
        UniqueConstraint("tenant_id", "oz", name="uq_office_prices_tenant_oz"),
    )


Index("ix_office_prices_tenant_kg", OfficePrice.tenant_id, OfficePrice.kostengruppe)
