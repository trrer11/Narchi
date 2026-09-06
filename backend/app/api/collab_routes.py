"""§78 — V2.7 étape 1 : REST de présence + verrous doux.

REST + polling explicite (5 s) plutôt que WebSocket survendu : l'UI annonce
l'intervalle. Le push temps réel arrive avec le CRDT (étape 2). Chaque
réponse porte les constantes réelles (TTL, intervalles) — l'UI n'invente rien.
"""

from typing import Optional

import json
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.collab_doc import CollabDoc
from app.models.collab_doc_snapshot import CollabDocSnapshot
from app.models.user import User
from app.services.collab_history import (
    MAX_SNAPSHOTS_PER_DOC,
    make_snapshot_row,
)
from app.services.collab_service import (
    LOCK_TTL_S,
    PRESENCE_TTL_S,
    get_collab_service,
)
from app.services.crdt_room_hub import get_crdt_hub
from app.models.gaeb_offer import GaebOffer
from app.services.collab_history import _utcnow
from app.services.gaeb_import import (
    MAX_XML_BYTES,
    GaebImportError,
    parse_gaeb_offer_xml,
)
from app.services.offer_compare import build_comparison
from app.services.gaeb_lv_export import LvExportError, build_lv_gaeb_x31
from app.services.gaeb_offer_export import (
    OfferX83Error,
    build_offer_gaeb_x83,
)
from app.services.offer_to_pricebook import (
    offer_source_label,
    prices_from_offer_items,
)
from app.services.office_price_service import commit_import
from app.services.price_observations import (
    delete_observations_of_offer,
    record_observations,
)
from app.services.lv_positions import (
    LV_MAX_POSITIONS,
    extract_lv_positions,
    lv_totals,
)

router = APIRouter(prefix="/api/v5/collab", tags=["Live-Präsenz & weiche Sperren"])

_ROOM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$")
_RESERVED = {"ws"}  # §81 — « ws » est le segment de l'endpoint WebSocket CRDT
POLL_INTERVAL_S = 5        # dit dans l'UI — pas de fausse promesse « instantané »
HEARTBEAT_INTERVAL_S = 15


class LockClaimIn(BaseModel):
    target: str = Field(min_length=1, max_length=120)


def _check_room(room: str) -> None:
    if not _ROOM_RE.match(room):
        raise HTTPException(
            422,
            "Raumname ungültig — Buchstaben/Ziffern, „:“, „_“, „-“ (max. 64).",
        )
    if room in _RESERVED:
        raise HTTPException(
            422,
            "Raumname „ws“ ist reserviert (WebSocket-Endpunkt für die Live-Mitarbeit).",
        )


def _who(user: User) -> str:
    return user.name or user.id


@router.post("/{room}/join")
def join_room(room: str,
              current_user: User = Depends(get_current_user),
              svc=Depends(get_collab_service)):
    _check_room(room)
    svc.join(current_user.tenant_id, room, current_user.id, _who(current_user))
    return {"room": room, "presence_ttl_s": PRESENCE_TTL_S,
            "heartbeat_interval_s": HEARTBEAT_INTERVAL_S}


@router.post("/{room}/heartbeat")
def heartbeat(room: str,
              current_user: User = Depends(get_current_user),
              svc=Depends(get_collab_service)):
    _check_room(room)
    svc.heartbeat(current_user.tenant_id, room, current_user.id, _who(current_user))
    return {"alive": True, "presence_ttl_s": PRESENCE_TTL_S}


@router.post("/{room}/leave")
def leave_room(room: str,
               current_user: User = Depends(get_current_user),
               svc=Depends(get_collab_service)):
    _check_room(room)
    svc.leave(current_user.tenant_id, room, current_user.id)
    return {"left": True}


@router.get("/{room}/presence")
def presence(room: str,
             current_user: User = Depends(get_current_user),
             svc=Depends(get_collab_service)):
    _check_room(room)
    members = svc.presence(current_user.tenant_id, room)
    return {"room": room, "count": len(members), "members": members,
            "poll_interval_s": POLL_INTERVAL_S}


@router.post("/{room}/locks")
def claim(room: str, payload: LockClaimIn,
          current_user: User = Depends(get_current_user),
          svc=Depends(get_collab_service)):
    _check_room(room)
    result = svc.claim_lock(current_user.tenant_id, room, payload.target.strip(),
                            current_user.id, _who(current_user))
    return {**result, "lock_ttl_s": LOCK_TTL_S}


@router.delete("/{room}/locks/{target}")
def release(room: str, target: str,
            current_user: User = Depends(get_current_user),
            svc=Depends(get_collab_service)):
    _check_room(room)
    return svc.release_lock(current_user.tenant_id, room, target, current_user.id)


@router.get("/{room}/locks")
def locks(room: str,
          current_user: User = Depends(get_current_user),
          svc=Depends(get_collab_service)):
    _check_room(room)
    items = svc.list_locks(current_user.tenant_id, room)
    return {"room": room, "count": len(items), "locks": items}


# ---------------------------------------------------------------------------
# §86 — Historique de versions (snapshots Notiz) : lister, créer, restaurer.
# Constantes exposées dans chaque réponse — l'UI n'invente aucune borne.
# ---------------------------------------------------------------------------

_MAX_HISTORY_ROWS = 50  # liste affichée (le prune serveur garde 25 de toute façon)


class SnapshotCreateIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=120)


def _snapshot_meta(row: CollabDocSnapshot) -> dict:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
        "trigger": row.trigger,                 # "manual" | "auto" — traduit dans l'UI
        "label": row.label,
        "created_by_name": row.created_by_name,
        "bytes": row.bytes,
        "chars": row.chars,
        "preview": row.preview,
    }


def _doc_or_404(db: Session, tenant_id: str, room: str) -> CollabDoc:
    doc = db.get(CollabDoc, f"{tenant_id}:{room}")
    if doc is None or not doc.state:
        raise HTTPException(
            404,
            "Notiz noch nicht gespeichert — zuerst schreiben, dann Schnappschuss.",
        )
    return doc


@router.get("/{room}/snapshots")
def list_snapshots(room: str,
                   current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    _check_room(room)
    rows = (
        db.query(CollabDocSnapshot)
        .filter(CollabDocSnapshot.doc_id == f"{current_user.tenant_id}:{room}")
        .order_by(CollabDocSnapshot.created_at.desc(), CollabDocSnapshot.id.desc())
        .limit(_MAX_HISTORY_ROWS)
        .all()
    )
    return {
        "room": room,
        "count": len(rows),
        "max_snapshots": MAX_SNAPSHOTS_PER_DOC,
        "snapshots": [_snapshot_meta(r) for r in rows],
    }


@router.post("/{room}/snapshots", status_code=201)
def create_snapshot(room: str,
                    payload: SnapshotCreateIn,
                    current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    _check_room(room)
    doc = _doc_or_404(db, current_user.tenant_id, room)
    label = (payload.label or "").strip() or None
    row = make_snapshot_row(db, doc, "manual", label=label, author=current_user)
    db.commit()
    return {
        "snapshot": _snapshot_meta(row),
        "max_snapshots": MAX_SNAPSHOTS_PER_DOC,
        # Honnêteté affichée : l'instantané part de la DERNIÈRE sauvegarde
        # automatique (flush ~2 s §81), pas chrono exact de la dernière frappe.
        "hinweis": "Stand: letzte Auto-Speicherung (max. ~2 s alt).",
    }


@router.post("/{room}/snapshots/{snapshot_id}/restore")
async def restore_snapshot(room: str,
                           snapshot_id: str,
                           current_user: User = Depends(get_current_user),
                           db: Session = Depends(get_db),
                           hub=Depends(get_crdt_hub)):
    _check_room(room)
    snap = db.get(CollabDocSnapshot, snapshot_id)
    # Invisibilité totale inter-bureaux : pas de 403 révélateur, un 404 net.
    if snap is None or snap.doc_id != f"{current_user.tenant_id}:{room}":
        raise HTTPException(404, "Schnappschuss nicht gefunden.")
    result = await hub.restore(current_user.tenant_id, room, bytes(snap.state))
    return {
        "restored": True,
        # "live" = propagé aux clients connectés ; "stored" = appliqué au
        # prochain chargement (salle fermée) — l'UI annonce les deux.
        "mode": result["mode"],
        "changed": result["changed"],
        "snapshot": _snapshot_meta(snap),
    }


# ---------------------------------------------------------------------------
# §89 — Positions LV structurées co-éditées (JSON pour le futur export GAEB)
# ---------------------------------------------------------------------------

@router.get("/{room}/lv")
def list_lv_positions(room: str,
                      current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    """Lit les positions LV du document CRDT persisté.

    Pas de 404 ici : un bureau sans document n'a tout simplement « pas
    encore de positions » — réponse vide honnête (et l'invisibilité
    inter-bureaux reste totale : document d'un autre tenant → même
    réponse vide, indifférenciable).
    """
    _check_room(room)
    doc = db.get(CollabDoc, f"{current_user.tenant_id}:{room}")
    if doc is None or not doc.state:
        positions: list = []
    else:
        positions = extract_lv_positions(bytes(doc.state))
    totals = lv_totals(positions)
    return {
        "room": room,
        "max_positions": LV_MAX_POSITIONS,
        "positions": positions,
        **totals,
        # Honnêteté affichée : même base temps que la Notiz (flush ~2 s
        # §81) + les EP sont des saisies manuelles (charte §36).
        "hinweis": ("Stand: letzte Auto-Speicherung (max. ~2 s alt). "
                    "EP = manuelle Eingabe — kein automatischer Preisspiegel."),
    }


# ---------------------------------------------------------------------------
# §90 — Téléchargement GAEB X31 du LV co-édité (essentiel, rien de plus)
# ---------------------------------------------------------------------------

@router.get("/{room}/lv/gaeb.x31")
def download_lv_gaeb(room: str,
                     preise: int = 0,
                     projekt: str = "Gemeinsames LV",
                     current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    """GAEB X31 (DA XML 3.2) des positions co-éditées.

    ``preise=0`` (défaut) : LV SANS prix (Ausschreibung pour l'entreprise) ;
    ``preise=1`` : EP/IT inclus — REFUS 422 avec la liste des OZ « ohne
    EP » plutôt qu'un 0,00 € inventé. Document absent → mêmes 422 que
    « pas encore de positions » : invisibilité inter-bureaux totale.
    """
    _check_room(room)
    doc = db.get(CollabDoc, f"{current_user.tenant_id}:{room}")
    positions = extract_lv_positions(bytes(doc.state)) if doc is not None and doc.state else []
    if not positions:
        raise HTTPException(
            422,
            "Noch keine LV-Positionen in dieser Notiz — zuerst Positionen anlegen, "
            "dann als GAEB exportieren.",
        )
    mit_preisen = preise == 1
    try:
        xml = build_lv_gaeb_x31(
            project_name=projekt.strip()[:256] or "Gemeinsames LV",
            positions=positions,
            mit_preisen=mit_preisen,
        )
    except LvExportError as exc:
        oz_liste = ", ".join(exc.oz[:20]) + (" …" if len(exc.oz) > 20 else "")
        raise HTTPException(
            422,
            f"{len(exc.oz)} Position(en) ohne EP ({oz_liste}) — Preise ergänzen "
            f"oder ohne Preise exportieren. Kein Preis wird erfunden.",
        ) from exc
    filename = f"lv-{re.sub(r'[^A-Za-z0-9_.-]+', '-', room)[:40] or 'buero'}.x31"
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Narchi-Lv-Positionen": str(len(positions)),
            "X-Narchi-Lv-Preise": "mit-ep" if mit_preisen else "ohne-preise",
        },
    )


# ---------------------------------------------------------------------------
# §91 — Offres d'entreprises (GAEB entrant) : base de l'Angebotsvergleich
# ---------------------------------------------------------------------------

MAX_OFFERS_PER_ROOM = 12        # borne servie — un LV n'a pas 13 entreprises


def _offer_meta(row: GaebOffer) -> dict:
    return {
        "id": row.id,
        "room": row.room,
        "company_name": row.company_name,
        "filename": row.filename,
        "dp": row.dp,
        "cur": row.cur,
        "item_count": row.item_count,
        "ohne_preis_count": row.ohne_preis_count,
        "gp_total_cents": row.gp_total_cents,
        "bytes": row.bytes,
        "created_by_name": row.created_by_name,
        "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
    }


def _offer_or_404(db: Session, tenant_id: str, room: str, offer_id: str) -> GaebOffer:
    row = db.get(GaebOffer, offer_id)
    if row is None or row.tenant_id != tenant_id or row.room != room:
        raise HTTPException(404, "Angebot nicht gefunden.")
    return row


@router.post("/{room}/offers", status_code=201)
def upload_offer(room: str,
                 file: UploadFile = File(...),
                 firma: str = Form(...),
                 current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """Import d'une offre (X83/X31 bepreist). Refus MOTIVÉ, jamais d'import
    silencieux d'un fichier douteux (les messages du parseur sont DE)."""
    _check_room(room)
    company = firma.strip()[:200]
    if not company:
        raise HTTPException(422, "Firmenname fehlt — wem gehört dieses Angebot?")
    count = (
        db.query(GaebOffer)
        .filter(GaebOffer.tenant_id == current_user.tenant_id, GaebOffer.room == room)
        .count()
    )
    if count >= MAX_OFFERS_PER_ROOM:
        raise HTTPException(
            422,
            f"Maximal {MAX_OFFERS_PER_ROOM} Angebote je Notiz — bitte zuerst eines entfernen.",
        )
    raw = file.file.read(MAX_XML_BYTES + 1)
    try:
        parsed = parse_gaeb_offer_xml(raw)
    except GaebImportError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = GaebOffer(
        id=uuid.uuid4().hex,
        tenant_id=current_user.tenant_id,
        room=room,
        company_name=company,
        filename=(file.filename or "")[:200],
        dp=parsed["dp"],
        cur=parsed["cur"],
        xml_raw=raw[:MAX_XML_BYTES],
        bytes=len(raw[:MAX_XML_BYTES]),
        items_json=json.dumps(parsed["items"], ensure_ascii=False),
        item_count=parsed["item_count"],
        ohne_preis_count=parsed["ohne_preis_count"],
        gp_total_cents=parsed["gp_total_cents"],
        created_by=current_user.id,
        created_by_name=current_user.name,
        created_at=_utcnow(),
    )
    db.add(row)
    db.commit()
    return {
        "offer": _offer_meta(row),
        "max_offers": MAX_OFFERS_PER_ROOM,
        "hinweis": ("Import geprüft: Preise in Cent gespeichert, XML-Original "
                    "aufbewahrt. Positionen ohne EP sind gezählt, nie als 0 € erfunden."),
    }


@router.get("/{room}/offers")
def list_offers(room: str,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    _check_room(room)
    rows = (
        db.query(GaebOffer)
        .filter(GaebOffer.tenant_id == current_user.tenant_id, GaebOffer.room == room)
        .order_by(GaebOffer.created_at.asc(), GaebOffer.id.asc())
        .all()
    )
    return {
        "room": room,
        "count": len(rows),
        "max_offers": MAX_OFFERS_PER_ROOM,
        "offers": [_offer_meta(r) for r in rows],
    }


@router.get("/{room}/offers/{offer_id}")
def get_offer(room: str, offer_id: str,
              current_user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    _check_room(room)
    row = _offer_or_404(db, current_user.tenant_id, room, offer_id)
    return {"offer": _offer_meta(row), "items": json.loads(row.items_json)}


@router.delete("/{room}/offers/{offer_id}", status_code=204)
def delete_offer(room: str, offer_id: str,
                 current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    _check_room(room)
    row = _offer_or_404(db, current_user.tenant_id, room, offer_id)
    # §96 — la pièce part, ses observations de prix partent aussi :
    # la provenance reste TOUJOURS réversible, jamais de chiffre fantôme.
    delete_observations_of_offer(
        db, tenant_id=current_user.tenant_id, offer_id=row.id,
    )
    db.delete(row)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# §92 — Angebotsvergleich : la matrice entreprises × positions (le verdict)
# ---------------------------------------------------------------------------

@router.get("/{room}/offers/compare/matrix")
def compare_offers(room: str,
                   current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    """Matrice de comparaison : LV interne (§89) × offres importées (§91).

    422 « noch keine Angebote » si rien à comparer — y compris quand le
    document est absent : invisibilité inter-bureaux conservée.
    """
    _check_room(room)
    offers = (
        db.query(GaebOffer)
        .filter(GaebOffer.tenant_id == current_user.tenant_id, GaebOffer.room == room)
        .order_by(GaebOffer.created_at.asc(), GaebOffer.id.asc())
        .all()
    )
    if not offers:
        raise HTTPException(
            422,
            "Noch keine Angebote — zuerst mindestens eine bepreiste GAEB-Datei "
            "hochladen, dann vergleichen.",
        )
    doc = db.get(CollabDoc, f"{current_user.tenant_id}:{room}")
    internal = extract_lv_positions(bytes(doc.state)) if doc is not None and doc.state else []
    parsed_offers = [
        {
            "id": row.id,
            "company_name": row.company_name,
            "dp": row.dp,
            "items": json.loads(row.items_json),
        }
        for row in offers
    ]
    matrix = build_comparison(internal, parsed_offers)
    return {
        "room": room,
        **matrix,
        "hinweis": ("EP-Vergleich je Zeile; « nur im Angebot » = vom Unternehmen "
                    "ergänzt. Unvollständige Angebote sind markiert, ihr Total "
                    "ist eine Teilsumme — nie als vergleichbar ausgegeben."),
    }


# ---------------------------------------------------------------------------
# §93 — Émission formelle X83 : l'Angebot retenu, normalisé par le produit
# ---------------------------------------------------------------------------

@router.get("/{room}/offers/{offer_id}/gaeb.x83")
def download_offer_gaeb_x83(room: str, offer_id: str,
                            projekt: str = "",
                            current_user: User = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    """GAEB X83 (Angebot, DP=83) d'une offre stockée — re-généré depuis
    les prix VÉRIFIÉS à l'import (§91), jamais depuis le XML d'origine.

    404 inter-bureaux indifférenciable (même comportement que GET
    /offers/{id}) ; 422 MOTIVÉ si la donnée stockée n'est pas émettable
    (garde défensive — l'import §91 refuse déjà ces cas). Jamais de
    0,00 € écrit pour une position « ohne EP ».
    """
    _check_room(room)
    row = _offer_or_404(db, current_user.tenant_id, room, offer_id)
    try:
        xml = build_offer_gaeb_x83(
            project_name=projekt.strip()[:256] or f"Angebot — {row.company_name}",
            company_name=row.company_name,
            items=json.loads(row.items_json),
            cur=row.cur,
            source_dp=row.dp,
        )
    except OfferX83Error as exc:
        raise HTTPException(422, str(exc)) from exc
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", row.company_name).strip("-")[:40]
    filename = f"angebot-{slug or 'unternehmen'}.x83"
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Narchi-Offer-Positionen": str(row.item_count),
            "X-Narchi-Offer-Ohne-EP": str(row.ohne_preis_count),
        },
    )


# ---------------------------------------------------------------------------
# §95 — « Preis-Spiegel » : la Preisbibliothek apprend des offres réelles
# ---------------------------------------------------------------------------

@router.post("/{room}/offers/{offer_id}/to-library")
def offer_to_library(room: str, offer_id: str,
                     current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    """Reprend les EP RÉELS d'une offre stockée dans la Preisbibliothek
    du bureau (§50) — même upsert idempotent, même fortgeschriebene
    Anzeige Destatis (§49), provenance dans source_file, rien d'inventé.

    404 inter-bureaux indifférenciable ; le rapport énumère les sauts
    (ohne EP, OZ doppelt, plausibilité) — jamais un import muet.
    """
    _check_room(room)
    row = _offer_or_404(db, current_user.tenant_id, room, offer_id)
    result = prices_from_offer_items(
        json.loads(row.items_json), preisstand_jahr=row.created_at.year,
    )
    if not result.accepted:
        raise HTTPException(
            422,
            "Nichts zu übernehmen — das Angebot enthält keine bepreiste Position "
            "mit OZ. Kein Preis wird erfunden.",
        )
    label = offer_source_label(
        company_name=row.company_name, room=row.room,
        received_at=row.created_at,
    )
    stats = commit_import(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        source_file=label,
        result=result,
    )
    # §96 — chaque EP repris est mémorisé comme OBSERVATION (idempotent) :
    # c'est leur histoire qui rend la médiane §96 possible. Jamais une
    # observation pour une ligne sautée (on n'observe pas un prix absent).
    observations_added = record_observations(
        db,
        tenant_id=current_user.tenant_id,
        offer_id=row.id,
        company_name=row.company_name,
        source_label=label,
        preisstand_jahr=row.created_at.year,
        accepted=result.accepted,
        taken_by=current_user.id,
        taken_at=_utcnow(),
    )
    return {
        "inserted": stats.inserted,
        "updated": stats.updated,
        "skipped": len(result.rejected),
        "total_active": stats.total_active,
        "preisstand_jahr": row.created_at.year,
        "observations_added": observations_added,
        # §97 — millésime plus ancien que l'existant pour l'OZ → refusé,
        # compté et dit (l'observation, elle, reste mémorisée = histoire).
        "skipped_veraltet": len(stats.skipped_veraltet or []),
        "hinweis": (
            "Netto-EP aus dem Angebot «" + row.company_name + "» (Preisstand "
            + str(row.created_at.year) + ") — fortgeschrieben wird wie bei "
            "allen Büropreisen mit dem offiziellen Destatis-Index (siehe "
            "Preisbibliothek). Ohne-EP-Positionen wurden übersprungen, nichts "
            "erfunden."
        ),
    }
