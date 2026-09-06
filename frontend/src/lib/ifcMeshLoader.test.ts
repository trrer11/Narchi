// @vitest-environment node
/**
 * Test d'extraction de géométrie réelle (web-ifc, thread principal — aucun
 * Worker, aucun navigateur). Exécuté sous environnement NODE pour que
 * web-ifc lise son WASM via le système de fichiers (node_modules/web-ifc),
 * exactement comme il le lira via HTTP /ifc/web-ifc.wasm dans le navigateur.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadIfcMeshes } from "./ifcMeshLoader";
import { resolveStoreyZeroAnchor } from "./ifcStoreyZero";
import { parseIfcBytes } from "./ifcParser";

function exampleText(): string {
  const candidates = [
    path.resolve(process.cwd(), "../examples/simple_house_efh.ifc"),
    path.resolve(process.cwd(), "examples/simple_house_efh.ifc"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`exemple IFC introuvable (cwd=${process.cwd()})`);
  return readFileSync(file, "utf-8");
}

function exampleBytes(): Uint8Array {
  return new TextEncoder().encode(exampleText());
}

function wasmBaseFromNodeModules(): string {
  const candidates = [
    path.resolve(process.cwd(), "node_modules/web-ifc") + "/",
    path.resolve(process.cwd(), "../node_modules/web-ifc") + "/",
  ];
  const dir = candidates.find((candidate) => existsSync(path.join(candidate, "web-ifc.wasm")));
  if (!dir) throw new Error("node_modules/web-ifc introuvable (npm ci requis)");
  return dir;
}

describe("loadIfcMeshes — géométrie réelle sans Worker", () => {
  it("extrait des maillages réels de l'IFC d'exemple (groupes, bbox, budgets)", async () => {
    const progress: Array<[number, string]> = [];
    const result = await loadIfcMeshes(exampleBytes(), {
      wasmBase: wasmBaseFromNodeModules(),
      onProgress: (ratio, stage) => progress.push([ratio, stage]),
      yieldControl: async () => undefined,
    });

    expect(result.meshCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBeGreaterThanOrEqual(100);
    expect(result.triangleCount).toBeGreaterThanOrEqual(40);
    // 4 couleurs distinctes : béton brut, dalle, verre, chêne.
    expect(result.groups.length).toBe(4);
    expect(result.schema).toMatch(/IFC/i);

    // Tampons cohérents.
    let indexedVerts = 0;
    for (const group of result.groups) {
      expect(group.positions.length).toBe(group.normals.length);
      expect(group.positions.length % 3).toBe(0);
      expect(group.indices.length % 3).toBe(0);
      const maxIndex = Math.max(...group.indices);
      expect(maxIndex).toBeLessThan(group.positions.length / 3);
      for (const channel of group.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      indexedVerts = Math.max(indexedVerts, maxIndex);
    }
    expect(indexedVerts).toBeGreaterThan(0);
    // Normales unitaires (premier groupe, premier sommet).
    const n0 = Math.hypot(
      result.groups[0].normals[0],
      result.groups[0].normals[1],
      result.groups[0].normals[2],
    );
    expect(n0).toBeGreaterThan(0.5);
    expect(n0).toBeLessThan(1.5);

    // Bbox finie et non dégénérée — web-ifc est Y-up : la hauteur du
    // bâtiment est l'axe 1 (y), la largeur l'axe 0 (x).
    for (let axis = 0; axis < 3; axis++) {
      expect(Number.isFinite(result.bbox.min[axis])).toBe(true);
      expect(Number.isFinite(result.bbox.max[axis])).toBe(true);
    }
    const height = result.bbox.max[1] - result.bbox.min[1];
    const width = result.bbox.max[0] - result.bbox.min[0];
    expect(height).toBeGreaterThan(1); // mur de 3 m
    expect(width).toBeGreaterThan(1); // emprise de 10 m

    // Progression rapportée et bornée.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0][0]).toBeGreaterThan(0);
    expect(progress[progress.length - 1][0]).toBe(1);

    // ±0,00 : ancré sur le niveau le plus bas de l'IFC (placement z=0 ici).
    expect(result.origin.basis).toBe("storey");
    expect(result.origin.storeyName).toBe("Erdgeschoss");
    expect(result.origin.shiftZ).toBe(0);
  }, 120_000);

  it("ancre ±0,00 : niveau du projet à z=5 affiché à z=0 (cas utilisateur)", async () => {
    // Simule l'IFC utilisateur : le placement du BÂTIMENT porte un offset +5
    // (point de base du projet) — sans correction, le niveau 5 du projet
    // s'affichait au niveau 0 du programme… qui lit 0 alors qu'il devrait
    // lire ±0,00 ANCRÉ sur le projet. On attend : correction à z=0 exact.
    const mutated = exampleText().replace(
      "#22=IFCCARTESIANPOINT((0.,0.,0.));",
      "#22=IFCCARTESIANPOINT((0.,0.,5.));",
    );
    expect(mutated).not.toBe(exampleText());

    const parsed = parseIfcBytes(new TextEncoder().encode(mutated), "anchor.ifc");
    const anchor = resolveStoreyZeroAnchor(parsed.entities);
    expect(anchor).not.toBeNull();
    expect(anchor!.z).toBe(5);
    expect(anchor!.storeyName).toBe("Erdgeschoss");

    const result = await loadIfcMeshes(new TextEncoder().encode(mutated), {
      wasmBase: wasmBaseFromNodeModules(),
      yieldControl: async () => undefined,
    });
    expect(result.origin.basis).toBe("storey");
    expect(result.origin.shiftZ).toBe(5);
    // Après correction : le niveau le plus bas du projet est posé sur 0
    // (axe Y = hauteur, convention web-ifc Y-up).
    expect(result.bbox.min[1]).toBeCloseTo(0, 3);
    // Et chaque sommet livré est bien décalé de −5 sur l'axe hauteur.
    for (const group of result.groups) {
      for (let i = 1; i < group.positions.length; i += 3) {
        expect(group.positions[i]).toBeGreaterThanOrEqual(-0.001);
      }
    }
  }, 120_000);

  it("respecte le budget sommets (exception exploitable vers le repli boîtes)", async () => {
    await expect(
      loadIfcMeshes(exampleBytes(), {
        wasmBase: wasmBaseFromNodeModules(),
        maxVertices: 10,
        yieldControl: async () => undefined,
      }),
    ).rejects.toThrow(/Budget sommets/i);
  }, 120_000);

  it("rejette proprement une entrée qui n'est pas un IFC", async () => {
    await expect(
      loadIfcMeshes(new TextEncoder().encode("PAS UN IFC ###"), {
        wasmBase: wasmBaseFromNodeModules(),
      }),
    ).rejects.toThrow();
  }, 120_000);
});
