import { describe, expect, it } from "vitest";
import { ClashDetector } from "@/lib/planpruefung";
import { AuditEngine } from "@/lib/AuditEngine";
import { IFC_HARD_LIMIT_BYTES, IFC_TOO_LARGE_ERROR, loadIfcMeshes, meshBudgetsForSize } from "@/lib/ifcMeshLoader";
import type { BuildingElement } from "@/data/types";

function element(id: string, type: string, bbox: [number, number, number, number, number, number] | null): BuildingElement {
  return {
    id,
    guid: `g-${id}`,
    code: "320",
    classificationLabel: "Wände",
    name: `Bauteil ${id}`,
    type,
    materialId: "mat-concrete",
    level: "EG",
    projectId: "p1",
    status: "modeled",
    qty: 1,
    unit: "m",
    weightKg: 10,
    cost: 1,
    carbonKg: 1,
    properties: [
      { key: "Quantité brute", value: JSON.stringify({ Width: 0.24, Height: 2.5, GrossVolume: 4.2 }) },
      ...(bbox ? [{ key: "bbox", value: JSON.stringify(bbox) }] : []),
    ],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
  };
}

describe("Performance QC & Conformité (page longue à ouvrir)", () => {
  it("1 600 éléments avec bbox : détection < 3 s (parse unitaire, plus de re-parse par paire)", () => {
    // Grille d'espacement 10 m : quelques collisions contrôlées seulement
    // (sinon 1,3 M d'objets clash exploseraient la mémoire du test).
    const elements: BuildingElement[] = [];
    for (let i = 0; i < 1600; i++) {
      const x = (i % 40) * 10;
      const y = Math.floor(i / 40) * 10;
      // Tous les multiples de 13 débordent de 1 m sur leur voisin +x
      const w = i % 13 === 0 ? 11 : 4;
      elements.push(element(`el-${i}`, "IFCWALL", [x, y, 0, x + w, y + 4, 3]));
    }
    const started = performance.now();
    const clashes = ClashDetector.detectClashes(elements);
    const elapsed = performance.now() - started;
    expect(clashes.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3000);
  });

  it("2 000 murs avec bloc BaseQuantities : audit complet < 2,5 s (cache de mesures)", () => {
    const walls = Array.from({ length: 2000 }, (_, i) => element(`w-${i}`, "IFCWALLSTANDARDCASE", null));
    const started = performance.now();
    const report = AuditEngine.runFullAudit(walls);
    const elapsed = performance.now() - started;
    expect(report.ruleStats.find((s) => s.ruleId === "STRUCT-WALL-THICKNESS")?.measurable).toBe(2000);
    expect(elapsed).toBeLessThan(2500);
  });
});

describe("Budgets adaptatifs gros IFC", () => {
  it("paliers : < 8 Mo plein détail, 8-20 Mo réduit, > 20 Mo fortement réduit", () => {
    expect(meshBudgetsForSize(7_000_000)).toEqual({ maxVertices: 3_000_000, maxMeshes: 60_000, degraded: false, note: null });
    expect(meshBudgetsForSize(10_000_000).degraded).toBe(true);
    expect(meshBudgetsForSize(10_000_000).maxVertices).toBe(1_600_000);
    expect(meshBudgetsForSize(25_000_000).maxMeshes).toBe(18_000);
    expect(meshBudgetsForSize(25_000_000).note).toContain("20 MB");
  });

  it("au-delà de 60 Mo : refus propre AVANT tout chargement WASM (repli boîtes)", async () => {
    await expect(loadIfcMeshes(new Uint8Array(IFC_HARD_LIMIT_BYTES + 1))).rejects.toThrow(IFC_TOO_LARGE_ERROR);
  });
});
