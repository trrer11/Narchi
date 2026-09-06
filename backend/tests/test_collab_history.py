"""Tests §86 — Historique de versions Notiz : snapshots + restauration.

Couvre, avec de VRAIES répliques pycrdt (pas des mocks) :
- lecture texte d'un état binaire + preview mono-ligne honnête ;
- restauration sur réplique vivante (diff-txn, updates capturées,
  IDEMPOTENCE) et CONVERGENCE d'un client connecté (scénario production :
  step1 intégral AVANT, puis updates de restore — preuve de non-divergence) ;
- REST : création 201 + métadonnées (préview, auteur, « hinweis » honnête),
  liste, borne 25 (l'aîné est évincé, pas caché), 404 si rien de stocké,
  isolation inter-bureaux (404 net, jamais de 403 révélateur) ;
- restore « stored » (salle fermée → état PG remplacé, relecture prouvée)
  et « live » (réplique en mémoire mise à jour + trame pont publiée) ;
- snapshot automatique à la fermeture de salle + rate-limit 1/30 min.
"""

import os
from datetime import timedelta

import fakeredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pycrdt import Doc, Text, YMessageType
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "dummy_salt_for_tests")

import app.api.collab_routes as routes_mod  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.collab_doc import CollabDoc  # noqa: E402
from app.models.collab_doc_snapshot import CollabDocSnapshot  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.collab_history import (  # noqa: E402
    AUTO_SNAPSHOT_MIN_INTERVAL,
    MAX_SNAPSHOTS_PER_DOC,
    _utcnow,
    preview_of,
    restore_doc_state,
    text_of_state,
)
from app.services.crdt_room_hub import CollabDocHub, Room, get_crdt_hub  # noqa: E402

TEXT_KEY = "notiz"


def state_of(text: str) -> bytes:
    """État binaire CRDT contenant exactement `text` (réplique réelle)."""
    doc = Doc()
    ytext = doc.get(TEXT_KEY, type=Text)
    with doc.transaction():
        ytext.insert(0, text)
    return doc.get_update()


def _make_stack():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, CollabDoc.__table__, CollabDocSnapshot.__table__],
    )
    sf = sessionmaker(bind=engine)
    session = sf()
    alice = User(id="u-alice", email="alice@buero.de", hashed_password="x",
                 name="Alice A", role="owner", tenant_id="t1", is_active=True)
    fred = User(id="u-fred", email="fred@ander.de", hashed_password="x",
                name="Fred F", role="owner", tenant_id="t2", is_active=True)
    session.add_all([alice, fred])
    session.commit()
    hub = CollabDocHub(fakeredis.FakeStrictRedis(), sf)
    app = FastAPI()
    app.include_router(routes_mod.router)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_crdt_hub] = lambda: hub
    return app, session, hub, {"alice": alice, "fred": fred}


@pytest.fixture()
def stack():
    app, session, hub, users = _make_stack()
    current = {"user": users["alice"]}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    with TestClient(app) as client:
        yield client, session, hub, users, current


def _seed_doc(session, tenant: str, room: str, text: str) -> CollabDoc:
    row = CollabDoc(id=f"{tenant}:{room}", tenant_id=tenant, room=room,
                    state=state_of(text), version=1, updated_at=_utcnow())
    session.add(row)
    session.commit()
    return row


# ----------------------------- helpers purs ---------------------------------


def test_text_of_state_et_preview():
    text = "Protokoll Baustelle\nOG Decke prüfen\nNächster Termin 14.08."
    state = state_of(text)
    assert text_of_state(state) == text
    # Mono-ligne, espaces normalisés, tronqué avec « … » visible (pas caché).
    assert preview_of(text) == "Protokoll Baustelle OG Decke prüfen Nächster Termin 14.08."
    long_text = "Zeile mit sehr viel Text " * 30
    flat = preview_of(long_text)
    assert flat.endswith("…") and "\\n" not in flat and len(flat) <= 90


def test_restore_doc_state_idempotent_et_convergent():
    # Snapshot = « A B » ; la salle a avancé à « A B C ».
    snap_state = state_of("Ligne A\nLigne B")
    live = Doc()
    live_text = live.get(TEXT_KEY, type=Text)
    live.apply_update(snap_state)
    with live.transaction():
        live_text.insert(len(str(live_text)), "\nLigne C")

    # Client CONNECTÉ (scénario production : il a tout reçu avant le restore).
    client = Doc()
    client_text = client.get(TEXT_KEY, type=Text)
    client.apply_update(live.get_update())

    updates = restore_doc_state(live, snap_state)
    assert updates, "le contenu a changé → au moins une update émise"
    assert str(live_text) == "Ligne A\nLigne B"
    for update in updates:
        client.apply_update(update)
    assert str(client_text) == "Ligne A\nLigne B", "convergence client connecté"

    # Idempotence véridique : restaurer le MÊME point = silence complet.
    assert restore_doc_state(live, snap_state) == []


# -------------------------------- REST --------------------------------------


def test_creation_manuelle_puis_liste(stack):
    client, session, _, users, _ = stack
    _seed_doc(session, "t1", "notiz-buero", "Protokoll Baustelle\nOG Decke prüfen")
    res = client.post("/api/v5/collab/notiz-buero/snapshots",
                      json={"label": "Nach Begehung"})
    assert res.status_code == 201, res.text
    body = res.json()
    snap = body["snapshot"]
    assert snap["trigger"] == "manual"
    assert snap["label"] == "Nach Begehung"
    assert snap["created_by_name"] == "Alice A"
    assert snap["preview"].startswith("Protokoll Baustelle")
    assert snap["chars"] == len("Protokoll Baustelle\nOG Decke prüfen")
    assert body["max_snapshots"] == MAX_SNAPSHOTS_PER_DOC
    assert "~2 s" in body["hinweis"]  # l'honnêteté du délai est ÉCRITE

    listing = client.get("/api/v5/collab/notiz-buero/snapshots")
    assert listing.status_code == 200
    data = listing.json()
    assert data["count"] == 1 and data["snapshots"][0]["id"] == snap["id"]


def test_creation_sans_document_existant_404(stack):
    client, *_ = stack
    res = client.post("/api/v5/collab/notiz-buero/snapshots", json={})
    assert res.status_code == 404
    assert "zuerst schreiben" in res.json()["detail"]


def test_retention_25_l_aine_evince(stack):
    client, session, _, _, _ = stack
    _seed_doc(session, "t1", "notiz-buero", "Text de base")
    ids = []
    for n in range(MAX_SNAPSHOTS_PER_DOC + 2):  # 27 créations
        res = client.post("/api/v5/collab/notiz-buero/snapshots",
                          json={"label": f"s-{n}"})
        assert res.status_code == 201, res.text
        ids.append(res.json()["snapshot"]["id"])
    data = client.get("/api/v5/collab/notiz-buero/snapshots").json()
    assert data["count"] == MAX_SNAPSHOTS_PER_DOC
    kept = {s["id"] for s in data["snapshots"]}
    assert ids[0] not in kept and ids[1] not in kept  # les deux aînés évincés
    assert ids[-1] in kept  # le plus récent toujours là


def test_isolation_bureaux_liste_et_restore(stack):
    client, session, _, users, current = stack
    _seed_doc(session, "t1", "notiz-buero", "Texte bureau 1")
    snap_id = client.post("/api/v5/collab/notiz-buero/snapshots",
                          json={}).json()["snapshot"]["id"]
    current["user"] = users["fred"]  # autre bureau, MÊME nom de salle
    assert client.get("/api/v5/collab/notiz-buero/snapshots").json()["count"] == 0
    res = client.post(f"/api/v5/collab/notiz-buero/snapshots/{snap_id}/restore")
    assert res.status_code == 404  # jamais de 403 révélateur


def test_restore_salle_fermee_remplace_etat_pg(stack):
    client, session, hub, users, _ = stack
    _seed_doc(session, "t1", "notiz-buero", "Version NOUVELLE")
    snap = client.post("/api/v5/collab/notiz-buero/snapshots", json={})
    old_id = snap.json()["snapshot"]["id"]
    # La note avance encore (le snapshot garde « NOUVELLE »).
    row = session.get(CollabDoc, "t1:notiz-buero")
    row.state = state_of("Version ENCORE plus nouvelle")
    session.commit()
    assert "t1:notiz-buero" not in hub.rooms  # salle fermée

    res = client.post(f"/api/v5/collab/notiz-buero/snapshots/{old_id}/restore")
    assert res.status_code == 200, res.text
    assert res.json()["mode"] == "stored" and res.json()["changed"] is True
    session.expire_all()
    after = session.get(CollabDoc, "t1:notiz-buero")
    assert text_of_state(after.state) == "Version NOUVELLE"


def test_restore_salle_vivante_diffuse_pont(stack):
    client, session, hub, users, _ = stack
    _seed_doc(session, "t1", "notiz-buero", "Snapshotpunkt alt")
    snap_id = client.post("/api/v5/collab/notiz-buero/snapshots", json={}).json()["snapshot"]["id"]

    # Salle VIVANTE sur CE worker, avec un texte plus récent.
    room = Room(hub, "t1:notiz-buero", "t1", "notiz-buero")
    room.ydoc.apply_update(state_of("Laufender aktueller Text"))
    hub.rooms["t1:notiz-buero"] = room

    # Un autre worker écoute le pont (simulateur inter-workers réel).
    # fakeredis : la confirmation de subscription doit être CONSOMMÉE avant
    # le publish, sinon la file du subscriber reste silencieuse.
    pubsub = hub.redis.pubsub()
    pubsub.subscribe(room.bridge_channel)
    confirm = pubsub.get_message()
    assert confirm is not None and confirm["type"] == "subscribe"

    res = client.post(f"/api/v5/collab/notiz-buero/snapshots/{snap_id}/restore")
    assert res.status_code == 200, res.text
    assert res.json()["mode"] == "live" and res.json()["changed"] is True
    # La réplique vivante PORTE le texte restauré.
    assert text_of_state(room.ydoc.get_update()) == "Snapshotpunkt alt"
    # …et le pont a publier une trame SYNC-UPDATE (les autres workers convergent).
    import json as _json
    message = pubsub.get_message()
    assert message is not None and message.get("type") == "message"
    envelope = _json.loads(message["data"])
    import base64 as _b64
    frame = _b64.b64decode(envelope["data"])
    assert envelope["kind"] == "u" and frame[0] == YMessageType.SYNC
    # Restaurer le MÊME point une seconde fois : changé = faux (idempotent).
    res2 = client.post(f"/api/v5/collab/notiz-buero/snapshots/{snap_id}/restore")
    assert res2.json()["changed"] is False
    pubsub.close()


def test_snapshot_auto_a_la_fermeture_et_rate_limit(stack):
    _, session, hub, _, _ = stack
    room = Room(hub, "t1:notiz-buero", "t1", "notiz-buero")
    room.ydoc.apply_update(state_of("Note de fin de session"))
    room._dirty = True  # écriture non flushée : le stop doit flush + snapshot
    import asyncio
    asyncio.run(room.stop())
    autos = session.query(CollabDocSnapshot).filter_by(
        doc_id="t1:notiz-buero", trigger="auto").all()
    assert len(autos) == 1
    assert autos[0].created_by_name is None  # auto ≠ personne (honnêteté auteur)
    # Rate-limit : un second stop dans la fenêtre → toujours 1 seul auto.
    room._auto_snapshot_sync()
    assert session.query(CollabDocSnapshot).filter_by(
        doc_id="t1:notiz-buero", trigger="auto").count() == 1
    # Fenêtre dépassée (31 min simulées) : un nouvel auto EST créé.
    autos[0].created_at = _utcnow() - (AUTO_SNAPSHOT_MIN_INTERVAL + timedelta(minutes=1))
    session.commit()
    room._auto_snapshot_sync()
    assert session.query(CollabDocSnapshot).filter_by(
        doc_id="t1:notiz-buero", trigger="auto").count() == 2


def test_label_trop_long_422(stack):
    client, *_ = stack
    res = client.post("/api/v5/collab/notiz-buero/snapshots",
                      json={"label": "x" * 121})
    assert res.status_code == 422
