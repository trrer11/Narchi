import { beforeEach, describe, expect, it } from "vitest";
import {
  addChangeOrder,
  addVertragspunkt,
  listScope,
  openChangeHonorar,
  setChangeStatus,
} from "./scopeGuard";

describe("scopeGuard §249", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ohne Projekt nichts", () => {
    expect(addVertragspunkt("", "Dach")).toBeNull();
    expect(listScope("")).toEqual([]);
  });

  it("Vertragspunkt bleibt lokal", () => {
    addVertragspunkt("p1", "LP 1–4 im Vertrag");
    expect(listScope("p1")).toHaveLength(1);
    expect(listScope("p2")).toHaveLength(0);
  });

  it("Change-Order rechnet HOAI-Delta, 0 bleibt 0", () => {
    const z = addChangeOrder({
      projectId: "p1",
      text: "Dachausbau",
      deltaKosten: 0,
      baseKosten: 0,
      honorarzone: 3,
      lps: [3],
      grund: "aenderungswunsch",
    });
    expect(z?.deltaHonorarNetto).toBe(0);
    expect(openChangeHonorar("p1")).toBe(0);
  });

  it("offenes Zusatzhonorar, beauftragt zählt nicht mehr offen", () => {
    const c = addChangeOrder({
      projectId: "p1",
      text: "Dach",
      deltaKosten: 80_000,
      honorarzone: 3,
      lps: [3, 5],
      grund: "zusatzleistung",
    });
    expect(c && (c.deltaHonorarNetto ?? 0) > 0).toBe(true);
    const open = openChangeHonorar("p1");
    setChangeStatus(c!.id, "beauftragt");
    expect(openChangeHonorar("p1")).toBe(0);
    expect(open).toBeGreaterThan(0);
  });
});
