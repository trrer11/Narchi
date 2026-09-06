/**
 * Tests §98 — graphique d'indice : géométrie DÉTERMINISTE (coordonnées
 * au 1/100), axe Y borné et MONTRÉ (jamais de cadrage trompeur), repères
 * annuels sur Q1, variation annuelle signée 1 décimale sur la série
 * officielle — et rien de tracé s'il n'y a rien à tracer.
 */
import { describe, expect, it } from "vitest";
import { DESTATIS_WOHNGEBAEUDE, INDEX_LATEST } from "@/data/destatisIndex";
import {
  buildChartView,
  quarterLabel,
  yoyPercent,
  yoyText,
} from "./indexChart";

describe("buildChartView — géométrie déterministe", () => {
  const toy = [
    { quarter: "2025-Q1", value: 100 },
    { quarter: "2025-Q2", value: 110 },
    { quarter: "2025-Q3", value: 120 },
    { quarter: "2025-Q4", value: 130 },
  ];
  const view = buildChartView(toy)!;

  it("chemin SVG exact, points aux extrémités de l'axe borné", () => {
    // axe : 100..130 → borné strict 100..140 ; innerW=582, innerH=166,
    // bas du cadre = padTop+innerH = 178 (pas 188 : mal calculé une fois).
    expect(view.axisFrom).toBe(100);
    expect(view.axisTo).toBe(140);
    expect(view.linePath).toBe(
      "M 44,178 L 238,136.5 L 432,95 L 626,53.5",
    );
    expect(view.points[0].y).toBe(178);          // min sur l'axe du bas
    expect(view.latest.x).toBe(626);             // dernier bord droit
  });

  it("ticks Y tous les 10, ticks X sur Q1", () => {
    expect(view.yTicks.map((t) => t.value)).toEqual([100, 110, 120, 130, 140]);
    expect(view.xTicks).toEqual([{ year: "2025", x: 44 }]);
  });

  it("série officielle : 7 ticks Y (90→150), années 2021–2026, dernier point en haut", () => {
    const v = buildChartView(DESTATIS_WOHNGEBAEUDE)!;
    expect(v.axisFrom).toBe(90);
    expect(v.axisTo).toBe(150);
    expect(v.yTicks).toHaveLength(7);
    expect(v.xTicks.map((t) => t.year)).toEqual(
      ["2021", "2022", "2023", "2024", "2025", "2026"],
    );
    expect(v.latest.point).toBe(INDEX_LATEST);
    // tous les points DANS le cadre — jamais de tracé clippé
    for (const p of v.points) {
      expect(p.y).toBeGreaterThanOrEqual(12);
      expect(p.y).toBeLessThanOrEqual(178);
    }
  });

  it("rien à tracer → null (carte muette, jamais un faux graphique)", () => {
    expect(buildChartView([])).toBeNull();
    expect(buildChartView([{ quarter: "2026-Q2", value: 140.3 }])).toBeNull();
  });
});

describe("variation annuelle — série officielle", () => {
  it("Q2/2026 vs Q2/2025 : (140,3−133,6)/133,6 = +5,0 %, signe et virgule", () => {
    expect(yoyPercent(INDEX_LATEST, DESTATIS_WOHNGEBAEUDE)).toBe(5.0);
    expect(yoyText(INDEX_LATEST, DESTATIS_WOHNGEBAEUDE)).toBe(
      "+5,0 % ggü. Vorjahresquartal (Q2/2026 vs Q2/2025)",
    );
  });

  it("sans point un an avant → null, jamais deviné", () => {
    expect(yoyPercent({ quarter: "2020-Q4", value: 90 }, DESTATIS_WOHNGEBAEUDE)).toBeNull();
    expect(yoyText({ quarter: "2020-Q4", value: 90 }, DESTATIS_WOHNGEBAEUDE)).toBeNull();
  });

  it("quarterLabel compact et tolérant", () => {
    expect(quarterLabel("2026-Q2")).toBe("Q2/2026");
    expect(quarterLabel("bizarroïde")).toBe("bizarroïde");
  });
});
