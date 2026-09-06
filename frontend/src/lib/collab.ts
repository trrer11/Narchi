/**
 * §78 — V2.7 étape 1 : présence live + verrous doux. Le serveur est la SEULE
 * vérité (Redis à TTL) ; ici : client HTTP + helpers PURS d'affichage (testés).
 * Intervalles ANNONCÉS (présence 5 s, heartbeat 15 s) — pas de promesse
 * « instantané ». Le CRDT texte (Yjs) arrive en étape 2, dit honnêtement.
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";

export interface PresenceMember {
  user_id: string;
  name: string;
  color: string;
  joined_at: string;
  last_seen: string;
}

export interface PresenceResponse {
  room: string;
  count: number;
  members: PresenceMember[];
  poll_interval_s: number;
}

export interface LockInfo {
  target: string;
  owner_id: string;
  owner_name: string;
  since: string;
  expires_in_s: number;
}

export interface ClaimResult {
  acquired: boolean;
  lock?: LockInfo;
  held_by?: LockInfo;
  lock_ttl_s: number;
}

export interface LocksResponse {
  room: string;
  count: number;
  locks: LockInfo[];
}

const base = () => getApiBase();

export function joinRoom(room: string): Promise<Response> {
  return secureFetch(`${base()}/api/v5/collab/${room}/join`, { method: "POST" });
}

export function heartbeatRoom(room: string): Promise<Response> {
  return secureFetch(`${base()}/api/v5/collab/${room}/heartbeat`, { method: "POST" });
}

export function leaveRoom(room: string): Promise<Response> {
  return secureFetch(`${base()}/api/v5/collab/${room}/leave`, { method: "POST" });
}

export async function fetchPresence(room: string): Promise<PresenceResponse> {
  const res = await secureFetch(`${base()}/api/v5/collab/${room}/presence`);
  if (!res.ok) throw new Error(`Präsenz fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as PresenceResponse;
}

export async function claimLock(room: string, target: string): Promise<ClaimResult> {
  const res = await secureFetch(`${base()}/api/v5/collab/${room}/locks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw new Error(`Sperre fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as ClaimResult;
}

export function releaseLock(room: string, target: string): Promise<Response> {
  return secureFetch(`${base()}/api/v5/collab/${room}/locks/${encodeURIComponent(target)}`, {
    method: "DELETE",
  });
}

export async function fetchLocks(room: string): Promise<LocksResponse> {
  const res = await secureFetch(`${base()}/api/v5/collab/${room}/locks`);
  if (!res.ok) throw new Error(`Sperren fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json()) as LocksResponse;
}

/* --------------------------- helpers purs (testés) ------------------------ */

/** Arrondi PLAFOND honnête : « noch ca. 15 Min. », jamais moins que la vérité. */
export function formatExpires(seconds: number): string {
  if (seconds < 60) return "unter 1 Minute";
  return `ca. ${Math.ceil(seconds / 60)} Min.`;
}

/** Bannière du verrou doux — nomme le collègue, dit la sémantique (« doux »). */
export function lockBanner(lock: LockInfo): string {
  return `${lock.owner_name} sperrt „${lock.target}“ (${formatExpires(lock.expires_in_s)}). Weiches Schloss — bitte Rücksprache; kein harter Schutz.`;
}

/** Résumé de présence : TOUJOURS soi-même inclus, compte exact. */
export function presenceSummary(count: number): string {
  if (count <= 1) return "Nur du online";
  if (count === 2) return "Du + 1 Kollege";
  return `Du + ${count - 1} Kollegen`;
}

/** Initiales d'affichage d'un membre (2 lettres max, haut de nom). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return letters.join("").toUpperCase();
}
