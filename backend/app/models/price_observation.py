"""§96 — Observations de prix RÉELLES (base du Preisspiegel par OZ).

Complément de §95 : « to-library » remplace la ligne de bibliothèque
(dernière vérité réelle gagne) ET enregistre ici CHAQUE observation
(un EP d'une offre précise, avec firme/date). La contrainte unique
(tenant_id, offer_id, oz) rend la mémorisation idempotente : réappuyer
sur « → Bibliothek » ne compte jamais deux fois la même pièce.

Montants en CENTIMES ENTIERS (jamais de float) ; la médiane est calculée
à la lecture, au centime Half-Up — règle écrite dans le service.

Cycle de vie honnête : supprimer l'offre supprime SES observations
(la provenance reste réversible, jamais de fantôme) ; la ligne de
bibliothèque reste (règle §50 inchangée — les deux vérités sont dites).
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Index, Integer, String, UniqueConstraint

from app.database import Base


class PriceObservation(Base):
    __tablename__ = "price_observations"

    id = Column(String(40), primary_key=True)           # uuid4 hex
    tenant_id = Column(String(64), nullable=False, index=True)
    offer_id = Column(String(40), nullable=False)       # gaeb_offers.id
    oz = Column(String(64), nullable=False)
    kurztext = Column(String(500), nullable=False)
    einheit = Column(String(24), nullable=False, default="")
    ep_cents = Column(Integer, nullable=False)          # EP netto, centimes
    preisstand_jahr = Column(Integer, nullable=False)   # année de l'offre
    source_label = Column(String(255), nullable=False)  # provenance lisible §95
    company_name = Column(String(200), nullable=False)
    taken_by = Column(String(64), nullable=True)        # user_id du clic
    taken_at = Column(DateTime, nullable=False)         # moment du clic

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "offer_id", "oz", name="uq_price_obs_tenant_offer_oz",
        ),
    )


Index("ix_price_obs_tenant_oz", PriceObservation.tenant_id, PriceObservation.oz)
