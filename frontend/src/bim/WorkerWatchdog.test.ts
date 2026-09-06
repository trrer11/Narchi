/**
 * Tests du protocole de supervision du Worker IFC (amorçage + parsing).
 *
 * Historique du bug couvert : en production, le script du Worker pouvait
 * ne jamais se charger (chunk JS perdu / import statique lourd échoué) —
 * le navigateur émettait alors un ErrorEvent vide à l'étape DEMARRAGE,
 * indistinguishable d'un OOM. Le protocole WORKER_READY + la tentative
 * automatique unique avec Worker neuf corrigent ce point sans retouche UI.
 */

import { describe, it, expect, vi } from "vitest";
import {
  IfcWorkerBootError,
  IfcWorkerPool,
  awaitWorkerReady,
  type IfcWorkerResponse,
} from "./WorkerWatchdog";

// ---------------------------------------------------------------------------
// Faux Worker piloté par le test
// ---------------------------------------------------------------------------

type Listener = (event: { data?: unknown } & Record<string, unknown>) => void;

class FakeWorker {
  public terminated = false;
  public posted: Array<{ message: unknown; transfer?: unknown }> = [];
  /** true = émet WORKER_READY dès qu'un écouteur message existe (évaluation OK). */
  public autoReady = false;
  private readySent = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    if (type === "message" && this.autoReady && !this.readySent) {
      this.readySent = true;
      setTimeout(() => this.emitMessage({ type: "WORKER_READY" }), 0);
    }
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  postMessage(message: unknown, transfer?: unknown): void {
    this.posted.push({ message, transfer });
    if (this.onRequest) this.onRequest(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Réaction à programmée à la réception d'une requête PARSE_IFC. */
  public onRequest: ((message: unknown) => void) | null = null;

  emitMessage(data: IfcWorkerResponse): void {
    for (const fn of this.listeners.get("message") ?? []) fn({ data });
  }

  emitError(init: Partial<ErrorEvent> = {}): void {
    for (const fn of this.listeners.get("error") ?? [])
      fn({ message: "", filename: "", lineno: 0, colno: 0, ...init });
  }
}

/** Worker « sain » : annonce READY puis répond succès à toute requête. */
function makeHealthyWorker(takeoffPayload: unknown = { takeoff: { ok: true } }): FakeWorker {
  const worker = new FakeWorker();
  worker.autoReady = true;
  worker.onRequest = (message) => {
    const requestId = (message as { requestId?: string }).requestId ?? "req-1";
    worker.emitMessage({
      type: "PARSE_SUCCESS",
      requestId,
      payload: {
        modelID: -1,
        elementCount: 3,
        schema: "IFC2X3",
        durationMs: 1,
        takeoff: takeoffPayload,
        validated: false,
      } as never,
    });
  };
  return worker;
}

/** Worker « mort-né » : le script ne se charge jamais (aucune annonce). */
function makeDeadWorker(): FakeWorker {
  return new FakeWorker();
}

function asWorker(fake: FakeWorker): Worker {
  return fake as unknown as Worker;
}

const FILE_BYTES = new ArrayBuffer(8);

// ---------------------------------------------------------------------------
// awaitWorkerReady
// ---------------------------------------------------------------------------

describe("awaitWorkerReady — preuve de vie du Worker", () => {
  it("résout dès réception de WORKER_READY", async () => {
    const fake = makeHealthyWorker();
    await expect(awaitWorkerReady(asWorker(fake), 100)).resolves.toBeUndefined();
    expect(fake.terminated).toBe(false);
  });

  it("rejette avec IfcWorkerBootError et termine le Worker si le script ne se charge pas", async () => {
    const fake = makeDeadWorker();
    await expect(awaitWorkerReady(asWorker(fake), 30)).rejects.toBeInstanceOf(
      IfcWorkerBootError,
    );
    expect(fake.terminated).toBe(true);
  });

  it("rejette avec le détail du Worker en cas de WORKER_BOOT_ERROR", async () => {
    const fake = new FakeWorker();
    setTimeout(
      () => fake.emitMessage({ type: "WORKER_BOOT_ERROR", message: "boom-eval" }),
      0,
    );
    await expect(awaitWorkerReady(asWorker(fake), 100)).rejects.toThrow(/boom-eval/);
    expect(fake.terminated).toBe(true);
  });

  it("rejette sur événement error vide (script perdu au téléchargement)", async () => {
    const fake = new FakeWorker();
    setTimeout(() => fake.emitError(), 0);
    await expect(awaitWorkerReady(asWorker(fake), 100)).rejects.toThrow(
      /n'a pas été\s*chargé|pas pu démarrer/,
    );
  });
});

// ---------------------------------------------------------------------------
// IfcWorkerPool
// ---------------------------------------------------------------------------

describe("IfcWorkerPool — amorçage garanti, tentative unique", () => {
  it("parsing nominal : READY → lecture fichier → succès, fabrique appelée une fois", async () => {
    const fake = makeHealthyWorker();
    const pool = new IfcWorkerPool(() => asWorker(fake), 100);
    const getFileData = vi.fn(async () => FILE_BYTES);

    const payload = await pool.parse(getFileData, "maison.ifc", 200);

    expect((payload as { elementCount: number }).elementCount).toBe(3);
    expect(getFileData).toHaveBeenCalledTimes(1);
    // Le buffer a été transféré au Worker (zéro-copie).
    expect(fake.posted[0].transfer).toEqual([FILE_BYTES]);
  });

  it("Worker mort-né : UNE seconde tentative automatique avec un Worker neuf, fabrique non appelée en vain", async () => {
    const dead = makeDeadWorker();
    const healthy = makeHealthyWorker();
    const created: FakeWorker[] = [];
    const pool = new IfcWorkerPool(() => {
      const next = created.length === 0 ? dead : healthy;
      created.push(next);
      return asWorker(next);
    }, 30);
    const getFileData = vi.fn(async () => FILE_BYTES);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const payload = await pool.parse(getFileData, "maison.ifc", 200);

    expect(created).toHaveLength(2);
    expect(dead.terminated).toBe(true);
    // CRITIQUE : la fabrique n'a été appelée qu'après la preuve de vie du
    // second Worker — jamais de buffer détaché relu à vide.
    expect(getFileData).toHaveBeenCalledTimes(1);
    expect((payload as { elementCount: number }).elementCount).toBe(3);
    warnSpy.mockRestore();
  });

  it("deux Workers mort-nés : erreur d'amorçage explicite, sans relance sans fin", async () => {
    let created = 0;
    const pool = new IfcWorkerPool(() => {
      created += 1;
      return asWorker(makeDeadWorker());
    }, 30);

    await expect(pool.parse(async () => FILE_BYTES, "maison.ifc", 100)).rejects.toThrow(
      /pas pu démarrer/,
    );
    // 1 tentative + 1 relance, puis arrêt.
    expect(created).toBe(2);
  });

  it("échec de PARSING (PARSE_ERROR) : jamais relancé automatiquement", async () => {
    const fake = makeHealthyWorker();
    fake.onRequest = (message) => {
      const requestId = (message as { requestId?: string }).requestId ?? "req-1";
      fake.emitMessage({
        type: "PARSE_ERROR",
        requestId,
        error: { code: "TAKEOFF_FAILED", message: "structure illisible" },
      });
    };
    let created = 0;
    const pool = new IfcWorkerPool(() => {
      created += 1;
      return asWorker(fake);
    }, 100);

    await expect(pool.parse(async () => FILE_BYTES, "maison.ifc", 200)).rejects.toThrow(
      /TAKEOFF_FAILED/,
    );
    expect(created).toBe(1);
  });

  it("crash silencieux AVANT le premier progrès : diagnostic nominatif (plus d'accusation mémoire à l'étape DEMARRAGE)", async () => {
    const fake = makeHealthyWorker();
    fake.onRequest = () => fake.emitError(); // navigateur tue le Worker, ErrorEvent vide
    const pool = new IfcWorkerPool(() => asWorker(fake), 100);

    await expect(pool.parse(async () => FILE_BYTES, "maison.ifc", 200)).rejects.toThrow(
      /DEMARRAGE — crash avant le début du parsing/,
    );
  });

  it("timeout de parsing : message enrichi (étape + taille + délai), sans relance", async () => {
    const fake = makeHealthyWorker();
    fake.onRequest = () => undefined; // le Worker ne répond plus
    let created = 0;
    const pool = new IfcWorkerPool(() => {
      created += 1;
      return asWorker(fake);
    }, 100);

    await expect(pool.parse(async () => FILE_BYTES, "maison.ifc", 40)).rejects.toThrow(
      /dernière étape : DEMARRAGE, fichier : 0\.0 Mo, délai/,
    );
    expect(created).toBe(1);
    expect(fake.terminated).toBe(true);
  });
});
