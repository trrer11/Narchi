import type { StateStorage } from "zustand/middleware";
import { captureOperationalError } from "@/core/telemetry";

const DB_NAME = "narchi-zustand-v5";
const STORE_NAME = "state";
let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, string>();

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB state storage blocked"));
  });
  return dbPromise;
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    captureOperationalError(error, { context: "Zustand.IndexedDB", mode });
    return null;
  }
}

export const indexedDbStateStorage: StateStorage = {
  async getItem(name) {
    if (typeof indexedDB === "undefined") return memoryFallback.get(name) ?? null;
    const persisted = await transact("readonly", (store) => store.get(name));
    return (persisted as string | null) ?? memoryFallback.get(name) ?? null;
  },
  async setItem(name, value) {
    memoryFallback.set(name, value);
    if (typeof indexedDB !== "undefined") {
      await transact("readwrite", (store) => store.put(value, name));
    }
  },
  async removeItem(name) {
    memoryFallback.delete(name);
    if (typeof indexedDB !== "undefined") {
      await transact("readwrite", (store) => store.delete(name));
    }
  },
};
