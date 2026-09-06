// NARCHI V6.11 — Serverseitige Terminerinnerungen, côté frontal (§46).
// Le rappel §35 ne sonne QUE si l'onglet NARCHI est ouvert. Ce module sync
// les entrées « Mein Kalender » avec rappel vers le backend FastAPI
// (/api/v5/reminders) : le serveur sonne même navigateur FERMÉ —
// e-mail si SMTP configuré, sinon in-app honnête — et le canal in-app
// remonte au prochain démarrage, tous appareils confondus.
//
// Défaillances HONNÊTES : backend éteindu / non connecté → le module se tait
// (le rappel local §35 continue de fonctionner, rien ne casse).

import { getApiBase, checkBackendHealth } from "@/lib/apiClient";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { entryStartsAt, type CalEntry } from "@/lib/myCalendar";

// ---------------------------------------------------------------------------
// Contrats (miroir du backend §46)
// ---------------------------------------------------------------------------

export interface ReminderInPayload {
  entry_id: string;
  title: string;
  kind: string;
  starts_at: string; // ISO 8601 avec fuseau
  remind_before_h: number;
  note?: string;
}

export interface ServerReminderOut {
  entry_id: string;
  title: string;
  kind: string;
  starts_at: string;
  remind_before_h: number;
  note: string | null;
  fired_at: string;
  email_sent: boolean;
}

export interface ReminderChannels {
  email_enabled: boolean;
  email_recipient: string | null;
  inapp_enabled: boolean;
}

export type SyncResult =
  | { ok: true; synced: number; retired: number; channels: ReminderChannels }
  | { ok: false; reason: "offline" | "error" };

// ---------------------------------------------------------------------------
// Mapping PUR (testable) — quelles entrées montent au serveur, et comment
// ---------------------------------------------------------------------------

const SYNC_HORIZON_DAYS = 60;
const SYNC_CAP = 200;

/**
 * Entrées à synchroniser : rappel > 0, rappel PAS ENCORE émis localement
 * (notifiedAt vide — sinon le serveur re-sonnerait en doublon), événement à
 * venir dans l'horizon (les rendez-vous passés ne remontent jamais).
 */
export function toServerPayload(entries: CalEntry[], nowMs: number, horizonDays = SYNC_HORIZON_DAYS): ReminderInPayload[] {
  const horizon = nowMs + horizonDays * 86_400_000;
  return entries
    .filter((e) => (e.remindH ?? 0) > 0 && !e.notifiedAt)
    .map((e) => ({ e, starts: entryStartsAt(e) }))
    .filter(({ starts }) => starts > nowMs && starts <= horizon)
    .sort((a, b) => a.starts - b.starts)
    .slice(0, SYNC_CAP)
    .map(({ e, starts }) => ({
      entry_id: e.id,
      title: e.title,
      kind: e.kind,
      starts_at: new Date(starts).toISOString(),
      remind_before_h: e.remindH ?? 0,
      ...(e.note ? { note: e.note } : {}),
    }));
}

// ---------------------------------------------------------------------------
// Déduplication du PULL in-app (le navigateur se souvient des « fired » vus)
// ---------------------------------------------------------------------------

const ACK_KEY = "narchi:server-reminders-acked";
const ACK_CAP = 500;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Clé d'unicité : entry + instant de déclenchement (un événement reporté re-sonne). */
export function ackId(r: Pick<ServerReminderOut, "entry_id" | "fired_at">): string {
  return `${r.entry_id}#${r.fired_at}`;
}

export function loadAcked(store: StorageLike | null = defaultStore()): Set<string> {
  if (!store) return new Set();
  try {
    const raw = store.getItem(ACK_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveAcked(acked: Set<string>, store: StorageLike | null = defaultStore()): void {
  if (!store) return;
  try {
    // FIFO : on conserve les ACK_CAP plus récents (l'ordre d'un Set = insertion).
    const arr = [...acked].slice(-ACK_CAP);
    store.setItem(ACK_KEY, JSON.stringify(arr));
  } catch {
    /* quota plein : silencieux, les rappels re-sonneront une fois max */
  }
}

export function unseenReminders(due: ServerReminderOut[], acked: Set<string>): ServerReminderOut[] {
  return due.filter((r) => !acked.has(ackId(r)));
}

export function rememberReminders(acked: Set<string>, seen: ServerReminderOut[], store: StorageLike | null = defaultStore()): Set<string> {
  const next = new Set(acked);
  for (const r of seen) next.add(ackId(r));
  saveAcked(next, store);
  return next;
}

// ---------------------------------------------------------------------------
// I/O — silencieuse hors-ligne (le rappel local §35 reste la garantie)
// ---------------------------------------------------------------------------

async function remindersFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const healthy = await checkBackendHealth();
  if (!healthy.ok) return null;
  try {
    const res = await secureFetch(`${getApiBase()}/api/v5/reminders${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
    });
    if (!res.ok) return null; // 401 (non connecté) → canal serveur simplement OFF
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Synchronise les entrées « avec rappel » vers le serveur (upsert complet). */
export async function syncServerReminders(entries: CalEntry[]): Promise<SyncResult> {
  const payload = toServerPayload(entries, Date.now());
  const body = await remindersFetch<ReminderSyncResultRaw>("/sync", {
    method: "POST",
    body: JSON.stringify({ reminders: payload }),
  });
  if (!body) return { ok: false, reason: "offline" };
  return { ok: true, synced: body.synced, retired: body.retired, channels: body.channels };
}

interface ReminderSyncResultRaw {
  synced: number;
  retired: number;
  channels: ReminderChannels;
}

/** Pull : rappels DÉCLENCHÉS côté serveur (brower fermé entre-temps). null = off. */
export async function fetchServerDueReminders(hours = 48): Promise<ServerReminderOut[] | null> {
  return remindersFetch<ServerReminderOut[]>(`/due?hours=${hours}`);
}

/** Badge honnête du header : e-mail actif ? in-app ? (null = serveur off). */
export async function fetchReminderChannels(): Promise<ReminderChannels | null> {
  return remindersFetch<ReminderChannels>("/channels");
}
