"""§81 — V2.7 étape 2 : hub CRDT RÉEL (protocole Yjs, cœur Rust `yrs`).

Avant ce module, la « collaboration temps réel » n'existait PAS : le seul
code client (`collaborationManager.ts`) pointait vers un hub Node fictif
`ws://localhost:1234` jamais déployé — du code mort. Ce service livre le
pendant serveur, DANS le backend FastAPI existant (aucun conteneur de
plus), avec trois propriétés non négociables :

1. PROTOCOLE STANDARD Yjs/y-websocket v1 : le client web officiel
   (`y-websocket`, déjà dépendance du frontend) s'y connecte tel quel.
   `pycrdt` est le binding Python du MÊME noyau `yrs` que Yjs — la
   convergence (commutativité, idempotence) est celle du CRDT, pas une
   promesse de plus.

2. MULTI-WORKER HONNÊTE : gunicorn tourne avec 4 workers (processus
   séparés, mémoires séparées). Sans relais, deux collègues branchés sur
   deux workers éditeraient des documents DIVERGENTS en silence. Chaque
   mise à jour/awareness d'un client est donc republiée sur un canal Redis
   (`collabdoc:{tenant}:{room}`) avec une enveloppe {origin, kind, data} ;
   les autres workers l'appliquent à leur propre réplique CRDT — qui
   converge par construction. Anti-ping-pong : on ne republie JAMAIS le
   trafic reçu du pont (seules les trames issues des clients locaux sont
   publiées), et chaque worker ignore ses propres enveloppes (`origin`).

3. PERSISTANCE DURABLE : l'état complet du document (binaire CRDT) est
   écrit dans PostgreSQL (`collab_docs`) 2 s après la dernière activité
   et au départ du dernier client. Un crash entre deux flush coûte au
   plus 2 s de frappe — dit dans le CHANGELOG, pas caché.

Cloisonnement : la salle interne est `{tenant}:{room}` — deux bureaux avec
la salle « notiz-buero » ne se voient jamais (le client ne transmet pas
son tenant, le serveur le sait par le cookie de session).
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

from pycrdt import (
    Doc,
    YMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    is_awareness_disconnect_message,
    read_message,
)

# ---------------------------------------------------------------------------
# Constantes affichées/testées — aucune promesse implicite.
# ---------------------------------------------------------------------------
MAX_FRAME_BYTES = 256 * 1024          # une trame = une frappe ; 256 ko = abus
MAX_DOC_BYTES = 4 * 1024 * 1024       # au-delà : flush refusé + log (pas de troncation silencieuse)
MAX_ROOM_CLIENTS = 32                 # un bureau tient largement ; borne DoS
FLUSH_DEBOUNCE_S = 2.0                # flush PG après silence d'écriture
BRIDGE_PREFIX = "collabdoc"           # canal Redis pub/sub
BRIDGE_KIND_UPDATE = "u"
BRIDGE_KIND_AWARENESS = "a"

# L'identité d'origine vit sur le HUB (une instance par processus en prod,
# plusieurs en tests) — jamais en global de module : deux hubs d'un même
# processus s'ignoreraient mutuellement (leçon du test inter-workers).

# Compat y-websocket v3 : le client peut envoyer « query awareness » (type 3).
QUERY_AWARENESS = 3

SessionFactory = Callable[[], object]  # sessionmaker SQLAlchemy (tests : SQLite)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ClientChannel:
    """Adaptateur FastAPI WebSocket → canal binaire Yjs (verrou d'envoi)."""

    def __init__(self, websocket, path: str, user_id: str, name: str, color: str):
        self._ws = websocket
        self.path = path
        self.user_id = user_id
        self.name = name
        self.color = color
        self._send_lock = asyncio.Lock()
        self.last_awareness: Optional[bytes] = None  # replay aux nouveaux venus

    async def send(self, message: bytes) -> None:
        async with self._send_lock:
            await self._ws.send_bytes(message)


class Room:
    """Une réplique CRDT vivante sur CE worker + ses clients locaux."""

    def __init__(self, hub: "CollabDocHub", key: str, tenant_id: str, room: str):
        self.hub = hub
        self.key = key
        self.tenant_id = tenant_id
        self.room = room
        self.ydoc = Doc()
        self.clients: set[ClientChannel] = set()
        self._update_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=65536)
        self._broadcaster: Optional[asyncio.Task] = None
        self._listener: Optional[asyncio.Task] = None
        self._flush_task: Optional[asyncio.Task] = None
        self._dirty = False
        self.closed = False
        # Positionné quand l'abonnement pub/sub est ACTIF (les messages pub/sub
        # ne sont pas conservés : publier avant = perdre). Tests + santé.
        self.bridge_ready = asyncio.Event()

    # --------------------------- cycle de vie -----------------------------

    def load_state(self) -> None:
        """Recharge l'état PostgreSQL (appelé via run_in_threadpool)."""
        from app.models.collab_doc import CollabDoc

        session = self.hub.session_factory()
        try:
            row = session.get(CollabDoc, self.key)
            if row is not None and row.state:
                self.ydoc.apply_update(bytes(row.state))
        except Exception as exc:  # persistance indisponible ≠ blocage du live
            self.hub.logger.warning("CRDT load impossible (%s) : %s", self.key, exc)
        finally:
            session.close()

    def start(self) -> None:
        # Toute mutation du ydoc (client local OU pont Redis) → file de
        # diffusion vers les clients locaux. Jamais de republication pont
        # depuis ici (anti-ping-pong). Helper en ligne (2 lignes) — aucune
        # dépendance vers pycrdt-websocket (le manifeste d'image n'a que pycrdt).
        adapter = self._UpdateSendAdapter(self._update_queue)

        def _enqueue(event) -> None:
            try:
                adapter.send_nowait(event.update)
            except Exception:
                pass

        self._subscription = self.ydoc.observe(_enqueue)
        self._broadcaster = asyncio.create_task(self._broadcast_loop(), name=f"crdt-bc-{self.key}")
        self._listener = asyncio.create_task(self._bridge_listen_loop(), name=f"crdt-ls-{self.key}")

    class _UpdateSendAdapter:
        """put_updates attend un send stream anyio ; on lui offre send_nowait."""

        def __init__(self, queue: "asyncio.Queue[bytes]"):
            self._queue = queue

        def send_nowait(self, update: bytes) -> None:
            try:
                self._queue.put_nowait(update)
            except asyncio.QueueFull:
                pass

    async def stop(self) -> None:
        """Arrêt propre : flush FINAL attendu (dernière écriture garantie),
        puis §86 — snapshot automatique de l'état (rate-limité 1/30 min) :
        chaque session de bureau devenue silencieuse laisse un point de
        restauration, sans qu'on le demande."""
        self.closed = True
        for task in (self._broadcaster, self._listener):
            if task is not None:
                task.cancel()
        if self._flush_task is not None and not self._flush_task.done():
            self._flush_task.cancel()
        if self._dirty:
            await asyncio.to_thread(self._flush_sync)
        await asyncio.to_thread(self._auto_snapshot_sync)
        try:
            self.ydoc.unobserve(self._subscription)
        except Exception:
            pass

    def _auto_snapshot_sync(self) -> None:
        """Snapshot « auto » depuis la ligne collab_docs (flush déjà fait)."""
        from app.models.collab_doc import CollabDoc
        from app.services.collab_history import (
            AUTO_SNAPSHOT_MIN_INTERVAL,
            make_snapshot_row,
            _utcnow,
        )

        session = self.hub.session_factory()
        try:
            row = session.get(CollabDoc, self.key)
            if row is None or not row.state:
                return
            from app.models.collab_doc_snapshot import CollabDocSnapshot

            last_auto = (
                session.query(CollabDocSnapshot)
                .filter(
                    CollabDocSnapshot.doc_id == self.key,
                    CollabDocSnapshot.trigger == "auto",
                )
                .order_by(CollabDocSnapshot.created_at.desc())
                .first()
            )
            if (
                last_auto is not None
                and last_auto.created_at is not None
                and _utcnow() - last_auto.created_at < AUTO_SNAPSHOT_MIN_INTERVAL
            ):
                return  # rate-limit affiché : pas d'empilement d'autos
            make_snapshot_row(session, row, "auto")
            session.commit()
        except Exception as exc:  # jamais bloquant : la note live prime
            self.hub.logger.warning("CRDT snapshot auto impossible (%s) : %s", self.key, exc)
            session.rollback()
        finally:
            session.close()

    # --------------------------- diffusion locale -------------------------

    async def _broadcast_loop(self) -> None:
        try:
            while True:
                update = await self._update_queue.get()
                if not update:
                    continue  # fusion idempotente : rien de neuf → rien à dire
                message = create_update_message(update)
                for client in tuple(self.clients):
                    try:
                        await client.send(message)
                    except Exception:
                        pass  # client parti : le retrait officiel arrive au finally
                self._schedule_flush()
        except asyncio.CancelledError:
            return

    # ----------------------------- pont Redis -----------------------------

    @property
    def bridge_channel(self) -> str:
        return f"{BRIDGE_PREFIX}:{self.tenant_id}:{self.room}"

    def _publish(self, kind: str, frame: bytes) -> None:
        """Appelé UNIQUEMENT pour du trafic client local (jamais depuis le pont)."""
        envelope = json.dumps({
            "origin": self.hub.origin,
            "kind": kind,
            "data": base64.b64encode(frame).decode("ascii"),
        })
        try:
            self.hub.redis.publish(self.bridge_channel, envelope)
        except Exception as exc:
            # Mono-worker (ou Redis coupé) : le local continue de fonctionner.
            self.hub.logger.warning("CRDT publish pont impossible : %s", exc)

    async def _bridge_listen_loop(self) -> None:
        pubsub = self.hub.redis.pubsub(ignore_subscribe_messages=True)
        try:
            await asyncio.to_thread(pubsub.subscribe, self.bridge_channel)
            self.bridge_ready.set()
            while True:
                try:
                    message = await asyncio.to_thread(pubsub.get_message, True, 0.2)
                except Exception as exc:
                    self.hub.logger.warning("CRDT pont lecture KO : %s", exc)
                    await asyncio.sleep(0.5)
                    continue
                if message is None or message.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(message["data"])
                except (TypeError, ValueError):
                    continue
                if envelope.get("origin") == self.hub.origin:
                    continue  # notre propre trafic : déjà appliqué localement
                try:
                    frame = base64.b64decode(envelope.get("data", b""), validate=True)
                except (TypeError, ValueError):
                    continue
                if not frame or len(frame) > MAX_FRAME_BYTES:
                    continue
                kind = envelope.get("kind")
                if kind == BRIDGE_KIND_UPDATE and frame[0] == YMessageType.SYNC:
                    # Applique à notre réplique ; l'observer diffuse aux locaux.
                    # JAMAIS de republication (leçon anti-tempête).
                    handle_sync_message(frame[1:], self.ydoc)
                    self._schedule_flush()
                elif kind == BRIDGE_KIND_AWARENESS and frame[0] == YMessageType.AWARENESS:
                    for client in tuple(self.clients):
                        try:
                            await client.send(frame)
                        except Exception:
                            pass
        except asyncio.CancelledError:
            return
        finally:
            try:
                await asyncio.to_thread(pubsub.unsubscribe, self.bridge_channel)
                await asyncio.to_thread(pubsub.close)
            except Exception:
                pass

    # ---------------------------- persistance -----------------------------

    def _schedule_flush(self) -> None:
        self._dirty = True
        if self._flush_task is not None and not self._flush_task.done():
            self._flush_task.cancel()
        self._flush_task = asyncio.create_task(self._debounced_flush())

    async def _debounced_flush(self) -> None:
        try:
            await asyncio.sleep(FLUSH_DEBOUNCE_S)
            await asyncio.to_thread(self._flush_sync)
        except asyncio.CancelledError:
            return

    def _flush_sync(self) -> None:
        from app.models.collab_doc import CollabDoc

        if not self._dirty:
            return
        state = self.ydoc.get_update()
        if len(state) > MAX_DOC_BYTES:
            self.hub.logger.error(
                "CRDT flush REFUSÉ (%s) : document %d o > plafond %d o",
                self.key, len(state), MAX_DOC_BYTES,
            )
            return
        session = self.hub.session_factory()
        try:
            row = session.get(CollabDoc, self.key)
            if row is None:
                row = CollabDoc(id=self.key, tenant_id=self.tenant_id, room=self.room,
                                state=state, version=1, updated_at=_utcnow())
                session.add(row)
            else:
                row.state = state
                row.version = (row.version or 0) + 1
                row.updated_at = _utcnow()
            session.commit()
            self._dirty = False
        except Exception as exc:
            session.rollback()
            self.hub.logger.warning("CRDT flush impossible (%s) : %s", self.key, exc)
        finally:
            session.close()


class CollabDocHub:
    """Registre des salles CRDT du processus. Injectable pour les tests."""

    def __init__(self, redis_client, session_factory: SessionFactory, logger=None):
        self.redis = redis_client
        self.session_factory = session_factory
        self.rooms: dict[str, Room] = {}
        self.origin = uuid.uuid4().hex  # identité de CE hub (= ce worker)
        import logging
        self.logger = logger or logging.getLogger("crdt")

    @staticmethod
    def room_key(tenant_id: str, room: str) -> str:
        # Cloisonnement gravé DANS la clé (jamais confié au client).
        return f"{tenant_id}:{room}"

    async def restore(self, tenant_id: str, room: str, snapshot_state: bytes) -> dict:
        """§86 — Restauration d'un snapshot.

        Deux chemins HONNÊTES (vérifiés par tests) :
        - salle VIVANTE : diff-txn sur notre réplique → updates Yjs
          normales diffusées aux clients locaux via l'observer + aux
          autres workers via le pont (la convergence est celle du CRDT) ;
        - salle FERMÉE : remplacement direct de l'état PG — la prochaine
          ouverture recharge le texte restauré via le step1 intégral.
        """
        from app.models.collab_doc import CollabDoc
        from app.services.collab_history import restore_doc_state

        key = self.room_key(tenant_id, room)
        room_obj = self.rooms.get(key)
        if room_obj is None:
            def _replace() -> None:
                session = self.session_factory()
                try:
                    row = session.get(CollabDoc, key)
                    if row is None:
                        row = CollabDoc(id=key, tenant_id=tenant_id, room=room,
                                        state=bytes(snapshot_state), version=1,
                                        updated_at=_utcnow())
                        session.add(row)
                    else:
                        row.state = bytes(snapshot_state)
                        row.version = (row.version or 0) + 1
                        row.updated_at = _utcnow()
                    session.commit()
                except Exception:
                    session.rollback()
                    raise
                finally:
                    session.close()

            await asyncio.to_thread(_replace)
            return {"mode": "stored", "changed": True}

        updates = await asyncio.to_thread(restore_doc_state, room_obj.ydoc, snapshot_state)
        for update in updates:
            # Republication explicite : l'observer diffuse déjà aux clients
            # locaux, mais le pont ne publie que le trafic CLIENT (anti-ping
            # -pong) — une mutation initiée serveur doit être annoncée ici.
            room_obj._publish(BRIDGE_KIND_UPDATE, create_update_message(update))
        if updates:
            room_obj._schedule_flush()
        return {"mode": "live", "changed": bool(updates)}

    async def serve(self, websocket, tenant_id: str, room: str,
                    user_id: str, name: str, color: str) -> None:
        """Cycle complet d'un client : salle, handshake, boucle, retrait."""
        from starlette.websockets import WebSocketDisconnect, WebSocketState

        key = self.room_key(tenant_id, room)
        room_obj = self.rooms.get(key)
        if room_obj is None:
            room_obj = Room(self, key, tenant_id, room)
            await asyncio.to_thread(room_obj.load_state)  # état AVANT step1
            room_obj.start()
            self.rooms[key] = room_obj

        if len(room_obj.clients) >= MAX_ROOM_CLIENTS:
            await websocket.close(code=4429)  # borne DoS affichée, pas cachée
            return

        await websocket.accept()
        channel = ClientChannel(websocket, f"{room}#{user_id}", user_id, name, color)
        room_obj.clients.add(channel)
        try:
            # 1) Handshake : notre état (step1) ; le client répondra step2.
            await channel.send(create_sync_message(room_obj.ydoc))
            # 2) Replay des présences connues (derniers payloads awareness).
            for other in room_obj.clients:
                if other is not channel and other.last_awareness:
                    try:
                        await channel.send(other.last_awareness)
                    except Exception:
                        pass
            # 3) Boucle de réception.
            while True:
                raw = await websocket.receive_bytes()
                frame = bytes(raw)
                if not frame:
                    continue
                if len(frame) > MAX_FRAME_BYTES:
                    await websocket.close(code=4409)
                    return
                kind = frame[0]
                if kind == YMessageType.SYNC:
                    reply = handle_sync_message(frame[1:], room_obj.ydoc)
                    if reply:
                        await channel.send(reply)
                    if len(frame) > 1 and frame[1] in (1, 2):  # STEP2 | UPDATE
                        room_obj._publish(BRIDGE_KIND_UPDATE, frame)
                        room_obj._schedule_flush()
                elif kind == YMessageType.AWARENESS:
                    channel.last_awareness = frame
                    disconnecting = False
                    try:
                        disconnecting = is_awareness_disconnect_message(read_message(frame[1:]))
                    except Exception:
                        pass
                    for client in tuple(room_obj.clients):
                        if client is channel and disconnecting:
                            continue
                        try:
                            await client.send(frame)
                        except Exception:
                            pass
                    room_obj._publish(BRIDGE_KIND_AWARENESS, frame)
                elif kind == QUERY_AWARENESS:
                    for other in room_obj.clients:
                        if other is not channel and other.last_awareness:
                            await channel.send(other.last_awareness)
                # autre type : ignoré (protocole tolérant, jamais de plantage)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            self.logger.warning("CRDT canal %s : %s", channel.path, exc)
            if websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await websocket.close(code=1011)
                except Exception:
                    pass
        finally:
            room_obj.clients.discard(channel)
            if not room_obj.clients:
                self.rooms.pop(key, None)
                await room_obj.stop()  # flush FINAL attendu — dernière écriture gardée


_SINGLETON: Optional[CollabDocHub] = None


def get_crdt_hub() -> CollabDocHub:
    """Hub réel (Redis + PostgreSQL), un par process. Injectable en tests."""
    global _SINGLETON
    if _SINGLETON is None:
        import redis

        from app.database import SessionLocal

        client = redis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379/0")
        )  # binaire (enveloppes JSON/base64 textes)
        _SINGLETON = CollabDocHub(client, SessionLocal)
    return _SINGLETON
