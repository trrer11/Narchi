/**
 * NARCHI V5 — OfflineOutbox
 * File d'attente offline résiliente.
 * Stockage : IndexedDB > localStorage > mémoire (fallback absolu).
 */

export interface OutboxMessage {
  id: string;
  type: "chat" | "takeoff" | "comment" | "file_upload";
  payload: unknown;
  tenantId: string;
  userId: string;
  projectId: string;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  priority: "low" | "normal" | "high" | "critical";
}

export interface FlushResult {
  sent: string[];
  failed: string[];
  pending: string[];
}

type StorageMode = "indexeddb" | "localstorage" | "memory";

export class OfflineOutbox {
  private static readonly DB_NAME = "narchi_outbox";
  private static readonly DB_VERSION = 2;
  private static readonly STORE_NAME = "messages";
  private static readonly DEAD_LETTER_STORE = "dead_letters";

  private db: IDBDatabase | null = null;
  private memoryQueue = new Map<string, OutboxMessage>();
  private storageMode: StorageMode = "memory";
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private syncInProgress = false;
  private flushCallbacks: Array<(messages: OutboxMessage[]) => Promise<boolean>> = [];
  private backgroundSyncRegistered = false;

  async initialize(): Promise<void> {
    try {
      this.db = await this.openIndexedDB();
      this.storageMode = "indexeddb";
      console.info("[Outbox] Mode: IndexedDB");
    } catch (idbError) {
      console.warn(`[Outbox] IndexedDB indisponible (${idbError}), fallback localStorage`);

      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("__outbox_test__", "1");
          localStorage.removeItem("__outbox_test__");
          this.storageMode = "localstorage";
          console.info("[Outbox] Mode: localStorage");
        } else {
          throw new Error("localStorage indisponible");
        }
      } catch {
        this.storageMode = "memory";
        console.info("[Outbox] Mode: Memory (headless)");
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline.bind(this));
      window.addEventListener("offline", this.handleOffline.bind(this));
      window.addEventListener("beforeunload", () => {
        void this.persistMemoryQueueToStorage();
      });
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.isOnline) {
          void this.flushQueue();
        }
      });

      // Enregistrer Background Sync API pour les flushs différés
      this.registerBackgroundSync();
    }

    // Callback de flush par défaut utilisant fetch (peut être remplacé par le consommateur)
    this.onFlush(this.defaultFlushCallback.bind(this));

    await this.recoverPersistedMessages();
  }

  async enqueue(
    message: Omit<OutboxMessage, "id" | "timestamp" | "retryCount">
  ): Promise<string> {
    const fullMessage: OutboxMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: message.maxRetries ?? 5,
    };

    await this.persistMessage(fullMessage);

    if (this.isOnline && !this.syncInProgress) {
      void this.flushQueue();
    }

    return fullMessage.id;
  }

  async flushQueue(): Promise<FlushResult> {
    if (this.syncInProgress) {
      return { sent: [], failed: [], pending: [] };
    }

    this.syncInProgress = true;
    const result: FlushResult = { sent: [], failed: [], pending: [] };

    try {
      const messages = await this.getAllMessages();

      messages.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return pDiff !== 0 ? pDiff : a.timestamp - b.timestamp;
      });

      for (const message of messages) {
        if (!this.isOnline) {
          result.pending.push(message.id);
          continue;
        }

        let sent = false;

        for (const callback of this.flushCallbacks) {
          try {
            sent = await callback([message]);
            if (sent) break;
          } catch (e) {
            console.warn(`[Outbox] Callback flush failed: ${e}`);
          }
        }

        if (sent) {
          await this.removeMessage(message.id);
          result.sent.push(message.id);
        } else {
          const updated = { ...message, retryCount: message.retryCount + 1 };

          if (updated.retryCount >= updated.maxRetries) {
            await this.moveToDeadLetter(updated);
            await this.removeMessage(message.id);
            result.failed.push(message.id);
            console.error(
              `[Outbox] Message ${message.id} mort après ${updated.maxRetries} tentatives`
            );
          } else {
            await this.persistMessage(updated);
            result.pending.push(message.id);
          }
        }
      }
    } finally {
      this.syncInProgress = false;
    }

    return result;
  }

  onFlush(callback: (messages: OutboxMessage[]) => Promise<boolean>): void {
    this.flushCallbacks.push(callback);
  }

  // ── PERSISTENCE ──────────────────────────────────────────────────────

  private async persistMessage(message: OutboxMessage): Promise<void> {
    switch (this.storageMode) {
      case "indexeddb":
        await this.idbPut(message);
        break;
      case "localstorage":
        this.localStoragePut(message);
        break;
      case "memory":
        this.memoryQueue.set(message.id, message);
        break;
    }
  }

  private async removeMessage(id: string): Promise<void> {
    switch (this.storageMode) {
      case "indexeddb":
        await this.idbDelete(id);
        break;
      case "localstorage":
        this.localStorageDelete(id);
        break;
      case "memory":
        this.memoryQueue.delete(id);
        break;
    }
  }

  private async getAllMessages(): Promise<OutboxMessage[]> {
    switch (this.storageMode) {
      case "indexeddb":
        return this.idbGetAll();
      case "localstorage":
        return this.localStorageGetAll();
      case "memory":
        return Array.from(this.memoryQueue.values());
    }
  }

  // ── INDEXEDDB ────────────────────────────────────────────────────────

  private openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB non disponible (environnement headless)"));
        return;
      }

      const request = indexedDB.open(OfflineOutbox.DB_NAME, OfflineOutbox.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(OfflineOutbox.STORE_NAME)) {
          const store = db.createObjectStore(OfflineOutbox.STORE_NAME, {
            keyPath: "id",
          });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("priority", "priority", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }

        if (!db.objectStoreNames.contains(OfflineOutbox.DEAD_LETTER_STORE)) {
          db.createObjectStore(OfflineOutbox.DEAD_LETTER_STORE, { keyPath: "id" });
        }
      };

      setTimeout(() => reject(new Error("IndexedDB timeout")), 5000);
    });
  }

  private idbPut(message: OutboxMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("DB non initialisée"));
      const tx = this.db.transaction(OfflineOutbox.STORE_NAME, "readwrite");
      const req = tx.objectStore(OfflineOutbox.STORE_NAME).put(message);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbDelete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("DB non initialisée"));
      const tx = this.db.transaction(OfflineOutbox.STORE_NAME, "readwrite");
      const req = tx.objectStore(OfflineOutbox.STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbGetAll(): Promise<OutboxMessage[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction(OfflineOutbox.STORE_NAME, "readonly");
      const req = tx.objectStore(OfflineOutbox.STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as OutboxMessage[]);
      req.onerror = () => reject(req.error);
    });
  }

  private async moveToDeadLetter(message: OutboxMessage): Promise<void> {
    if (!this.db) return;
    const tx = this.db.transaction(OfflineOutbox.DEAD_LETTER_STORE, "readwrite");
    tx.objectStore(OfflineOutbox.DEAD_LETTER_STORE).put({
      ...message,
      deadAt: Date.now(),
    });
  }

  // ── LOCALSTORAGE ─────────────────────────────────────────────────────

  private readonly LS_PREFIX = "narchi_outbox_";

  private localStoragePut(message: OutboxMessage): void {
    try {
      localStorage.setItem(
        this.LS_PREFIX + message.id,
        JSON.stringify(message)
      );
    } catch (e) {
      console.warn("[Outbox] localStorage quota dépassé, message en mémoire");
      this.memoryQueue.set(message.id, message);
    }
  }

  private localStorageDelete(id: string): void {
    localStorage.removeItem(this.LS_PREFIX + id);
  }

  private localStorageGetAll(): OutboxMessage[] {
    const messages: OutboxMessage[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(this.LS_PREFIX)) continue;
      try {
        const msg = JSON.parse(localStorage.getItem(key) ?? "null");
        if (msg) messages.push(msg);
      } catch {
        // Message corrompu — ignorer
      }
    }
    return messages;
  }

  // ── HELPERS ──────────────────────────────────────────────────────────

  private handleOnline(): void {
    this.isOnline = true;
    console.info("[Outbox] Connexion rétablie — flush de la file...");
    void this.flushQueue();
  }

  private handleOffline(): void {
    this.isOnline = false;
    console.info("[Outbox] Connexion perdue — mode offline activé");
  }

  private async recoverPersistedMessages(): Promise<void> {
    const messages = await this.getAllMessages();
    console.info(`[Outbox] ${messages.length} message(s) récupéré(s) depuis le stockage persistant`);
    if (messages.length > 0 && this.isOnline) {
      void this.flushQueue();
    }
  }

  private persistMemoryQueueToStorage(): void {
    if (this.storageMode === "memory") return;
    for (const message of this.memoryQueue.values()) {
      void this.persistMessage(message);
    }
  }

  // ── BACKGROUND SYNC ──────────────────────────────────────────────────

  private async registerBackgroundSync(): Promise<void> {
    if (this.backgroundSyncRegistered) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      if ("sync" in registration) {
        // Enregistrer un tag de sync pour chaque type de message prioritaire
        await (registration as any).sync.register("narchi-outbox-flush");
        this.backgroundSyncRegistered = true;
        console.info("[Outbox] Background Sync API registered");
      }
    } catch (e) {
      console.warn("[Outbox] Background Sync registration failed:", e);
    }
  }

  private async defaultFlushCallback(messages: OutboxMessage[]): Promise<boolean> {
    if (messages.length === 0) return true;

    // Envoyer les messages par batch via secureFetch
    // NOTE: L'URL de base doit être configurée selon l'environnement
    const API_BASE = typeof window !== "undefined" ? window.location.origin : "";

    for (const message of messages) {
      try {
        let endpoint = "";
        let body: Record<string, unknown> = {
          clientId: message.id,
          clientCreatedAt: new Date(message.timestamp).toISOString(),
        };

        switch (message.type) {
          case "chat":
            endpoint = `${API_BASE}/api/v5/chat/channels/${encodeURIComponent(message.projectId)}/messages`;
            body = { ...body, text: message.payload };
            break;
          case "takeoff":
            endpoint = `${API_BASE}/api/v5/chat/channels/${encodeURIComponent(message.projectId)}/takeoffs`;
            body = { ...body, ...(message.payload as Record<string, unknown>) };
            break;
          case "comment":
            endpoint = `${API_BASE}/api/v5/chat/channels/${encodeURIComponent(message.projectId)}/comments`;
            body = { ...body, ...(message.payload as Record<string, unknown>) };
            break;
          case "file_upload":
            endpoint = `${API_BASE}/api/v5/upload`;
            body = { ...body, ...(message.payload as Record<string, unknown>) };
            break;
          default:
            continue;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          // Ne pas utiliser credentials pour les requêtes background sync
          credentials: "same-origin",
        });

        if (!response.ok) {
          console.warn(`[Outbox] Flush failed for ${message.id}: ${response.status}`);
          return false;
        }
      } catch (e) {
        console.warn(`[Outbox] Flush error for ${message.id}:`, e);
        return false;
      }
    }
    return true;
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────

  async getQueueSize(): Promise<number> {
    return (await this.getAllMessages()).length;
  }

  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  isNetworkOnline(): boolean {
    return this.isOnline;
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline.bind(this));
      window.removeEventListener("offline", this.handleOffline.bind(this));
    }
    this.db?.close();
    this.memoryQueue.clear();
  }
}

export const outbox = new OfflineOutbox();
