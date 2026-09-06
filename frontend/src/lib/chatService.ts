// NARCHI V5 — Production Grade Chat Service
// Refactored for Absolute Synchronization & Zero-White-Screen Resilience

import type { SafeUser } from "@/lib/auth";
import { sanitizeChatMessage, secureFetch } from "@/auth/SecuritySanitizer";
import { hydrateAvatarsFromServer } from "@/lib/avatars";

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  /** Axe 3 (G-Set) : identite client — cle de dedoublonnage. */
  clientId?: string;
  /** Axe 3 : horodatage de SAISIE — cle de tri chronologique de verite. */
  clientCreatedAt?: string;
}

/**
 * Cle de tri lexicographique STABLE (clientCreatedAt|createdAt, clientId|id).
 * Garantit un ordre identique sur tous les clients quel que soit l'ordre
 * d'arrivee des messages (REST, trame WS, rejeu outbox) — propriete de
 * convergence recherchee du G-Set.
 */
export function chatSortKey(m: ChatMessage): string {
  return `${m.clientCreatedAt ?? m.createdAt}|${m.clientId ?? m.id}`;
}

/** Fusion G-Set : union par identite (clientId prioritaire), puis tri stable. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  for (const m of [...current, ...incoming]) {
    const identity = m.clientId ?? m.id;
    const existing = byKey.get(identity);
    // Le message PERSISTE (id serveur definitif) remplace l'optimiste local.
    if (!existing || (existing.id.startsWith("tmp-") && !m.id.startsWith("tmp-"))) {
      byKey.set(identity, m);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => chatSortKey(a) < chatSortKey(b) ? -1 : 1);
}

export interface ChatChannel {
  id: string;
  kind: "team" | "project" | "direct";
  name: string;
  memberIds: string[];
  projectId?: string;
  createdAt: string;
}

const API = "/api/v5/chat";
const MAX_TEXT = 4000;

// Global fallback channel to prevent UI crashes in any scenario
const GLOBAL_CHANNEL: ChatChannel = {
  id: "channel-global",
  kind: "team",
  name: "# Général",
  memberIds: [],
  createdAt: new Date().toISOString(),
};

// SÉCURITÉ : plus AUCUNE lecture de token côté JS. La session transite
// exclusivement via le cookie HttpOnly `narchi_session` (credentials: "include").
async function api<T>(path: string, init: RequestInit = {}, retries = 2): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  let attempt = 0;
  let delay = 400;
  while (true) {
    try {
      // P1-B' : TOUT le trafic chat passe par secureFetch — un 401 ouvre le
      // disjoncteur sessionSecurity et broadcast narchi-session-expired.
      // (credentials: "include" est impose par secureFetch lui-meme.)
      const res = await secureFetch(`${API}${path}`, { ...init, headers });
      if (!res.ok) {
        // P1-B' : 401 = session expiree, deja traitee par l'intercepteur de
        // secureFetch (suspend + broadcast). Retenter serait marteler un
        // backend qui refusera identiquement — echec immediat, sans retry.
        if (res.status === 401) throw new Error("Session expiree");
        if ((res.status === 408 || res.status === 429 || res.status >= 500) && attempt < retries) throw new Error(`HTTP ${res.status}`);
        if (res.status === 404) return {} as T; 
        throw new Error(`Chat API ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, delay + Math.round(Math.random() * 150)));
      delay = Math.min(delay * 2, 4000);
      attempt += 1;
    }
  }
}

function normalizeChannel(raw: any): ChatChannel {
  if (!raw || typeof raw !== 'object') return { ...GLOBAL_CHANNEL, id: `fallback-${Date.now()}` };
  return {
    id: String(raw.id || "unknown"),
    kind: raw.kind === "direct" || raw.kind === "project" ? raw.kind : "team",
    name: String(raw.name || "# Général"),
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds.map(String) : [],
    projectId: raw.projectId || undefined,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

function normalizeMessage(raw: any): ChatMessage {
  if (!raw || typeof raw !== 'object') return { id: 'err', channelId: 'err', authorId: 'sys', authorName: 'NARCHI', text: '', createdAt: new Date().toISOString() };
  return {
    id: String(raw.id || "unknown"),
    channelId: String(raw.channelId || "unknown"),
    authorId: String(raw.authorId || "system"),
    authorName: String(raw.authorName || "NARCHI"),
    text: String(raw.text || ""),
    createdAt: raw.createdAt || new Date().toISOString(),
    clientId: raw.clientId || undefined,
    clientCreatedAt: raw.clientCreatedAt || undefined,
  };
}

export async function ensureChannels(users: SafeUser[], projects: { id: string; name: string }[]): Promise<ChatChannel[]> {
  try {
    const payload = {
      users: (users || []).map((u) => u.id).filter(Boolean),
      projects: (projects || []).map((p) => ({ id: p.id, name: p.name })),
    };
    const channels = await api<ChatChannel[]>("/ensure", { method: "POST", body: JSON.stringify(payload) });
    return (channels || []).map(normalizeChannel);
  } catch (e) {
    console.warn("Chat ensureChannels fallback active", e);
    return [GLOBAL_CHANNEL];
  }
}

export async function getChannels(_userId: string): Promise<ChatChannel[]> {
  try {
    const channels = await api<ChatChannel[]>("/channels");
    if (!channels || channels.length === 0) return [GLOBAL_CHANNEL];
    return channels.map(normalizeChannel);
  } catch (e) {
    console.warn("Chat getChannels fallback active", e);
    return [GLOBAL_CHANNEL];
  }
}

/* ----- Comptes d'équipe réels (cibles valides d'une Direktnachricht) ----- */

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** §82 — propagation des avatars (clé §80 + contenu JSON serveur). */
  avatar_key: string | null;
  avatar_json: string | null;
}

/// Membres du tenant avec compte backend réel (actifs). null si le backend
/// est injoignable — l'UI masque alors la section « Direktnachrichten »
/// plutôt que d'ouvrir un canal de repli trompeur nommé « # Général ».
export async function getTeamUsers(): Promise<TeamUser[] | null> {
  try {
    const rows = await api<TeamUser[]>("/users");
    if (!Array.isArray(rows)) return null;
    const users = rows
      .filter((row) => row && typeof row.id === "string" && typeof row.email === "string")
      .map((row) => ({
        id: String(row.id),
        name: String(row.name || row.email),
        email: String(row.email),
        role: String(row.role || "architect"),
        avatar_key: typeof row.avatar_key === "string" ? row.avatar_key : null,
        avatar_json: typeof row.avatar_json === "string" ? row.avatar_json : null,
      }));
    // §82 — verse les avatars serveur dans le registre local (icônes visibles
    // partout : rail de contacts, fils, notiz live).
    hydrateAvatarsFromServer(users);
    return users;
  } catch (error) {
    console.warn("[Chat] Comptes d'équipe indisponibles :", error);
    return null;
  }
}

/// Canal direct avec un collègue AYANT UN COMPTE réel (id backend).
/// Échoue explicitement si le compte n'existe pas — l'appelant affiche
/// l'erreur au lieu d'un faux canal « # Général » de repli.
/** §108 — Renommage owner/admin (team/project uniquement ; DM = identité du
 *  contact, refusée côté serveur). Le serveur est la SEULE vérité : en cas
 *  d'échec l'erreur remonte, l'UI n'invente rien. */
export async function renameChannel(channelId: string, name: string): Promise<ChatChannel> {
  const raw = await api<unknown>(`/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return normalizeChannel(raw);
}

/** §108 — Suppression d'une conversation directe (owner/admin, cascade
 *  serveur : membres + messages). team/project : refus 409 (auto-gérés). */
export async function deleteChannel(channelId: string): Promise<{ deletedMessages: number }> {
  const raw = await api<{ deletedMessages?: number }>(`/channels/${channelId}`, {
    method: "DELETE",
  });
  return { deletedMessages: typeof raw?.deletedMessages === "number" ? raw.deletedMessages : 0 };
}

export async function ensureDirectChannel(_me: SafeUser, other: SafeUser): Promise<ChatChannel> {
  const raw = await api<ChatChannel>("/direct", {
    method: "POST",
    body: JSON.stringify({ otherUserId: other.id, otherUserName: other.name || other.email || "Collègue" }),
  });
  // Le service API renvoie {} sur 404 (compte introuvable côté tenant).
  if (!raw || typeof (raw as { id?: unknown }).id !== "string") {
    throw new Error(
      `Direktnachricht nicht möglich — ${other.name || other.email || "Kollege"} hat kein Benutzerkonto.`,
    );
  }
  return normalizeChannel(raw);
}

export async function getMessages(channelId: string): Promise<ChatMessage[]> {
  try {
    const messages = await api<ChatMessage[]>(`/channels/${encodeURIComponent(channelId)}/messages`);
    return (messages || []).map(normalizeMessage);
  } catch (e) {
    console.error("Chat getMessages error", e);
    return [];
  }
}

export async function sendMessage(channelId: string, _author: SafeUser, text: string): Promise<ChatMessage> {
  // Neutralisation XSS AVANT persistance (défense en profondeur : le rendu
  // JSX ré-échappe une seconde fois ; dangerouslySetInnerHTML est proscrit).
  const safeText = sanitizeChatMessage(String(text || "")).slice(0, MAX_TEXT);
  if (!safeText) throw new Error("Message vide.");
  try {
    const msg = await api<ChatMessage>(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: safeText }),
    });
    window.dispatchEvent(new CustomEvent("narchi-chat-message", { detail: msg }));
    return normalizeMessage(msg);
  } catch (e) {
    throw e;
  }
}

export async function unreadCount(userId: string, channelId: string): Promise<number> {
  try {
    const messages = await getMessages(channelId);
    const key = `narchi:chatread:${userId}:${channelId}`;
    const lastRead = Number(new Date(localStorage.getItem(key) || 0));
    return messages.filter((m) => m.authorId !== userId && Number(new Date(m.createdAt)) > lastRead).length;
  } catch {
    return 0;
  }
}

export function markRead(userId: string, channelId: string) {
  localStorage.setItem(`narchi:chatread:${userId}:${channelId}`, new Date().toISOString());
  window.dispatchEvent(new Event("narchi-chat-read"));
}

/* ---------------------- verrou anti-tempête (§84) ---------------------- */
// §84 — CAUSE RÉELLE du « va-et-vient » du dock (~2×/s) : markRead() était
// appelé à CHAQUE cycle de rafraîchissement → chaque markRead déclenche
// « narchi-chat-read » → subscribeChat y répond IMMÉDIATEMENT (attempt=0,
// cb() instantané) → nouveau cycle → nouveau markRead… boucle infinie.
// Verrou : acquitter UNIQUEMENT si un message plus récent que le dernier
// horodatage acquitté est présent.

/// Horodatage d'activité le plus récent d'une liste (clientCreatedAt = heure
/// de saisie, prioritaire ; repli createdAt). Tri lexicographique ISO = tri
/// chronologique pour ces formats. null si liste vide.
export function newestActivityTimestamp(messages: ChatMessage[]): string | null {
  let best: string | null = null;
  for (const m of messages) {
    const t = m.clientCreatedAt ?? m.createdAt;
    if (typeof t === "string" && t && (best === null || t > best)) best = t;
  }
  return best;
}

/// Renvoie l'horodatage à mémoriser s'il faut acquitter (message plus récent
/// que lastMarked), sinon null (même instantané → silence, fin de la boucle).
export function shouldMarkReadNow(lastMarked: string, messages: ChatMessage[]): string | null {
  const newest = newestActivityTimestamp(messages);
  if (!newest) return null;
  return newest > lastMarked ? newest : null;
}

export function subscribeChat(cb: () => void): () => void {
  let closed = false;
  let attempt = 0;
  let timer: number | null = null;

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(3000 * 2 ** Math.min(attempt, 4), 30000);
    timer = window.setTimeout(() => {
      if (!closed) cb();
      attempt = Math.min(attempt + 1, 4);
      schedule();
    }, delay);
  };

  const onLocal = () => { attempt = 0; if (!closed) cb(); };
  window.addEventListener("narchi-chat-read", onLocal);
  window.addEventListener("narchi-chat-message", onLocal as EventListener);
  schedule();

  return () => {
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener("narchi-chat-read", onLocal);
    window.removeEventListener("narchi-chat-message", onLocal as EventListener);
  };
}

export function connectChannelSocket(channelId: string, cb: (payload: unknown) => void): () => void {
  // SÉCURITÉ : plus de token en query string (fuite dans les logs serveur/proxy).
  // Le handshake WebSocket same-origin transporte automatiquement le cookie
  // HttpOnly `narchi_session`, validé côté backend (app/core/security.py).
  let closed = false;
  let ws: WebSocket | null = null;
  let retry: number | null = null;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ws = new WebSocket(`${proto}//${window.location.host}${API}/ws?channel_id=${encodeURIComponent(channelId)}`);
      ws.onopen = () => { attempt = 0; };
      ws.onmessage = (event) => {
        try { cb(JSON.parse(event.data)); } catch { cb(event.data); }
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(1000 * 2 ** Math.min(attempt++, 6), 30000);
        retry = window.setTimeout(connect, delay);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
    } catch (e) {
      retry = window.setTimeout(connect, 5000);
    }
  };

  connect();
  return () => {
    closed = true;
    if (retry !== null) window.clearTimeout(retry);
    try { ws?.close(); } catch { /* noop */ }
  };
}
