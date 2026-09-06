import { describe, expect, it } from "vitest";
import { AuditEngine, numericProperty } from "@/lib/AuditEngine";
import type { BuildingElement } from "@/data/types";

/// Élément minimal conforme au type BuildingElement du projet.
function element(over: Partial<BuildingElement>): BuildingElement {
  return {
    id: "el-1",
    guid: "guid-1",
    code: "330",
    classificationLabel: "Tragende Bauteile",
    name: "Bauteil",
    type: "IFCWALLSTANDARDCASE",
    materialId: "mat-concrete",
    level: "EG",
    projectId: "p1",
    status: "modeled",
    qty: 1,
    unit: "m",
    weightKg: 100,
    cost: 50,
    carbonKg: 10,
    properties: [],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
    ...over,
  };
}

describe("AuditEngine — numericProperty (lecture tolérante IFC)", () => {
  it("lit une clé directe par synonyme (Width → width)", () => {
    const el = element({ properties: [{ key: "Width", value: "0.24" }] });
    expect(numericProperty(el, ["width"])).toBe(0.24);
  });

  it("lit la mesure dans le bloc JSON « Quantité brute » (BaseQuantities)", () => {
    const el = element({
      properties: [
        { key: "Quantité brute", value: JSON.stringify({ Width: 0.3, GrossVolume: 84 }) },
        { key: "Express ID", value: "42" },
      ],
    });
    expect(numericProperty(el, ["width"])).toBe(0.3);
  });

  it("accepte les virgules décimales et ignore les clés sans rapport", () => {
    const el = element({ properties: [{ key: "Breite", value: "0,875" }] });
    expect(numericProperty(el, ["width", "breite"])).toBe(0.875);
    expect(numericProperty(el, ["height"])).toBeNull();
  });

  it("survit à un JSON corrompu sans lever d'exception", () => {
    const el = element({ properties: [{ key: "blob", value: "{\"Width\": }" }] });
    expect(numericProperty(el, ["width"])).toBeNull();
  });
});

describe("AuditEngine — règles réellement évaluées (fin du « 0 Violations » muet)", () => {
  it("porte trop étroite via BaseQuantities → violation critical DIN 18040", () => {
    const door = element({
      type: "IFCDOOR",
      name: "Tür EG-01",
      properties: [{ key: "Quantité brute", value: JSON.stringify({ Width: 0.78, Height: 2.1 }) }],
    });
    const report = AuditEngine.runFullAudit([door]);
    const issue = report.issues.find((i) => i.ruleId === "DIN-18040-DOOR-WIDTH");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("critical");
    expect(issue?.measuredValue).toContain("0.78");
  });

  it("porte conforme → aucune violation mais couverture comptabilisée", () => {
    const door = element({
      type: "IFCDOOR",
      properties: [{ key: "Width", value: "1.0" }, { key: "Height", value: "2.1" }],
    });
    const report = AuditEngine.runFullAudit([door]);
    expect(report.issues.filter((i) => i.ruleId.startsWith("DIN-18040"))).toHaveLength(0);
    const stat = report.ruleStats.find((s) => s.ruleId === "DIN-18040-DOOR-WIDTH");
    expect(stat?.checked).toBe(1);
    expect(stat?.measurable).toBe(1);
    expect(stat?.violations).toBe(0);
  });

  it("mur + BaseQuantities Width = épaisseur évaluée (pas de skip muet)", () => {
    const wall = element({
      type: "IFCWALLSTANDARDCASE",
      properties: [{ key: "Quantité brute", value: JSON.stringify({ Width: 0.24 }) }],
    });
    const report = AuditEngine.runFullAudit([wall]);
    const stat = report.ruleStats.find((s) => s.ruleId === "STRUCT-WALL-THICKNESS");
    expect(stat?.checked).toBe(1);
    expect(stat?.measurable).toBe(1); // 0,24 m ≥ 0,15 → conforme, mais MESURÉ
    expect(stat?.violations).toBe(0);
  });

  it("fenêtre au-dessus du seuil GEG → violation major (U-Wert synonyme)", () => {
    const win = element({
      type: "IFCWINDOW",
      properties: [{ key: "ThermalTransmittance", value: "1.8" }],
    });
    const report = AuditEngine.runFullAudit([win]);
    const issue = report.issues.find((i) => i.ruleId === "GEG-U-VALUE-WINDOW");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("major");
  });

  it("élément sans données mesurables : couverture 0, aucune violation factice", () => {
    const wall = element({ type: "IFCWALL" });
    const report = AuditEngine.runFullAudit([wall]);
    const stat = report.ruleStats.find((s) => s.ruleId === "STRUCT-WALL-THICKNESS");
    expect(stat?.checked).toBe(1);
    expect(stat?.measurable).toBe(0);
    expect(report.totalIssues).toBe(0);
  });
});
