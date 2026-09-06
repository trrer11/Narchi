// Tests de la persistance IndexedDB du dernier modèle IFC.
// Un IndexedDB factice minimal (un magasin, clés chaîne, callbacks asynchrones
// par microtâche) est injecté — le module accepte la fabrique en paramètre.

import { describe, expect, it } from "vitest";
import {
  IFC_MODEL_MAX_BYTES,
  clearIfcModel,
  loadIfcModel,
  saveIfcModel,
} from "@/lib/ifcPersistence";

function makeRequest<T>(value: T): IDBRequest<T> {
  const req: Record<string, unknown> = { result: value, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    (req.onsuccess as (() => void) | null)?.call(req as never);
  });
  return req as unknown as IDBRequest<T>;
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };

  createObjectStore(name: string) {
    this.stores.set(name, new Map());
  }

  transaction(names: string | string[]) {
    const storeName = Array.isArray(names) ? names[0] : names;
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`store ${storeName} inconnu`);
    return {
      objectStore: () => ({
        put: (value: unknown, key: string) => {
          store.set(String(key), value);
          return makeRequest<unknown>(undefined);
        },
        get: (key: string) => makeRequest(store.get(String(key))),
        delete: (key: string) => {
          store.delete(String(key));
          return makeRequest<undefined>(undefined);
        },
      }),
    } as unknown as IDBTransaction;
  }

  close() {}
}

class FakeIDBFactory {
  private dbs = new Map<string, FakeDatabase>();

  open(name: string) {
    const req: Record<string, unknown> = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      let db = this.dbs.get(name);
      if (!db) {
        db = new FakeDatabase();
        this.dbs.set(name, db);
        req.result = db;
        (req.onupgradeneeded as (() => void) | null)?.call(req as never);
      } else {
        req.result = db;
      }
      (req.onsuccess as (() => void) | null)?.call(req as never);
    });
    return req as unknown as IDBOpenDBRequest;
  }
}

function ifcFile(content: string, name = "meuble final.ifc"): File {
  return new File([content], name, { type: "model/ifc" });
}

describe("ifcPersistence", () => {
  it("aller-retour sauvegarde → chargement (octets identiques)", async () => {
    const factory = new FakeIDBFactory();
    const content = "ISO-10303-21; FILE-DEMO;";
    const saved = await saveIfcModel(ifcFile(content), factory as unknown as IDBFactory);
    expect(saved).toBe(true);

    const loaded = await loadIfcModel(factory as unknown as IDBFactory);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("meuble final.ifc");
    expect(loaded!.size).toBe(content.length);
    expect(new TextDecoder().decode(loaded!.bytes)).toBe(content);
    expect(loaded!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("chargement d'un magasin vide → null", async () => {
    const factory = new FakeIDBFactory();
    await expect(loadIfcModel(factory as unknown as IDBFactory)).resolves.toBeNull();
  });

  it("suppression → chargement null", async () => {
    const factory = new FakeIDBFactory();
    await saveIfcModel(ifcFile("DEMO;"), factory as unknown as IDBFactory);
    await clearIfcModel(factory as unknown as IDBFactory);
    await expect(loadIfcModel(factory as unknown as IDBFactory)).resolves.toBeNull();
  });

  it("fichier au-delà du plafond → ignoré, rien de stocké", async () => {
    const factory = new FakeIDBFactory();
    const huge = { name: "gros.ifc", size: IFC_MODEL_MAX_BYTES + 1 } as unknown as File;
    const saved = await saveIfcModel(huge, factory as unknown as IDBFactory);
    expect(saved).toBe(false);
    await expect(loadIfcModel(factory as unknown as IDBFactory)).resolves.toBeNull();
  });

  it("IndexedDB indisponible → dégradation silencieuse (jamais d'exception)", async () => {
    await expect(saveIfcModel(ifcFile("DEMO;"), null)).resolves.toBe(false);
    await expect(loadIfcModel(null)).resolves.toBeNull();
    await expect(clearIfcModel(null)).resolves.toBeUndefined();
  });

  it("le dernier import écrase le précédent", async () => {
    const factory = new FakeIDBFactory();
    await saveIfcModel(ifcFile("A;", "projet-a.ifc"), factory as unknown as IDBFactory);
    await saveIfcModel(ifcFile("BB;", "projet-b.ifc"), factory as unknown as IDBFactory);
    const loaded = await loadIfcModel(factory as unknown as IDBFactory);
    expect(loaded!.name).toBe("projet-b.ifc");
    expect(loaded!.size).toBe(3);
  });
});
