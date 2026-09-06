// Narchi — DataVault: offline-first persistence, automatic backup & full export/import.
// This is the trust layer that lets a German SME keep real project data in Narchi:
// nothing leaves the device, data is auto-backed-up to IndexedDB, and the whole
// workspace can be exported to a single file at any time (DSGVO-conform).

const DB_NAME = "narchi-vault";
const STORE = "snapshots";
const AUTO_INTERVAL = 45_000; // auto-backup every 45s

export interface BackupSnapshot {
  takenAt: string;
  version: string;
  bytes: number;
  itemCount: number;
  data: Record<string, string>;
}

export interface VaultStatus {
  lastBackup: string | null;
  itemCount: number;
  bytes: number;
  autoBackupActive: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

import { storage } from "@/utils/localStore";

/** Collect every narchi:* key currently in localStorage. */
export function collectSnapshot(): BackupSnapshot {
  const keys = storage.keys();
  const data: Record<string, string> = {};
  for (const key of keys) data[key] = storage.getRaw(key) ?? "";
  const bytes = new Blob([JSON.stringify(data)]).size;
  return {
    takenAt: new Date().toISOString(),
    version: "5.2",
    bytes,
    itemCount: keys.length,
    data,
  };
}

/** Persist the current snapshot into IndexedDB (the safety net). */
export async function autoBack(): Promise<BackupSnapshot> {
  const snapshot = collectSnapshot();
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot, "latest");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* IndexedDB may be unavailable in some contexts — export still works */
  }
  return snapshot;
}

export async function getLatestBackup(): Promise<BackupSnapshot | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("latest");
      req.onsuccess = () => resolve((req.result as BackupSnapshot) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const snap = collectSnapshot();
  const latest = await getLatestBackup();
  return {
    lastBackup: latest?.takenAt ?? null,
    itemCount: snap.itemCount,
    bytes: snap.bytes,
    autoBackupActive: true,
  };
}

/** Restore an imported snapshot back into localStorage. */
export async function restoreSnapshot(snapshot: BackupSnapshot): Promise<{ restored: number }> {
  // wipe existing narchi keys first (clean restore)
  storage.clearAll();
  // write imported data
  let restored = 0;
  for (const [k, v] of Object.entries(snapshot.data)) {
    storage.setRaw(k, v);
    restored++;
  }
  await autoBack();
  return { restored };
}

/** Trigger a download of the full workspace as a .narchi backup file. */
export function downloadBackup() {
  const snapshot = collectSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `narchi-backup-${stamp}.narchi`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read an uploaded .narchi file and restore it. */
export function readBackupFile(file: File): Promise<BackupSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BackupSnapshot;
        if (!parsed.data || typeof parsed.data !== "object") throw new Error("invalid");
        resolve(parsed);
      } catch {
        reject(new Error("Ungültige Backup-Datei."));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/* ----- Auto-backup loop: starts once, survives navigation ----- */
let started = false;
let timer: number | null = null;

export function startAutoBackup() {
  if (started) return;
  started = true;

  // Auto-backup is intentionally light and idle-only. The previous startup
  // backup ran 3 seconds after login and synchronously JSON-stringified every
  // narchi:* localStorage value; on real projects / old browser profiles this
  // can lock the main thread and Chrome shows "Cette page ne répond pas".
  const run = () => {
    const schedule = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number);
    if (schedule) schedule(() => { void autoBack(); }, { timeout: 5000 });
    else window.setTimeout(() => { void autoBack(); }, 250);
  };

  timer = window.setInterval(run, AUTO_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") run();
  });
  window.addEventListener("beforeunload", run);
  // No initial backup on app boot: it is the source of the observed freeze.
}

export function stopAutoBackup() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  started = false;
}
