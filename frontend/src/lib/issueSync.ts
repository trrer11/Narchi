/**
 * §117 — Moteur de synchro des Mängel (étape 2 de la synchro inter-appareils).
 *
 * Branche l'IndexedDB de cet appareil sur la VÉRITÉ PARTAGÉE du serveur
 * §115 (`/api/v5/issues`). Règles du jeu, TOUTES dites :
 *
 *  1. DERNIER-ÉCRIVAIN-GAGNE sur l'horodatage porté PAR L'APPAREIL
 *     (updated_at). Une horloge déréglée fait gagner son tort — limite
 *     documentée §115, pas de fusion « intelligente » opaque.
 *  2. File de poussée PERSISTANTE (localStorage) : un Mangel noté au
 *     sous-sol sans réseau part dès que le réseau revient, même après
 *     fermeture du navigateur.
 *  3. Tombe de pierre : une suppression faite ailleurs RETIRE le Mangel
 *     ici — sauf si cet appareil a une écriture PLUS RÉCENTE : alors la
 *     ligne « revit » côté serveur (résurrection §117, testée backend).
 *  4. Jamais de boucle : les écritures venant DU serveur passent par
 *     upsertIssues/removeIssues (actions dédiées) qui NE remettent PAS
 *     en file de poussée.
 *  5. Le curseur vient DU SERVEUR (server_time). Si une page de delta est
 *     tronquée, le curseur s'arrête AU DERNIER ÉLÉMENT REÇU et on repart
 *     de là — jamais de trou de lecture masqué.
 *  6. Projet inconnu sur cet appareil → Mangel « garé », compté et DIT
 *     dans le badge (masquer serait mentir). §121 — LOI DU CURSEUR HONNÊTE
 *     (course réelle trouvée par la suite E2E navigateur : le tirage des
 *     Mängel peut battre celui des Projets de quelques millisecondes au
 *     premier démarrage d'un appareil) : tant qu'un enregistrement du
 *     tirage est garé, le curseur NE BOUGE PAS — rien n'est affirmé reçu
 *     qui ne l'est pas. Le serveur redonne donc les garés au prochain
 *     cycle (delta strict updated_at > since), ET une copie mémoire est
 *     rejouée INSTANTANÉMENT dès que le miroir Projets §118 livre le
 *     projet manquant (retryParkedIssues). Un garé « éternel » (projet
 *     supprimé partout) reste compté et dit dans le badge — jamais fondu.
 *  7. Photos/vidéos : seuls les IDENTIFIANTS voyagent (étape 3 = blobs).
 *
 * Le moteur ne connaît PAS le store : tout passe par injection (deps),
 * ce qui le teste seul et interdit toute dépendance circulaire.
 */

import { secureFetch } from "@/auth/SecuritySanitizer";
import type { Issue, Project } from "@/data/types";
import { daysSinceProjectStart } from "@/lib/chantier";

const API = "/api/v5/issues";
const QUEUE_KEY = "narchi:issues:sync-queue";
const CURSOR_KEY = "narchi:issues:sync-cursor";

// --- Types miroirs du contrat serveur §115/§117 ------------------------------

export interface IssueSyncItem {
  id: string;
  project_id: string;
  day: string;
  title: string;
  description: string;
  zone: string;
  severity: "minor" | "major" | "critical";
  status: "open" | "in-review" | "resolved";
  photo_ids: string[];
  video_ids: string[];
  updated_at: string;
}

export interface IssueRemote extends IssueSyncItem {
  created_by: string;
  created_at: string | null;
  deleted_at: string | null;
}

interface BatchVerdict { id: string; applied: boolean; server_updated_at: string }

interface ListResponse {
  issues: IssueRemote[];
  server_time: string;
  truncated: boolean;
}

// --- État observable (badge) -------------------------------------------------

export type IssueSyncPhase = "jamais" | "sync" | "offline" | "erreur";

export interface IssueSyncStatus {
  phase: IssueSyncPhase;
  /** Poussées locales en attente (file persistée). */
  pending: number;
  /** Mängel venus du serveur dont le PROJET est inconnu ici — dits, pas cachés. */
  parked: number;
  /** server_time du dernier delta réussi (horloge DU SERVEUR). */
  lastSyncAt: string | null;
  /** Dernier message d'erreur nu ; null si tout va bien. */
  lastError: string | null;
}

export interface IssueSyncDeps {
  loadIssues: () => Issue[];
  loadProjects: () => Pick<Project, "id" | "startDate">[];
  upsertLocal: (issues: Issue[]) => void;
  removeLocal: (ids: string[]) => void;
}

interface EngineState {
  deps: IssueSyncDeps | null;
  queue: string[];             // ids locaux à pousser (persistés)
  parkedIds: string[];         // ids serveur non appliquables (projet absent)
  /** §121 — copie MÉMOIRE des enregistrements garés : sans elle, un garé
   *  n'était rejoué que si le serveur le RENVOYAIT — ce que le delta strict
   *  ne refait jamais une fois le curseur passé (Mangel invisible à vie sur
   *  l'appareil — course réelle du premier démarrage, trouvée par l'E2E). */
  parkedRecords: Map<string, IssueRemote>;
  status: IssueSyncStatus;
  listeners: Set<(s: IssueSyncStatus) => void>;
  intervalHandle: ReturnType<typeof setInterval> | null;
  onlineListener: (() => void) | null;
  debounceHandle: ReturnType<typeof setTimeout> | null;
  pushing: boolean;
  pulling: boolean;
  intervalMs: number;
  debounceMs: number;
}

const engine: EngineState = {
  deps: null,
  queue: [],
  parkedIds: [],
  parkedRecords: new Map(),
  status: { phase: "jamais", pending: 0, parked: 0, lastSyncAt: null, lastError: null },
  listeners: new Set(),
  intervalHandle: null,
  onlineListener: null,
  debounceHandle: null,
  pushing: false,
  pulling: false,
  intervalMs: 45_000,
  debounceMs: 800,
};

// --- Persistance file/curseur (localStorage, try/catch — jamais de crash) ----

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function saveQueue(): void {
  const st = storage();
  if (!st) return;
  try { st.setItem(QUEUE_KEY, JSON.stringify(engine.queue)); } catch { /* plein : on vit avec la mémoire */ }
}

function saveCursor(cursor: string): void {
  const st = storage();
  if (!st) return;
  try { st.setItem(CURSOR_KEY, cursor); } catch { /* idem */ }
}

function loadCursor(): string | null {
  const st = storage();
  if (!st) return null;
  try { return st.getItem(CURSOR_KEY); } catch { return null; }
}

function loadQueue(): string[] {
  const st = storage();
  if (!st) return [];
  try {
    const brut = st.getItem(QUEUE_KEY);
    if (!brut) return [];
    const p = JSON.parse(brut) as unknown;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// --- État observable ----------------------------------------------------------

function emit(patch: Partial<IssueSyncStatus>): void {
  engine.status = {
    ...engine.status,
    ...patch,
    pending: engine.queue.length,
    parked: engine.parkedIds.length,
  };
  for (const l of engine.listeners) l(engine.status);
}

export function getIssueSyncStatus(): IssueSyncStatus {
  return {
    ...engine.status,
    pending: engine.queue.length,
    parked: engine.parkedIds.length,
  };
}

export function subscribeIssueSync(l: (s: IssueSyncStatus) => void): () => void {
  engine.listeners.add(l);
  l(getIssueSyncStatus());
  return () => { engine.listeners.delete(l); };
}

// --- Correspondances (pures, exportées pour tests) ----------------------------

export interface SkipResult { skip: string }
export type MappingLocal = { item: IssueSyncItem } | SkipResult;

/**
 * Issue locale → item serveur. Jamais de champ inventé : si le « day »
 * n'est pas collé au Mangel (visitDate §107), il est RECOMPOSÉ depuis
 * project.startDate + raisedDay (la même information, autre forme) ;
 * projet introuvable → refus explicite (skip), jamais de date du jour
 * silencieuse.
 */
export function issueToSyncItem(
  issue: Issue,
  projects: Pick<Project, "id" | "startDate">[],
  fallbackNow: string,
): MappingLocal {
  let day = issue.visitDate;
  if (!day) {
    const project = projects.find((p) => p.id === issue.projectId);
    if (!project || !project.startDate) {
      return { skip: `projet ${issue.projectId} introuvable — jour non déductible` };
    }
    const base = new Date(project.startDate).getTime();
    if (Number.isNaN(base)) return { skip: "startDate de projet illisible" };
    day = new Date(base + Math.max(0, issue.raisedDay) * 86_400_000).toISOString().slice(0, 10);
  }
  return {
    item: {
      id: issue.id,
      project_id: issue.projectId,
      day,
      title: issue.title,
      description: issue.description ?? "",
      zone: issue.level ?? "",
      severity: issue.severity,
      status: issue.status,
      photo_ids: issue.photoIds ?? [],
      video_ids: issue.videoIds ?? [],
      // updatedAt absent (données d'avant §117) : cet appareil n'a jamais
      // poussé ce Mangel → la date de PREMIÈRE synchro fait foi (dit §117).
      updated_at: issue.updatedAt ?? fallbackNow,
    },
  };
}

/**
 * Item serveur → Issue locale, ou null quand le PROJET est inconnu sur
 * cet appareil (le Mangel est « garé », compté — jamais fondu dans un
 * autre projet ni inventé). assignee = provenance dite.
 */
export function remoteToIssue(
  remote: IssueRemote,
  projects: Pick<Project, "id" | "startDate">[],
): Issue | null {
  const project = projects.find((p) => p.id === remote.project_id);
  if (!project) return null;
  const issue: Issue = {
    id: remote.id,
    title: remote.title,
    description: remote.description,
    level: remote.zone || "",
    classificationCode: "",
    severity: remote.severity,
    status: remote.status,
    assignee: remote.created_by ? `Sync · ${remote.created_by}` : "Sync",
    raisedDay: daysSinceProjectStart(project.startDate, new Date(`${remote.day}T00:00:00`)),
    projectId: remote.project_id,
    visitDate: remote.day,
    updatedAt: remote.updated_at,
  };
  if (remote.photo_ids.length > 0) issue.photoIds = remote.photo_ids;
  if (remote.video_ids.length > 0) issue.videoIds = remote.video_ids;
  return issue;
}

// --- Marquage (appelé par les actions du store) --------------------------------

/** Une écriture LOCALE vient d'arriver : elle rejoint la file persistante,
 *  puis une poussée est programmée (débouncée — une rafale de statuts =
 *  UNE requête). */
export function markIssueDirty(id: string): void {
  if (!engine.queue.includes(id)) {
    engine.queue.push(id);
    saveQueue();
  }
  emit({});
  if (engine.deps) {
    if (engine.debounceHandle) clearTimeout(engine.debounceHandle);
    engine.debounceHandle = setTimeout(() => { void pushIssues(); }, engine.debounceMs);
  }
}

// --- Poussée --------------------------------------------------------------------

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export async function pushIssues(now: string = new Date().toISOString()): Promise<number> {
  if (!engine.deps || engine.pushing || engine.queue.length === 0) return 0;
  if (!isOnline()) {
    emit({ phase: "offline", lastError: null });
    return 0;
  }
  engine.pushing = true;
  let pousses = 0;
  try {
    const { deps } = engine;
    const parId = new Map(deps.loadIssues().map((i) => [i.id, i]));
    const projects = deps.loadProjects();
    const items: IssueSyncItem[] = [];
    const restants: string[] = [];
    for (const id of engine.queue) {
      const issue = parId.get(id);
      if (!issue) continue; // disparu localement (tombstone venue du serveur)
      const map = issueToSyncItem(issue, projects, now);
      if ("item" in map) items.push(map.item);
      else restants.push(id); // non synchronisable — reste en file, DIT (pending)
    }
    if (items.length === 0) {
      engine.queue = restants;
      saveQueue();
      emit({});
      return 0;
    }
    const res = await secureFetch(`${API}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { results: BatchVerdict[] };
    const acceptes = new Set(body.results.filter((r) => r.applied).map((r) => r.id));
    const declines = body.results.filter((r) => !r.applied);
    const resolus = new Set(acceptes);
    // Le serveur garde une version plus récente : on récupère LA SÛRETÉ
    // (GET par id) — le delta seul pourrait la manquer (curseur > maj).
    // Un décliné RÉCUPÉRÉ sort de la file (résolu : version serveur
    // appliquée) — sinon il repartirait à chaque cycle = rebouclage sans
    // fin, attrapé par le test « poussée déclinée ».
    for (const d of declines) {
      const rep = await secureFetch(`${API}/${encodeURIComponent(d.id)}`);
      if (rep.ok) {
        const remote = (await rep.json()) as IssueRemote;
        applyRemote(remote, projects);
        resolus.add(d.id);
      } // GET en panne : il RESTE en file — honnête, réessayé au prochain cycle
    }
    engine.queue = engine.queue.filter((id) => !resolus.has(id));
    saveQueue();
    pousses = acceptes.size;
    emit({ phase: "sync", lastError: null });
    return pousses;
  } catch (e) {
    emit({ phase: "erreur", lastError: e instanceof Error ? e.message : String(e) });
    return 0;
  } finally {
    engine.pushing = false;
  }
}

// --- Tirage ---------------------------------------------------------------------

/** Horodatages ISO → ms. Date.parse, JAMAIS de comparaison lexicale :
 * « .000Z » vs « +00:00 » trient différemment pour le MÊME instant.
 * NaN (valeur illisible/absente) = -∞ : la version connue gagne toujours.
 * (Exporté §118 : le miroir Projets applique exactement cette règle.) */
export function toMs(iso: string | undefined | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Verdict interne d'application — §121 : le tirage doit SAVOIR qu'un
 *  enregistrement vient d'être garé pour geler le curseur. */
type ApplyVerdict = "applique" | "gare" | "garde" | "supprime" | "ignore";

/** Applique UN enregistrement serveur (delta ou rattrapage) avec LWW. */
function applyRemote(
  remote: IssueRemote,
  projects: Pick<Project, "id" | "startDate">[],
): ApplyVerdict {
  if (!engine.deps) return "ignore";
  const local = engine.deps.loadIssues().find((i) => i.id === remote.id);
  const localMs = toMs(local?.updatedAt);
  const remoteMs = toMs(remote.updated_at);

  if (remote.deleted_at) {
    // Une tombe DÉGARE proprement : la suppression prime côté serveur.
    engine.parkedIds = engine.parkedIds.filter((id) => id !== remote.id);
    engine.parkedRecords.delete(remote.id);
    if (local && localMs > remoteMs) {
      // Écrit locale PLUS RÉCENTE que la suppression : la ligne doit
      // revivre côté serveur à la prochaine poussée (résurrection §117).
      markIssueDirty(remote.id);
      return "garde";
    }
    if (local) engine.deps.removeLocal([remote.id]);
    return "supprime";
  }

  if (local && localMs >= remoteMs) return "ignore"; // local à jour (égalité = gardé, anti flip-flop)

  const issue = remoteToIssue(remote, projects);
  if (!issue) {
    if (!engine.parkedIds.includes(remote.id)) engine.parkedIds.push(remote.id);
    engine.parkedRecords.set(remote.id, remote); // §121 — copie gardée
    return "gare";
  }
  engine.parkedIds = engine.parkedIds.filter((id) => id !== remote.id);
  engine.parkedRecords.delete(remote.id);
  engine.deps.upsertLocal([issue]);
  return "applique";
}

/**
 * §121 — Rejoue les Mängel garés contre les projets ACTUELS (copie mémoire,
 * zéro réseau). Appelé par le miroir Projets §118 juste après un tirage qui
 * applique des projets : la course « Mangel tiré avant son projet » se
 * résout à la milliseconde près, sans attendre le cycle de 45 s.
 * Retourne combien de garés ont trouvé leur projet.
 */
export function retryParkedIssues(): number {
  if (!engine.deps || engine.parkedIds.length === 0) return 0;
  const projects = engine.deps.loadProjects();
  let resolus = 0;
  for (const id of [...engine.parkedIds]) {
    const copie = engine.parkedRecords.get(id);
    if (!copie) {
      // Garé sans copie (ne devrait pas exister) : on l'avoue en le
      // retirant du compteur plutôt que de le faire taire à vie.
      engine.parkedIds = engine.parkedIds.filter((x) => x !== id);
      continue;
    }
    if (applyRemote(copie, projects) === "applique") resolus += 1;
  }
  emit({});
  return resolus;
}

export async function pullIssues(): Promise<number> {
  if (!engine.deps || engine.pulling) return 0;
  if (!isOnline()) {
    emit({ phase: "offline", lastError: null });
    return 0;
  }
  engine.pulling = true;
  let appliques = 0;
  try {
    const { deps } = engine;
    const since = loadCursor();
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    params.set("limit", "500");
    const res = await secureFetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as ListResponse;
    const projects = deps.loadProjects();
    let garesCeTirage = 0;
    for (const remote of body.issues) {
      const avant = deps.loadIssues().length + engine.parkedIds.length;
      if (applyRemote(remote, projects) === "gare") garesCeTirage += 1;
      const apres = deps.loadIssues().length + engine.parkedIds.length;
      if (apres !== avant || remote.deleted_at) appliques += 1;
    }
    // §121 — LOI DU CURSEUR HONNÊTE : tant qu'un enregistrement de CE
    // tirage vient d'être garé, le curseur NE BOUGE PAS (rien n'est affirmé
    // reçu qui ne l'est pas). Le delta serveur étant strict (updated_at >
    // since), le prochain cycle REDONNE les garés — guérison certaine,
    // y compris après fermeture du navigateur (curseur persisté).
    if (garesCeTirage === 0) {
      // Curseur : server_time SI la page est complète ; sinon le DERNIER
      // élément reçu (sinon on sauterait les non-lus — trou masqué interdit).
      const dernier = body.issues[body.issues.length - 1];
      const curseur = body.truncated && dernier ? dernier.updated_at : body.server_time;
      saveCursor(curseur);
    }
    emit({ phase: "sync", lastSyncAt: body.server_time, lastError: null });
    return appliques;
  } catch (e) {
    emit({ phase: "erreur", lastError: e instanceof Error ? e.message : String(e) });
    return 0;
  } finally {
    engine.pulling = false;
  }
}

/** Cycle complet : on pousse ce qu'on a écrit, puis on tire ce que les
 *  autres ont écrit (dans CET ordre — sinon un appareil frais repousserait
 *  sur des données qu'il n'a pas encore). */
export async function syncIssuesOnce(): Promise<void> {
  await pushIssues();
  await pullIssues();
}

// --- Démarrage/arrêt ------------------------------------------------------------

/** Branche les dépendances et recharge la file SANS lancer de cycle.
 *  (startIssueSync = attach + cycle ; attach seul sert aux tests et au
 *  démarrage différé — l'API ne cache pas ce que fait le produit.) */
export function attachIssueSync(
  deps: IssueSyncDeps,
  opts: { intervalMs?: number; debounceMs?: number } = {},
): void {
  stopIssueSync();
  engine.deps = deps;
  engine.intervalMs = opts.intervalMs ?? engine.intervalMs;
  engine.debounceMs = opts.debounceMs ?? engine.debounceMs;
  engine.queue = loadQueue();
  emit({});
}

/** Idempotent : un second start remplace proprement le premier. */
export function startIssueSync(
  deps: IssueSyncDeps,
  opts: { intervalMs?: number; debounceMs?: number } = {},
): () => void {
  attachIssueSync(deps, opts);

  void syncIssuesOnce();
  engine.intervalHandle = setInterval(() => { void pullIssues(); }, engine.intervalMs);
  const online = () => { void syncIssuesOnce(); };
  if (typeof window !== "undefined") {
    window.addEventListener("online", online);
    engine.onlineListener = online;
  }
  return stopIssueSync;
}

export function stopIssueSync(): void {
  if (engine.intervalHandle) {
    clearInterval(engine.intervalHandle);
    engine.intervalHandle = null;
  }
  if (engine.debounceHandle) {
    clearTimeout(engine.debounceHandle);
    engine.debounceHandle = null;
  }
  if (engine.onlineListener && typeof window !== "undefined") {
    window.removeEventListener("online", engine.onlineListener);
    engine.onlineListener = null;
  }
  engine.deps = null;
}

/** Réinitialisation COMPLÈTE — réservée aux tests (file rechargée disque). */
export function _resetIssueSyncForTests(): void {
  stopIssueSync();
  engine.queue = [];
  engine.parkedIds = [];
  engine.parkedRecords.clear();
  engine.listeners.clear();
  engine.pushing = false;
  engine.pulling = false;
  engine.status = { phase: "jamais", pending: 0, parked: 0, lastSyncAt: null, lastError: null };
  const st = storage();
  if (st) {
    try { st.removeItem(QUEUE_KEY); st.removeItem(CURSOR_KEY); } catch { /* rien */ }
  }
}
