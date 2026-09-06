"""§91 — Offres d'entreprises importées (GAEB X83/X31 entrant).

Une ligne = UNE offre reçue pour la Notiz/LV co-éditée d'un bureau :
le XML brut est conservé (preuve/audit), les positions extraites sont
du JSON propre avec montants EN CENTIMES ENTIERS (``up_cents`` /
``it_cents`` — jamais de float pour de l'argent). ``ohne_preis_count``
et ``gp_total_cents`` sont calculés À L'IMPORT et stockés : jamais de
total recompté différemment plus tard.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String, Text

from app.database import Base


class GaebOffer(Base):
    __tablename__ = "gaeb_offers"

    id = Column(String(40), primary_key=True)          # uuid4 hex
    tenant_id = Column(String(64), nullable=False, index=True)
    room = Column(String(80), nullable=False)
    company_name = Column(String(200), nullable=False)  # Firma, saisie à l'envoi
    filename = Column(String(200), nullable=False, default="")
    dp = Column(String(4), nullable=False, default="31")  # phase GAEB lue dans le fichier
    cur = Column(String(4), nullable=False, default="EUR")
    xml_raw = Column(LargeBinary, nullable=False)       # preuve bit-pour-bit
    bytes = Column(Integer, nullable=False)
    items_json = Column(Text, nullable=False)           # [{oz,title,qty,unit,up_cents,it_cents}]
    item_count = Column(Integer, nullable=False)
    ohne_preis_count = Column(Integer, nullable=False)  # positions SANS prix — comptées, jamais cachées
    gp_total_cents = Column(Integer, nullable=False)    # somme EXACTE des it_cents connus
    created_by = Column(String(64), nullable=True)
    created_by_name = Column(String(140), nullable=True)
    created_at = Column(DateTime, nullable=False)
