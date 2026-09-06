"""
NARCHI V5 — Enterprise Chat API Router.
REST + WebSocket real-time backend utilizing Redis Streams and Pub/Sub
for distributed multi-instance message broadcast, exact sequential ordering,
and secure HttpOnly cookie-based WebSocket authentication (OWASP compliant).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time

import redis.asyncio as redis_async
from redis.exceptions import RedisError
from datetime import datetime, timezone
from typing import Dict, Set, Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db, SessionLocal
from app.core.security import get_current_user
from app.core.security.jwt import get_token_payload
from app.core.logging import get_logger
from app.core.pagination import decode_cursor, encode_cursor
from app.models.user import User
from app.models.project import Project
from app.models.chat import ChatChannel, ChatChannelMember, ChatChannelTombstone, ChatMessage
from app.schemas.chat import (
    ChatChannelResponse,
    ChatMessageResponse,
    EnsureChannelsRequest,
    DirectChannelRequest,
    RenameChannelRequest,
    SendMessageRequest,
    TeamUserResponse,
)

router = APIRouter(prefix="/api/v5/chat", tags=["Team Chat V5"])
logger = get_logger("chat")

# §60 — anti-spam messages (audit externe « no rate limiting ») : l'envoi
# n'était protégé que par l'idempotence, pas par un quota. 30 messages/minute
# par utilisateur (conversations humaines jamais bridées, bots stoppés).
from app.core.rate_limit import RedisSlidingWindowRateLimiter

chat_send_limiter = RedisSlidingWindowRateLimiter(max_attempts=30, window_seconds=60, namespace="chat-send")
async_redis_client = redis_async.from_url(
    os.getenv("REDIS_URL", "redis://redis:6379/0"),
    decode_responses=True,
    socket_timeout=2,
)

# Lock global pour synchroniser les écritures WebSocket en mémoire
ws_lock = asyncio.Lock()

def _member_ids(channel: ChatChannel) -> list[str]:
    return sorted({member.user_id for member in channel.members})


def _is_channel_member(channel: ChatChannel, user_id: str) -> bool:
    # Un canal sans membres explicites est visible par tout le tenant.
    return not channel.members or any(member.user_id == user_id for member in channel.members)


def _channel_response(ch: ChatChannel) -> ChatChannelResponse:
    return ChatChannelResponse(
        id=ch.id,
        kind=ch.kind,  # type: ignore[arg-type]
        name=ch.name,
        memberIds=_member_ids(ch),
        projectId=ch.project_id,
        createdAt=ch.created_at,
    )


def _set_channel_members(
    channel: ChatChannel,
    member_ids: list[str],
    tenant_id: str,
) -> None:
    existing = {member.user_id for member in channel.members}
    for user_id in sorted({item for item in member_ids if item} - existing):
        channel.members.append(
            ChatChannelMember(user_id=user_id, tenant_id=tenant_id)
        )


def _ensure_base_channels(
    db: Session,
    member_ids: list[str],
    projects: list[dict],
    *,
    reconcile_archives: bool = False,
) -> None:
    tenant_id = db.info.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    tenant_digest = hashlib.sha256(tenant_id.encode()).hexdigest()[:16]
    definitions = [
        (f"ch-team-{tenant_digest}", "team", "Équipe", None),
        *[
            (f"ch-project-{project['id']}", "project", project["name"], project["id"])
            for project in projects
            if project.get("id") and project.get("name")
        ],
    ]

    # §110 — pierres tombales : un canal AUTO-GÉRÉ (équipe/projet) supprimé
    # par un owner/admin ne doit JAMAIS renaître d'une synchro — sinon le
    # « supprimer » serait du théâtre, le canal reviendrait tout seul.
    tombstoned = {
        row.id
        for row in db.query(ChatChannelTombstone.id)
        .filter(ChatChannelTombstone.tenant_id == tenant_id)
        .all()
    }

    for channel_id, kind, name, project_id in definitions:
        if channel_id in tombstoned:
            continue
        channel = db.query(ChatChannel).filter(ChatChannel.id == channel_id).first()
        if channel is None:
            channel = ChatChannel(
                id=channel_id,
                tenant_id=tenant_id,
                kind=kind,
                name=name,
                project_id=project_id,
            )
            db.add(channel)
        _set_channel_members(channel, member_ids, tenant_id)
    # §59 — Réconciliation douce des canaux PROJET, UNIQUEMENT lorsque le
    # frontend envoie son catalogue réel (jamais sur le repli « 20 derniers
    # projets », qui pourrait être vide/incomplet pendant un chargement) :
    # chaque import IFC régénère un identifiant projet → un canal par
    # incarnation restait visible à jamais (capture : 6 × « meuble final.ifc »).
    # - projet ABSENT du catalogue  -> archived_at posé (masqué des listes) ;
    # - projet PRÉSENT              -> archived_at effacé (résurrection sûre) ;
    # - messages, membres, lignes   -> JAMAIS supprimés ;
    # - canal d'équipe & Direktnachrichten -> JAMAIS touchés (kind != projet) ;
    # - filtre tenant EXPLICITE     -> aucune écriture hors périmètre.
    if reconcile_archives:
        live_project_ids = {
            project_id
            for (_channel_id, kind, _name, project_id) in definitions
            if kind == "project" and project_id
        }
        project_channels = (
            db.query(ChatChannel)
            .filter(
                ChatChannel.tenant_id == tenant_id,
                ChatChannel.kind == "project",
            )
            .all()
        )
        now = datetime.now(timezone.utc)
        for channel in project_channels:
            if channel.project_id in live_project_ids:
                if channel.archived_at is not None:
                    channel.archived_at = None
            elif channel.archived_at is None:
                channel.archived_at = now
    db.commit()


def _message_response(msg: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=msg.id,
        channelId=msg.channel_id,
        authorId=msg.author_id or "system",
        authorName=msg.author_name,
        text=msg.text,
        createdAt=msg.created_at,
        clientId=msg.client_id,
        clientCreatedAt=msg.client_created_at,
    )


# ============================================================================
# WEBSOCKET AUTHENTICATION BY SECURE COOKIE (OWASP 2026 Compliant)
# ============================================================================
def _authenticate_ws_cookie(websocket: WebSocket, db: Session) -> User:
    """
    Extrait et valide de manière hermétique le token de session stocké dans
    le cookie HttpOnly 'narchi_session' lors du handshake du WebSocket.
    Empêche toute fuite de token dans les journaux d'accès du reverse-proxy.
    """
    token = websocket.cookies.get("narchi_session")
    if not token:
        raise HTTPException(status_code=401, detail="Cookie de session manquant")

    payload = get_token_payload(token)
    if not payload or payload.get("type") == "refresh":
        raise HTTPException(status_code=401, detail="Jeton de session invalide")

    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Claims de session incomplets")

    db.info["tenant_id"] = tenant_id
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user or user.tenant_id != tenant_id:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")

    pw_stamp = payload.get("pw_stamp")
    if pw_stamp and (user.hashed_password or "")[-8:] != pw_stamp:
        raise HTTPException(status_code=401, detail="Session révoquée")
    return user


# ============================================================================
# CLASSE DE DIFFUSION DISTRIBUÉE MULTI-INSTANCE (Redis Pub/Sub)
# ============================================================================
class DistributedChatHub:
    """Diffuse les événements Redis avec l'API asyncio native, sans polling."""

    def __init__(self):
        self._local_connections: Dict[str, Set[WebSocket]] = {}
        self._listener_tasks: dict[str, asyncio.Task] = {}

    async def register_and_listen(self, channel_id: str, websocket: WebSocket) -> None:
        async with ws_lock:
            self._local_connections.setdefault(channel_id, set()).add(websocket)
            if channel_id not in self._listener_tasks:
                self._listener_tasks[channel_id] = asyncio.create_task(
                    self._redis_subscription_listener(channel_id),
                    name=f"chat-pubsub-{channel_id}",
                )

    async def unregister(self, channel_id: str, websocket: WebSocket) -> None:
        listener_to_cancel: asyncio.Task | None = None
        async with ws_lock:
            connections = self._local_connections.get(channel_id)
            if connections:
                connections.discard(websocket)
                if not connections:
                    self._local_connections.pop(channel_id, None)
                    listener_to_cancel = self._listener_tasks.pop(channel_id, None)

        if (
            listener_to_cancel
            and listener_to_cancel is not asyncio.current_task()
            and not listener_to_cancel.done()
        ):
            listener_to_cancel.cancel()
            try:
                await listener_to_cancel
            except asyncio.CancelledError:
                pass

    async def _redis_subscription_listener(self, channel_id: str) -> None:
        pubsub_key = f"pubsub:channel:{channel_id}"
        pubsub = async_redis_client.pubsub()
        try:
            await pubsub.subscribe(pubsub_key)
            logger.info("Redis async Pub/Sub listener started", extra={"channel_id": channel_id})
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                payload = json.loads(message["data"])
                async with ws_lock:
                    targets = list(self._local_connections.get(channel_id, set()))
                if not targets:
                    break

                results = await asyncio.gather(
                    *(socket.send_json(payload) for socket in targets),
                    return_exceptions=True,
                )
                for socket, result in zip(targets, results):
                    if isinstance(result, Exception):
                        logger.debug(
                            "Stale websocket removed",
                            extra={"channel_id": channel_id, "error": str(result)},
                        )
                        await self.unregister(channel_id, socket)
                async with ws_lock:
                    if not self._local_connections.get(channel_id):
                        break
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception(
                "Redis async Pub/Sub listener failed",
                extra={"channel_id": channel_id, "error": str(error)},
            )
        finally:
            await pubsub.unsubscribe(pubsub_key)
            await pubsub.aclose()
            async with ws_lock:
                current = self._listener_tasks.get(channel_id)
                if current is asyncio.current_task():
                    self._listener_tasks.pop(channel_id, None)

    async def close(self) -> None:
        tasks = list(self._listener_tasks.values())
        self._listener_tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._local_connections.clear()


hub = DistributedChatHub()


async def close_chat_resources() -> None:
    await hub.close()
    await async_redis_client.aclose()


@router.post("/ensure", response_model=list[ChatChannelResponse])
def ensure_channels(req: EnsureChannelsRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_ids = list({current_user.id, *req.users})
    # §59 — la réconciliation n'a le droit d'agir QUE sur le catalogue
    # explicite de l'app ; le repli « 20 derniers projets » ci-dessous ne
    # doit JAMAIS archiver (catalogue potentiellement incomplet).
    explicit_catalog = bool(req.projects)
    if not req.projects:
        req.projects = [{"id": p.id, "name": p.name} for p in db.query(Project).order_by(Project.created_at.desc()).limit(20).all()]
    # Isolation Multi-Tenant: Initialise de manière isolée
    db.info["tenant_id"] = current_user.tenant_id
    _ensure_base_channels(db, user_ids, req.projects, reconcile_archives=explicit_catalog)
    return list_channels(
        Response(), cursor=None, limit=50, current_user=current_user, db=db
    )


@router.get("/channels", response_model=list[ChatChannelResponse])
def list_channels(
    response: Response,
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    query = db.query(ChatChannel).filter(
        # §59 — les canaux archivés (projet disparu du catalogue actif) sont
        # masqués ici ; ils restent en base avec leurs messages (jamais de
        # suppression) et redeviennent visibles si le projet réapparaît.
        ChatChannel.archived_at.is_(None),
        or_(
            ~ChatChannel.members.any(),
            ChatChannel.members.any(ChatChannelMember.user_id == current_user.id),
        ),
    )
    if cursor:
        try:
            cursor_date, cursor_id = decode_cursor(cursor)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        query = query.filter(
            or_(
                ChatChannel.created_at < cursor_date,
                and_(ChatChannel.created_at == cursor_date, ChatChannel.id < cursor_id),
            )
        )

    rows = (
        query.order_by(ChatChannel.created_at.desc(), ChatChannel.id.desc())
        .limit(limit + 1)
        .all()
    )
    channels = rows[:limit]
    if len(rows) > limit and channels:
        response.headers["X-Cursor"] = encode_cursor(
            channels[-1].created_at, channels[-1].id
        )
    response.headers["X-Page-Limit"] = str(limit)
    return [_channel_response(channel) for channel in channels]


@router.get("/users", response_model=List[TeamUserResponse])
def list_team_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Membres du tenant avec compte réel (actifs) — cibles valides pour une
    Direktnachricht. Le rail de contacts frontend marque les autres
    identités (démo locale) comme « kein Konto » au lieu d'ouvrir un canal
    de repli trompeur nommé « # Général »."""
    rows = (
        db.query(User)
        .filter(User.tenant_id == current_user.tenant_id, User.is_active.is_(True))
        .order_by(User.name.asc())
        .all()
    )
    return [
        TeamUserResponse(id=str(user.id), name=user.name, email=user.email,
                         role=user.role, avatar_key=user.avatar_key,
                         avatar_json=user.avatar_json)
        for user in rows
    ]


@router.post("/direct", response_model=ChatChannelResponse)
def ensure_direct_channel(req: DirectChannelRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.info["tenant_id"] = current_user.tenant_id
    other_user = db.query(User).filter(User.id == req.otherUserId).first()
    if not other_user:
        raise HTTPException(status_code=404, detail="Utilisateur du tenant introuvable")

    ids = sorted({current_user.id, other_user.id})
    digest = hashlib.sha256("|".join(ids).encode()).hexdigest()[:24]
    channel_id = f"ch-dm-{digest}"
    ch = db.query(ChatChannel).filter(ChatChannel.id == channel_id).first()
    if ch is None:
        ch = ChatChannel(
            id=channel_id,
            tenant_id=current_user.tenant_id,
            kind="direct",
            name=req.otherUserName,
        )
        db.add(ch)
    _set_channel_members(ch, ids, current_user.tenant_id)
    db.commit()
    db.refresh(ch)
    return _channel_response(ch)


# §108 — Gestion des conversations (demande client « clic droit : supprimer /
# renommer, uniquement owner et admin »). Règles HONNÊTES liées au modèle :
# - team/project : canaux AUTO-ASSURÉS par /ensure → les supprimer serait un
#   mensonge (ils renaissent au prochain ensure ; les orphelins sont déjà
#   archivés par §59) → suppression refusée 409, renommage permis (durable :
#   ensure n'écrit le nom qu'à la création) ;
# - direct : supprimable à fond (cascade membres + messages), renommage
#   refusé (le nom EST l'identité du contact — le changer serait du fake).
CHANNEL_MANAGER_ROLES = ("owner", "admin")


def _require_channel_manager(user: User) -> None:
    if getattr(user, "role", "") not in CHANNEL_MANAGER_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Aktion nur für Rolle Inhaber oder Admin.",
        )


def _own_channel_or_404(db: Session, channel_id: str, tenant_id: str) -> ChatChannel:
    channel = (
        db.query(ChatChannel)
        .filter(ChatChannel.id == channel_id, ChatChannel.tenant_id == tenant_id)
        .first()
    )
    if channel is None:
        raise HTTPException(status_code=404, detail="Canal introuvable")
    return channel


@router.patch("/channels/{channel_id}", response_model=ChatChannelResponse)
def rename_channel(
    channel_id: str,
    req: RenameChannelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    _require_channel_manager(current_user)
    channel = _own_channel_or_404(db, channel_id, current_user.tenant_id)
    if channel.kind == "direct":
        raise HTTPException(
            status_code=400,
            detail="Direktnachrichten behalten den Namen des Kontakts.",
        )
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Nom de canal vide.")
    channel.name = name
    db.commit()
    db.refresh(channel)
    return _channel_response(channel)


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    _require_channel_manager(current_user)
    channel = _own_channel_or_404(db, channel_id, current_user.tenant_id)
    member_count = len(channel.members)
    message_count = db.query(ChatMessage).filter(ChatMessage.channel_id == channel_id).count()
    if channel.kind != "direct":
        # §110 — demande client : owner/admin suppriment AUSSI les canaux
        # équipe/projet (« supprimer une discussion », pas un message).
        # La pierre tombale est OBLIGATOIRE ici : les ids sont
        # déterministes et ensure_channels recrée tout canal absent —
        # sans elle, le canal renaîtrait à la prochaine synchro et le
        # « supprimer » aurait été du théâtre. merge = réécriture
        # idempotente si une pierre existait déjà.
        db.merge(
            ChatChannelTombstone(
                id=channel.id,
                tenant_id=current_user.tenant_id,
                deleted_by=current_user.id,
            )
        )
    db.delete(channel)  # cascade : membres + messages — suppression réelle
    db.commit()
    logger.info(
        "chat channel deleted",
        extra={"extras": {"channel_id": channel_id, "tenant": current_user.tenant_id,
                          "by": current_user.id, "members": member_count, "messages": message_count}},
    )
    return {"ok": True, "id": channel_id, "deletedMessages": message_count}


@router.get("/channels/{channel_id}/messages", response_model=list[ChatMessageResponse])
def list_messages(
    channel_id: str,
    response: Response,
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.info["tenant_id"] = current_user.tenant_id
    channel = db.query(ChatChannel).filter(ChatChannel.id == channel_id).first()
    if channel is None:
        raise HTTPException(status_code=404, detail="Canal introuvable")
    if not _is_channel_member(channel, current_user.id):
        raise HTTPException(status_code=403, detail="Accès au canal refusé")

    query = db.query(ChatMessage).filter(ChatMessage.channel_id == channel_id)
    if cursor:
        try:
            cursor_date, cursor_id = decode_cursor(cursor)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        query = query.filter(
            or_(
                ChatMessage.created_at < cursor_date,
                and_(ChatMessage.created_at == cursor_date, ChatMessage.id < cursor_id),
            )
        )

    rows = (
        query.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(limit + 1)
        .all()
    )
    page = rows[:limit]
    if len(rows) > limit and page:
        response.headers["X-Cursor"] = encode_cursor(
            page[-1].created_at, page[-1].id
        )
    response.headers["X-Page-Limit"] = str(limit)
    return [_message_response(message) for message in reversed(page)]


@router.post("/channels/{channel_id}/messages", response_model=ChatMessageResponse)
async def send_message(request: Request, channel_id: str, req: SendMessageRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.info["tenant_id"] = current_user.tenant_id
    # §60 — quota avant toute écriture/fanout (même anti-spoofing SEC-003).
    ip_address = request.client.host if request.client else "unknown"
    if not chat_send_limiter.check_and_record(f"user:{current_user.id}", ip_address):
        raise HTTPException(status_code=429, detail="Trop de messages envoyes. Reessayez dans une minute.")
    ch = db.query(ChatChannel).filter(ChatChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Canal introuvable")
    if not _is_channel_member(ch, current_user.id):
        raise HTTPException(status_code=403, detail="Accès au canal refusé")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message vide")

    # 1. IDEMPOTENCE PAR CONTRAINTE UNIQUE (Anti-Duplications)
    if req.clientId:
        existing = db.query(ChatMessage).filter(ChatMessage.client_id == req.clientId).first()
        if existing:
            return _message_response(existing)

    msg = ChatMessage(
        channel_id=channel_id,
        author_id=current_user.id,
        author_name=current_user.name,
        text=text[:4000],
        client_id=req.clientId,
        client_created_at=req.clientCreatedAt,
    )
    db.add(msg)
    
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = db.query(ChatMessage).filter(ChatMessage.client_id == req.clientId).first()
        if winner:
            return _message_response(winner)
        raise HTTPException(status_code=409, detail="Conflit d'identifiant client concurrent.")
        
    db.refresh(msg)
    
    # 3. DURABILITÉ REDIS STREAM (Conformité SOC2)
    # Enregistre le message dans un journal de diffusion immuable tronqué
    stream_key = f"stream:tenant:{current_user.tenant_id}:chat"
    message_payload = {
        "type": "message",
        "channelId": channel_id,
        "message": json.dumps(_message_response(msg).model_dump(mode="json"))
    }
    
    try:
        await async_redis_client.xadd(
            stream_key,
            message_payload,
            maxlen=5000,
            approximate=True,
        )
        await async_redis_client.publish(
            f"pubsub:channel:{channel_id}",
            json.dumps(message_payload),
        )
    except RedisError as error:
        # PostgreSQL a déjà committé le message : Redis est un transport,
        # jamais la source de vérité.
        logger.warning(
            "Redis chat transport unavailable",
            extra={"channel_id": channel_id, "error": str(error)},
        )

    return _message_response(msg)


# ============================================================================
# WEBSOCKET REAL-TIME ENDPOINT (SecOps Hardened)
# ============================================================================
@router.websocket("/ws")
async def chat_ws(websocket: WebSocket, channel_id: str = Query(...)):
    db = SessionLocal()
    current_user = None
    try:
        # Authentification étanche par cookie de session (OWASP)
        current_user = _authenticate_ws_cookie(websocket, db)
        
        # Confinement de session SQLAlchemy
        db.info["tenant_id"] = current_user.tenant_id
        
        ch = db.query(ChatChannel).filter(ChatChannel.id == channel_id).first()
        if not ch:
            await websocket.close(code=4404)
            return
        if not _is_channel_member(ch, current_user.id):
            await websocket.close(code=4403)
            return
    except Exception as error:
        logger.warning("Chat WebSocket handshake rejected", extra={"error": str(error)})
        await websocket.close(code=4401)
        return
    finally:
        db.close()

    await websocket.accept()
    # Raccorder le WebSocket local au hub distribué
    await hub.register_and_listen(channel_id, websocket)
    
    # Évaluation de rate-limiting anti-flood
    attempts = 0
    last_reset = time.time()
    MAX_MESSAGES_PER_MINUTE = 30

    try:
        while True:
            # Attendre et intercepter les pings périodiques du client (Heartbeat)
            msg = await websocket.receive_json()
            now = time.time()
            
            # Réinitialiser le rate-limit chaque minute
            if now - last_reset > 60:
                attempts = 0
                last_reset = now
                
            attempts += 1
            if attempts > MAX_MESSAGES_PER_MINUTE:
                logger.warning(
                    "Chat WebSocket flood blocked",
                    extra={"user_id": current_user.id, "channel_id": channel_id},
                )
                await websocket.close(code=4429)
                break

            if msg.get("type") == "ping":
                # Écho de vie instantané
                await websocket.send_json({"type": "pong", "ts": datetime.now(timezone.utc).isoformat()})
                
    except WebSocketDisconnect:
        pass
    finally:
        # Libération propre du socket
        await hub.unregister(channel_id, websocket)
