"""Tests §81 — V2.7 étape 2 : hub CRDT Yjs RÉEL (pycrdt côté client ET serveur).

Contrairement à un test de mock, chaque « client » EST une réplique pycrdt :
on envoie de vraies trames y-websocket (step1/step2/update) et on vérifie la
CONVERGENCE binaire. Couvre : handshake, convergence A↔B, cloisonnement
tenant (deux bureaux, même nom de salle), persistance PostgreSQL/SQLite après
coupure, pont Redis inter-workers (deux hubs = deux workers, fakeredis
partagé) avec preuve anti-tempête, garde-fous (4401/4422/4409/422), relais
awareness + replay aux nouveaux venus.
"""

import asyncio
import base64
import json
import os
import time

import fakeredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pycrdt import (
    Doc,
    Text,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect, WebSocketState

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_ws_routes as ws_mod  # noqa: E402
import app.services.crdt_room_hub as hub_mod  # noqa: E402
from app.core.security.jwt import create_access_token  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.collab_doc import CollabDoc  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.crdt_room_hub import (  # noqa: E402
    MAX_FRAME_BYTES,
    CollabDocHub,
)

TEXT_KEY = "notiz"  # le MÊME nom de Y.Text que le frontend (contrat gravé)


# ------------------------- réplique client (vrai Yjs) -----------------------


class YSim:
    """Client y-websocket simulé avec une VRAIE réplique CRDT pycrdt."""

    def __init__(self):
        self.doc = Doc()
        self.text = self.doc.get(TEXT_KEY, type=Text)

    def step1(self) -> bytes:
        return create_sync_message(self.doc)

    def feed(self, frame: bytes):
        """Applique une trame serveur ; retourne la réponse à renvoyer (ou None)."""
        if frame and frame[0] == 0:  # YMessageType.SYNC
            return handle_sync_message(frame[1:], self.doc)
        return None

    def write(self, insert_at: int, chunk: str) -> bytes:
        """Édition locale → trame UPDATE prête à envoyer (comme le navigateur)."""
        avant = self.doc.get_state()
        with self.doc.transaction():
            self.text.insert(insert_at, chunk)
        return create_update_message(self.doc.get_update(avant))


# ------------------------------- fixtures ----------------------------------


def _make_stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__, CollabDoc.__table__])
    sf = sessionmaker(bind=engine)
    session = sf()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    bob = User(id="u-bob", email="bob@buero.de", hashed_password="x",
               name="Bob B", role="architect", tenant_id="t1", is_active=True)
    fred = User(id="u-fred", email="fred@ander.de", hashed_password="x",
                name="Fred F", role="owner", tenant_id="t2", is_active=True)
    session.add_all([alice, bob, fred])
    session.commit()
    hub = CollabDocHub(fakeredis.FakeStrictRedis(), sf)
    app = FastAPI()
    app.include_router(ws_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    return app, session, hub, sf, {"alice": alice, "bob": bob, "fred": fred}


def _cookie(user) -> dict:
    token = create_access_token(
        {"sub": user.id, "role": user.role, "type": "access"}, user=user
    )
    return {"Cookie": f"narchi_session={token}"}


@pytest.fixture()
def stack(monkeypatch):
    app, session, hub, sf, users = _make_stack()
    monkeypatch.setattr(ws_mod, "get_crdt_hub", lambda: hub)
    with TestClient(app) as client:
        yield client, session, hub, users


# ------------------------------ auth & gardes -------------------------------


def test_ws_cookie_absent_refuse_4401(stack):
    client, _, _, _ = stack
    with pytest.raises(WebSocketDisconnect) as err:
        with client.websocket_connect("/api/v5/collab/ws/notiz-buero"):
            pass
    assert err.value.code == 4401


def test_ws_salle_invalide_4422(stack):
    client, _, _, users = stack
    with pytest.raises(WebSocketDisconnect) as err:
        with client.websocket_connect("/api/v5/collab/ws/bad room!!",
                                      headers=_cookie(users["alice"])):
            pass
    assert err.value.code == 4422


def test_ws_trame_trop_grosse_4409(stack):
    client, _, _, users = stack
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["alice"])) as ws:
        ws.receive_bytes()  # step1
        ws.send_bytes(b"\x00" + os.urandom(MAX_FRAME_BYTES))  # > plafond
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_bytes()
        assert err.value.code == 4409


# --------------------------- convergence réelle -----------------------------


def test_ws_deux_clients_convergent(stack):
    client, _, hub, users = stack
    alice, bob = YSim(), YSim()
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["alice"])) as wa:
        wa.receive_bytes()  # step1 serveur (doc vide)
        with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                      headers=_cookie(users["bob"])) as wb:
            wb.receive_bytes()  # step1 serveur (doc vide)

            # Alice écrit → Bob la reçoit (vraie convergence CRDT).
            # Le serveur renvoie aussi l'ÉCHO à Alice (comme le serveur
            # y-websocket officiel) — le CRDT le rend idempotent, sans doublon.
            wa.send_bytes(alice.write(0, "Hallo Kollegen"))
            alice.feed(wa.receive_bytes())  # écho d'Alice : no-op garanti
            assert str(alice.text) == "Hallo Kollegen"
            bob.feed(wb.receive_bytes())
            assert str(bob.text) == "Hallo Kollegen"

            # Bob répond en TÊTE → Alice la reçoit ; les deux répliques égalent.
            wb.send_bytes(bob.write(0, "Chef: "))
            bob.feed(wb.receive_bytes())     # écho de Bob : no-op garanti
            assert str(bob.text) == "Chef: Hallo Kollegen"
            alice.feed(wa.receive_bytes())
            assert str(alice.text) == "Chef: Hallo Kollegen"

            assert set(hub.rooms) == {"t1:notiz-buero"}


def test_ws_cloisonnement_tenant(stack):
    client, _, hub, users = stack
    alice, fred = YSim(), YSim()
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["alice"])) as wa:
        wa.receive_bytes()
        # Fred (AUTRE bureau) choisit le MÊME nom de salle.
        with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                      headers=_cookie(users["fred"])) as wf:
            wf.receive_bytes()
            # Fred demande explicitement l'état : le serveur ne lui livre RIEN
            # de t1 (le diff STEP2 d'un doc vierge reste vide de contenu).
            wf.send_bytes(fred.step1())
            fred.feed(wf.receive_bytes())
            assert str(fred.text) == ""

            wa.send_bytes(alice.write(0, "Geheimplan 42"))
            assert str(fred.text) == ""  # aucune fuite vers t2

            # Preuve structurelle : deux mondes distincts côté serveur.
            assert set(hub.rooms) == {"t1:notiz-buero", "t2:notiz-buero"}
            assert str(hub.rooms["t2:notiz-buero"].ydoc.get(TEXT_KEY, type=Text)) == ""


# ------------------------------ persistance --------------------------------


def test_ws_persistance_apres_reconnexion(stack):
    client, session, hub, users = stack
    alice, bob = YSim(), YSim()
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["alice"])) as wa:
        wa.receive_bytes()
        wa.send_bytes(alice.write(0, "Grundriss: Flur 3,20 m"))
        wa.receive_bytes()  # écho serveur (ack CRDT implicite)
    # dernier client parti → flush synchrone dans stop()
    time.sleep(0.05)
    row = session.get(CollabDoc, "t1:notiz-buero")
    assert row is not None and row.state and row.tenant_id == "t1"
    assert row.version >= 1

    # Bob arrive APRÈS la coupure : l'état revient de la base, pas du vide.
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["bob"])) as wb:
        wb.receive_bytes()  # step1 du doc RECHARGÉ
        wb.send_bytes(bob.step1())
        bob.feed(wb.receive_bytes())
        assert str(bob.text) == "Grundriss: Flur 3,20 m"


# ------------------------------- awareness ----------------------------------


def _awareness_frame(payload: bytes) -> bytes:
    """Trame awareness valide (type 1 + longueur varuint 7 bits < 128)."""
    assert len(payload) < 128
    return b"\x01" + bytes([len(payload)]) + payload


def test_awareness_relais_et_replay(stack):
    client, _, _, users = stack
    with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                  headers=_cookie(users["alice"])) as wa:
        wa.receive_bytes()
        with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                      headers=_cookie(users["bob"])) as wb:
            wb.receive_bytes()
            frame = _awareness_frame(b'{"alice":"tippt"}')
            wa.send_bytes(frame)
            # Bob reçoit la présence d'Alice ; Alice reçoit l'écho (keep-alive).
            assert wb.receive_bytes() == frame
            assert wa.receive_bytes() == frame
            # Fred (autre tenant) n'entre pas en jeu ici — nouvel arrivant chez t1 :
            with client.websocket_connect("/api/v5/collab/ws/notiz-buero",
                                          headers=_cookie(users["alice"])) as wb2:
                wb2.receive_bytes()  # step1
                assert wb2.receive_bytes() == frame  # replay immédiat


# --------------------------- pont Redis (2 workers) -------------------------


class _FakeWS:
    """WebSocket minimal pour servir DEUX hubs dans une boucle asyncio."""

    def __init__(self):
        self.sent: list[bytes] = []
        self.inbox: asyncio.Queue[bytes] = asyncio.Queue()
        self.client_state = WebSocketState.CONNECTED

    async def accept(self):
        return None

    async def close(self, code: int = 1000):
        self.client_state = WebSocketState.DISCONNECTED

    async def send_bytes(self, data: bytes):
        self.sent.append(bytes(data))

    async def receive_bytes(self) -> bytes:
        return await self.inbox.get()


def _hub_pair():
    server = fakeredis.FakeServer()

    def make_hub():
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                               poolclass=StaticPool)
        Base.metadata.create_all(bind=engine, tables=[CollabDoc.__table__])
        sf = sessionmaker(bind=engine)
        return CollabDocHub(fakeredis.FakeStrictRedis(server=server), sf)

    return make_hub(), make_hub()


def test_pont_redis_inter_workers_convergence_et_anti_tempete():
    """DEUX hubs (deux workers gunicorn), UN seul serveur Redis : la frappe
    sur le worker 1 doit arriver au worker 2 — et JAMAIS repartir (sinon
    tempête/écho infini entre processus). Preuve par comptage exact."""

    async def main():
        hub_a, hub_b = _hub_pair()
        ws_a, ws_b = _FakeWS(), _FakeWS()
        task_a = asyncio.create_task(
            hub_a.serve(ws_a, "t1", "notiz-buero", "u1", "A", "#111"))
        task_b = asyncio.create_task(
            hub_b.serve(ws_b, "t1", "notiz-buero", "u2", "B", "#222"))
        try:
            # Le bus pub/sub ne CONSERVE rien : on n'écrit qu'une fois les
            # DEUX abonnements réellement actifs (sinon course perdue d'avance).
            key = CollabDocHub.room_key("t1", "notiz-buero")
            for _ in range(100):
                if key in hub_a.rooms and key in hub_b.rooms:
                    if hub_a.rooms[key].bridge_ready.is_set() and hub_b.rooms[key].bridge_ready.is_set():
                        break
                await asyncio.sleep(0.02)
            assert ws_a.sent and ws_b.sent  # deux step1 (docs vides)
            assert hub_b.rooms[key].bridge_ready.is_set()

            sim_b = YSim()
            sim_b.feed(ws_b.sent[0])
            sim_a = YSim()
            sim_a.feed(ws_a.sent[0])

            # A tape sur le WORKER A → B (worker B, autre processus) reçoit.
            ws_a.inbox.put_nowait(sim_a.write(0, "brücke"))
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                for frame in ws_b.sent[1:]:
                    sim_b.feed(frame)
                if str(sim_b.text) == "brücke":
                    break
                await asyncio.sleep(0.05)
            assert str(sim_b.text) == "brücke"

            # Fenêtre de règlement : une trame UPDATE de plus NUIRAIT si le
            # pont ping-pongait. On fige et on compte.
            snapshots = (len(ws_a.sent), len(ws_b.sent))
            await asyncio.sleep(0.7)  # > 3 cycles d'écoute (0,2 s)
            assert (len(ws_a.sent), len(ws_b.sent)) == snapshots
            # A reçoit au plus : step1 + écho local de sa propre écriture.
            assert len(ws_a.sent) <= 2
        finally:
            task_a.cancel()
            task_b.cancel()
            await asyncio.gather(task_a, task_b, return_exceptions=True)

    asyncio.run(main())


# ------------------------- salle réservée côté REST -------------------------


def test_rest_salle_reservee_ws_422():
    import types
    import sys
    import importlib.util
    from pathlib import Path
    from app.services.collab_service import CollabService

    stub = types.ModuleType("app.middlewares.dos_guard")

    async def _no_dos_guard():
        return None

    stub.verify_dos_protection = _no_dos_guard  # type: ignore[attr-defined]
    sys.modules.setdefault("app.middlewares.dos_guard", stub)
    path = Path(__file__).resolve().parents[1] / "app" / "api" / "collab_routes.py"
    spec = importlib.util.spec_from_file_location("collab_routes_reserved", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[User.__table__])
    session = sessionmaker(bind=engine)()
    user = User(id="chef", email="c@b.de", hashed_password="x",
                name="Chef", role="owner", tenant_id="t1", is_active=True)
    session.add(user)
    session.commit()
    app = FastAPI()
    app.include_router(mod.router)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[mod.get_current_user] = lambda: user
    shared = CollabService(fakeredis.FakeStrictRedis(decode_responses=True))
    app.dependency_overrides[mod.get_collab_service] = lambda: shared
    with TestClient(app) as api:
        assert api.get("/api/v5/collab/ws/presence").status_code == 422
        assert api.post("/api/v5/collab/ws/join").status_code == 422
