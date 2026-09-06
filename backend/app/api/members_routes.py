"""§80 — Hiérarchie Büro 3 niveaux (spécification utilisateur) :

    owner  : TOUT — y compris promouvoir/rétrograder la Geschäftsführung ;
    admin  : gère les MEMBRES (architect) : créer, désactiver, réactiver,
             supprimer + invitations — JAMAIS créer d'admin/owner, JAMAIS
             toucher un owner ni un autre admin ;
    architect : aucune gestion (403) — self-service /members/me
             (nom, avatar) ; mot de passe via /auth/reset-password (§60).

Garde-fous gravés : jamais soi-même ici, owner NON supprimable, dernier
owner actif indésactivable (bureau jamais orphelin), email plattformweit
unique, rôle « architect » forcé à la création (l'élévation est réservée
à l'owner via /role). Chaque action d'administration est AUDITÉE (AuditLog
SOC2 append-only). La désactivation est RÉELLE : login (:163), refresh
(:261) et get_current_user (dependencies.py:124) refusent is_active=False.
"""

import json
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, get_password_hash
from app.database import get_db
from app.middlewares.dos_guard import verify_dos_protection
from app.models.audit_log import AuditLog
from app.models.chat import ChatChannelMember
from app.models.user import User

router = APIRouter(
    prefix="/api/v5/members",
    tags=["Mitgliederverwaltung (owner > Geschäftsführung > Mitglied)"],
)

ROLES_MANAGE = ("owner", "admin")  # ce qui change par rapport à « owner seul »
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_ROLE_RANK = {"owner": 0, "admin": 1, "architect": 2, "guest": 3}


class MemberCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    company: Optional[str] = Field(default=None, max_length=160)


class RolePatchIn(BaseModel):
    role: str = Field(pattern="^(admin|architect)$")  # owner n'est JAMAIS assignable ici


class MeUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    avatar_key: Optional[str] = Field(default=None, max_length=64)
    # §82 — contenu de l'avatar : {"kind":"photo","photo":"data:image/jpeg;base64,…"}
    # (≤ 64 ko, c'est le JPEG 128 px cadré navigateur) ou {"kind":"emoji","emoji":"🏗️"}.
    # None = inchangé ; objet = remplace ; {"kind": null} interdit (voir route, reset = "clear").
    avatar_json: Optional[str] = Field(default=None, max_length=68_000)


# §82 — validation stricte du contenu avatar (jamais de blob arbitraire en base)
_AVATAR_PHOTO_PREFIXES = ("data:image/jpeg;base64,", "data:image/png;base64,")
_AVATAR_PHOTO_MAX = 65_000
_AVATAR_EMOJI_MAX = 14


def _validate_avatar_payload(raw: str) -> Optional[str]:
    """Renvoie le JSON canonique à stocker, ou lève 400 si forme invalide."""
    try:
        spec = json.loads(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "Avatar ungültig: kein JSON.")
    if not isinstance(spec, dict):
        raise HTTPException(400, "Avatar ungültig: Objekt erwartet.")
    if spec.get("clear") is True:
        return None  # Zurücksetzen (Initialen) — suppression serveur explicite
    kind = spec.get("kind")
    if kind == "photo":
        photo = spec.get("photo")
        if not isinstance(photo, str) or not photo.startswith(_AVATAR_PHOTO_PREFIXES):
            raise HTTPException(400, "Foto ungültig: nur JPEG/PNG (data-URL).")
        if len(photo) > _AVATAR_PHOTO_MAX:
            raise HTTPException(400, "Foto zu groß (max. 64 KB).")
        return json.dumps({"kind": "photo", "photo": photo}, ensure_ascii=False)
    if kind == "emoji":
        emoji = spec.get("emoji")
        if not isinstance(emoji, str) or not emoji.strip() or len(emoji) > _AVATAR_EMOJI_MAX:
            raise HTTPException(400, "Emoji ungültig.")
        return json.dumps({"kind": "emoji", "emoji": emoji.strip()}, ensure_ascii=False)
    raise HTTPException(400, "Avatar ungültig: kind muss „photo“ oder „emoji“ sein.")


class MemberOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    avatar_key: Optional[str] = None
    avatar_json: Optional[str] = None
    created_at: Optional[str] = None
    last_login: Optional[str] = None


def _out(u: User) -> MemberOut:
    return MemberOut(
        id=u.id, email=u.email, name=u.name, role=u.role,
        is_active=bool(u.is_active), avatar_key=u.avatar_key,
        avatar_json=u.avatar_json,
        created_at=u.created_at.isoformat() if u.created_at else None,
        last_login=u.last_login.isoformat() if u.last_login else None,
    )


def _audit(db: Session, actor: User, action: str, **payload) -> None:
    """Trace SOC2 append-only de chaque décision d'administration."""
    db.add(AuditLog(tenant_id=actor.tenant_id, user_id=actor.id,
                    action=action, payload=payload or None))


def _require_manager(actor: User) -> None:
    if actor.role not in ROLES_MANAGE:
        raise HTTPException(
            403, "Mitgliederverwaltung nur für Eigentümer und Geschäftsführung."
        )


def _target(db: Session, actor: User, member_id: str) -> User:
    row = db.execute(
        select(User).where(User.id == member_id, User.tenant_id == actor.tenant_id)
    ).scalars().first()
    if row is None:
        raise HTTPException(404, "Mitglied im eigenen Büro nicht gefunden.")
    return row


def _guard_mutation(actor: User, target: User) -> None:
    """Règles communes à deactivate/activate/delete/role."""
    if target.id == actor.id:
        raise HTTPException(409, "Das eigene Konto ändert man im Profil, nicht hier.")
    if actor.role == "admin" and target.role != "architect":
        raise HTTPException(
            403,
            "Geschäftsführung verwaltet nur Mitglieder (architect) — "
            "nie Eigentümer oder andere Admins.",
        )


def _guard_not_sole_active_owner(db: Session, target: User) -> None:
    if target.role != "owner" or not target.is_active:
        return
    active_owners = db.execute(
        select(func.count()).select_from(User).where(
            User.tenant_id == target.tenant_id,
            User.role == "owner",
            User.is_active.is_(True),
        )
    ).scalar_one()
    if active_owners <= 1:
        raise HTTPException(
            409,
            "Letzter aktiver Eigentümer — das Büro wäre verwaist. "
            "Zuerst eine Nachfolge einrichten.",
        )


@router.get("")
def list_members(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Liste RÉELLE des comptes du bureau (PostgreSQL — plus d'annuaire navigateur)."""
    _require_manager(current_user)
    rows = db.execute(
        select(User).where(User.tenant_id == current_user.tenant_id)
    ).scalars().all()
    rows.sort(key=lambda u: (_ROLE_RANK.get(u.role, 9), (u.name or "").lower()))
    return {
        "count": len(rows),
        "your_role": current_user.role,
        "members": [_out(u) for u in rows],
    }


@router.post("", status_code=201, dependencies=[Depends(verify_dos_protection)])
def create_member(
    payload: MemberCreateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Crée un MEMBRE (architect) dans le bureau — l'élévation se fait
    ensuite, par l'owner seul, via /role. Mot de passe initial choisi par
    le gérant et transmis hors application (affiché UNE fois côté UI)."""
    _require_manager(current_user)
    email = payload.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(422, "E-Mail-Format ungültig.")
    exists = db.execute(select(User).where(User.email == email)).scalars().first()
    if exists is not None:
        raise HTTPException(409, "Diese E-Mail ist bereits vergeben (plattformweit eindeutig).")
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        hashed_password=get_password_hash(payload.password),
        name=payload.name.strip(),
        role="architect",  # GRAVÉ : jamais admin/owner à la création
        company=(payload.company or None),
        tenant_id=current_user.tenant_id,
        is_active=True,
    )
    db.add(user)
    _audit(db, current_user, "MEMBER_CREATED", target_id=user.id,
           target_email=email[:2] + "***", by_role=current_user.role)
    db.commit()
    return _out(user)


@router.post("/{member_id}/deactivate")
def deactivate_member(
    member_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(current_user)
    target = _target(db, current_user, member_id)
    _guard_mutation(current_user, target)
    changed = bool(target.is_active)
    if changed:
        _guard_not_sole_active_owner(db, target)
        target.is_active = False
        _audit(db, current_user, "MEMBER_DEACTIVATED", target_id=target.id)
        db.commit()
    # Idempotent honnête : déjà inactif → changed=False plutôt qu'un faux succès.
    return {"changed": changed, "member": _out(target)}


@router.post("/{member_id}/activate")
def activate_member(
    member_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_manager(current_user)
    target = _target(db, current_user, member_id)
    _guard_mutation(current_user, target)
    changed = not bool(target.is_active)
    if changed:
        target.is_active = True
        _audit(db, current_user, "MEMBER_ACTIVATED", target_id=target.id)
        db.commit()
    return {"changed": changed, "member": _out(target)}


@router.patch("/{member_id}/role")
def change_role(
    member_id: str,
    payload: RolePatchIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Élévation/rétrogradation admin — réservée à l'OWNER (sa spécification)."""
    if current_user.role != "owner":
        raise HTTPException(403, "Rollen vergibt nur der Eigentümer.")
    target = _target(db, current_user, member_id)
    if target.id == current_user.id:
        raise HTTPException(409, "Die eigene Rolle ändert man nicht selbst.")
    if target.role == "owner":
        raise HTTPException(409, "Eigentümerrollen sind hier unveränderlich.")
    old = target.role
    if old != payload.role:
        target.role = payload.role
        _audit(db, current_user, "MEMBER_ROLE_CHANGED",
               target_id=target.id, from_role=old, to_role=payload.role)
        db.commit()
    return _out(target)


@router.delete("/{member_id}")
def remove_member(
    member_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Suppression dure d'un MEMBRE : owner/admin selon la matrice ; owner
    JAMAIS supprimable (désactiver à la place — la trace reste auditable)."""
    _require_manager(current_user)
    target = _target(db, current_user, member_id)
    _guard_mutation(current_user, target)
    if target.role == "owner":
        raise HTTPException(
            409, "Eigentümerkonten werden nicht gelöscht — deaktiviert, die Historie bleibt."
        )
    memberships = db.execute(
        select(ChatChannelMember).where(ChatChannelMember.user_id == target.id)
    ).scalars().all()
    for m in memberships:
        db.delete(m)
    _audit(db, current_user, "MEMBER_DELETED",
           target_id=target.id, target_email=target.email[:2] + "***",
           removed_channel_memberships=len(memberships))
    db.delete(target)
    db.commit()
    return {"deleted": member_id, "removed_channel_memberships": len(memberships)}


@router.patch("/me")
def update_my_profile(
    payload: MeUpdateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Self-service DE L'INVITÉ (et de tous) : nom + avatar. Jamais de rôle,
    jamais d'email ici — pas d'élévation de soi-même par la porte de service."""
    # §87 — BUG PERSISTANCE RÉEL (cause des avatars « jamais propagés » chez
    # le client) : get_current_user charge l'utilisateur dans SA propre
    # session (get_db_dependency) ; la `db` de la route est une AUTRE
    # session → modifier current_user puis db.commit() n'écrivait RIEN en
    # base malgré « changed: true ». Nos tests §80-§82 ne l'ont pas vu :
    # ils injectaient LA MÊME session aux deux dépendances. Le test §87
    # reproduit le câblage réel (application complète) et le prouve.
    user = db.get(User, current_user.id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Benutzerkonto nicht gefunden oder deaktiviert.")
    changed = False
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(422, "Name darf nicht leer sein.")
        if name != user.name:
            user.name = name
            changed = True
    if payload.avatar_key is not None:
        avatar_key = payload.avatar_key.strip() or None
        if avatar_key != user.avatar_key:
            user.avatar_key = avatar_key
            changed = True
    if payload.avatar_json is not None:
        # §82 — validation stricte (photo JPEG/PNG ≤ 64 ko OU emoji ; clear → reset)
        canon = _validate_avatar_payload(payload.avatar_json)
        if canon != user.avatar_json:
            user.avatar_json = canon
            changed = True
    if changed:
        db.commit()
    return {"changed": changed, "member": _out(user)}
