// Narchi — Unified remote/local database with offline write queue.
// Online → real Supabase (cross-device). Offline → local SharedStore, AND every
// local write is queued so it replays against the cloud when back online.
// Fixes the "silent data divergence" problem.

import { store as localStore } from "@/lib/sharedStore";
import { isConfigured } from "@/lib/remoteConfig";
import { remoteDelete, remoteInsert, remoteSelect, remoteUpdate, remoteUpsert, subscribeRealtime } from "@/lib/supabase";
import { sessionSecurity } from "@/auth/sessionSecurity";

export function isOnline(): boolean {
  return isConfigured();
}

/* ---- Offline write queue (replays on reconnect) ---- */
interface QueuedOp {
  id: number;
  table: string;
  op: "insert" | "update" | "delete" | "upsert";
  doc?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  rowId?: string;
}
const QUEUE_KEY = "narchi:writequeue";
let queueCounter = 0;
function loadQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const q = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
    queueCounter = q.reduce((m, o) => Math.max(m, o.id), 0);
    return q;
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event("narchi-queue-changed"));
}
function enqueue(op: Omit<QueuedOp, "id">) {
  const q = loadQueue();
  q.push({ ...op, id: ++queueCounter });
  saveQueue(q);
}
function dequeue(id: number) {
  const q = loadQueue().filter((o) => o.id !== id);
  saveQueue(q);
}

let flushing = false;
/**
 * Rejoue la file d'ecritures persistee.
 * P1-B (gel controle) : si la session est suspendue (401 detecte), AUCUNE
 * requete ne part — la file reste en sursis dans localStorage et survit a
 * la fermeture d'onglet. `force=true` est reserve au handler de succes
 * d'authentification (rejeu immediat sans attendre le cycle de 15 s).
 */
export async function flushQueue(force = false) {
  if (sessionSecurity.isSuspended() && !force) return;
  if (!isOnline() || flushing) return;
  flushing = true;
  const q = loadQueue();
  for (const op of q) {
    try {
      if (op.op === "insert" && op.doc) await remoteInsert(op.table, op.doc as { id: string });
      else if (op.op === "upsert" && op.doc) await remoteUpsert(op.table, op.doc as { id: string });
      else if (op.op === "update" && op.rowId && op.patch) await remoteUpdate(op.table, op.rowId, op.patch);
      else if (op.op === "delete" && op.rowId) await remoteDelete(op.table, op.rowId);
      dequeue(op.id); // success → remove from queue
    } catch {
      break; // stop on first failure, retry later
    }
  }
  flushing = false;
}

export function queueLength(): number {
  return loadQueue().length;
}

/* ---- Polling sync for online mode ---- */
const POLL_MS = 4000;
const pollers = new Map<string, number>();
function ensurePoller(collection: string, listeners: Set<() => void>) {
  if (pollers.has(collection)) return;
  const id = window.setInterval(() => listeners.forEach((l) => l()), POLL_MS);
  pollers.set(collection, id);
}
function stopPoller(collection: string) {
  const id = pollers.get(collection);
  if (id !== undefined) {
    window.clearInterval(id);
    pollers.delete(collection);
  }
}

const listeners = new Map<string, Set<() => void>>();

export async function getAll<T>(collection: string): Promise<T[]> {
  if (isOnline()) {
    try {
      const data = await remoteSelect<T & { created_at?: string }>(collection);
      return data.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    } catch {
      return localStore.getAll<T>(collection);
    }
  }
  return localStore.getAll<T>(collection);
}

export async function insert<T extends { id: string }>(collection: string, doc: T): Promise<T> {
  // Always write locally first (instant UI), then push to cloud (with queue on failure)
  const local = await localStore.insert(collection, doc);
  if (isOnline()) {
    try {
      return await remoteInsert(collection, doc);
    } catch {
      enqueue({ table: collection, op: "insert", doc: doc as unknown as Record<string, unknown> });
    }
  }
  return local;
}

export async function upsert<T extends { id: string }>(collection: string, doc: T): Promise<T> {
  const local = await localStore.insert(collection, doc);
  if (isOnline()) {
    try {
      return await remoteUpsert(collection, doc);
    } catch {
      enqueue({ table: collection, op: "upsert", doc: doc as unknown as Record<string, unknown> });
    }
  }
  return local;
}

export async function update<T>(collection: string, id: string, patch: Partial<T>): Promise<void> {
  await localStore.update(collection, id, patch);
  if (isOnline()) {
    try {
      await remoteUpdate<T>(collection, id, patch);
      return;
    } catch {
      enqueue({ table: collection, op: "update", rowId: id, patch: patch as Record<string, unknown> });
    }
  }
}

export async function remove(collection: string, id: string): Promise<void> {
  await localStore.remove(collection, id);
  if (isOnline()) {
    try {
      await remoteDelete(collection, id);
      return;
    } catch {
      enqueue({ table: collection, op: "delete", rowId: id });
    }
  }
}

export function subscribe(collection: string, cb: () => void): () => void {
  if (!listeners.has(collection)) listeners.set(collection, new Set());
  listeners.get(collection)!.add(cb);
  if (isOnline()) {
    // Realtime (instant) + polling (fallback) + local (own writes)
    const rtUnsub = subscribeRealtime(collection, () => cb());
    ensurePoller(collection, listeners.get(collection)!);
    const localUnsub = localStore.subscribe(collection, cb);
    return () => {
      listeners.get(collection)?.delete(cb);
      if ((listeners.get(collection)?.size ?? 0) === 0) stopPoller(collection);
      rtUnsub();
      localUnsub();
    };
  }
  const unsub = localStore.subscribe(collection, cb);
  return () => {
    listeners.get(collection)?.delete(cb);
    unsub();
  };
}

/** Initialise: flush pending writes and periodically retry. */
export function initRemoteDb(): () => void {
  const handleOnline = () => void flushQueue();
  void flushQueue();
  window.addEventListener("online", handleOnline);
  const timer = window.setInterval(() => void flushQueue(), 15000);
  return () => {
    window.removeEventListener("online", handleOnline);
    window.clearInterval(timer);
  };
}
