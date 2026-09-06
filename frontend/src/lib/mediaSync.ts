/**
 * §118 — Synchro des FICHIERS photo/vidéo (étape 3, plainte client :
 * « la synchronisation de photos et vidéos ne fonctionne pas »).
 *
 * Ce qui change : chaque média importé est ENFILÉ pour versement serveur
 * (`POST /api/v5/media/{id}`, octets magiques vérifiés côté serveur) ;
 * à l'AFFICHAGE, une photo absente de l'appareil est d'abord demandée au
 * serveur (`pull-through`) avant d'annoncer « pas sur cet appareil ».
 *
 * Lois :
 *  - file de versement PERSISTANTE (localStorage) : hors-ligne, ça suit
 *    tout seul au retour du réseau, même après fermeture du navigateur ;
 *  - refus DÉFINITIF du serveur (4xx : type/taille/id) → sortie de file,
 *    liste « refusés » tenue et DITE (raison) — jamais de boucle muette ;
 *  - le téléchargement est à la demande (pas de fond de téléchargement
 *    surprise sur votre forfait téléphone : dit, choisi) ;
 *  - 404 côté serveur = vrai « n'existe nulle part » : mémoire de session
 *    pour ne pas redemander le même id à l'infini ;
 *  - moteur injecté (pas d'import du store ni de mangelPhotos : DI).
 */

import { secureFetch } from "@/auth/SecuritySanitizer";

const API = "/api/v5/media";
const QUEUE_KEY = "narchi:media:upload-queue";
const FAILED_KEY = "narchi:media:failed";

export interface MediaSyncDeps {
  getBlob: (id: string) => Promise<Blob | null>;
  putBlob: (id: string, blob: Blob) => Promise<void>;
}

export interface MediaFailure { id: string; reason: string }

export interface MediaSyncStatus {
  pendingUploads: number;
  failedUploads: number;
  uploading: boolean;
  lastError: string | null;
}

interface EngineState {
  deps: MediaSyncDeps | null;
  queue: string[];
  failed: MediaFailure[];
  listeners: Set<(s: MediaSyncStatus) => void>;
  uploading: boolean;
  lastError: string | null;
  missing404: Set<string>;   // mémoire de session (pas persistée)
}

const engine: EngineState = {
  deps: null,
  queue: [],
  failed: [],
  listeners: new Set(),
  uploading: false,
  lastError: null,
  missing404: new Set(),
};

function storage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function readJson<T>(key: string, def: T): T {
  const st = storage();
  if (!st) return def;
  try {
    const brut = st.getItem(key);
    return brut ? (JSON.parse(brut) as T) : def;
  } catch { return def; }
}
function writeJson(key: string, v: unknown): void {
  const st = storage();
  if (!st) return;
  try { st.setItem(key, JSON.stringify(v)); } catch { /* mémoire seule */ }
}

function emit(): void {
  const s = getMediaSyncStatus();
  for (const l of engine.listeners) l(s);
}

export function getMediaSyncStatus(): MediaSyncStatus {
  return {
    pendingUploads: engine.queue.length,
    failedUploads: engine.failed.length,
    uploading: engine.uploading,
    lastError: engine.lastError,
  };
}

export function subscribeMediaSync(l: (s: MediaSyncStatus) => void): () => void {
  engine.listeners.add(l);
  l(getMediaSyncStatus());
  return () => { engine.listeners.delete(l); };
}

export function getMediaFailures(): MediaFailure[] {
  return [...engine.failed];
}

/** Branche les dépendances et recharge files persistentes (shell). */
export function attachMediaSync(deps: MediaSyncDeps): void {
  engine.deps = deps;
  engine.queue = readJson<string[]>(QUEUE_KEY, []);
  engine.failed = readJson<MediaFailure[]>(FAILED_KEY, []);
  emit();
}

/** Un fichier local vient d'être écrit (mangelPhotos) : il part en file. */
export function markMediaForUpload(id: string): void {
  if (!engine.queue.includes(id)) engine.queue.push(id);
  writeJson(QUEUE_KEY, engine.queue);
  emit();
  if (engine.deps) void uploadPendingMedia();
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export async function uploadPendingMedia(): Promise<number> {
  if (!engine.deps || engine.uploading || engine.queue.length === 0) return 0;
  if (!isOnline()) {
    engine.lastError = null;
    emit();
    return 0;
  }
  engine.uploading = true;
  let verses = 0;
  try {
    // Copie défensive : markMediaForUpload peut re-mplir pendant l'attente.
    let id: string | undefined;
    while ((id = engine.queue[0]) !== undefined) {
      const blob = await engine.deps.getBlob(id);
      if (!blob) {
        // Disparu de l'appareil entre-temps : rien à verser, on le dit
        // dans la liste des échecs plutôt qu'un trou silencieux.
        engine.queue.shift();
        engine.failed.push({ id, reason: "Datei lokal nicht (mehr) vorhanden" });
        writeJson(QUEUE_KEY, engine.queue);
        writeJson(FAILED_KEY, engine.failed);
        emit();
        continue;
      }
      const forme = new FormData();
      forme.append("file", blob, id);
      const res = await secureFetch(`${API}/${encodeURIComponent(id)}`, {
        method: "POST",
        body: forme,
      });
      if (res.ok) {
        engine.queue.shift();
        engine.missing404.delete(id);
        verses += 1;
        writeJson(QUEUE_KEY, engine.queue);
        emit();
        continue;
      }
      if (res.status >= 400 && res.status < 500) {
        // Refus DÉFINITIF (type/taille/id) : sorti de file, gardé à vue.
        let raison = `HTTP ${res.status}`;
        try {
          const corps = await res.json();
          if (typeof corps?.detail === "string") raison = corps.detail;
        } catch { /* statut seul */ }
        engine.queue.shift();
        engine.failed.push({ id, reason: raison });
        writeJson(QUEUE_KEY, engine.queue);
        writeJson(FAILED_KEY, engine.failed);
        emit();
        continue;
      }
      // 5xx / réseau : réessayable — on arrête proprement, file intacte.
      throw new Error(`HTTP ${res.status}`);
    }
    engine.lastError = null;
    emit();
    return verses;
  } catch (e) {
    engine.lastError = e instanceof Error ? e.message : String(e);
    emit();
    return verses;
  } finally {
    engine.uploading = false;
  }
}

/**
 * Pull-through : le local d'abord, le serveur ensuite ; null = n'existe
 * NULLE part (ou moteur non branché) — jamais d'exception vers l'UI.
 * Utilisé par mangelPhotos.loadMangelPhoto : une photo importée sur le
 * téléphone s'affiche au bureau sans geste.
 */
export async function tryFetchMediaFromServer(id: string): Promise<Blob | null> {
  if (!engine.deps || engine.missing404.has(id)) return null;
  if (!isOnline()) return null;
  try {
    const res = await secureFetch(`${API}/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      engine.missing404.add(id);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("Content-Type") ?? "application/octet-stream";
    const blob = new Blob([await res.arrayBuffer()], { type });
    await engine.deps.putBlob(id, blob);
    return blob;
  } catch (e) {
    engine.lastError = e instanceof Error ? e.message : String(e);
    emit();
    return null;
  }
}

/** Réinitialisation COMPLÈTE — réservée aux tests. */
export function _resetMediaSyncForTests(): void {
  engine.deps = null;
  engine.queue = [];
  engine.failed = [];
  engine.listeners.clear();
  engine.uploading = false;
  engine.lastError = null;
  engine.missing404 = new Set();
  const st = storage();
  if (st) {
    try { st.removeItem(QUEUE_KEY); st.removeItem(FAILED_KEY); } catch { /* rien */ }
  }
}
