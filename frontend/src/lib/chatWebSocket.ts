/**
 * CHAT WEBSOCKET MANAGER - NARCHI CORE V5 (PATCH OFFLINE OUTBOX)
 * ---------------------------------------------------------------
 * Lifecycle WebSocket + outbox persistante IndexedDB + repli mémoire atomique +
 * beforeunload + sendBeacon + Jitter + Heartbeat.
 */

import { sanitizeChatMessage, secureFetch } from "@/auth/SecuritySanitizer";
import { sessionSecurity } from "@/auth/sessionSecurity";

const API = "/api/v5/chat";
const MAX_TEXT = 4000;

export type OutboxStatus = "pending" | "sending" | "sent" | "failed";

export interface OutboxMessage {
  clientId: string;
  channelId: string;
  text: string;
  clientCreatedAt: string;
  status: OutboxStatus;
  attempts: number;
}

export interface ChatSocketEvents {
  onPayload: (payload: unknown) => void;
  onOutboxChange?: (queue: readonly OutboxMessage[]) => void;
  onStateChange?: (state: "connecting" | "open" | "closed") => void;
}

// ============================================================================
// STOCKAGE OUTBOX : IndexedDB avec repli mémoire atomique
// ============================================================================

class OutboxStorage {
  private db: IDBDatabase | null = null;
  private readonly memoryFallback: Map<string, OutboxMessage> = new Map();
  private dbFailed = false;

  public init(): Promise<void> {
    if (this.db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        this.dbFailed = true;
        return reject(new Error("IndexedDB is not defined in this environment."));
      }
      const request = indexedDB.open("narchi_chat_outbox", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "clientId" });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => {
        this.dbFailed = true;
        reject(request.error);
      };
      request.onblocked = () => {
        this.dbFailed = true;
        reject(new Error("IndexedDB blocked."));
      };
    });
  }

  public async save(msg: OutboxMessage): Promise<void> {
    // La mémoire est le journal synchrone utilisé par beforeunload.
    this.memoryFallback.set(msg.clientId, { ...msg });
    if (this.dbFailed || !this.db) return;
    await new Promise<void>((resolve) => {
      const tx = this.db!.transaction("outbox", "readwrite");
      tx.objectStore("outbox").put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        // L'écriture mémoire reste valide : aucune perte, même si IDB tombe.
        this.dbFailed = true;
        resolve();
      };
      tx.onabort = () => {
        this.dbFailed = true;
        resolve();
      };
    });
  }

  public async delete(clientId: string): Promise<void> {
    if (this.dbFailed || !this.db) {
      this.memoryFallback.delete(clientId);
      return;
    }

    await new Promise<void>((resolve) => {
      const tx = this.db!.transaction("outbox", "readwrite");
      tx.objectStore("outbox").delete(clientId);
      tx.oncomplete = () => {
        this.memoryFallback.delete(clientId);
        resolve();
      };
      tx.onerror = () => {
        // Conserve la copie mémoire si la suppression persistante échoue.
        this.dbFailed = true;
        resolve();
      };
      tx.onabort = () => {
        this.dbFailed = true;
        resolve();
      };
    });
  }

  public async list(): Promise<OutboxMessage[]> {
    if (this.dbFailed || !this.db) {
      return Array.from(this.memoryFallback.values()).sort(
        (a, b) => new Date(a.clientCreatedAt).getTime() - new Date(b.clientCreatedAt).getTime()
      );
    }
    return new Promise((resolve) => {
      const tx = this.db!.transaction("outbox", "readonly");
      const store = tx.objectStore("outbox");
      const request = store.getAll();
      request.onsuccess = () => {
        const merged = new Map<string, OutboxMessage>();
        for (const message of request.result as OutboxMessage[]) merged.set(message.clientId, message);
        for (const message of this.memoryFallback.values()) merged.set(message.clientId, message);
        const list = [...merged.values()].sort(
          (a, b) => new Date(a.clientCreatedAt).getTime() - new Date(b.clientCreatedAt).getTime(),
        );
        resolve(list);
      };
      request.onerror = () => {
        this.dbFailed = true;
        resolve(Array.from(this.memoryFallback.values()));
      };
    });
  }

  public hasMemoryFallback(): boolean {
    return this.dbFailed;
  }
}

const OUTBOX_MAX_SIZE = 200;
const OUTBOX_TTL_MS = 24 * 3600 * 1000;
const OUTBOX_MAX_ATTEMPTS = 5;

class ResilientOutboxStorage extends OutboxStorage {
  async prune(): Promise<void> {
    const list = await this.list();
    const now = Date.now();

    for (const msg of list) {
      const age = now - new Date(msg.clientCreatedAt).getTime();
      const expired = age > OUTBOX_TTL_MS;
      const exhausted = msg.attempts >= OUTBOX_MAX_ATTEMPTS;

      if (expired || exhausted) {
        await this.delete(msg.clientId);
        console.warn(`[Outbox] Message abandonné: ${msg.clientId} (expired=${expired}, attempts=${msg.attempts})`);
      }
    }

    const remaining = await this.list();
    if (remaining.length > OUTBOX_MAX_SIZE) {
      const toDelete = remaining.slice(0, remaining.length - OUTBOX_MAX_SIZE);
      for (const msg of toDelete) await this.delete(msg.clientId);
    }
  }

  public isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof indexedDB !== "undefined" &&
      typeof navigator !== "undefined"
    );
  }
}

const outboxStore = new ResilientOutboxStorage();

function newClientId(): string {
  const entropy =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `msg-${entropy}`;
}

// ============================================================================
// MANAGER PRINCIPAL
// ============================================================================

export class ChatWebSocketManager {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private attempt = 0;
  private draining = false;
  private queueSnapshot: readonly OutboxMessage[] = [];

  constructor(
    private readonly channelId: string,
    private readonly events: ChatSocketEvents,
  ) {
    void this.initPipeline();
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  private async initPipeline() {
    try {
      await outboxStore.init();
    } catch (e) {
      console.warn("[ChatWS] IndexedDB indisponible, repli mémoire actif :", e);
    }
    this.queueSnapshot = await outboxStore.list();
    this.events.onOutboxChange?.(this.queueSnapshot);
    this.connect();
  }

  private readonly handleOnline = (): void => {
    void this.drainQueue();
  };

  private readonly handleBeforeUnload = (): void => {
    // beforeunload ne peut pas attendre IndexedDB : utilise le snapshot mémoire.
    if (!navigator.sendBeacon) return;
    for (const msg of this.queueSnapshot) {
      const blob = new Blob(
        [JSON.stringify({
          text: msg.text,
          clientId: msg.clientId,
          clientCreatedAt: msg.clientCreatedAt,
        })],
        { type: "application/json" },
      );
      navigator.sendBeacon(
        `${API}/channels/${encodeURIComponent(msg.channelId)}/messages`,
        blob,
      );
    }
  };

  // ------------------------------------------------------------------
  // CYCLE DE VIE WS
  // ------------------------------------------------------------------
  private connect(): void {
    if (this.closed) return;
    this.events.onStateChange?.("connecting");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";

    try {
      this.ws = new WebSocket(
        `${proto}//${window.location.host}${API}/ws?channel_id=${encodeURIComponent(this.channelId)}`,
      );

      this.ws.onopen = () => {
        this.attempt = 0;
        this.events.onStateChange?.("open");
        this.startHeartbeat();
        void this.drainQueue();
      };

      this.ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "pong") return;
          this.events.onPayload(payload);
        } catch {
          this.events.onPayload(event.data);
        }
      };

      this.ws.onclose = () => {
        this.events.onStateChange?.("closed");
        this.stopHeartbeat();
        if (this.closed) return;
        const backoff = Math.min(1000 * 2 ** Math.min(this.attempt++, 6), 30000);
        const jitter = Math.random() * 5000;
        this.retryTimer = window.setTimeout(() => this.connect(), backoff + jitter);
      };

      this.ws.onerror = () => {
        try { this.ws?.close(); } catch { /* noop */ }
      };
    } catch {
      this.retryTimer = window.setTimeout(() => this.connect(), 5000);
    }
  }

  // ------------------------------------------------------------------
  // ENVOI SÉCURISÉ
  // ------------------------------------------------------------------
  public async send(rawText: string): Promise<OutboxMessage> {
    const text = sanitizeChatMessage(rawText).slice(0, MAX_TEXT);
    if (!text) throw new Error("Message vide.");

    const message: OutboxMessage = {
      clientId: newClientId(),
      channelId: this.channelId,
      text,
      clientCreatedAt: new Date().toISOString(),
      status: "pending",
      attempts: 0,
    };

    await outboxStore.save(message);
    await this.notifyOutbox();

    if (this.isHealthy()) {
      await this.drainQueue();
    }
    return message;
  }

  private isHealthy(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      navigator.onLine &&
      !sessionSecurity.isSuspended()
    );
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      if (typeof outboxStore.prune === "function") {
        await outboxStore.prune();
      }
      let activeList = await outboxStore.list();
      while (activeList.length > 0) {
        if (sessionSecurity.isSuspended()) break;
        if (!this.isHealthy() && activeList[0].attempts > 0) break;

        const message = activeList[0];
        message.status = "sending";
        message.attempts += 1;
        await outboxStore.save(message);
        await this.notifyOutbox();

        try {
          const res = await secureFetch(
            `${API}/channels/${encodeURIComponent(message.channelId)}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: message.text,
                clientId: message.clientId,
                clientCreatedAt: message.clientCreatedAt,
              }),
            },
          );
          if (!res.ok) throw new Error(`Chat send ${res.status}`);

          await outboxStore.delete(message.clientId);
          activeList = await outboxStore.list();
          await this.notifyOutbox();
        } catch {
          message.status = "failed";
          await outboxStore.save(message);
          await this.notifyOutbox();
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async notifyOutbox(): Promise<void> {
    const list = await outboxStore.list();
    this.queueSnapshot = list;
    this.events.onOutboxChange?.(list);
    window.dispatchEvent(new CustomEvent("narchi-chat-outbox", {
      detail: { channelId: this.channelId, pending: list.length },
    }));
  }

  // ------------------------------------------------------------------
  // HEARTBEAT
  // ------------------------------------------------------------------
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isHealthy()) {
        try { this.ws?.send(JSON.stringify({ type: "ping" })); } catch { /* noop */ }
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public async getQueue(): Promise<readonly OutboxMessage[]> {
    return outboxStore.list();
  }

  public dispose(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
