/**
 * §81 — V2.7 étape 2 : co-édition CRDT RÉELLE (Yjs ↔ backend pycrdt/yrs).
 *
 * Bascule leurre → réel : l'ancien `collaborationManager.ts` (supprimé au
 * §81) simulait un « real-time engine » pointé sur un hub Node
 * `ws://localhost:1234` qui n'a jamais existé. Ici, tout bout visible est
 * observable et testé :
 *
 *  - transport : WebSocket same-origin vers `/api/v5/collab/ws/{salle}`
 *    (cookie HttpOnly, comme le chat §61 — jamais de token en URL) ;
 *  - convergence : Yjs officiel côté navigateur, cœur `yrs` côté serveur —
 *    deux répliques éditées en parallèle fusionnent SANS perte ;
 *  - hors ligne : l'édition locale continue (CRDT file d'attente), la
 *    resynchronisation se fait au reconnect — la bannière le dit quand
 *    c'est le cas, sinon l'indicateur reste « Live ».
 *
 * Fonctions PURES testées : delta minimal texte, URL WS, pastilles pairs.
 */

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";

export const NOTIZ_ROOM = "notiz-buero";
export const NOTIZ_TEXT_KEY = "notiz";   // contrat gravé côté serveur
export const NOTIZ_MAX_CHARS = 50_000;
const LOCAL_ORIGIN = "local-edit";

// --------------------------------------------------------------------------
// Helpers purs (tests vitest)
// --------------------------------------------------------------------------

/** ws(s)://{host}/api/v5/collab/ws — même origine, cookie de session seul. */
export function buildCollabWsBase(
  loc: Pick<Location, "protocol" | "host"> = window.location,
): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/api/v5/collab/ws`;
}

export interface TextDelta {
  index: number;      // position (unités UTF-16 = sémantique Y.Text)
  deleteLen: number;  // unités supprimées à cet index
  insert: string;     // texte inséré à cet index
}

/**
 * Delta minimal entre deux valeurs de textarea (préfixe/suffixe communs).
 * Un textarea contrôlé ne propose pas d'évènements Y natifs : on convertit
 * chaque saisie en UNE transaction Yjs minimale — c'est ce qui rend la
 * co-édition fluide au lieu d'écraser le document à chaque frappe.
 */
export function textDelta(prev: string, next: string): TextDelta | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start += 1;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev -= 1;
    endNext -= 1;
  }
  return { index: start, deleteLen: endPrev - start, insert: next.slice(start, endNext) };
}

/** Applique le delta à une réplique Y.Text (origine marquée — anti-boucle). */
export function applyTextDelta(doc: Y.Doc, ytext: Y.Text, delta: TextDelta): void {
  doc.transact(() => {
    if (delta.deleteLen > 0) ytext.delete(delta.index, delta.deleteLen);
    if (delta.insert) ytext.insert(delta.index, delta.insert);
  }, LOCAL_ORIGIN);
}

export interface PeerState {
  name: string;
  color: string;
  typing: boolean;
  /// §86 — position curseur (index Y.Text, unités UTF-16) si le pair la
  /// publie ; null sinon. La LIGNE est calculée ici, pas devinée.
  cursor: number | null;
}

/**
 * Pastilles de présence depuis l'état awareness (duplicatas d'un même
 * utilisateur en 2 onglets fusionnés — « tape… » gagne), soi-même exclu.
 */
export function peersFromStates(
  states: Iterable<unknown>,
  selfName: string,
): PeerState[] {
  const byName = new Map<string, PeerState>();
  for (const raw of states) {
    const user = (raw as { user?: { name?: unknown; color?: unknown; typing?: unknown; cursor?: unknown } })
      ?.user;
    if (!user || typeof user.name !== "string" || !user.name) continue;
    if (user.name === selfName) continue;
    const color = typeof user.color === "string" && user.color ? user.color : "#64748b";
    const typing = user.typing === true;
    const cursor =
      typeof user.cursor === "number" && Number.isFinite(user.cursor) && user.cursor >= 0
        ? Math.floor(user.cursor)
        : null;
    const prev = byName.get(user.name);
    byName.set(user.name, {
      name: user.name,
      color,
      typing: typing || prev?.typing === true,
      // Dernier curseur non nul gagne (deux onglets du même collègue).
      cursor: cursor ?? prev?.cursor ?? null,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/* ------------------------ §86 — curseur (Zeile réelle) --------------------- */

export interface CursorPos {
  line: number;     // 1-basé (affichage « Z. n »)
  column: number;   // 1-basé
}

/** Ligne/colonne 1-basées d'un index (sauts de ligne « \n » ; borné au texte). */
export function cursorLineCol(text: string, index: number): CursorPos {
  const clamped = Math.max(0, Math.min(Math.floor(index), text.length));
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastBreak = i;
    }
  }
  return { line, column: clamped - lastBreak };
}

/** Libellé de pastille : nom + (« tippt… » prioritaire, sinon ligne curseur). */
export function peerChipText(peer: PeerState, docText: string): string {
  if (peer.typing) return `${peer.name} · tippt…`;
  if (peer.cursor !== null) return `${peer.name} · Z. ${cursorLineCol(docText, peer.cursor).line}`;
  return peer.name;
}

/* --------------------- §86 — historique (snapshots REST) ------------------- */

export interface NotizSnapshot {
  id: string;
  createdAt: string;
  trigger: "manual" | "auto";
  label: string | null;
  createdByName: string | null;
  bytes: number;
  chars: number;
  preview: string;
}

/// Transforme une ligne serveur ; renvoie null si forme hostile (jamais
/// de donnée aveugle affichée — même ligne que parseAvatarJson §82).
export function snapshotOf(raw: unknown): NotizSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.created_at !== "string") return null;
  if (r.trigger !== "manual" && r.trigger !== "auto") return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    trigger: r.trigger,
    label: typeof r.label === "string" ? r.label : null,
    createdByName: typeof r.created_by_name === "string" ? r.created_by_name : null,
    bytes: typeof r.bytes === "number" ? r.bytes : 0,
    chars: typeof r.chars === "number" ? r.chars : 0,
    preview: typeof r.preview === "string" ? r.preview : "",
  };
}

async function ensureOk(res: Response, verb: string): Promise<Response> {
  if (res.ok) return res;
  let detail = `HTTP ${res.status}`;
  try { detail = (await res.json()).detail ?? detail; } catch { /* garde le code */ }
  throw new Error(`${verb}: ${detail}`);
}

export interface SnapshotList {
  snapshots: NotizSnapshot[];
  /// Borne de rétention RÉELLE renvoyée par le serveur (25 §86) — l'UI
  /// l'affiche telle quelle plutôt que la deviner.
  maxSnapshots: number;
}

export async function fetchNotizSnapshots(room: string = NOTIZ_ROOM): Promise<SnapshotList> {
  const res = await ensureOk(
    await secureFetch(`${getApiBase()}/api/v5/collab/${encodeURIComponent(room)}/snapshots`),
    "Verlauf laden fehlgeschlagen",
  );
  const body = (await res.json()) as { snapshots?: unknown[]; max_snapshots?: unknown };
  return {
    snapshots: (Array.isArray(body.snapshots) ? body.snapshots : [])
      .map(snapshotOf)
      .filter((s): s is NotizSnapshot => s !== null),
    maxSnapshots: typeof body.max_snapshots === "number" ? body.max_snapshots : 0,
  };
}

export async function createNotizSnapshot(
  label?: string,
  room: string = NOTIZ_ROOM,
): Promise<NotizSnapshot> {
  const res = await ensureOk(
    await secureFetch(`${getApiBase()}/api/v5/collab/${encodeURIComponent(room)}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label ?? null }),
    }),
    "Schnappschuss fehlgeschlagen",
  );
  const body = (await res.json()) as { snapshot?: unknown };
  const snap = snapshotOf(body.snapshot);
  if (!snap) throw new Error("Schnappschuss fehlgeschlagen: Antwort ungültig");
  return snap;
}

export interface RestoreResult {
  /// "live" = propagé aux connectés ; "stored" = appliqué au prochain chargement.
  mode: "live" | "stored";
  changed: boolean;
}

export function restoreResultOf(raw: unknown): RestoreResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== "live" && r.mode !== "stored") return null;
  if (typeof r.changed !== "boolean") return null;
  return { mode: r.mode, changed: r.changed };
}

export async function restoreNotizSnapshot(
  id: string,
  room: string = NOTIZ_ROOM,
): Promise<RestoreResult> {
  const res = await ensureOk(
    await secureFetch(
      `${getApiBase()}/api/v5/collab/${encodeURIComponent(room)}/snapshots/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    ),
    "Wiederherstellen fehlgeschlagen",
  );
  const result = restoreResultOf(await res.json());
  if (!result) throw new Error("Wiederherstellen fehlgeschlagen: Antwort ungültig");
  return result;
}

/** Simple et vérifiable : « 2 online » reste la vérité de la CollabBar §78. */
export function peerChipLabel(count: number): string {
  if (count <= 0) return "Nur Sie hier";
  if (count === 1) return "1 Kollege live";
  return `${count} Kollegen live`;
}

// --------------------------------------------------------------------------
// Connexion vivante (le composant pilote, ces effets sont fins et dit)
// --------------------------------------------------------------------------

export interface SharedNotizHandle {
  doc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  destroy: () => void;
}

export function openSharedNotiz(user: { name: string; color?: string }): SharedNotizHandle {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(buildCollabWsBase(), NOTIZ_ROOM, doc, {
    // cookies voyagent seuls (same-origin) — aucun paramètre sensible.
    resyncInterval: 30_000,
  });
  const ytext = doc.getText(NOTIZ_TEXT_KEY);
  provider.awareness.setLocalStateField("user", {
    name: user.name,
    color: user.color ?? "#64748b",
    typing: false,
  });
  return {
    doc,
    ytext,
    provider,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}

export { LOCAL_ORIGIN };
