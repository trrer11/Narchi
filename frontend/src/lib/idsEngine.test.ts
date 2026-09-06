import { describe, expect, it } from "vitest";
import { runIdsAudit, type IdsReport } from "@/lib/idsEngine";
import type { BuildingElement } from "@/data/types";

let seq = 0;
function el(opts: Partial<BuildingElement> & { type: string }): BuildingElement {
  seq += 1;
  return {
    id: `e${seq}`,
    guid: `g-${seq}-unique`,
    code: "330",
    classificationLabel: "T",
    name: `Bauteil ${seq}`,
    materialId: "m",
    level: "EG",
    projectId: "p",
    status: "modeled",
    qty: 1,
    unit: "m³",
    weightKg: 100,
    cost: 1,
    carbonKg: 1,
    properties: [{ key: "bbox", value: JSON.stringify([0, 0, 0, 1, 0.2, 3]) }],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
    ...opts,
  };
}

const rule = (r: IdsReport, id: string) => r.requirements.find((x) => x.id === id)!;

describe("IDS-Abnahme (DIN EN 17412 / COBie) — pass/fail/n.a. honnêtes", () => {
  it("maquette propre → tout passe, label « Abnahme-reif »", () => {
    const clean = [
      el({ type: "IFCWALL", name: "AW-EG-01 Stahlbeton C30/37", level: "EG", properties: [{ key: "bbox", value: "[0,0,0,4,0.3,3]" }, { key: "u-wert", value: "0.24" }] }),
      el({ type: "IFCSLAB", name: "DE-EG-01 Stahlbeton", level: "EG" }),
      el({ type: "IFCDOOR", name: "Tuer-EG-01 0.875", properties: [{ key: "width", value: "0.875" }, { key: "bbox", value: "[0,0,0,1,0.2,2.1]" }] }),
    ];
    const r = runIdsAudit(clean);
    expect(r.overallPassRate).toBe(1);
    expect(r.overallLabel).toContain("Abnahme-reif");
    expect(rule(r, "NQI-01").failed).toBe(0);
    expect(rule(r, "NQI-06").passRate).toBe(1); // U-Wert mesuré (pas na)
  });

  it("GUID dupliquée → NQI-01 échoue avec détail (double sauvegarde Revit)", () => {
    const a = el({ type: "IFCWALL", guid: "duplikat-wand-88" });
    const b = el({ type: "IFCWALL", guid: "DUPLikat-Wand-88" }); // casse tolérée
    const r = runIdsAudit([a, b]);
    expect(rule(r, "NQI-01").failed).toBe(2);
    expect(rule(r, "NQI-01").failing[0].detail).toContain("dupliziert");
  });

  it("élément sans étage → NQI-02 fail ; schéma non allemand → n.a. honnête", () => {
    const r = runIdsAudit([
      el({ type: "IFCWALL", level: "—" }),
      el({ type: "IFCSLAB", level: "Floor 7" }),
      el({ type: "IFCCOLUMN", level: "2. OG" }),
    ]);
    expect(rule(r, "NQI-02").failed).toBe(1);
    expect(rule(r, "NQI-02").na).toBe(1);
    expect(rule(r, "NQI-02").passed).toBe(1);
  });

  it("Stütze sans géométrie → NQI-03 fail (sortir de Revit en volumes)", () => {
    const r = runIdsAudit([
      el({ type: "IFCCOLUMN", name: "Stuetze S1 Stahlbeton", properties: [] }),
      el({ type: "IFCDOOR", name: "T1 0.9", properties: [] }), // porte : pas dans le périmètre NQI-03
    ]);
    expect(rule(r, "NQI-03").checked).toBe(1);
    expect(rule(r, "NQI-03").failed).toBe(1);
    expect(rule(r, "NQI-03").failing[0].detail).toContain("Keine Geometrie");
  });

  it("matériau : non rapproché → fail ; seulement classe → n.a. ; nom → pass", () => {
    const r = runIdsAudit([
      el({ type: "IFCWALL", name: "Beton C30/37 Wand" }),       // pass nom
      el({ type: "IFCSLAB", name: "Decke x-99" }),               // na (classe → Näherung stahlbeton)
      el({ type: "IFCFOO", name: "????" }),                      // fail (classe inconnue + nom vide)
    ]);
    const stat = rule(r, "NQI-04");
    expect(stat.passed).toBe(1);
    expect(stat.na).toBe(1);
    expect(stat.failed).toBe(1);
  });

  it("portes : sans largeur → n.a. ; 0,72 m → fail ; 0,81 m → fail barrierefrei ; 0,875 → pass", () => {
    const r = runIdsAudit([
      el({ type: "IFCDOOR", name: "T1", properties: [] }),
      el({ type: "IFCDOOR", name: "T2 0.72", properties: [{ key: "width", value: "0.72" }] }),
      el({ type: "IFCDOOR", name: "T3 0.81", properties: [{ key: "width", value: "0.81" }] }),
      el({ type: "IFCDOOR", name: "T4 0.875", properties: [{ key: "width", value: "0.875" }] }),
    ]);
    const stat = rule(r, "NQI-05");
    expect(stat.na).toBe(1);
    expect(stat.failed).toBe(2);
    expect(stat.passed).toBe(1);
    expect(stat.failing.map((f) => f.name)).toContain("T3 0.81");
    expect(stat.failing.find((f) => f.name === "T3 0.81")?.detail).toContain("barrierefrei");
  });

  it("U-Wert : absent → n.a. (jamais conforme silencieux) ; 0,32 → fail ; 0,20 → pass", () => {
    const r = runIdsAudit([
      el({ type: "IFCWALL", name: "AW Beton", properties: [] }),
      el({ type: "IFCWALL", name: "AW Beton 2", properties: [{ key: "u-wert", value: "0.32" }] }),
      el({ type: "IFCWALL", name: "AW Beton 3", properties: [{ key: "u-wert", value: "0.2" }] }),
      el({ type: "IFCCURTAINWALL", name: "Fassade", properties: [] }),
    ]);
    const stat = rule(r, "NQI-06");
    expect(stat.checked).toBe(3); // CurtainWALL hors périmètre
    expect(stat.na).toBe(1);
    expect(stat.failed).toBe(1);
    expect(stat.passed).toBe(1);
    expect(stat.passRate).toBeCloseTo(0.5, 5);
  });

  it("COBie-Namen : « Wall-0123 » generika → fail ; « AW-EG-01 C30/37 » → pass", () => {
    const r = runIdsAudit([
      el({ type: "IFCWALL", name: "Wall-0123" }),
      el({ type: "IFCWALL", name: "AW-EG-01 Stahlbeton C30/37" }),
      el({ type: "IFCSLAB", name: "x" }),
    ]);
    const stat = rule(r, "NQI-07");
    expect(stat.failed).toBe(2);
    expect(stat.passed).toBe(1);
  });

  it("KG DIN 276 : « 330 » passe ; code « — » ou vide → fail", () => {
    const r = runIdsAudit([el({ type: "IFCWALL", code: "330" }), el({ type: "IFCSLAB", code: "—" }), el({ type: "IFCDOOR", code: "abc" })]);
    expect(rule(r, "NQI-08").failed).toBe(2);
    expect(rule(r, "NQI-08").passed).toBe(1);
  });

  it("quantité : qty 0 → fail (AVA impossible) ; IFCSPACE = zombie → fail NQI-10", () => {
    const r = runIdsAudit([el({ type: "IFCWALL", qty: 0 }), el({ type: "IFCSPACE", name: "Büroraum 1.03", qty: 0 })]);
    expect(rule(r, "NQI-09").failed).toBeGreaterThanOrEqual(1);
    expect(rule(r, "NQI-10").failed).toBe(1);
  });

  it("global : tri pires d'abord, passRate global exact, caps ≥ seuils label", () => {
    const r = runIdsAudit([
      el({ type: "IFCWALL", name: "Wall-0123", level: "—", properties: [] }), // plusieurs fails
      el({ type: "IFCDOOR", name: "Tuer-EG-01 0.9", properties: [{ key: "width", value: "0.9" }] }),
    ]);
    // la règle la plus fautive arrive en tête
    expect(r.requirements[0].failed).toBeGreaterThanOrEqual(r.requirements[r.requirements.length - 1].failed);
    expect(r.overallPassRate).not.toBeNull();
    expect(r.overallLabel).not.toContain("Abnahme-reif");
    expect(r.measurableElements).toBeGreaterThan(0);
    expect(r.totalElements).toBe(2);
  });

  it("failing-cap : au plus 12 éléments listés par règle (DOM protégé)", () => {
    const walls = Array.from({ length: 30 }, () => el({ type: "IFCWALL", name: "Wall-XX", level: "—", properties: [] }));
    const r = runIdsAudit(walls);
    expect(rule(r, "NQI-02").failing.length).toBeLessThanOrEqual(12);
  });

  it("contrat anti-corruption §36 : aucun caractère CJK/plein-format", () => {
    const r = runIdsAudit([el({ type: "IFCWALL", name: "Wall-1", level: "—", properties: [] })]);
    // eslint-disable-next-line no-control-regex
    expect(/[\u4e00-\u9fff\uff00-\uffef]/.test(JSON.stringify(r))).toBe(false);
  });
});
