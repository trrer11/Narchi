/**
 * §102 — Photos de Mängel (Baustelle) : BLOBS dans IndexedDB, CLÉS dans le
 * store persisté.
 *
 * Pourquoi séparé : un zustand persisté en JSON sérialiserait chaque photo
 * en base64 (~+33 % par cliché) et gonflerait la persistance principale
 * jusqu'à saturer le quota — la règle est donc : gros binaires en IDB,
 * références textuelles dans le store.
 *
 * Sans IndexedDB (tests jsdom, vieux navigateur) : repli MÉMOIRE honnête —
 * les photos vivent alors le temps de la session, et `supportsIdb()` permet
 * à l'écran de le dire.
 *
 * §118 — étape 3 : save() enfile désormais le VERSEMENT serveur (file
 * persistante), load() tente le serveur sur manque local (pull-through) ;
 * la variante « Silent » n'enfile rien (elle sert au moteur lui-même,
 * sinon chaque téléchargement re-partirait en upload — boucle interdite).
 */
import {
  markMediaForUpload,
  tryFetchMediaFromServer,
} from "@/lib/mediaSync";

const DB_NAME = "narchi_baustelle_photos";
const DB_VERSION = 1;
const STORE = "photos";

const memoryFallback = new Map<string, Blob>();

export function supportsIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolvePromise, rejectPromise) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolvePromise(request.result);
      request.onerror = () => rejectPromise(request.error);
    });
  } finally {
    db.close();
  }
}

/** Faux quand la sauvegarde est impossible (l'écran le dit, ne tait rien). */
export async function saveMangelPhoto(id: string, blob: Blob): Promise<boolean> {
  const ok = await saveMangelPhotoSilent(id, blob);
  if (ok) {
    // §118 — écriture locale réussie ⇒ versement serveur en file (étape 3 ;
    // hors-ligne = file conservée, dit par le badge).
    markMediaForUpload(id);
  }
  return ok;
}

/** Écriture locale SANS marquage de versement — réservée au moteur
 * §118 (sinon chaque téléchargement repartirait en upload : boucle). */
export async function saveMangelPhotoSilent(id: string, blob: Blob): Promise<boolean> {
  try {
    if (!supportsIdb()) {
      memoryFallback.set(id, blob);
    } else {
      await withStore("readwrite", (store) => store.put(blob, id));
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadMangelPhoto(id: string): Promise<Blob | null> {
  const local = await loadMangelPhotoLocalOnly(id);
  if (local) return local;
  // §118 — pull-through : une photo importée sur un autre appareil est
  // d'abord demandée au serveur avant d'annoncer « pas ici ».
  return tryFetchMediaFromServer(id);
}

/** Lecture locale pure (utilisée aussi par le moteur de versement :
 * jamais de boucle load→serveur→putBlob→load). */
export async function loadMangelPhotoLocalOnly(id: string): Promise<Blob | null> {
  try {
    if (!supportsIdb()) return memoryFallback.get(id) ?? null;
    const result = await withStore("readonly", (store) => store.get(id));
    return result instanceof Blob ? result : null;
  } catch {
    return null;
  }
}

export async function deleteMangelPhoto(id: string): Promise<void> {
  try {
    if (!supportsIdb()) {
      memoryFallback.delete(id);
      return;
    }
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    /* photo orpheline = gênante, jamais fatale */
  }
}

/** Test/dev : vide le repli mémoire (les tests repartent à zéro). */
export function clearMangelPhotoMemory(): void {
  memoryFallback.clear();
}

/** Toutes les clés posées (IDB ou repli mémoire) — jamais d'exception. */
export async function listMangelPhotoIds(): Promise<string[]> {
  try {
    if (!supportsIdb()) return [...memoryFallback.keys()];
    const keys = await withStore("readonly", (store) => store.getAllKeys());
    return keys.map(String);
  } catch {
    return [];
  }
}

/**
 * §104 — Balayage honnête des orphelines : l'import se fait en mémoire
 * de page ; si l'utilisateur quitte sans rattacher les photos à un Mangel,
 * leurs blobs resteraient invisibles ad vitam. Au montage de la page,
 * toute clé PRÉFIXÉE (notre import, jamais le reste) non référencée par
 * une Issue est supprimée — le disque ne gonfle pas dans le dos de
 * l'utilisateur. Retourne le nombre de suppressions réelles.
 */
export async function sweepOrphanPhotos(
  referenced: ReadonlySet<string>,
  prefix = "foto-",
): Promise<number> {
  const all = await listMangelPhotoIds();
  let removed = 0;
  for (const key of all) {
    if (!key.startsWith(prefix) || referenced.has(key)) continue;
    await deleteMangelPhoto(key);
    removed += 1;
  }
  return removed;
}
