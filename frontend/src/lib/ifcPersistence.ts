// NARCHI — Persistance du dernier modèle IFC dans IndexedDB.
//
// Problème : après un rechargement complet de la page, le fichier source
// (et son URL blob) était perdu — l'utilisateur devait ré-importer son
// fichier pour retrouver la vraie géométrie 3D.
//
// Solution : le fichier IFC (ArrayBuffer) est stocké localement dans le
// navigateur dès l'import réussi ; au prochain chargement de la page
// d'import, le modèle est restauré automatiquement via la même chaîne
// résiliente (Worker → repli thread principal), sans action utilisateur.
//
// Garde-fous :
// - taille plafonnée (IFC_MODEL_MAX_BYTES) : IndexedDB n'est pas un disque ;
// - toute erreur IndexedDB est dégradée en avertissement console — le flux
//   d'import n'est jamais interrompu par la persistance ;
// - stockage local uniquement : le fichier ne quitte jamais le navigateur.

export interface PersistedIfcModel {
  name: string;
  size: number;
  savedAt: string;
  bytes: ArrayBuffer;
}

const DB_NAME = "narchi-bim";
const DB_VERSION = 1;
const STORE = "models";
const KEY_LAST = "last";

/// Plafond de persistance : 64 Mio (le fichier de référence fait 7,4 Mio).
export const IFC_MODEL_MAX_BYTES = 64 * 1024 * 1024;

function defaultFactory(): IDBFactory | null {
  return typeof indexedDB !== "undefined" ? indexedDB : null;
}

function requestToPromise<T>(req: IDBRequest<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(label));
  });
}

async function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open"));
  });
}

/// Enregistre le fichier IFC importé. Retourne false si ignoré (trop gros,
/// IndexedDB indisponible) — jamais d'exception vers l'appelant.
export async function saveIfcModel(
  file: File,
  factory: IDBFactory | null = defaultFactory(),
): Promise<boolean> {
  if (!factory) return false;
  if (file.size > IFC_MODEL_MAX_BYTES) {
    console.info(
      `[IFC] Modèle non persisté (${(file.size / 1024 / 1024).toFixed(1)} Mo > ` +
        `${IFC_MODEL_MAX_BYTES / 1024 / 1024} Mo plafond).`,
    );
    return false;
  }
  try {
    const bytes = await file.arrayBuffer();
    const record: PersistedIfcModel = {
      name: file.name,
      size: file.size,
      savedAt: new Date().toISOString(),
      bytes,
    };
    const db = await openDb(factory);
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(tx.objectStore(STORE).put(record, KEY_LAST), "put");
    } finally {
      db.close();
    }
    return true;
  } catch (error) {
    console.warn("[IFC] Persistance du modèle impossible :", error);
    return false;
  }
}

/// Recharge le dernier modèle persisté (null si absent ou illisible).
export async function loadIfcModel(
  factory: IDBFactory | null = defaultFactory(),
): Promise<PersistedIfcModel | null> {
  if (!factory) return null;
  try {
    const db = await openDb(factory);
    try {
      const tx = db.transaction(STORE, "readonly");
      const record = await requestToPromise(
        tx.objectStore(STORE).get(KEY_LAST),
        "get",
      );
      if (!record || !(record.bytes instanceof ArrayBuffer) || record.bytes.byteLength === 0) {
        return null;
      }
      return record;
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("[IFC] Chargement du modèle persisté impossible :", error);
    return null;
  }
}

/// Supprime le modèle persisté (action « Annuler » / nouveau projet vide).
export async function clearIfcModel(
  factory: IDBFactory | null = defaultFactory(),
): Promise<void> {
  if (!factory) return;
  try {
    const db = await openDb(factory);
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(tx.objectStore(STORE).delete(KEY_LAST), "delete");
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("[IFC] Suppression du modèle persisté impossible :", error);
  }
}
