/**
 * §49 — Verrouille la série officielle Destatis (61261-0002, Basis 2021=100,
 * inkl. USt, Stand 10.07.2026). Si l'on met à jour la série (nouveau
 * trimestre publié), ces tests doivent être adaptés EN CONSCIENCE — c'est
 * l'anti-dérive qui empêche le retour d'un indice fantaisiste type « 169.7 ».
 */
import { describe, it, expect } from "vitest";
import {
  DESTATIS_WOHNGEBAEUDE,
  INDEX_LATEST,
  INDEX_SOURCE_LABEL,
  YEARLY_INDEX,
  indexForYear,
  indexStandLabel,
  yearFactorFor,
} from "./destatisIndex";

describe("destatisIndex — série officielle épinglée", () => {
  it("contient les 22 trimestres 2021-Q1 → 2026-Q2 officiels", () => {
    expect(DESTATIS_WOHNGEBAEUDE).toHaveLength(22);
    expect(DESTATIS_WOHNGEBAEUDE[0]).toEqual({ quarter: "2021-Q1", value: 96.7 });
    // points de contrôle officiels (communiqué Destatis 10.07.2026)
    const byQ = Object.fromEntries(DESTATIS_WOHNGEBAEUDE.map((p) => [p.quarter, p.value]));
    expect(byQ["2024-Q1"]).toBe(128.5);
    expect(byQ["2024-Q4"]).toBe(130.8);
    expect(byQ["2025-Q2"]).toBe(133.6);
    expect(byQ["2026-Q1"]).toBe(137.0);
    expect(byQ["2026-Q2"]).toBe(140.3);
  });

  it("est strictement croissante (pas de trou, pas de doublon)", () => {
    for (let i = 1; i < DESTATIS_WOHNGEBAEUDE.length; i++) {
      expect(DESTATIS_WOHNGEBAEUDE[i].value).toBeGreaterThan(
        DESTATIS_WOHNGEBAEUDE[i - 1].value,
      );
    }
  });

  it("le dernier point publié est Q2/2026 = 140,3", () => {
    expect(INDEX_LATEST).toEqual({ quarter: "2026-Q2", value: 140.3 });
  });

  it("moyennes annuelles officielles (4 trimestres)", () => {
    expect(indexForYear(2024)).toBe(129.75); // (128,5+129,4+130,3+130,8)/4
    expect(indexForYear(2025)).toBe(133.88); // (132,6+133,6+134,3+135,0)/4
    expect(indexForYear(2023)).toBe(115.63);
    expect(indexForYear(2021)).toBe(100); // année de base, par construction
  });

  it("année en cours = dernier point publié, 2020 rétrocédé", () => {
    expect(indexForYear(2026)).toBe(140.3);
    expect(indexForYear(2020)).toBe(88.73); // 100 / 1,127
    expect(indexForYear(2019)).toBeNull(); // non supporté — référentiel trop vieux
  });

  it("YEARLY_INDEX couvre 2020..2026 et reflète la série", () => {
    expect(Object.keys(YEARLY_INDEX).map(Number).sort()).toEqual([
      2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    expect(YEARLY_INDEX[2024]).toBe(129.75);
    expect(YEARLY_INDEX[2026]).toBe(140.3);
  });

  it("facteur d'année 2024 → 2026 = +8,13 % (officiel, pas l'ancien +6,3 %)", () => {
    const f = yearFactorFor(2024, 2026);
    expect(f).toBeCloseTo(140.3 / 129.75, 6);
    expect((f - 1) * 100).toBeCloseTo(8.13, 1);
  });

  it("facteur d'année : identité en base 2024, plafonné à ±40 %", () => {
    expect(yearFactorFor(2024, 2024)).toBe(1);
    expect(yearFactorFor(2010, 2026)).toBe(1); // base non supportée → neutre
    expect(yearFactorFor(2020, 2026)).toBeLessThanOrEqual(1.4);
  });

  it("labels de provenance traçables (charte §36)", () => {
    expect(indexStandLabel()).toBe("Destatis \u00b7 Stand 06/2026"); // mois de référence Q2 (publication 10.07.2026)
    expect(INDEX_SOURCE_LABEL).toContain("61261-0002");
    expect(INDEX_SOURCE_LABEL).toContain("Basis 2021=100");
    expect(INDEX_SOURCE_LABEL).toContain("USt");
  });

  it("aucune chaîne CJK ni balise interdite dans les labels", () => {
    const labels = [indexStandLabel(), INDEX_SOURCE_LABEL].join(" ");
    expect(labels).not.toMatch(/[\u4e00-\u9fff\u3040-\u30ff]/);
  });
});
