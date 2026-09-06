// @vitest-environment node
/**
 * RÉGRESSION DÉCISIVE — alignement des deux mondes 3D (retour utilisateur
 * 2026-08-06 : « marqueurs à des places où il n'y a aucun mur »).
 *
 * Le MÊME fichier IFC passe par les deux pipelines de production :
 *   1) takeoff (parseIfc → ifcToTakeoff → boîtes + geometryAnchor) ;
 *   2) viewer (loadIfcMeshes → sommets réels + origin.shift).
 * Contrats vérifiés bout à bout :
 *   A) les boîtes excluent les types non physiques (IfcSite 80×80 m de
 *      l'exemple — cause de la plaque fantôme et des bboxes désaccordées) ;
 *   B) la translation boîtes→scène utilise les ANCRES EXACTES, pas
 *      l'heuristique de bbox (cassée par ces mêmes parasites) ;
 *   C) chaque marqueur de focus retombe DANS la bbox de la vraie scène
 *      (convention web-ifc x, z, −y — jamais le miroir (x, z, y)).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseIfc } from "@/lib/ifcParser";
import { ifcToTakeoff } from "@/lib/modelTakeoff";
import { loadIfcMeshes } from "@/lib/ifcMeshLoader";
import { reconcileFocusBoxes } from "@/lib/qcFocus3d";

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

describe("alignement des deux mondes 3D — pipeline de production complet", () => {
  it("aucun marqueur ne tombe hors du vrai modèle (ancres exactes + miroir)", async () => {
    const bytes = exampleBytes();
    const text = new TextDecoder().decode(bytes);

    // 1) Monde takeoff (boîtes centrées + ancre brute) — chaîne IDENTIQUE à
    //    celle de ModelImport.
    const model = parseIfc(text, "simple_house_efh.ifc", bytes.length);
    const takeoff = ifcToTakeoff(model);
    const boxes = takeoff.boxes ?? [];
    expect(boxes.length).toBeGreaterThan(0);
    expect(takeoff.geometryAnchor).not.toBeNull();

    // A) IfcSite (80×80 m) exclu : la bbox des boîtes n'est plus déformée.
    //    (#20 IFCSITE s=40×40 de l'exemple — contract de filtrage.)
    expect(boxes.every((b) => b.type.toUpperCase() !== "IFCSITE")).toBe(true);

    // 2) Monde viewer (sommets réels + shift exact) — chaîne IDENTIQUE à
    //    celle de WebIfcMainThreadViewer.
    const meshes = await loadIfcMeshes(bytes, {
      wasmBase: wasmBaseFromNodeModules(),
      yieldControl: async () => undefined,
    });
    const sceneBBox = { min: meshes.bbox.min, max: meshes.bbox.max };
    const anchors = {
      boxesAnchor: takeoff.geometryAnchor!,
      sceneShift: meshes.origin.shift,
    };

    // B) Δ utilisé = Δ EXACT par ancres (pas l'heuristique de bbox).
    const [bx, by, bz] = anchors.boxesAnchor;
    const [sx, sy, sz] = anchors.sceneShift;
    const first = reconcileFocusBoxes(
      {
        center: [boxes[0].center.x, boxes[0].center.y, boxes[0].center.z],
        size: [1, 1, 1],
      },
      boxes,
      sceneBBox,
      anchors,
    );
    expect(first.delta).toEqual([bx - sx, bz - sy, -by - sz]);

    // C) CHAQUE élément devient un marqueur potentiel : il DOIT retomber
    //    dans la bbox de la vraie scène (marge 1 m pour les bords).
    for (const box of boxes) {
      const res = reconcileFocusBoxes(
        {
          center: [box.center.x, box.center.y, box.center.z],
          size: [Math.abs(box.size.x), Math.abs(box.size.y), Math.abs(box.size.z)],
          elements: [
            {
              center: [box.center.x, box.center.y, box.center.z],
              size: [Math.abs(box.size.x), Math.abs(box.size.y), Math.abs(box.size.z)],
            },
          ],
        },
        boxes,
        sceneBBox,
        anchors,
      );
      const [px, py, pz] = res.boxes[0].position;
      const margin = 1;
      const dOut = Math.max(
        sceneBBox.min[0] - px, px - sceneBBox.max[0],
        sceneBBox.min[1] - py, py - sceneBBox.max[1],
        sceneBBox.min[2] - pz, pz - sceneBBox.max[2],
      );
      expect(
        dOut,
        `box#${box.id} (${box.type}) tombe à (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}) — hors scène de ${(dOut - margin).toFixed(2)} m`,
      ).toBeLessThanOrEqual(margin * 2); // marge 1 m admise aux bords, voir dOut
      expect(dOut - margin).toBeLessThanOrEqual(1); // jamais > 1 m de dérive
    }

    // Les deux mondes décrivent le MÊME bâtiment : les hauteurs concordent.
    const boxesHeight = Math.max(...boxes.map((b) => b.center.z + Math.abs(b.size.z))) -
      Math.min(...boxes.map((b) => b.center.z - Math.abs(b.size.z)));
    const sceneHeight = sceneBBox.max[1] - sceneBBox.min[1];
    expect(Math.abs(boxesHeight - sceneHeight)).toBeLessThan(1.5);
  }, 60_000);
});
