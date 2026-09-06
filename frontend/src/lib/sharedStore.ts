// Narchi — SharedStore: optional browser-local collaboration cache.
// It must never block the main dashboard boot. All IndexedDB reads are lazy,
// guarded, and oversized/corrupt payloads are discarded instead of parsed.

const DB_NAME = "narchi-shared-db";
const DB_VERSION = 1;
const MAX_BOOT_JSON_BYTES = 2_000_000; // protect Chrome from huge legacy IndexedDB payloads

export type Listener = () => void;

interface DocRecord {
  id: string;
  updatedAt: number;
  data: unknown;
}
interface StoreShape {
  [collection: string]: Record<string, DocRecord>;
}

class SharedStore {
  private mem: StoreShape = {};
  private listeners = new Map<string, Set<Listener>>();
  private channel: BroadcastChannel | null = null;
  private db: IDBDatabase | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private dirty = false;
  private persistTimer: number | null = null;

  async init() {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        this.channel = new BroadcastChannel("narchi-sync");
        this.channel.onmessage = (e) => this.handleRemote(e.data);
      } catch {
        this.channel = null;
      }

      await this.openDB();
      await this.loadFromDBSafely();
      this.ready = true;

      if (this.persistTimer === null) {
        this.persistTimer = window.setInterval(() => {
          if (this.dirty) {
            this.dirty = false;
            void this.persist();
          }
        }, 5000);
      }
    })().catch(() => {
      this.mem = {};
      this.ready = true;
    });

    return this.initPromise;
  }

  private async whenReady(): Promise<void> {
    if (!this.ready) await this.init();
  }

  private openDB(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        req.onsuccess = () => { this.db = req.result; resolve(); };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private idbGet(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction("kv", "readonly");
        const req = tx.objectStore("kv").get(key);
        req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private idbSet(key: string, val: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      try {
        const tx = this.db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async loadFromDBSafely() {
    const json = await this.idbGet("store");
    if (!json) {
      this.mem = {};
      return;
    }
    if (json.length > MAX_BOOT_JSON_BYTES) {
      console.warn(`[NARCHI] SharedStore payload ignored (${json.length} bytes) to avoid UI freeze.`);
      this.mem = {};
      void this.idbSet("store", "{}");
      return;
    }
    try {
      this.mem = JSON.parse(json) as StoreShape;
    } catch {
      this.mem = {};
      void this.idbSet("store", "{}");
    }
  }

  private async persist() {
    try {
      const json = JSON.stringify(this.mem);
      if (json.length <= MAX_BOOT_JSON_BYTES) await this.idbSet("store", json);
    } catch {
      // persistence is a cache; failure must not affect the app
    }
  }

  private broadcast(collection: string, type: string, id: string, data?: unknown) {
    this.channel?.postMessage({ collection, type, id, data });
    this.dirty = true;
    this.notify(collection);
  }

  private handleRemote(msg: { collection: string; type: string; id: string; data?: unknown }) {
    if (!msg?.collection || !msg.id) return;
    const col = this.mem[msg.collection] ?? (this.mem[msg.collection] = {});
    if (msg.type === "delete") delete col[msg.id];
    else if (msg.data) col[msg.id] = { id: msg.id, updatedAt: Date.now(), data: msg.data };
    this.notify(msg.collection);
  }

  private notify(collection: string) {
    this.listeners.get(collection)?.forEach((l) => l());
    this.listeners.get("*")?.forEach((l) => l());
  }

  async getAll<T>(collection: string): Promise<T[]> {
    await this.whenReady();
    const col = this.mem[collection] ?? {};
    return Object.values(col)
      .filter((r): r is DocRecord => !!r && r.data !== undefined)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((r) => r.data as T);
  }

  async insert<T extends { id: string }>(collection: string, doc: T): Promise<T> {
    await this.whenReady();
    if (!this.mem[collection]) this.mem[collection] = {};
    this.mem[collection][doc.id] = { id: doc.id, updatedAt: Date.now(), data: doc };
    this.broadcast(collection, "insert", doc.id, doc);
    return doc;
  }

  async update<T extends { id: string }>(collection: string, id: string, patch: Partial<T>): Promise<void> {
    await this.whenReady();
    const col = this.mem[collection];
    if (col?.[id]) {
      const merged = { ...(col[id].data as T), ...patch, id };
      col[id] = { id, updatedAt: Date.now(), data: merged };
      this.broadcast(collection, "update", id, merged);
    }
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.whenReady();
    const col = this.mem[collection];
    if (col?.[id]) {
      delete col[id];
      this.broadcast(collection, "delete", id);
    }
  }

  subscribe(collection: string, listener: Listener): () => void {
    if (!this.listeners.has(collection)) this.listeners.set(collection, new Set());
    this.listeners.get(collection)!.add(listener);
    return () => this.listeners.get(collection)?.delete(listener);
  }

  async clear(): Promise<void> {
    this.mem = {};
    this.dirty = false;
    await this.idbSet("store", "{}");
    this.notify("*");
  }
}

export const store = new SharedStore();

import { useEffect, useState } from "react";
export function useCollection<T>(collection: string): [T[], boolean] {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const data = await store.getAll<T>(collection);
      if (mounted) {
        setItems(data);
        setLoading(false);
      }
    };
    void refresh();
    const unsub = store.subscribe(collection, () => void refresh());
    return () => { mounted = false; unsub(); };
  }, [collection]);

  return [items, loading];
}
