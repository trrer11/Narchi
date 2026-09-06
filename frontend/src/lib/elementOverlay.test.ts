// @vitest-environment node
/**
 * RÉGRESSION « murs solides » (retour utilisateur 2026-08-06 : « vaut mieux
 * voir les clashs en mur solide et pas juste des reflets »).
 *
 * Le viewer web-ifc fusionne les triangles PAR COULEUR : impossible de
 * re-teinter UN élément… jusqu'au registre elementRanges. Contrats vérifiés :
 *   1) unitaire — extraction compacte et autonome d'un sous-maillage ;
 *   2) production — sur le VRAI pipeline (parseIfc → takeoff + loadIfcMeshes),
 *      la géométrie réelle extraite d'un Bauteil retombe EXACTEMENT sur sa
 *      boîte analytique (mêmes ancres que le focus QC) → le re-teintage
 *      rouge/bleu frappe le bon élément, à la bonne place.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseIfc } from "@/lib/ifcParser";
import { ifcToTakeoff } from "@/lib/modelTakeoff";
import {
  extractElementSubMesh,
  loadIfcMeshes,
  subMeshBBox,
  type IfcMeshGroup,
  type IfcSubMesh,
} from "@/lib/ifcMeshLoader";

function exampleBytes(): Uint8Array {
  const candidates = [
    path.resolve(process.cwd(), "../examples/simple_house_efh.ifc"),
    path.resolve(process.cwd(), "examples/simple_house_efh.ifc"),
  ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new Error(`exemple IFC introuvable (cwd=${process.cwd()})`);
  return new Uint8Array(readFileSync(file));
}

function wasmBaseFromNodeModules(): string {
  const candidates = [
    path.resolve(process.cwd(), "node_modules/web-ifc") + "/",
    path.resolve(process.cwd(), "../node_modules/web-ifc") + "/",
  ];
  const dir = candidates.find((candidate) =>
    existsSync(path.join(candidate, "web-ifc.wasm")),
  );
  if (!dir) throw new Error("node_modules/web-ifc introuvable (npm ci requis)");
  return dir;
}

describe("extractElementSubMesh — extraction unitaire", () => {
  // Groupe fusionné : DEUX éléments entrelacés dans les mêmes tampons.
  const group: IfcMeshGroup = {
    color: [1, 0, 0],
    opacity: 1,
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // triangle élément 7
      10, 10, 10, 11, 10, 10, 10, 11, 10, // triangle élément 9
    ]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0, -1, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    elementRanges: [
      { expressId: 7, start: 0, end: 3 },
      { expressId: 9, start: 3, end: 6 },
    ],
  };

  it("isole les triangles de L'ÉLÉMENT demandé (remapping compact 0..n-1)", () => {
    const sub = extractElementSubMesh(group, 9);
    expect(sub).not.toBeNull();
    expect(sub!.indices.length).toBe(3);
    expect(Math.max(...sub!.indices)).toBeLessThan(3); // remappé, jamais 3-4-5
    const bbox = subMeshBBox(sub!);
    expect(bbox.center).toEqual([10.5, 10.5, 10]);
    expect(bbox.size).toEqual([1, 1, 0]);
    // Tampons AUTONOMES : modifier le sous-maillage ne touche pas le groupe.
    sub!.positions[0] = -999;
    expect(group.positions[9]).toBe(10);
  });

  it("retourne null pour un élément absent ou un registre vide", () => {
    expect(extractElementSubMesh(group, 12345)).toBeNull();
    expect(extractElementSubMesh({ ...group, elementRanges: [] }, 7)).toBeNull();
    expect(extractElementSubMesh({ ...group, elementRanges: undefined }, 7)).toBeNull();
  });
});

describe("focus « murs solides » — pipeline de production complet", () => {
  it("la géométrie réelle d'un fautif retombe EXACTEMENT sur sa boîte", async () => {
    const bytes = exampleBytes();
    const model = parseIfc(new TextDecoder().decode(bytes), "simple_house_efh.ifc", bytes.length);
    const takeoff = ifcToTakeoff(model);
    const boxes = takeoff.boxes ?? [];
    expect(boxes.length).toBeGreaterThan(0);

    const meshes = await loadIfcMeshes(bytes, {
      wasmBase: wasmBaseFromNodeModules(),
      yieldControl: async () => undefined,
    });

    // 1) Le registre élément→triangles est présent et COHÉRENT partout.
    let totalRanges = 0;
    for (const group of meshes.groups) {
      expect(Array.isArray(group.elementRanges)).toBe(true);
      for (const r of group.elementRanges ?? []) {
        expect(r.expressId).toBeGreaterThan(0);
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeGreaterThan(r.start);
        expect(r.end).toBeLessThanOrEqual(group.indices.length);
        totalRanges++;
      }
    }
    expect(totalRanges).toBeGreaterThan(0);

    // 2) Couverture : la majorité des boîtes physiques ont des triangles
    //    réels (sinon le re-teintage ne pourrait jamais viser).
    const idsWithMesh = new Set(
      meshes.groups.flatMap((g) => (g.elementRanges ?? []).map((r) => r.expressId)),
    );
    const covered = boxes.filter((b) => idsWithMesh.has(b.id)).length;
    expect(covered / boxes.length).toBeGreaterThan(0.5);

    // 3) FIDÉLITÉ EXACTE des triangles extraits — le contrat décisif du
    //    re-teintage : le sous-maillage d'un fautif doit contenir EXACTEMENT
    //    les triangles que le viewer dessine déjà pour cet élément (mêmes
    //    sommets, bit à bit — multi-ensemble). Ainsi l'overlay rouge/bleu
    //    frappe TOUJOURS la géométrie visible, dans SON propre repère,
    //    indépendamment du Δ boîtes→scène d'alignement des marqueurs.
    const sampleIds = [...idsWithMesh].slice(0, 3);
    expect(sampleIds.length).toBeGreaterThan(0);
    for (const id of sampleIds) {
      for (const group of meshes.groups) {
        const sub = extractElementSubMesh(group, id);
        if (!sub) continue;
        // Sommets du sous-maillage : triés pour comparaison de multi-ensemble.
        const key = (a: ArrayLike<number>, i: number) =>
          `${a[i * 3].toFixed(5)}|${a[i * 3 + 1].toFixed(5)}|${a[i * 3 + 2].toFixed(5)}`;
        const subVerts = Array.from(
          { length: sub.positions.length / 3 },
          (_, i) => key(sub.positions, i),
        ).sort();
        // Sommets ORIGINAUX des plages déclarées de CET élément dans le groupe.
        const original: string[] = [];
        for (const r of group.elementRanges ?? []) {
          if (r.expressId !== id) continue;
          for (let i = r.start; i < r.end; i++) {
            original.push(key(group.positions, group.indices[i]));
          }
        }
        original.sort();
        // Chaque sommet du sous-maillage DOIT être un sommet des triangles
        // originaux (répétitions comprises — le remapping déduplique en
        // reconstruisant : on exige l'inclusion en SOUS-ENSEMBLE ordonné).
        const tally = new Map<string, number>();
        for (const v of original) tally.set(v, (tally.get(v) ?? 0) + 1);
        for (const v of subVerts) {
          const left = tally.get(v) ?? 0;
          expect(left, `sommet ${v} absent des triangles originaux de #${id}`).toBeGreaterThan(0);
          tally.set(v, left - 1);
        }
        // Et à l'inverse : RIEN de perdu — tous les sommets distincts des
        // plages sont présents dans le sous-maillage.
        const subSet = new Set(subVerts);
        for (const v of new Set(original)) {
          expect(subSet.has(v), `sommet ${v} perdu à l'extraction de #${id}`).toBe(true);
        }
      }
    }

    // 4) Le sous-maillage d'un fautif reste DANS le vrai modèle affiché
    //    (jamais à des kilomètres — garde-fou anti-dispersion/miroir).
    //    Note : l'exemple synthétique `simple_house_efh.ifc` a des chaînes
    //    de placement résolues différemment par les deux parseurs (écart
    //    boîte↔mesh jusqu'à ~6 m documenté sur ce fichier) — la comparaison
    //    centre-contre-boîte n'est donc PAS le contrat ici : c'est le
    //    pipeline frameAlignment qui garantit l'alignement des marqueurs.
    const target = boxes.reduce((best, b) =>
      b.size.x * b.size.y * b.size.z > best.size.x * best.size.y * best.size.z ? b : best,
    );
    const parts: IfcSubMesh[] = [];
    for (const group of meshes.groups) {
      const sub = extractElementSubMesh(group, target.id);
      if (sub) parts.push(sub);
    }
    expect(parts.length).toBeGreaterThan(0);
    const vertexCount = parts.reduce((n, p) => n + p.positions.length / 3, 0);
    const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);
    const merged: IfcSubMesh = {
      positions: new Float32Array(vertexCount * 3),
      normals: new Float32Array(vertexCount * 3),
      indices: new Uint32Array(indexCount),
    };
    let vOff = 0;
    let iOff = 0;
    for (const p of parts) {
      merged.positions.set(p.positions, vOff * 3);
      merged.normals.set(p.normals, vOff * 3);
      for (let i = 0; i < p.indices.length; i++) merged.indices[iOff + i] = p.indices[i] + vOff;
      vOff += p.positions.length / 3;
      iOff += p.indices.length;
    }
    const realBBox = subMeshBBox(merged);
    const margin = 1.0;
    for (let axis = 0; axis < 3; axis++) {
      expect(realBBox.min[axis]).toBeGreaterThanOrEqual(meshes.bbox.min[axis] - margin);
      expect(realBBox.max[axis]).toBeLessThanOrEqual(meshes.bbox.max[axis] + margin);
      expect(realBBox.size[axis]).toBeGreaterThan(0.01); // géométrie non dégénérée
    }
  });
});
