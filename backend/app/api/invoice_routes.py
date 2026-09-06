# §116 — API Factures / E-Rechnung (« finis d'abord la E-Rechnung »).
#
#   GET    /api/v5/invoices              → liste (filtres status/q, limit capé)
#   POST   /api/v5/invoices              → brouillon (totaux calculés serveur)
#   GET    /api/v5/invoices/{id}         → détail (404 hors tenant, garde §80)
#   PUT    /api/v5/invoices/{id}         → brouillon SEULEMENT (409 sinon)
#   DELETE /api/v5/invoices/{id}         → brouillon SEULEMENT (GoBD : une
#                                          facture émise ne disparaît JAMAIS)
#   POST   /api/v5/invoices/{id}/issue   → ÉMISSION : numéro + date serveur,
#                                          pré-validée (422 + violations nues)
#   POST   /api/v5/invoices/{id}/cancel  → storno : marquée, numéro CONSERVÉ
#   GET    /api/v5/invoices/{id}/validation   → bilan EN 16931/XRechnung nu
#   GET    /api/v5/invoices/{id}/xrechnung.xml → XML CII D16B (profil KoSIT)
#
# GoBD tenu ici, pas « conseillé » : numérotation continue par bureau et
# par année (invoice_counters), émise figée, stornée jamais effacée.
from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.database import get_db
from app.models.invoice import STATUTS, Invoice, InvoiceCounter
from app.models.tenant_branding import TenantBranding
from app.models.user import User
from app.schemas.invoice import (
    CancelRequest,
    InvoiceListResponse,
    InvoiceOut,
    InvoiceUpsert,
    ValidationReport,
)
from app.services.ubl import construire_ubl
from app.services.versand import eml_bytes
from app.services.xrechnung import (
    Facture,
    LigneFacture,
    Partie,
    XRechnungError,
    calculer_totaux,
    construire_cii,
    valider,
)
from app.services.zugferd_pdf import generer_pdf_zugferd
from app.services.kosit_client import sidecar_ready, validate_pair as kosit_validate_pair

router = APIRouter(prefix="/api/v5/invoices", tags=["Rechnungen / E-Rechnung §116"])
logger = get_logger("invoices")

LIMITE_MAX = 500
_CENT = Decimal("0.01")


def _fmt(v: Decimal) -> str:
    """Mêmes règles que le service §114 (centimes, HALF_UP)."""
    return str(v.quantize(_CENT, rounding=ROUND_HALF_UP))


def _lignes(inv: Invoice) -> list[LigneFacture]:
    """JSON stocké → lignes du service §114 (chaînes → Decimal, 0 float)."""
    out: list[LigneFacture] = []
    for li in inv.lines or []:
        out.append(
            LigneFacture(
                designation=str(li["designation"]),
                quantite=Decimal(str(li["quantite"])),
                unite=str(li["unite"]),
                prix_unitaire_ht=Decimal(str(li["prix_unitaire_ht"])),
                taux_tva=Decimal(str(li["taux_tva"])),
                categorie_tva=str(li.get("categorie_tva", "S")),
            )
        )
    return out


def _facture(inv: Invoice, numero: str | None = None, issue_date: str | None = None) -> Facture:
    """État COURANT → modèle du service §114. Le brouillon part sans
    numéro ni date : le rapport de validation le dit (XR-01/02) au lieu
    de simuler une facture officielle qui n'existe pas."""
    return Facture(
        numero=numero if numero is not None else (inv.rechnungsnummer or ""),
        date_emission=issue_date if issue_date is not None else (inv.issue_date or ""),
        vendeur=Partie(
            nom=inv.seller_name or "",
            rue=inv.seller_street or "",
            code_postal=inv.seller_zip or "",
            ville=inv.seller_city or "",
            pays=inv.seller_country or "DE",
            vat_id=inv.seller_vat_id or "",
            email=inv.seller_email or "",
        ),
        acheteur=Partie(
            nom=inv.buyer_name,
            rue=inv.buyer_street or "",
            code_postal=inv.buyer_zip or "",
            ville=inv.buyer_city or "",
            pays=inv.buyer_country or "DE",
            email=inv.buyer_email or "",
        ),
        lignes=tuple(_lignes(inv)),
        devise=inv.currency or "EUR",
        reference_acheteur=inv.buyer_reference or "",
        date_livraison=inv.delivery_date or "",
        periode_debut=inv.period_start or "",
        periode_fin=inv.period_end or "",
        date_echeance=inv.due_date or "",
        iban=inv.seller_iban or "",
        titulaire_compte=inv.seller_account_name or "",
        bic=inv.seller_bic or "",
        processus=inv.processus or "",
        contact_nom=inv.seller_contact_name or "",
        contact_telephone=inv.seller_contact_phone or "",
        contact_email=inv.seller_contact_email or "",
        notes=tuple(inv.notes or []),
    )


def _out(inv: Invoice) -> InvoiceOut:
    return InvoiceOut(
        id=inv.id,
        status=inv.status,
        rechnungsnummer=inv.rechnungsnummer,
        issue_date=inv.issue_date,
        profile=inv.profile,
        project_id=inv.project_id,
        buyer_name=inv.buyer_name,
        buyer_street=inv.buyer_street or "",
        buyer_zip=inv.buyer_zip or "",
        buyer_city=inv.buyer_city or "",
        buyer_country=inv.buyer_country or "DE",
        buyer_reference=inv.buyer_reference or "",
        seller_name=inv.seller_name or "",
        seller_street=inv.seller_street or "",
        seller_zip=inv.seller_zip or "",
        seller_city=inv.seller_city or "",
        seller_country=inv.seller_country or "DE",
        seller_vat_id=inv.seller_vat_id or "",
        seller_iban=inv.seller_iban or "",
        seller_bic=inv.seller_bic or "",
        seller_account_name=inv.seller_account_name or "",
        seller_email=inv.seller_email or "",
        buyer_email=inv.buyer_email or "",
        seller_contact_name=inv.seller_contact_name or "",
        seller_contact_phone=inv.seller_contact_phone or "",
        seller_contact_email=inv.seller_contact_email or "",
        processus=inv.processus or "",
        currency=inv.currency or "EUR",
        delivery_date=inv.delivery_date,
        period_start=inv.period_start,
        period_end=inv.period_end,
        due_date=inv.due_date,
        lines=[dict(li) for li in (inv.lines or [])],
        notes=list(inv.notes or []),
        total_net=inv.total_net,
        total_tva=inv.total_tva,
        total_brut=inv.total_brut,
        created_by=inv.created_by,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
        issued_at=inv.issued_at,
        cancelled_at=inv.cancelled_at,
        cancel_reason=inv.cancel_reason or "",
    )


def _own_or_404(db: Session, invoice_id: str, tenant_id: str) -> Invoice:
    inv = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
        .first()
    )
    if inv is None:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden")
    return inv


def _applique_upsert(inv: Invoice, payload: InvoiceUpsert, user_id: str) -> None:
    """Écrit le contenu du brouillon + totaux RECALCULÉS serveur."""
    inv.buyer_name = payload.buyer_name
    inv.buyer_street = payload.buyer_street
    inv.buyer_zip = payload.buyer_zip
    inv.buyer_city = payload.buyer_city
    inv.buyer_country = payload.buyer_country
    inv.buyer_reference = payload.buyer_reference
    inv.seller_name = payload.seller_name
    inv.seller_street = payload.seller_street
    inv.seller_zip = payload.seller_zip
    inv.seller_city = payload.seller_city
    inv.seller_country = payload.seller_country
    inv.seller_vat_id = payload.seller_vat_id
    inv.seller_iban = payload.seller_iban
    inv.seller_bic = payload.seller_bic
    inv.seller_account_name = payload.seller_account_name
    inv.seller_email = payload.seller_email
    inv.buyer_email = payload.buyer_email
    inv.seller_contact_name = payload.seller_contact_name
    inv.seller_contact_phone = payload.seller_contact_phone
    inv.seller_contact_email = payload.seller_contact_email
    inv.processus = payload.processus
    inv.currency = payload.currency
    inv.project_id = payload.project_id
    inv.delivery_date = payload.delivery_date
    inv.period_start = payload.period_start
    inv.period_end = payload.period_end
    inv.due_date = payload.due_date
    inv.notes = list(payload.notes)
    inv.lines = [
        {
            "designation": li.designation,
            "quantite": li.quantite,
            "unite": li.unite,
            "prix_unitaire_ht": li.prix_unitaire_ht,
            "taux_tva": li.taux_tva,
            "categorie_tva": li.categorie_tva,
        }
        for li in payload.lines
    ]
    totaux = calculer_totaux(_lignes(inv))
    inv.total_net = _fmt(totaux["net"])
    inv.total_tva = _fmt(totaux["tva"])
    inv.total_brut = _fmt(totaux["brut"])
    inv.updated_at = datetime.now(timezone.utc)
    inv.created_by = inv.created_by or user_id


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


@router.get("", response_model=InvoiceListResponse)
def list_invoices(
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    project_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=200, ge=1, le=LIMITE_MAX),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    query = db.query(Invoice).filter(Invoice.tenant_id == current_user.tenant_id)
    if status:
        if status not in STATUTS:
            raise HTTPException(
                status_code=400,
                detail=f"status « {status} » inconnu (attendu : {', '.join(STATUTS)})",
            )
        query = query.filter(Invoice.status == status)
    if q:
        motif = f"%{q}%"
        query = query.filter(
            (Invoice.rechnungsnummer.ilike(motif)) | (Invoice.buyer_name.ilike(motif))
        )
    if project_id:
        query = query.filter(Invoice.project_id == project_id)
    rows = (
        query.order_by(Invoice.created_at.desc(), Invoice.id.desc()).limit(limit).all()
    )
    return InvoiceListResponse(invoices=[_out(i) for i in rows], total=len(rows))


@router.post("", response_model=InvoiceOut, status_code=201)
def create_invoice(
    payload: InvoiceUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = Invoice(
        tenant_id=current_user.tenant_id,
        created_by=current_user.id,
        updated_at=datetime.now(timezone.utc),
    )
    _applique_upsert(inv, payload, current_user.id)
    db.add(inv)
    db.commit()
    db.refresh(inv)
    logger.info("invoice draft created", extra={"invoice_id": inv.id})
    return _out(inv)


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    return _out(_own_or_404(db, invoice_id, current_user.tenant_id))


@router.put("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: str,
    payload: InvoiceUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status != "draft":
        raise _conflict(
            f"Rechnung ist « {inv.status} » — nur Entwürfe sind änderbar "
            "(GoBD: stornieren Sie stattdessen und stellen Sie neu aus)"
        )
    _applique_upsert(inv, payload, current_user.id)
    db.commit()
    db.refresh(inv)
    return _out(inv)


@router.delete("/{invoice_id}", status_code=204)
def delete_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status != "draft":
        raise _conflict(
            "Nur Entwürfe werden gelöscht — eine ausgestellte Rechnung "
            "verschwindet nie (GoBD). Stornieren Sie sie stattdessen."
        )
    db.delete(inv)
    db.commit()
    return Response(status_code=204)


@router.get("/{invoice_id}/validation", response_model=ValidationReport)
def validate_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    violations = valider(_facture(inv), inv.profile or "xrechnung")
    return ValidationReport(ok=not violations, violations=violations)


@router.post("/{invoice_id}/issue", response_model=InvoiceOut)
def issue_invoice(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status != "draft":
        raise _conflict(f"Rechnung ist bereits « {inv.status} » — keine zweite Ausstellung")

    now = datetime.now(timezone.utc)
    issue_date = now.date().isoformat()
    year = now.year

    # Numéro CANDIDAT : le compteur ne sera consommé que si tout passe
    # (un essai refusé ne laisse JAMAIS de trou dans la chaîne).
    counter = (
        db.query(InvoiceCounter)
        .filter(
            InvoiceCounter.tenant_id == current_user.tenant_id,
            InvoiceCounter.year == year,
        )
        .first()
    )
    seq = counter.next_seq if counter else 1
    numero = f"RE-{year}-{seq:04d}"

    violations = valider(_facture(inv, numero=numero, issue_date=issue_date), inv.profile or "xrechnung")
    if violations:
        # 422 avec les violations NUES : le frontend les affiche telles
        # quelles (jamais « invalide » sans raison).
        raise HTTPException(
            status_code=422,
            detail={"detail": "Ausstellung verweigert — Pflichtangaben fehlen", "violations": violations},
        )

    if counter is None:
        counter = InvoiceCounter(
            tenant_id=current_user.tenant_id, year=year, next_seq=seq + 1
        )
        db.add(counter)
    else:
        counter.next_seq = seq + 1

    inv.status = "issued"
    inv.rechnungsnummer = numero
    inv.issue_date = issue_date
    inv.issued_at = now
    inv.updated_at = now
    try:
        db.commit()
    except IntegrityError:
        # Deux émissions simultanées (PostgreSQL) : l'index unique partiel
        # sur (tenant_id, rechnungsnummer) a refusé le doublon. Pas de
        # trou, pas de numéro volé : on le dit franchement.
        db.rollback()
        raise _conflict(
            "Nummernkonflikt bei gleichzeitiger Ausstellung — bitte erneut ausstellen"
        ) from None
    db.refresh(inv)
    logger.info("invoice issued", extra={"invoice_id": inv.id, "nummer": numero})
    return _out(inv)


@router.post("/{invoice_id}/cancel", response_model=InvoiceOut)
def cancel_invoice(
    invoice_id: str,
    payload: CancelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status != "issued":
        raise _conflict(
            f"Nur ausgestellte Rechnungen werden storniert (hier: « {inv.status} ») — "
            "einen Entwurf können Sie einfach löschen"
        )
    now = datetime.now(timezone.utc)
    inv.status = "cancelled"
    inv.cancelled_at = now
    inv.cancel_reason = payload.reason
    inv.updated_at = now
    db.commit()
    db.refresh(inv)
    logger.info("invoice cancelled", extra={"invoice_id": inv.id, "nummer": inv.rechnungsnummer})
    return _out(inv)


_NOM_SUR = re.compile(r"[^A-Za-z0-9._-]+")


def _branding(db: Session, tenant_id: str) -> tuple[str | None, str | None]:
    """Branding du bureau (§77) : (logo_b64, office_name) ou (None, None).

    Le logo/nom décorent le PDF ZUGFeRD (§150) — sans branding, le PDF reste
    sobre avec le nom du vendeur. Jamais d'erreur si la table/ligne manque.
    """
    try:
        row = (
            db.query(TenantBranding)
            .filter(TenantBranding.tenant_id == tenant_id)
            .first()
        )
    except Exception:
        return None, None
    if row is None:
        return None, None
    return (row.logo_b64 if row.logo_mime and row.logo_b64 else None), (
        row.office_name or None
    )


@router.get("/{invoice_id}/xrechnung.xml")
def download_xml(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status == "draft":
        raise _conflict(
            "Entwurf ohne Rechnungsnummer — erst ausstellen, dann liefert Narchi das XML"
        )
    if inv.status == "cancelled":
        raise _conflict(
            f"Rechnung {inv.rechnungsnummer} ist storniert — kein neues XML "
            "(das Originaldokument ist im Audit archiviert, der Nummer bleibt reserviert)"
        )
    try:
        xml = construire_cii(_facture(inv), inv.profile or "xrechnung")
    except XRechnungError as exc:  # ne devrait JAMAIS arriver (émission pré-validée)
        logger.error("xml regeneration refused", extra={"violations": exc.violations})
        raise HTTPException(
            status_code=500,
            detail={"detail": "XML nicht erzeugbar — Daten beschädigt?", "violations": exc.violations},
        ) from None
    nom = _NOM_SUR.sub("_", inv.rechnungsnummer or inv.id)
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{nom}.xml"'},
    )


@router.post("/{invoice_id}/kosit")
def kosit_check(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§260 — Verdict du JAR KoSIT (sidecar). Jamais un faux ACCEPTABLE local."""
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status == "draft":
        raise _conflict(
            "Entwurf ohne Rechnungsnummer — erst ausstellen, dann KoSIT"
        )
    if inv.status == "cancelled":
        raise _conflict(
            f"Rechnung {inv.rechnungsnummer} ist storniert — kein KoSIT-Lauf"
        )
    try:
        fac = _facture(inv)
        cii = construire_cii(fac, inv.profile or "xrechnung")
        ubl = construire_ubl(fac, inv.profile or "xrechnung")
    except XRechnungError as exc:
        raise HTTPException(
            status_code=500,
            detail={"detail": "XML nicht erzeugbar", "violations": exc.violations},
        ) from None
    result = kosit_validate_pair(cii, ubl)
    result["sidecar_ready"] = sidecar_ready() if result.get("verdict") != "UNAVAILABLE" else False
    if result.get("verdict") == "UNAVAILABLE":
        raise HTTPException(status_code=503, detail=result.get("detail") or "KoSIT nicht da")
    now = datetime.now(timezone.utc)
    inv.kosit_last = {
        "ok": result.get("ok"),
        "verdict": result.get("verdict"),
        "cii": result.get("cii"),
        "ubl": result.get("ubl"),
        "peppol_network": False,
        "checked_at": now.isoformat(),
    }
    inv.kosit_checked_at = now
    inv.updated_at = now
    db.commit()
    db.refresh(inv)
    result["kosit_checked_at"] = now.isoformat()
    return result


@router.get("/{invoice_id}/zugferd.pdf")
def download_zugferd(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§129 — Facture hybride PDF/A-3 + factur-x.xml embarqué (ZUGFeRD/Factur-X).

    Mêmes gardes que le XML : brouillon = 409 (pas de numéro officiel),
    stornée = 409 (document d'origine archivé, numéro réservé). Le XML
    embarqué est au profil `en16931` (celui de ZUGFeRD/Factur-X, plus souple
    que l'extension XRechnung qui exige Leitweg-ID/IBAN).
    """
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status == "draft":
        raise _conflict(
            "Entwurf ohne Rechnungsnummer — erst ausstellen, dann liefert Narchi das PDF"
        )
    if inv.status == "cancelled":
        raise _conflict(
            f"Rechnung {inv.rechnungsnummer} ist storniert — kein neues PDF "
            "(das Originaldokument ist im Audit archiviert, die Nummer bleibt reserviert)"
        )
    try:
        fac = _facture(inv)
        xml = construire_cii(fac, "en16931")
        logo_b64, office_name = _branding(db, current_user.tenant_id)
        pdf = generer_pdf_zugferd(fac, xml, logo_b64=logo_b64, office_name=office_name)
    except XRechnungError as exc:  # ne devrait JAMAIS arriver (émission pré-validée)
        logger.error("zugferd regeneration refused", extra={"violations": exc.violations})
        raise HTTPException(
            status_code=500,
            detail={"detail": "PDF nicht erzeugbar — Daten beschädigt?", "violations": exc.violations},
        ) from None
    nom = _NOM_SUR.sub("_", inv.rechnungsnummer or inv.id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nom}_zugferd.pdf"'},
    )


@router.get("/{invoice_id}/xrechnung-ubl.xml")
def download_ubl(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§130 — Même facture en syntaxe UBL 2.1 (la syntaxe du réseau Peppol).

    Mêmes gardes que le XML CII : brouillon = 409, stornée = 409. La syntaxe
    est UBL, le PROFIL reste celui de la facture (xrechnung ou en16931).
    """
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status == "draft":
        raise _conflict(
            "Entwurf ohne Rechnungsnummer — erst ausstellen, dann liefert Narchi das UBL"
        )
    if inv.status == "cancelled":
        raise _conflict(
            f"Rechnung {inv.rechnungsnummer} ist storniert — kein neues UBL "
            "(das Originaldokument ist im Audit archiviert, die Nummer bleibt reserviert)"
        )
    try:
        ubl = construire_ubl(_facture(inv), inv.profile or "xrechnung")
    except XRechnungError as exc:  # ne devrait JAMAIS arriver (émission pré-validée)
        logger.error("ubl regeneration refused", extra={"violations": exc.violations})
        raise HTTPException(
            status_code=500,
            detail={"detail": "UBL nicht erzeugbar — Daten beschädigt?", "violations": exc.violations},
        ) from None
    nom = _NOM_SUR.sub("_", inv.rechnungsnummer or inv.id)
    return Response(
        content=ubl,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{nom}_ubl.xml"'},
    )


@router.get("/{invoice_id}/versand.eml")
def download_email(
    invoice_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """§131 — E-mail prêt à l'envoi (.eml) avec la facture hybride jointe.

    Mêmes gardes que le XML : brouillon = 409, stornée = 409. L'e-mail est
    GÉNÉRÉ (expéditeur/destinataire du modèle, objet+corps allemand, pièce
    jointe = PDF/A-3 ZUGFeRD §129) mais jamais « envoyé » par Narchi : le
    bureau l'ouvre dans son client mail et l'envoie lui-même (pas de SMTP
    intégré, dit dans docs/PEPPOL.md). Sans e-mail destinataire (BT-49) le
    téléchargement refuse honnêtement — on ne fabrique pas un destinataire.
    """
    db.info["tenant_id"] = current_user.tenant_id
    inv = _own_or_404(db, invoice_id, current_user.tenant_id)
    if inv.status == "draft":
        raise _conflict(
            "Entwurf ohne Rechnungsnummer — erst ausstellen, dann liefert Narchi den E-Mail-Entwurf"
        )
    if inv.status == "cancelled":
        raise _conflict(
            f"Rechnung {inv.rechnungsnummer} ist storniert — kein E-Mail-Entwurf "
            "(das Originaldokument ist im Audit archiviert)"
        )
    fac = _facture(inv)
    if not fac.acheteur.email.strip():
        raise _conflict(
            "Keine E-Mail-Adresse des Kunden hinterlegt — der E-Mail-Versand "
            "braucht einen echten Empfänger (er wird gespeichert, nie erfunden)"
        )
    try:
        xml = construire_cii(fac, "en16931")
        logo_b64, office_name = _branding(db, current_user.tenant_id)
        pdf = generer_pdf_zugferd(fac, xml, logo_b64=logo_b64, office_name=office_name)
        eml = eml_bytes(fac, pdf)
    except XRechnungError as exc:  # ne devrait JAMAIS arriver (émission pré-validée)
        logger.error("versand regeneration refused", extra={"violations": exc.violations})
        raise HTTPException(
            status_code=500,
            detail={"detail": "E-Mail-Entwurf nicht erzeugbar — Daten beschädigt?", "violations": exc.violations},
        ) from None
    nom = _NOM_SUR.sub("_", inv.rechnungsnummer or inv.id)
    return Response(
        content=eml,
        media_type="message/rfc822",
        headers={"Content-Disposition": f'attachment; filename="{nom}_versand.eml"'},
    )
