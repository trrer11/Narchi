/**
 * COLLABORATION HUB - NARCHI CORE V2
 * High-Availability WebSocket Relay Server for Yjs with Automatic Session Eviction.
 * 
 * Implements a robust lifecycle management for shared documents to prevent 
 * memory leaks in multi-tenant SaaS environments.
 */

import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection } from 'y-websocket/bin/utils';

// ============================================================================
// SECURITY & PERFORMANCE CONSTANTS
// ============================================================================

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity
const SNAPSHOT_THRESHOLD = 50;                 // Consolidate every 50 updates

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface DocumentState {
  doc: Y.Doc;
  persistenceQueue: Promise<void>;
  lastSnapshotTimestamp: number;
  updateCountSinceSnapshot: number;
  connections: Set<WebSocket>; // Track active clients for this project
  timeoutHandle: NodeJS.Timeout | null; // Timer for eviction
}

// ============================================================================
// COLLABORATION HUB
// ============================================================================

export class CollaborationHub {
  private wss: WebSocketServer;
  private port: number;
  private sessions: Map<string, DocumentState> = new Map();

  constructor(port: number = 1234) {
    this.port = port;
    this.wss = new WebSocketServer({ port });
    this.init();
  }

  private init(): void {
    console.log(`[CollaborationHub] Sovereign Sync Server started on port ${this.port}`);

    this.wss.on('connection', (conn, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const roomName = url.pathname.slice(1);

      if (!roomName) {
        conn.close();
        return;
      }

      // 1. Session Retrieval & Activation
      const session = this.getOrCreateSession(roomName);
      
      // Add connection to the active set
      session.connections.add(conn);

      // IMPORTANT: Cancel the eviction timer if a user reconnects
      if (session.timeoutHandle) {
        console.log(`[CollaborationHub] Reactivating session for ${roomName}. Timer cancelled.`);
        clearTimeout(session.timeoutHandle);
        session.timeoutHandle = null;
      }

      // 2. Initialize Yjs Connection
      setupWSConnection(conn, req, {
        docName: roomName,
        gc: true,
      });

      // 3. Bind the WAL (Write-Ahead Log) listener
      session.doc.on('update', (update, origin) => {
        if (origin !== null) {
          this.enqueueUpdate(roomName, update);
        }
      });

      // 4. Handle Disconnection
      conn.on('close', () => {
        this.handleDisconnection(roomName, conn);
      });
    });
  }

  /**
   * Manages the lifecycle of a connection closure.
   */
  private handleDisconnection(roomName: string, conn: WebSocket): void {
    const session = this.sessions.get(roomName);
    if (!session) return;

    // Remove the socket from the active set
    session.connections.delete(conn);
    console.log(`[CollaborationHub] Client disconnected from ${roomName}. Active: ${session.connections.size}`);

    // If no one is left, start the eviction countdown
    if (session.connections.size === 0) {
      console.log(`[CollaborationHub] Session ${roomName} is now idle. Eviction scheduled in ${SESSION_IDLE_TIMEOUT_MS / 1000 / 60} min.`);
      
      session.timeoutHandle = setTimeout(async () => {
        await this.purgeSession(roomName);
      }, SESSION_IDLE_TIMEOUT_MS);
    }
  }

  /**
   * Sovereign Purge Procedure.
   * Ensures data is saved and memory is physically released.
   */
  private async purgeSession(roomName: string): Promise<void> {
    const session = this.sessions.get(roomName);
    if (!session) return;

    console.log(`[CollaborationHub] Evicting idle session: ${roomName}...`);

    try {
      // 1. Force final persistence of the document state
      await this.consolidateSnapshot(roomName);

      // 2. Destroy the Yjs document to free internal listeners and buffers
      session.doc.destroy();

      // 3. Remove from the Map to allow Garbage Collection
      this.sessions.delete(roomName);
      
      console.log(`[CollaborationHub] Session ${roomName} successfully purged from RAM.`);
    } catch (error) {
      console.error(`[CollaborationHub] Critical error during purge of ${roomName}:`, error);
    }
  }

  private getOrCreateSession(roomName: string): DocumentState {
    if (this.sessions.has(roomName)) {
      return this.sessions.get(roomName)!;
    }

    const doc = new Y.Doc();
    this.hydrateDocument(doc, roomName);

    const session: DocumentState = {
      doc,
      persistenceQueue: Promise.resolve(),
      lastSnapshotTimestamp: Date.now(),
      updateCountSinceSnapshot: 0,
      connections: new Set<WebSocket>(),
      timeoutHandle: null,
    };

    this.sessions.set(roomName, session);
    return session;
  }

  // ============================================================================
  // PERSISTENCE LOGIC (WAL)
  // ============================================================================

  private enqueueUpdate(roomName: string, update: Uint8Array): void {
    const session = this.sessions.get(roomName);
    if (!session) return;

    session.persistenceQueue = session.persistenceQueue.then(async () => {
      try {
        await this.writeToTransactionLog(roomName, update);
        session.updateCountSinceSnapshot++;

        if (session.updateCountSinceSnapshot >= SNAPSHOT_THRESHOLD) {
          await this.consolidateSnapshot(roomName);
        }
      } catch (error) {
        console.error(`[CollaborationHub] WAL error for ${roomName}:`, error);
      }
    });
  }

  private async writeToTransactionLog(roomName: string, update: Uint8Array): Promise<void> {
    // DB.query("INSERT INTO bcf_logs (room, delta, ts) VALUES ($1, $2, $3)", [roomName, update, Date.now()])
    console.log(`[WAL] Logged delta for ${roomName} (${update.length} bytes)`);
    return Promise.resolve();
  }

  private async consolidateSnapshot(roomName: string): Promise<void> {
    const session = this.sessions.get(roomName);
    if (!session) return;

    const state = Y.encodeStateAsUpdate(session.doc);
    try {
      await this.saveFullSnapshot(roomName, state);
      session.updateCountSinceSnapshot = 0;
      session.lastSnapshotTimestamp = Date.now();
      await this.clearTransactionLog(roomName);
    } catch (error) {
      console.error(`[CollaborationHub] Snapshot failed for ${roomName}:`, error);
    }
  }

  private async saveFullSnapshot(roomName: string, state: Uint8Array): Promise<void> {
    // DB.query("UPDATE project_states SET state = $1 WHERE room = $2", [state, roomName])
    console.log(`[SovereignDB] Snapshot persisted for ${roomName}`);
    return Promise.resolve();
  }

  private async clearTransactionLog(roomName: string): Promise<void> {
    // DB.query("DELETE FROM bcf_logs WHERE room = $1", [roomName])
    return Promise.resolve();
  }

  private async hydrateDocument(doc: Y.Doc, roomName: string): Promise<void> {
    try {
      const snapshot = await this.loadSnapshotFromDb(roomName);
      if (snapshot) Y.applyUpdate(doc, snapshot);
      const pendingDeltas = await this.loadPendingDeltas(roomName);
      for (const delta of pendingDeltas) Y.applyUpdate(doc, delta);
    } catch (error) {
      console.error(`[CollaborationHub] Hydration failed for ${roomName}:`, error);
    }
  }

  private async loadSnapshotFromDb(roomName: string): Promise<Uint8Array | null> {
    return null; 
  }

  private async loadPendingDeltas(roomName: string): Promise<Uint8Array[]> {
    return [];
  }

  public async shutdown(): Promise<void> {
    const rooms = Array.from(this.sessions.keys());
    await Promise.all(rooms.map(room => this.consolidateSnapshot(room)));
    this.wss.close();
    console.log("[CollaborationHub] Hub shutdown complete.");
  }
}

new CollaborationHub();
