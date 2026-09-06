"""§50 — Schémas API de la bibliothèque de prix du bureau."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ImportedPriceOut(BaseModel):
    oz: str
    kurztext: str
    einheit: str
    einheitspreis_netto: float
    preisstand_jahr: int
    kostengruppe: Optional[str] = None


class RejectionOut(BaseModel):
    row: int
    oz: str
    reason: str


class ImportPreviewResponse(BaseModel):
    """Étape 1 : le fichier est parsé, RIEN n'est encore écrit en base."""

    kind: str
    detected_headers: Dict[str, str] = Field(default_factory=dict)
    accepted_count: int
    rejected_count: int
    sample_accepted: List[ImportedPriceOut]
    sample_rejected: List[RejectionOut]
    preisstand_jahr_effektiv: int
    warnings: List[str] = Field(default_factory=list)


class ImportCommitResponse(BaseModel):
    """Étape 2 : écriture idempotente (upsert par OZ) + rapport final."""

    kind: str
    inserted: int
    updated: int
    rejected_count: int
    total_active: int
    sample_rejected: List[RejectionOut]
    warnings: List[str] = Field(default_factory=list)
    # §97 — lignes refusées car un millésime plus récent existe pour l'OZ
    # (le détail est dans warnings : OZ listées, règle dite).
    skipped_veraltet: int = 0


class OfficePriceOut(BaseModel):
    id: str
    oz: str
    kurztext: str
    einheit: str
    einheitspreis_netto: float
    preisstand_jahr: int
    kostengruppe: Optional[str] = None
    source_file: str
    index_note: Optional[str] = None  # ex. « indexiert 2024→2026 (×1,0813) »


class OfficePriceSearchResponse(BaseModel):
    total: int
    items: List[OfficePriceOut]


class OfficePriceStatsResponse(BaseModel):
    total: int
    by_jahr: Dict[int, int]
    kg_abgedeckt: int          # KG avec ≥1 prix du bureau
    kg_total: int              # KG couvertes par le moteur
    letzter_import: Optional[str] = None  # ISO datetime
    index_quelle: str          # provenance Destatis (charte §36)


class ImportBatchOut(BaseModel):
    """§73 — V2.6 : un lot d'import RÉEL (regroupé par fichier source)."""

    source_file: str
    source_kind: str
    positionen: int
    erst_import: Optional[str] = None
    letzte_aktualisierung: Optional[str] = None
    preisstand_von: int
    preisstand_bis: int


class OfficePriceVerlaufResponse(BaseModel):
    """§73 — historique + fraîcheur. Rien d'inventé : NULL partout si vide."""

    veraltet: Optional[bool] = None   # True seulement si > 12 mois sans mise à jour
    alter_tage: Optional[int] = None
    alter_monate: Optional[int] = None
    schwellwert_monate: int = 12      # Destatis/BKI fortgeschrieben chaque année
    imports: List[ImportBatchOut] = Field(default_factory=list)


class BatchDeleteResponse(BaseModel):
    """§76 — suppression CHIRURGICALE d'un lot d'import : compte RÉEL
    toujours rendu ; la route répond 404 si le lot est absent pour ce
    tenant — jamais de « succès » factice sur un fichier inconnu."""

    deleted: int
    source_file: str


class PriceSpiegelItem(BaseModel):
    """§96 — une OZ vue par ≥ 2 offres réelles (tout en centimes entiers)."""

    oz: str
    kurztext: str
    einheit: str
    n: int
    min_cents: int
    median_cents: Optional[int] = None
    max_cents: int
    latest_ep_cents: int
    latest_company: str
    latest_jahr: int
    latest_source: str
    min_jahr: int                   # §97 — plus ancien millésime observé
    max_jahr: int                   # et plus récent (Jahrgänge affichés)


class PriceSpiegelResponse(BaseModel):
    """§96 — Preisspiegel : jamais de moyenne d'une seule pièce (comptée)."""

    items: List[PriceSpiegelItem] = Field(default_factory=list)
    total_observations: int
    single_oz_count: int          # OZ avec exactement 1 observation — dites
    capped: bool                  # True si l'écran a été borné (SPIEGEL_CAP)
    hinweis: str
