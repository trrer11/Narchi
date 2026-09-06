/** §181 — Bauteil-Standard-Bibliothek (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  addBauteil,
  bibliothekStats,
  ladeBauteile,
  removeBauteil,
  sucheBauteile,
  type BauteilStandard,
} from "@/lib/detailBibliothek";

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

const wand: BauteilStandard = {
  id: "bt-1",
  name: "Außenwand KS + WDVS",
  kategorie: "wand",
  aufbau: "KS 17,5 cm + WDVS EPS 160 mm",
  uWert: 0.18,
  kosten: 210,
  notiz: "Standard für EFH, GEG-konform.",
  createdAt: "2026-08-21T00:00:00.000Z",
};

const dach: BauteilStandard = {
  id: "bt-2",
  name: "Flachdach Dämmung",
  kategorie: "dach",
  aufbau: "EPS 200 mm + Bitumen",
  uWert: 0.15,
  kosten: 120,
  notiz: "Gefälle beachten.",
  createdAt: "2026-08-21T00:00:00.000Z",
};

describe("detailBibliothek (§181)", () => {
  it("ajoute, relit, supprime", () => {
    const s = memStorage();
    addBauteil(wand, s);
    expect(ladeBauteile(s)).toHaveLength(1);
    const list = ladeBauteile(s);
    removeBauteil(list[0].id, s);
    expect(ladeBauteile(s)).toHaveLength(0);
  });
  it("stockage absent / JSON corrompu → jamais d'erreur", () => {
    expect(ladeBauteile(null)).toEqual([]);
    const s = memStorage();
    s.setItem("narchi:bauteil-bibliothek", "{pas du json");
    expect(ladeBauteile(s)).toEqual([]);
  });
});

describe("sucheBauteile (§181)", () => {
  it("cherche dans le nom, l'aufbau et la note", () => {
    const list = [wand, dach];
    expect(sucheBauteile(list, "KS")).toHaveLength(1);
    expect(sucheBauteile(list, "bitumen")).toHaveLength(1);
    expect(sucheBauteile(list, "GEG")).toHaveLength(1); // seule la 1re note contient GEG
    expect(sucheBauteile(list, "")).toHaveLength(2);
  });
});

describe("bibliothekStats (§181)", () => {
  it("compte par catégorie", () => {
    const list = [wand, { ...wand, id: "bt-3", name: "Decke Stahlbeton", kategorie: "decke" as const }];
    const st = bibliothekStats(list);
    expect(st.total).toBe(2);
    expect(st.perKategorie["wand"]).toBe(1);
    expect(st.perKategorie["decke"]).toBe(1);
  });
});
