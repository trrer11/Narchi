import { describe, expect, it } from "vitest";
import { DEFAULT_COST_CONFIG, DEFAULT_HOAI_CONFIG, costFuerProjekt, hoaiFuerProjekt, type HoaiConfig } from "./financialSlice";

const a: HoaiConfig = { ...DEFAULT_HOAI_CONFIG, anrechenbareKosten: 250_000, honorarzone: 4 };

describe("hoaiFuerProjekt §236", () => {
  it("leeres Projekt → Default 0, nichts erfunden", () => {
    expect(hoaiFuerProjekt({}, "").anrechenbareKosten).toBe(0);
    expect(hoaiFuerProjekt({}, "p-neu").anrechenbareKosten).toBe(0);
  });

  it("merkt nur das eigene Projekt", () => {
    const map = { "p-a": a };
    expect(hoaiFuerProjekt(map, "p-a").anrechenbareKosten).toBe(250_000);
    expect(hoaiFuerProjekt(map, "p-b").anrechenbareKosten).toBe(0);
    expect(hoaiFuerProjekt(map, "p-b").honorarzone).toBe(3);
  });

  it("altes globales Honorar einmal dem aktuellen Projekt", () => {
    const alt = hoaiFuerProjekt({}, "p-alt", a);
    expect(alt.anrechenbareKosten).toBe(250_000);
    expect(hoaiFuerProjekt({ "p-x": a }, "p-alt", a).anrechenbareKosten).toBe(0);
  });
});

describe("costFuerProjekt §237", () => {
  it("neues Projekt startet bei NGF 0", () => {
    expect(costFuerProjekt({}, "p-neu").ngf).toBe(0);
    const alt = { ...DEFAULT_COST_CONFIG, ngf: 420 };
    expect(costFuerProjekt({ "p-a": alt }, "p-b").ngf).toBe(0);
    expect(costFuerProjekt({ "p-a": alt }, "p-a").ngf).toBe(420);
  });
});
