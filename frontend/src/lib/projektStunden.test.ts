/** §180 — Projektstunden → Deckungsbeitrag (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  addStunden,
  deckungsbeitrag,
  ladeStunden,
  ladeStundensatz,
  migriereStundenProjektId,
  removeStunden,
  setzeStundensatz,
  stundenFuerProjekt,
  stundenNachLp,
  stundenOhneProjekt,
  STUNDENSATZ_DEFAULT,
} from "@/lib/projektStunden";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("addStunden / ladeStunden (§180)", () => {
  it("ajoute, relit, supprime", () => {
    const s = memStorage();
    addStunden({ projektId: "p1", lp: 3, stunden: 2.5, datum: "2026-08-21" }, s);
    addStunden({ projektId: "p1", lp: 5, stunden: 4, datum: "2026-08-21" }, s);
    const list = ladeStunden(s);
    expect(list).toHaveLength(2);
    removeStunden(list[0].id, s);
    expect(ladeStunden(s)).toHaveLength(1);
  });
  it("stockage absent → jamais d'erreur", () => {
    expect(ladeStunden(null)).toEqual([]);
    expect(addStunden({ projektId: "p", lp: 1, stunden: 1, datum: "x" }, null)).toHaveLength(1);
  });
});

describe("stundenFuerProjekt / stundenNachLp (§180)", () => {
  it("agrège par projet et par LP", () => {
    const list = [
      { id: "a", projektId: "p1", lp: 3, stunden: 2, datum: "d" },
      { id: "b", projektId: "p1", lp: 3, stunden: 3, datum: "d" },
      { id: "c", projektId: "p1", lp: 5, stunden: 1, datum: "d" },
      { id: "d", projektId: "p2", lp: 1, stunden: 8, datum: "d" },
    ];
    const p1 = stundenFuerProjekt(list, "p1");
    expect(p1.totalStunden).toBeCloseTo(6);
    expect(p1.perLp[3]).toBeCloseTo(5);
    expect(p1.perLp[5]).toBeCloseTo(1);
    const nachLp = stundenNachLp(p1.perLp);
    expect(nachLp.map((x) => x.lp)).toEqual([3, 5]);
    expect(nachLp[0].name).toBe("Entwurfsplanung");
  });
});

describe("deckungsbeitrag (§180)", () => {
  it("honorar > aufwand → positif (le projet gagne)", () => {
    const d = deckungsbeitrag(100_000, 100, 75); // 7 500 € d'heures
    expect(d.aufwandEuro).toBe(7500);
    expect(d.deckungsbeitrag).toBe(92500);
    expect(d.realisationPct).toBeCloseTo(7.5, 5);
  });
  it("honorar < aufwand → négatif (le projet perd)", () => {
    const d = deckungsbeitrag(5_000, 100, 75);
    expect(d.deckungsbeitrag).toBeLessThan(0);
    expect(d.realisationPct).toBeGreaterThan(100);
  });
  it("honorar 0 → realisationPct null (pas de NaN)", () => {
    const d = deckungsbeitrag(0, 10, 75);
    expect(d.realisationPct).toBeNull();
  });
});

describe("§229 Stunden gehören zu EINEM Projekt", () => {
  it("migriert nur « aktiv », lässt andere Projekte", () => {
    const { list, geaendert } = migriereStundenProjektId(
      [
        { id: "1", projektId: "aktiv", lp: 3, stunden: 2, datum: "d" },
        { id: "2", projektId: "p-alt", lp: 1, stunden: 8, datum: "d" },
      ],
      "p-neu",
    );
    expect(geaendert).toBe(1);
    expect(list[0].projektId).toBe("p-neu");
    expect(list[1].projektId).toBe("p-alt");
    expect(migriereStundenProjektId(list, "").geaendert).toBe(0);
  });

  it("löschen betrifft nur das gewählte Projekt", () => {
    const rest = stundenOhneProjekt(
      [
        { id: "1", projektId: "p1", lp: 3, stunden: 2, datum: "d" },
        { id: "2", projektId: "p2", lp: 1, stunden: 8, datum: "d" },
      ],
      "p1",
    );
    expect(rest).toHaveLength(1);
    expect(rest[0].projektId).toBe("p2");
  });
});

describe("Stundensatz (§180)", () => {
  it("défaut, lecture, écriture", () => {
    const s = memStorage();
    expect(ladeStundensatz(s)).toBe(STUNDENSATZ_DEFAULT);
    setzeStundensatz(95, s);
    expect(ladeStundensatz(s)).toBe(95);
    setzeStundensatz(-5, s); // invalide → défaut
    expect(ladeStundensatz(s)).toBe(STUNDENSATZ_DEFAULT);
  });
});
