"""
§50 — API Bibliothèque de prix du bureau (tenantbezogene Preisbibliothek).

Import CSV/GAEB X31 en 2 étapes honnêtes : /preview (parse, rien d'écrit)
puis /import (upsert idempotent + rapport). Chaque ligne rejetée est rendue
avec sa raison. Cloisonnement strict par tenant. Le moteur /quick consomme
ces prix avec PRIORITÉ sur le Richtwert marché (voir estimation_routes).
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.estimation.destatis_index import INDEX_SOURCE
from app.core.estimation.office_price_import import (
    ImportResult,
    MAX_PRICE,
    parse_office_prices,
)
from app.core.security import get_current_user
from app.middlewares.dos_guard import verify_dos_protection
from app.database import get_db
from app.models.office_price import OfficePrice
from app.models.user import User
from app.schemas.office_price import (
    BatchDeleteResponse,
    ImportBatchOut,
    ImportCommitResponse,
    ImportPreviewResponse,
    ImportedPriceOut,
    OfficePriceOut,
    OfficePriceSearchResponse,
    OfficePriceStatsResponse,
    OfficePriceVerlaufResponse,
    PriceSpiegelItem,
    PriceSpiegelResponse,
    RejectionOut,
)
from app.services.price_observations import spiegel_for_tenant
from app.services.office_price_service import (
    commit_import,
    current_index_year,
    index_note,
    tenant_price_map,
)

router = APIRouter(prefix="/api/v5/office-prices", tags=["Tenantbezogene Preisbibliothek"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 Mo — large pour une bibliothèque de prix
SAMPLE_LIMIT = 200                   # l'aperçu ne renvoie jamais le fichier entier


def _read_upload_guarded(upload: UploadFile) -> bytes:
    data = upload.file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        from fastapi import HTTPException
        raise HTTPException(413, f"Datei zu groß ({len(data)} B > {MAX_UPLOAD_BYTES} B).")
    if not data:
        from fastapi import HTTPException
        raise HTTPException(422, "Datei ist leer.")
    return data


def _to_sample(result: ImportResult) -> List[ImportedPriceOut]:
    return [
        ImportedPriceOut(
            oz=p.oz, kurztext=p.kurztext, einheit=p.einheit,
            einheitspreis_netto=float(p.einheitspreis_netto),
            preisstand_jahr=p.preisstand_jahr, kostengruppe=p.kostengruppe,
        )
        for p in result.accepted[:SAMPLE_LIMIT]
    ]


def _rejections(result: ImportResult) -> List[RejectionOut]:
    return [RejectionOut(row=r.row, oz=r.oz, reason=r.reason) for r in result.rejected]


def _import_warnings(result: ImportResult) -> List[str]:
    warnings: List[str] = []
    unmapped = sum(1 for p in result.accepted if p.kostengruppe is None)
    if len(result.accepted) > SAMPLE_LIMIT:
        warnings.append(f"Vorschau zeigt {SAMPLE_LIMIT} von {len(result.accepted)} Positionen.")
    if unmapped:
        warnings.append(
            f"{unmapped} Position(en) ohne eindeutige Kostengruppe — gespeichert, "
            "aber nicht im Schnell-Schätzer verwendet (keine automatische Zuordnung geraten)."
        )
    return warnings


@router.post("/preview", response_model=ImportPreviewResponse,
             dependencies=[Depends(verify_dos_protection)])
async def preview_import(
    file: UploadFile = File(...),
    preisstand_jahr: int = Form(...),
    current_user: User = Depends(get_current_user),  # noqa: ARG001 — auth requise
):
    """ÉTAPE 1 : parse le fichier, montre le rapport — BASE NON TOUCHÉE."""
    data = _read_upload_guarded(file)
    result = parse_office_prices(file.filename or "upload", data, preisstand_jahr)
    warnings = _import_warnings(result)
    if result.kind == "x31":
        warnings.append(
            "GAEB X31 trägt kein Preisstand-Jahr — alle Positionen erhalten das gewählte "
            f"Preisstand-Jahr {preisstand_jahr} (bei Import angeben!)."
        )
    return ImportPreviewResponse(
        kind=result.kind,
        detected_headers=result.detected_headers,
        accepted_count=len(result.accepted),
        rejected_count=len(result.rejected),
        sample_accepted=_to_sample(result),
        sample_rejected=_rejections(result),
        preisstand_jahr_effektiv=preisstand_jahr,
        warnings=warnings,
    )


@router.post("/import", response_model=ImportCommitResponse,
             dependencies=[Depends(verify_dos_protection)])
async def commit_import_route(
    file: UploadFile = File(...),
    preisstand_jahr: int = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """ÉTAPE 2 : écrit (upsert idempotent par OZ) + rapport final honnête."""
    data = _read_upload_guarded(file)
    result = parse_office_prices(file.filename or "upload", data, preisstand_jahr)
    stats = commit_import(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        source_file=file.filename or "upload",
        result=result,
    )
    warnings = _import_warnings(result)
    if stats.skipped_veraltet:
        # §97 — règle du millésime DITE : l'ancien ne remplace jamais le
        # plus récent, et le rapport nomme les OZ concernées.
        oz_liste = ", ".join(stats.skipped_veraltet[:20])
        more = " …" if len(stats.skipped_veraltet) > 20 else ""
        warnings.append(
            f"{len(stats.skipped_veraltet)} Zeile(n) mit ÄLTEREM Preisstand "
            f"verworfen (OZ: {oz_liste}{more}) — der neuere Preisstand bleibt."
        )
    return ImportCommitResponse(
        kind=result.kind,
        inserted=stats.inserted,
        updated=stats.updated,
        rejected_count=len(result.rejected),
        total_active=stats.total_active,
        sample_rejected=_rejections(result),
        warnings=warnings,
        skipped_veraltet=len(stats.skipped_veraltet or []),
    )


@router.get("/search", response_model=OfficePriceSearchResponse)
def search_prices(
    q: Optional[str] = Query(None, description="OZ ou Kurztext (ILIKE)"),
    kostengruppe: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(OfficePrice).where(OfficePrice.tenant_id == current_user.tenant_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (OfficePrice.oz.ilike(like)) | (OfficePrice.kurztext.ilike(like))
        )
    if kostengruppe:
        stmt = stmt.where(OfficePrice.kostengruppe == kostengruppe)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(
        stmt.order_by(OfficePrice.oz.asc()).limit(limit).offset(offset)
    ).scalars().all()

    ziel = current_index_year()
    items: List[OfficePriceOut] = []
    from decimal import Decimal, ROUND_HALF_UP
    from app.core.estimation.destatis_index import year_factor_for
    for row in rows:
        factor = year_factor_for(int(row.preisstand_jahr), ziel).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        items.append(OfficePriceOut(
            id=row.id, oz=row.oz, kurztext=row.kurztext, einheit=row.einheit,
            einheitspreis_netto=float(row.einheitspreis_netto),
            preisstand_jahr=int(row.preisstand_jahr),
            kostengruppe=row.kostengruppe,
            source_file=row.source_file,
            index_note=index_note(int(row.preisstand_jahr), factor, ziel),
        ))
    return OfficePriceSearchResponse(total=int(total), items=items)


@router.get("/stats", response_model=OfficePriceStatsResponse)
def library_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(OfficePrice).where(OfficePrice.tenant_id == current_user.tenant_id)
    ).scalars().all()

    by_jahr: dict[int, int] = {}
    kg_set: set[str] = set()
    latest: Optional[datetime] = None
    for row in rows:
        by_jahr[int(row.preisstand_jahr)] = by_jahr.get(int(row.preisstand_jahr), 0) + 1
        if row.kostengruppe:
            kg_set.add(row.kostengruppe)
        if row.updated_at and (latest is None or row.updated_at > latest):
            latest = row.updated_at

    # KG réellement valorisables par le moteur /quick (déjà résolues).
    resolved = tenant_price_map(db, tenant_id=current_user.tenant_id)
    from app.core.estimation.quick_estimate import KG_TITEL

    return OfficePriceStatsResponse(
        total=len(rows),
        by_jahr=dict(sorted(by_jahr.items())),
        kg_abgedeckt=len(resolved),
        kg_total=len(KG_TITEL),
        letzter_import=latest.isoformat() if latest else None,
        index_quelle=f"{INDEX_SOURCE} · Stand {current_index_year()}",
    )


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    """Postgres renvoie des datetimes « aware », SQLite des naïves : on
    normalise en UTC naïve pour comparer sans ambiguïté ni crash."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


STALE_DAYS = 365  # > 12 mois sans mise à jour → avertissement de fraîcheur


@router.get("/spiegel", response_model=PriceSpiegelResponse)
def library_spiegel(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§96 — Preisspiegel par OZ : n/min/médiane/max des observations
    RÉELLES (offres reprises en bibliothèque §95). Jamais de moyenne sur
    une seule pièce — les OZ à observation unique sont comptés et dits."""
    data = spiegel_for_tenant(db, tenant_id=current_user.tenant_id)
    return PriceSpiegelResponse(
        items=[PriceSpiegelItem(**item) for item in data["items"]],
        total_observations=data["total_observations"],
        single_oz_count=data["single_oz_count"],
        capped=data["capped"],
        hinweis=data["hinweis"],
    )


@router.get("/verlauf", response_model=OfficePriceVerlaufResponse)
def library_verlauf(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§73 — V2.6 : historique RÉEL des imports du tenant + fraîcheur.

    Regroupé par fichier source ; aucun chiffre inventé — tout provient des
    colonnes created_at / updated_at / preisstand_jahr des lignes du tenant.
    Alerte `veraltet` au-delà de 12 mois : Destatis/BKI sont fortgeschrieben
    chaque année, un millésime figé n'est plus qu'une approximation."""
    rows = db.execute(
        select(OfficePrice).where(OfficePrice.tenant_id == current_user.tenant_id)
    ).scalars().all()

    batches: dict = {}
    latest: Optional[datetime] = None
    for row in rows:
        cre = _naive(row.created_at)
        upd = _naive(row.updated_at)
        b = batches.setdefault(row.source_file, {
            "source_kind": row.source_kind,
            "positionen": 0,
            "erst": None, "letzte": None,
            "von": int(row.preisstand_jahr),
            "bis": int(row.preisstand_jahr),
        })
        b["positionen"] += 1
        b["von"] = min(b["von"], int(row.preisstand_jahr))
        b["bis"] = max(b["bis"], int(row.preisstand_jahr))
        if cre is not None and (b["erst"] is None or cre < b["erst"]):
            b["erst"] = cre
        if upd is not None and (b["letzte"] is None or upd > b["letzte"]):
            b["letzte"] = upd
        if upd is not None and (latest is None or upd > latest):
            latest = upd

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    alter_tage = max(0, (now - latest).days) if latest is not None else None

    imports = [
        ImportBatchOut(
            source_file=name,
            source_kind=b["source_kind"],
            positionen=b["positionen"],
            erst_import=b["erst"].isoformat() if b["erst"] else None,
            letzte_aktualisierung=b["letzte"].isoformat() if b["letzte"] else None,
            preisstand_von=b["von"],
            preisstand_bis=b["bis"],
        )
        for name, b in batches.items()
    ]
    imports.sort(key=lambda x: x.letzte_aktualisierung or "", reverse=True)

    return OfficePriceVerlaufResponse(
        veraltet=(alter_tage > STALE_DAYS) if alter_tage is not None else None,
        alter_tage=alter_tage,
        alter_monate=round(alter_tage / 30.44) if alter_tage is not None else None,
        schwellwert_monate=12,
        imports=imports,
    )


@router.delete("/verlauf/{source_file}", response_model=BatchDeleteResponse)
def delete_import_batch(
    source_file: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§76 — supprime UN lot d'import complet (toutes les lignes venues de ce
    fichier) sans toucher aux autres lots ni aux autres tenants.

    Née d'un incident réel : un GAEB X31 d'ESSAI validé à l'étape 3 de
    l'assistant se mélangeait aux vrais prix du bureau, et la seule voie de
    nettoyage était « Bibliothek leeren » (tout effacer). 404 — pas un 200
    à 0 — si le lot n'existe pas POUR CE TENANT : un succès factice sur un
    fichier absent serait un mensonge."""
    rows = db.execute(
        select(OfficePrice).where(
            OfficePrice.tenant_id == current_user.tenant_id,
            OfficePrice.source_file == source_file,
        )
    ).scalars().all()
    if not rows:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail=(
                f"Kein Import-Los zur Datei „{source_file}“ gefunden — bereits "
                "gelöscht oder nie importiert (Bibliothek unverändert)."
            ),
        )
    count = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return BatchDeleteResponse(deleted=count, source_file=source_file)


@router.delete("/purge")
def purge_library(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Purge explicite, tenant uniquement (bouton « Alles löschen » de l'UI)."""
    deleted = db.execute(
        select(OfficePrice).where(OfficePrice.tenant_id == current_user.tenant_id)
    ).scalars().all()
    count = len(deleted)
    for row in deleted:
        db.delete(row)
    db.commit()
    return {"deleted": count}
