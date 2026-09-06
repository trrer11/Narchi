/**
 * TEST ANTI-REGRESSION "camPos is not defined" (crash a l'import IFC).
 * Reproduit le scenario reel : creation du LODManager par RealIfcViewer,
 * enregistrement d'objets, puis update() appele a chaque frame de rendu.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LODManager } from "./LODManager";

describe("LODManager - boucle de rendu apres import IFC", () => {
  it("update() ne leve plus ReferenceError (camPos) sur 120 frames simulees", () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 10000);
    const lod = new LODManager(camera);

    // Scene realiste : objets sur chaque couche IFC
    for (const layer of ["walls", "slabs", "struct", "openings", "stairs", "spaces", "other"]) {
      lod.registerObject(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), layer);
    }
    
    // Test that registered objects exist
    const stats = lod.getStats();
    expect(stats.length).toBeGreaterThan(0);

    // 120 frames avec camera mobile (zoom in/out comme un architecte)
    expect(() => {
      for (let frame = 0; frame < 120; frame++) {
        const d = 5 + Math.abs(Math.sin(frame / 10)) * 100;
        camera.position.set(d * 0.7, d * 0.5, d * 0.7);
        lod.update();
      }
    }).not.toThrow();
  });

  it("la visibilite LOD reagit reellement a la distance camera", () => {
    const camera = new THREE.PerspectiveCamera();
    const lod = new LODManager(camera);
    const decorative = new THREE.Mesh(new THREE.BoxGeometry());
    // Move decorative to origin
    decorative.position.set(0, 0, 0);
    decorative.updateMatrixWorld();
    
    lod.registerObject(decorative, "other"); // DECORATIVE => visible < 15m

    camera.position.set(0, 0, 5);   // proche
    lod.update();
    expect(decorative.visible).toBe(true);

    camera.position.set(0, 0, 200); // loin
    lod.update();
    expect(decorative.visible).toBe(false);
  });
});
