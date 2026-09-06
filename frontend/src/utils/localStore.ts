// Narchi — typed, safe localStorage + sessionStorage wrapper.
// Centralises every persistence call so errors are handled uniformly,
// keys are namespaced, and reads never throw (defensive parsing).

const NAMESPACE = "narchi";

function namespaced(key: string): string {
  return key.startsWith(NAMESPACE + ":") ? key : `${NAMESPACE}:${key}`;
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(namespaced(key));
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  set<T>(key: string, value: T): boolean {
    try {
      localStorage.setItem(namespaced(key), JSON.stringify(value));
      return true;
    } catch {
      // quota exceeded or disabled storage — fail gracefully
      return false;
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(namespaced(key));
    } catch {
      /* ignore */
    }
  },

  /** Read raw string (for large opaque blobs). */
  getRaw(key: string): string | null {
    try {
      return localStorage.getItem(namespaced(key));
    } catch {
      return null;
    }
  },
  setRaw(key: string, value: string): boolean {
    try {
      localStorage.setItem(namespaced(key), value);
      return true;
    } catch {
      return false;
    }
  },

  /** Remove every namespaced key (full reset, preserving foreign data). */
  clearAll(): number {
    let removed = 0;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NAMESPACE + ":")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      removed = keys.length;
    } catch {
      /* ignore */
    }
    return removed;
  },

  has(key: string): boolean {
    try {
      return localStorage.getItem(namespaced(key)) !== null;
    } catch {
      return false;
    }
  },

  keys(): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NAMESPACE + ":")) out.push(k);
      }
    } catch {
      /* ignore */
    }
    return out;
  },
};

/** Session-scoped variant (cleared when the tab closes). */
export const session = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = sessionStorage.getItem(namespaced(key));
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      sessionStorage.setItem(namespaced(key), JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      sessionStorage.removeItem(namespaced(key));
    } catch {
      /* ignore */
    }
  },
};

/** Human-readable byte size (KB/MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
