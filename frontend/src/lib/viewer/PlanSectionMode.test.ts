import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildSectionPlane,
  sectionHeightBounds,
  suggestKostengruppe,
} from "./PlanSectionMode";

describe("PlanSectionMode — mapping IFC → Kostengruppe DIN 276", () => {
  it("mappe les classes IFC majeures sur les bonnes KG", () => {
    expect(suggestKostengruppe(["IfcWallStandardCase"])?.kg).toBe("KG 320");
    expect(suggestKostengruppe(["IfcSlab"])?.kg).toBe("KG 340");
    expect(suggestKostengruppe(["IfcWindow"])?.kg).toBe("KG 361");
    expect(suggestKostengruppe(["IfcDoor"])?.kg).toBe("KG 362");
    expect(suggestKostengruppe(["IfcFooting"])?.kg).toBe("KG 310");
    expect(suggestKostengruppe(["IfcBoiler"])?.kg).toBe("KG 420");
  });

  it("retourne null pour une classe non couverte", () => {
    expect(suggestKostengruppe(["IfcFurniture"])).toBeNull();
    expect(suggestKostengruppe([])).toBeNull();
  });

  it("est insensible à la casse IFC des exports Revit", () => {
    expect(suggestKostengruppe(["ifcstair"])?.kg).toBe("KG 366");
  });
});

describe("PlanSectionMode — géométrie du plan de coupe", () => {
  it("conserve les points sous la hauteur de coupe", () => {
    const plane = buildSectionPlane(1.4);
    // Distance signée positive = conservé (sous la coupe).
    expect(plane.distanceToPoint(new THREE.Vector3(0, 0.5, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 3.0, 0))).toBeLessThan(0);
    expect(plane.distanceToPoint(new THREE.Vector3(5, 1.4, -2))).toBeCloseTo(0, 6);
  });

  it("déduit des bornes de coupe cohérentes de la boîte englobante", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-5, 0, -5),
      new THREE.Vector3(5, 9.3, 5),
    );
    const bounds = sectionHeightBounds(box);
    expect(bounds.min).toBe(0);
    expect(bounds.max).toBeCloseTo(9.3, 5);
    // Coupe initiale à 1,40 m (convention Grundriss)
    expect(bounds.initial).toBeCloseTo(1.4, 5);
    expect(bounds.initial).toBeGreaterThan(bounds.min);
    expect(bounds.initial).toBeLessThanOrEqual(bounds.max);
  });

  it("plafonne la coupe initiale au sommet pour un modèle bas", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(4, 0.8, 4),
    );
    const bounds = sectionHeightBounds(box);
    expect(bounds.initial).toBeCloseTo(0.8, 5);
  });
});
