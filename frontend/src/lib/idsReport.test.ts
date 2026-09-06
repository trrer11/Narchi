import { describe, expect, it } from "vitest";
import { idsReportCsv, idsReportHtml, idsVerdictLabel } from "@/lib/idsReport";
import { runIdsAudit, type IdsReport, type IdsRuleStat } from "@/lib/idsEngine";
import type { BuildingElement } from "@/data/types";

function el(id: string, type: string, opts: Partial<BuildingElement> = {}): BuildingElement {
  return {
    id, guid: `guid-${id}`, code: "320", classificationLabel: "T", name: `Element ${id}`, type,
    materialId: "m", level: "EG", projectId: "p", status: "modeled", qty: 1, unit: "m",
    weightKg: 1, cost: 1, carbonKg: 1, properties: [], lastUpdated: "2026-08-06T00:00:00.000Z", conflicts: 0,
    ...opts,
  };
}

const meta = {
  projectName: "Büro <Neubau> & Halle",
  sourceLabel: "Modell-Takeoff · 3 Bauteile",
  generatedAt: new Date("2026-08-06T10:30:00Z"),
};

const fakeRule = (over: Partial<IdsRuleStat>): IdsRuleStat => ({
  id: "NQI-01", title: "GUID eindeutig", category: "ALLGEMEIN", basis: "buildingSMART IDS",
  suggestion: "GUIDs neu generieren.", checked: 10, passed: 8, failed: 2, na: 0,
  passRate: 0.8, failing: [
    { elementId: "e1", expressId: 42, name: "Wand <Nord> & Co", level: "EG", detail: "GUID doppelt belegt" },
  ],
  ...over,
});

describe("§45 idsReportCsv — CSV allemand auditable", () => {
  const report: IdsReport = {
    requirements: [fakeRule({}), fakeRule({ id: "NQI-06", passRate: null, failed: 0, passed: 0, na: 10, failing: [], suggestion: "U-Wert eintragen." })],
    measurableElements: 10, totalElements: 12, overallPassRate: 0.8, overallLabel: "Klärungsbedarf vor Eingang",
  };

  it("en-tête traçable + une ligne par exigence + statut honnête", () => {
    const csv = idsReportCsv(report, meta);
    expect(csv).toContain("IDS-EINGANGSKONTROLLE");
    expect(csv).toContain("Projekt;Büro <Neubau> & Halle");
    expect(csv).toContain("GESAMT;80,0 % – Klärungsbedarf vor Eingang");
    expect(csv).toContain("NQI-01;GUID eindeutig;ALLGEMEIN");
    expect(csv).toContain("NQI-06");
    expect(csv).toContain("nicht prüfbar (Daten fehlen)");
    expect(csv).toContain("FEHLERHAFTE BAUTEILE");
    expect(csv).toContain("Wand <Nord> & Co");
    expect(csv.split("\r\n").length).toBeGreaterThan(6);
  });

  it("zéro erreur → pas de section fautive, et pas de CJK", () => {
    const clean: IdsReport = { ...report, requirements: [fakeRule({ failing: [], failed: 0, passed: 10, passRate: 1 })], overallPassRate: 1, overallLabel: "Abnahme-reif ✅" };
    const csv = idsReportCsv(clean, meta);
    expect(csv).not.toContain("FEHLERHAFTE BAUTEILE");
    expect(csv).not.toMatch(/[\u4e00-\u9fff\uff00-\uffef]/);
  });
});

describe("§45 idsReportHtml — document imprimable autonome (→ PDF)", () => {
  const report: IdsReport = {
    requirements: [fakeRule({})],
    measurableElements: 8, totalElements: 10, overallPassRate: 0.8, overallLabel: "Restpunkte klären",
  };
  const html = idsReportHtml(report, meta);

  it("contient le bouton d'impression, les chiffres 1:1 et l'échappement HTML", () => {
    expect(html).toContain("window.print()");
    expect(html).toContain("Als PDF speichern");
    expect(html).toContain("80,0 % — Restpunkte klären");
    expect(html).toContain("8 von 10");
    expect(html).toContain("Wand &lt;Nord&gt; &amp; Co");
    expect(html).toContain("Büro &lt;Neubau&gt; &amp; Halle");
    expect(html).toContain("GUID doppelt belegt");
    expect(html).not.toMatch(/[\u4e00-\u9fff\uff00-\uffef]/);
  });

  it("aucune ressource externe (aperçu sandbox + autonomie d'archivage)", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("@import");
  });
});

describe("§45 verdicts + intégration moteur réel §41", () => {
  it("barème : fail > OK > n.a. (jamais d'invention)", () => {
    expect(idsVerdictLabel(fakeRule({}))).toBe("FEHLER");
    expect(idsVerdictLabel(fakeRule({ failed: 0, passed: 10, passRate: 1 }))).toBe("OK");
    expect(idsVerdictLabel(fakeRule({ passRate: null, failed: 0, passed: 0, na: 10 }))).toBe("nicht prüfbar (Daten fehlen)");
  });

  it("un VRAI rapport §41 (modèle minimal) produit 10 lignes sans planter", () => {
    const real = runIdsAudit([
      el("a", "WALL"), el("b", "DOOR", { properties: [{ key: "Width", value: "0.90" }] }), el("el-7", "COLUMN"),
    ]);
    const csv = idsReportCsv(real, meta);
    // Lignes d'exigences = 10 champs « ; » (les lignes BAUTEILE fautifs en ont 6).
    const rows = csv.split("\r\n").filter((l) => /^NQI-\d{2};/.test(l) && l.split(";").length === 10);
    expect(rows).toHaveLength(10);
    expect(idsReportHtml(real, meta)).toContain("NQI-10");
  });
});
