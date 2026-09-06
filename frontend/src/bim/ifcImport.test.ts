/**
 * Tests de l'import IFC résilient (worker d'abord, thread principal en secours).
 *
 * Le cas de production couvert : un environnement où le script du Worker ne
 * peut JAMAIS démarrer (chunk bloqué) ne doit plus empêcher l'import — le
 * parseur streaming s'exécute alors sur le thread principal.
 */

import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { importIfcResilient } from "./ifcImport";
import { IfcWorkerBootError, IfcWorkerPool } from "./WorkerWatchdog";

async function exampleBuffer(): Promise<ArrayBuffer> {
  const candidates = [
    path.resolve(process.cwd(), "../examples/simple_house_efh.ifc"),
    path.resolve(process.cwd(), "examples/simple_house_efh.ifc"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`exemple IFC introuvable (cwd=${process.cwd()})`);
  const bytes = readFileSync(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Pool dont tous les Workers sont mort-nés (chunk illivable). */
function deadPool(): IfcWorkerPool {
  const pool = new IfcWorkerPool();
  vi.spyOn(pool, "parse").mockRejectedValue(
    new IfcWorkerBootError("script simulé illivable"),
  );
  return pool;
}

describe("importIfcResilient", () => {
  it("Worker disponible : moteur worker, sans repli", async () => {
    const pool = new IfcWorkerPool();
    vi.spyOn(pool, "parse").mockResolvedValue({
      modelID: -1,
      elementCount: 42,
      schema: "IFC2X3",
      durationMs: 3,
      takeoff: { elements: [] },
      validated: false,
    } as never);

    const result = await importIfcResilient(pool, exampleBuffer, "maison.ifc");

    expect(result.engine).toBe("worker");
    expect(result.payload.elementCount).toBe(42);
  });

  it("Worker mort-né : REPLI thread principal — l'import réussit quand même, avec les quantités réelles", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await importIfcResilient(deadPool(), exampleBuffer, "simple_house_efh.ifc");

    expect(result.engine).toBe("main-thread");
    expect(result.payload.elementCount).toBeGreaterThan(0);
    expect(result.payload.takeoff.elements.length).toBeGreaterThan(0);
    expect(result.payload.validated).toBe(false);
    warnSpy.mockRestore();
  });

  it("fichier corrompu EN repli : erreur explicite, jamais de crash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const garbage = new TextEncoder().encode("#1=IFCWALL('x',));\nPAS UN STEP ###").buffer as ArrayBuffer;

    await expect(importIfcResilient(deadPool(), async () => garbage, "casse.ifc")).rejects.toThrow(
      /DATA|gültige|illisible/i,
    );
    warnSpy.mockRestore();
  });

  it("échec de PARSING côté Worker : jamais de repli (le fichier est en cause, pas l'environnement)", async () => {
    const pool = new IfcWorkerPool();
    const parseSpy = vi
      .spyOn(pool, "parse")
      .mockRejectedValue(new Error("Échec du parsing IFC [TAKEOFF_FAILED] : structure illisible"));

    await expect(importIfcResilient(pool, exampleBuffer, "maison.ifc")).rejects.toThrow(
      /TAKEOFF_FAILED/,
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });
});
