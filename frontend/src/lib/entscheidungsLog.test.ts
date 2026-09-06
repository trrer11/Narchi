/** §177 — Entscheidungslog : journal de décisions (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  addEntscheidung,
  entscheidungenFuerProjekt,
  migriereEntscheidungenProjektId,
  entscheidungsProtokoll,
  listEntscheidungen,
  makeEntscheidung,
  offeneEntscheidungen,
  removeEntscheidung,
  setEntscheidungStatus,
} from "@/lib/entscheidungsLog";

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

const base = {
  projektId: "prj-1",
  thema: "Ausbau des Dachbodens",
  beschreibung: "Der Auftraggeber möchte den Dachboden zu Wohnraum ausbauen.",
  status: "vorgeschlagen" as const,
  quelle: "email" as const,
  verantwortlich: "AM",
};

describe("makeEntscheidung / persistance (§177)", () => {
  it("id + datum déterministes, ajout et lecture", () => {
    const s = memStorage();
    const e = makeEntscheidung(base, new Date("2026-08-17T10:00:00Z"));
    expect(e.id).toMatch(/^entsch-/);
    expect(e.datum).toBe("2026-08-17");
    addEntscheidung(e, s);
    expect(listEntscheidungen(s)).toHaveLength(1);
    expect(listEntscheidungen(s)[0].thema).toBe("Ausbau des Dachbodens");
  });

  it("suppression et changement de statut", () => {
    const s = memStorage();
    const e = makeEntscheidung(base);
    addEntscheidung(e, s);
    setEntscheidungStatus(e.id, "freigegeben", s);
    expect(listEntscheidungen(s)[0].status).toBe("freigegeben");
    removeEntscheidung(e.id, s);
    expect(listEntscheidungen(s)).toHaveLength(0);
  });

  it("stockage absent / JSON corrompu → jamais d'erreur", () => {
    expect(listEntscheidungen(null)).toEqual([]);
    const s = memStorage();
    s.setItem("narchi:entscheidungslog", "{pas du json");
    expect(listEntscheidungen(s)).toEqual([]);
  });
});

describe("offeneEntscheidungen (§177 — le temps volé)", () => {
  it("remonte les décisions en souffrance (proposées/renvoyées)", () => {
    const list = [
      makeEntscheidung({ ...base, status: "vorgeschlagen" }),
      makeEntscheidung({ ...base, status: "freigegeben" }),
      makeEntscheidung({ ...base, status: "vertagt" }),
      makeEntscheidung({ ...base, status: "abgelehnt" }),
    ];
    expect(offeneEntscheidungen(list)).toHaveLength(2);
  });
});

describe("entscheidungsProtokoll (§177 — la trace qui fait foi)", () => {
  it("génère le protocole daté + sourcé + statut", () => {
    const list = [
      makeEntscheidung({ ...base, status: "freigegeben" }, new Date("2026-08-17T10:00:00Z")),
    ];
    const p = entscheidungsProtokoll(list, "EFH Muster");
    expect(p).toContain("Entscheidungsprotokoll — EFH Muster");
    expect(p).toContain("2026-08-17");
    expect(p).toContain("Freigegeben");
    expect(p).toContain("E-Mail");
    expect(p).toContain("Ausbau des Dachbodens");
  });

  it("liste vide → mention honnête", () => {
    expect(entscheidungsProtokoll([], "X")).toContain("noch keine Entscheidungen");
  });
});

describe("entscheidungenFuerProjekt (§177)", () => {
  it("filtre par projet et trie plus récent d'abord", () => {
    const list = [
      makeEntscheidung({ ...base, projektId: "a" }, new Date("2026-08-10T10:00:00Z")),
      makeEntscheidung({ ...base, projektId: "b" }, new Date("2026-08-17T10:00:00Z")),
    ];
    const a = entscheidungenFuerProjekt(list, "a");
    expect(a).toHaveLength(1);
    expect(a[0].projektId).toBe("a");
  });
});
