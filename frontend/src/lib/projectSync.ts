/**
 * §118 — Miroir de synchro des PROJETS (plainte client : « un projet
 * importé est invisible sur l'autre compte »).
 *
 * Mêmes lois que le moteur Mängel §117 (issueSync), appliquées au miroir
 * serveur `/api/v5/project-sync` :
 *  - création et suppression marquées dans le slice, file PERSISTANTE
 *    (localStorage) — hors-ligne, rien ne se perd, rien ne part ;
 *  - dernier-écrivain-gagne en MILLISECONDES (règle importée d'issueSync,
 *    jamais de comparaison lexicale d'horodatages) ;
 *  - tombstone serveur → retrait local (silencieux = pas de re-marquage,
 *    sinon boucle) ; suppression LOCALE → file de DELETEs distincte ;
 *  - au tirage, `activeProjectId` n'est JAMAIS modifié (la sélection
 *    reste un choix de l'utilisateur — §111) ;
 *  - décliné par le serveur → rattrapage GET par id (même raison que §117
 *    : le delta peut manquer la gagnante — curseur au-delà de SA date) ;
 *  - `updatedAt` absent (projets d'avant §118) → date de première synchro
 *    fait foi (dit, jamais de passé inventé) ;
 *  - §121 — RELAIS DES GARÉS : un tirage qui fait arriver des projets
 *    rejoue IMMÉDIATEMENT les Mängel garés faute de projet (copie mémoire
 *    §121, zéro réseau — la course « Mangel avant projet » du premier
 *    démarrage, trouvée par la suite E2E navigateur, se résout ici).
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import type { Project } from "@/data/types";
import { retryParkedIssues, toMs } from "@/lib/issueSync";

const API = "/api/v5/project-sync";
const QUEUE_KEY = "narchi:projects:sync-queue";
const DEL_KEY = "narchi:projects:deleted-queue";
const CURSOR_KEY = "narchi:projects:sync-cursor";

/** Champs synchronisés (fiche d'affichage complète — cf. data/types). */
const CHAMPS_SYNC = [
  "code", "type", "location", "client",
  "clientStreet", "clientZip", "clientCity", "clientLeitweg",
  "status", "progress", "budget",
  "spent", "grossFloorArea", "floors", "startDate", "endDate", "team",
  "classificationCode", "carbonBudgetKg", "health", "riskScore", "accent",
] as const;

export interface ProjectSyncItemShape {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  updated_at: string;
}

export interface ProjectRemote extends ProjectSyncItemShape {
  created_by: string;
  created_at: string | null;
  deleted_at: string | null;
}

export interface ProjectSyncDeps {
  loadProjects: () => Project[];
  upsertProjects: (p: Project[]) => void;
  removeProjects: (ids: string[]) => void;
}

export type ProjectSyncPhase = "jamais" | "sync" | "offline" | "erreur";

export interface ProjectSyncStatus {
  phase: ProjectSyncPhase;
  pending: number;          // créations/modifs en attente
  pendingDeletes: number;   // suppressions en attente
  lastSyncAt: string | null;
  lastError: string | null;
}

interface EngineState {
  deps: ProjectSyncDeps | null;
  queue: string[];
  delQueue: string[];
  status: ProjectSyncStatus;
  listeners: Set<(s: ProjectSyncStatus) => void>;
  pushing: boolean;
  pulling: boolean;
  debounceHandle: ReturnType<typeof setTimeout> | null;
  debounceMs: number;
}

const engine: EngineState = {
  deps: null,
  queue: [],
  delQueue: [],
  status: { phase: "jamais", pending: 0, pendingDeletes: 0, lastSyncAt: null, lastError: null },
  listeners: new Set(),
  pushing: false,
  pulling: false,
  debounceHandle: null,
  debounceMs: 800,
};

// --- persistance --------------------------------------------------------------

function storage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}
function readIds(key: string): string[] {
  const st = storage();
  if (!st) return [];
  try {
    const brut = st.getItem(key);
    const p = brut ? (JSON.parse(brut) as unknown) : [];
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function writeIds(key: string, ids: string[]): void {
  const st = storage();
  if (!st) return;
  try { st.setItem(key, JSON.stringify(ids)); } catch { /* mémoire seule, dit par file conservée */ }
}

function emit(patch: Partial<ProjectSyncStatus>): void {
  engine.status = {
    ...engine.status, ...patch,
    pending: engine.queue.length, pendingDeletes: engine.delQueue.length,
  };
  for (const l of engine.listeners) l(engine.status);
}

export function getProjectSyncStatus(): ProjectSyncStatus {
  return { ...engine.status, pending: engine.queue.length, pendingDeletes: engine.delQueue.length };
}

export function subscribeProjectSync(l: (s: ProjectSyncStatus) => void): () => void {
  engine.listeners.add(l);
  l(getProjectSyncStatus());
  return () => { engine.listeners.delete(l); };
}

// --- correspondances pures -----------------------------------------------------

export function projectToSyncItem(p: Project, fallbackNow: string): ProjectSyncItemShape {
  const payload: Record<string, unknown> = {};
  for (const k of CHAMPS_SYNC) payload[k] = p[k as keyof Project];
  return {
    id: p.id,
    name: p.name,
    payload,
    updated_at: p.updatedAt ?? fallbackNow, // legacy : 1re synchro fait foi (dit)
  };
}

export function remoteToProject(r: ProjectRemote): Project {
  const p = r.payload as Partial<Project>;
  return {
    id: r.id,
    name: r.name,
    code: p.code ?? "",
    type: p.type ?? "",
    location: p.location ?? "",
    client: p.client ?? "",
    clientStreet: typeof p.clientStreet === "string" ? p.clientStreet : "",
    clientZip: typeof p.clientZip === "string" ? p.clientZip : "",
    clientCity: typeof p.clientCity === "string" ? p.clientCity : "",
    clientLeitweg: typeof p.clientLeitweg === "string" ? p.clientLeitweg : "",
    // projet d'avant §118 sans statut dans la charge : « planning », le
    // même repli que projectStatusMeta (jamais de valeur hors union).
    status: (p.status as Project["status"]) ?? "planning",
    progress: p.progress ?? 0,
    budget: p.budget ?? 0,
    spent: p.spent ?? 0,
    grossFloorArea: p.grossFloorArea ?? 0,
    floors: p.floors ?? 0,
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    team: Array.isArray(p.team) ? p.team : [],
    classificationCode: p.classificationCode ?? "",
    carbonBudgetKg: p.carbonBudgetKg ?? 0,
    health: p.health ?? 0,
    riskScore: p.riskScore ?? 0,
    accent: p.accent ?? "",
    updatedAt: r.updated_at,
  };
}

// --- marquage (appelé par le slice) --------------------------------------------

export function markProjectDirty(id: string): void {
  engine.delQueue = engine.delQueue.filter((x) => x !== id); // re-création après suppression
  if (!engine.queue.includes(id)) engine.queue.push(id);
  writeIds(QUEUE_KEY, engine.queue);
  writeIds(DEL_KEY, engine.delQueue);
  emit({});
  planifie();
}

export function markProjectDeleted(id: string): void {
  engine.queue = engine.queue.filter((x) => x !== id); // plus rien à pousser d'un disparu
  if (!engine.delQueue.includes(id)) engine.delQueue.push(id);
  writeIds(QUEUE_KEY, engine.queue);
  writeIds(DEL_KEY, engine.delQueue);
  emit({});
  planifie();
}

function planifie(): void {
  if (!engine.deps) return;
  if (engine.debounceHandle) clearTimeout(engine.debounceHandle);
  engine.debounceHandle = setTimeout(() => { void pushProjects(); }, engine.debounceMs);
}

// --- poussée --------------------------------------------------------------------

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export async function pushProjects(now: string = new Date().toISOString()): Promise<number> {
  if (!engine.deps || engine.pushing) return 0;
  if (engine.queue.length === 0 && engine.delQueue.length === 0) return 0;
  if (!isOnline()) {
    emit({ phase: "offline", lastError: null });
    return 0;
  }
  engine.pushing = true;
  let faits = 0;
  try {
    const { deps } = engine;

    // Suppressions d'abord : la tombe doit exister avant toute réapparition.
    const delRestants: string[] = [];
    for (const id of engine.delQueue) {
      const res = await secureFetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok || res.status === 404) faits += 1; // 404 = déjà parti : atteint
      else if (res.status >= 500) delRestants.push(id);
      // 4xx autre : impossible côté client → on abandonne honnêtement ce DELETE
    }
    engine.delQueue = delRestants;
    writeIds(DEL_KEY, engine.delQueue);

    if (engine.queue.length > 0) {
      const parId = new Map(deps.loadProjects().map((p) => [p.id, p]));
      const items: ProjectSyncItemShape[] = [];
      const restants: string[] = [];
      for (const id of engine.queue) {
        const p = parId.get(id);
        if (!p) continue; // disparu localement entre-temps (tombstone tirée)
        items.push(projectToSyncItem(p, now));
      }
      if (items.length > 0) {
        const res = await secureFetch(`${API}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { results: Array<{ id: string; applied: boolean }> };
        const resolus = new Set(body.results.filter((r) => r.applied).map((r) => r.id));
        for (const d of body.results.filter((r) => !r.applied)) {
          const rep = await secureFetch(`${API}/${encodeURIComponent(d.id)}`);
          if (rep.ok) {
            applyRemote((await rep.json()) as ProjectRemote);
            resolus.add(d.id);
          } // GET en panne → reste en file, honnête
        }
        for (const id of engine.queue) if (!resolus.has(id)) restants.push(id);
        faits += resolus.size;
      }
      engine.queue = restants;
      writeIds(QUEUE_KEY, engine.queue);
    }
    emit({ phase: "sync", lastError: null });
    return faits;
  } catch (e) {
    emit({ phase: "erreur", lastError: e instanceof Error ? e.message : String(e) });
    return faits;
  } finally {
    engine.pushing = false;
  }
}

// --- tirage ---------------------------------------------------------------------

function applyRemote(remote: ProjectRemote): void {
  if (!engine.deps) return;
  const local = engine.deps.loadProjects().find((p) => p.id === remote.id);
  const localMs = toMs(local?.updatedAt);
  const remoteMs = toMs(remote.updated_at);

  if (remote.deleted_at) {
    if (local && localMs > remoteMs) {
      markProjectDirty(remote.id); // écrit locale plus récente → résurrection au push
      return;
    }
    if (local) engine.deps.removeProjects([remote.id]);
    return;
  }
  if (local && localMs >= remoteMs) return; // égalité = local gardé (anti flip-flop)
  engine.deps.upsertProjects([remoteToProject(remote)]);
}

export async function pullProjects(): Promise<number> {
  if (!engine.deps || engine.pulling) return 0;
  if (!isOnline()) {
    emit({ phase: "offline", lastError: null });
    return 0;
  }
  engine.pulling = true;
  let appliques = 0;
  try {
    const st = storage();
    const since = st ? st.getItem(CURSOR_KEY) : null;
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    params.set("limit", "500");
    const res = await secureFetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      projects: ProjectRemote[];
      server_time: string;
      truncated: boolean;
    };
    const avant = engine.deps.loadProjects().length;
    for (const remote of body.projects) applyRemote(remote);
    appliques = engine.deps.loadProjects().length - avant;
    const dernier = body.projects[body.projects.length - 1];
    const curseur = body.truncated && dernier ? dernier.updated_at : body.server_time;
    if (st) {
      try { st.setItem(CURSOR_KEY, curseur); } catch { /* mémoire */ }
    }
    // §121 — les Mängel garés faute de projet trouvent peut-être le leur
    // dans CE tirage : on les rejoue tout de suite (copie mémoire, sans
    // réseau). Déclenché même à `appliques === 0` : un projet tombé puis
    // ressuscité, ou déjà présent, débloque tout autant.
    retryParkedIssues();
    emit({ phase: "sync", lastSyncAt: body.server_time, lastError: null });
    return appliques;
  } catch (e) {
    emit({ phase: "erreur", lastError: e instanceof Error ? e.message : String(e) });
    return 0;
  } finally {
    engine.pulling = false;
  }
}

export async function syncProjectsOnce(): Promise<void> {
  await pushProjects();
  await pullProjects();
}

// --- démarrage (attaché par le shell) --------------------------------------------

export function attachProjectSync(
  deps: ProjectSyncDeps,
  opts: { debounceMs?: number } = {},
): void {
  engine.deps = deps;
  engine.debounceMs = opts.debounceMs ?? engine.debounceMs;
  engine.queue = readIds(QUEUE_KEY);
  engine.delQueue = readIds(DEL_KEY);
  emit({});
}

/** Réinitialisation COMPLÈTE — réservée aux tests. */
export function _resetProjectSyncForTests(): void {
  engine.deps = null;
  engine.queue = [];
  engine.delQueue = [];
  engine.listeners.clear();
  engine.pushing = false;
  engine.pulling = false;
  if (engine.debounceHandle) { clearTimeout(engine.debounceHandle); engine.debounceHandle = null; }
  engine.status = { phase: "jamais", pending: 0, pendingDeletes: 0, lastSyncAt: null, lastError: null };
  const st = storage();
  if (st) {
    try {
      st.removeItem(QUEUE_KEY); st.removeItem(DEL_KEY); st.removeItem(CURSOR_KEY);
    } catch { /* rien */ }
  }
}
