/**
 * §89 — positions LV structurées co-éditées : décisions PURES testées,
 * et convergence sur VRAIES répliques Yjs (jamais de mock du CRDT).
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addPosition,
  deletePosition,
  formatEuro,
  LV_KEY,
  LV_MAX_POSITIONS,
  lvTotals,
  normalizeOz,
  ozCompare,
  parseLvNumber,
  positionGp,
  positionsFromYArray,
  round2,
  setPositionCell,
  sortByOz,
  validateDraft,
  type LvDraft,
} from "@/lib/lvOps";

function lvDoc() {
  const doc = new Y.Doc();
  return { doc, yarr: doc.getArray(LV_KEY) as Y.Array<unknown> };
}

const DRAFT: LvDraft = {
  oz: "01.003.010",
  title: "Stahlbeton C25/30, Fundamente",
  qty: 12.5,
  unit: "m³",
  unitPrice: 189.9,
};

describe("§89 — parseLvNumber / arrondis / format", () => {
  it("styles allemand et anglais, espaces, bornes", () => {
    expect(parseLvNumber("12,5")).toBe(12.5);
    expect(parseLvNumber("1.234,56")).toBe(1234.56);   // 1 234,56 € à l'allemande
    expect(parseLvNumber("12.5")).toBe(12.5);
    expect(parseLvNumber(" 7 ")).toBe(7);
    expect(parseLvNumber("")).toBeNull();
    expect(parseLvNumber("abc")).toBeNull();
    expect(parseLvNumber("-3")).toBeNull();            // Menge négative refusée
    expect(parseLvNumber("1e9")).toBeNull();           // notation exponentielle refusée
    expect(parseLvNumber("2000000001")).toBeNull();    // > 1 milliard : borné
  });

  it("round2 tue les floats sales, formatEuro est allemand", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2 * 100.005)).toBe(200.01);   // GP métier : Menge × EP au centime
    expect(formatEuro(1234.5)).toContain("1.234,50");
    expect(formatEuro(189.9)).toContain("189,90");
  });
});

describe("§89 — OZ : nettoyage, tri, validation", () => {
  it("normalizeOz nettoie sans rejet brutal, borne 32", () => {
    expect(normalizeOz(" 01..003.010 ")).toBe("01.003.010");
    expect(normalizeOz("abc01.002xyz")).toBe("01.002");
    expect(normalizeOz("1".repeat(40)).length).toBe(32);
  });

  it("ozCompare est NUMÉRIQUE — 01.10 après 01.2 (le lexicographique inverse)", () => {
    const tri = ["01.10", "01.2", "01.1", "02.001"].sort(ozCompare);
    expect(tri).toEqual(["01.1", "01.2", "01.10", "02.001"]);
  });

  it("validateDraft : messages allemands honnêtes, « ohne EP » légal", () => {
    expect(validateDraft({ ...DRAFT, oz: "" }, 0)).toContain("OZ");
    expect(validateDraft({ ...DRAFT, oz: "ab.01" }, 0)).toContain("Ziffern");
    expect(validateDraft({ ...DRAFT, qty: -1 }, 0)).toContain("Menge");
    expect(validateDraft({ ...DRAFT, unitPrice: Number.NaN }, 0)).toContain("EP");
    expect(validateDraft({ ...DRAFT, unitPrice: null }, 0)).toBeNull();
    expect(validateDraft(DRAFT, LV_MAX_POSITIONS)).toContain(`${LV_MAX_POSITIONS}`);
  });

  it("totaux : ohne EP compté à part, somme en centimes propres", () => {
    const positions = [
      { id: "a", oz: "01.001", title: "", qty: 2, unit: "m³", unitPrice: 100.005, priceHint: "manuell" },
      { id: "b", oz: "01.002", title: "", qty: 1, unit: "Stk", unitPrice: null, priceHint: "manuell" },
    ];
    expect(positionGp(positions[0])).toBe(200.01);
    expect(positionGp(positions[1])).toBeNull();
    const t = lvTotals(positions);
    expect(t).toEqual({ count: 2, ohneEp: 1, gpTotal: 200.01 });
  });
});

describe("§89 — pont Yjs réel", () => {
  it("positionsFromYArray ignore les hostiles sans deviner", () => {
    const { doc, yarr } = lvDoc();
    doc.transact(() => {
      const good = new Y.Map<unknown>();
      good.set("id", "a");
      good.set("oz", "01.001");
      good.set("title", "OK");
      good.set("qty", 3);
      good.set("unit", "m³");
      good.set("unit_price", null);          // ohne EP légal
      good.set("price_hint", "manuell");
      const noId = new Y.Map<unknown>();
      noId.set("oz", "01.002");
      noId.set("qty", 1);
      const badQty = new Y.Map<unknown>();
      badQty.set("id", "c");
      badQty.set("qty", "abc");
      const badBool = new Y.Map<unknown>();
      badBool.set("id", "d");
      badBool.set("qty", 1);
      badBool.set("unit_price", true);
      yarr.push([good, "hostile-string", 42, noId, badQty, badBool]);
    });
    const positions = positionsFromYArray(yarr);
    expect(positions.map((p) => p.id)).toEqual(["a"]);
    expect(positions[0].unitPrice).toBeNull(); // « ohne EP » survit, les corrompus non
  });

  it("add + convergence entre DEUX répliques (preuve CRDT, pas un mock)", () => {
    const a = lvDoc();
    const b = lvDoc();
    a.doc.on("update", (u: Uint8Array) => Y.applyUpdate(b.doc, u));
    const id = addPosition(a.doc, a.yarr, DRAFT);
    expect(id).not.toBeNull();
    const surB = positionsFromYArray(b.yarr);
    expect(surB).toHaveLength(1);
    expect(surB[0]).toMatchObject({ oz: "01.003.010", qty: 12.5, unitPrice: 189.9, priceHint: "manuell" });
  });

  it("setPositionCell cible l'ID (pas l'index affiché) et se propage", () => {
    const a = lvDoc();
    const b = lvDoc();
    a.doc.on("update", (u: Uint8Array) => Y.applyUpdate(b.doc, u));
    addPosition(a.doc, a.yarr, { ...DRAFT, oz: "01.002", title: "B" });
    addPosition(a.doc, a.yarr, { ...DRAFT, oz: "01.001", title: "A" });
    // Tri d'affichage : A en premier — suppression/édition par ID vise juste.
    const sorted = sortByOz(positionsFromYArray(a.yarr));
    expect(sorted[0].title).toBe("A");
    const cible = sorted.find((p) => p.title === "B")!;
    expect(setPositionCell(a.doc, a.yarr, cible.id, "qty", 99)).toBe(true);
    expect(setPositionCell(a.doc, a.yarr, "id-inconnu", "qty", 1)).toBe(false);
    const surB = positionsFromYArray(b.yarr);
    expect(surB.find((p) => p.id === cible.id)?.qty).toBe(99);
  });

  it("deletePosition par ID + borne 500 servie (rien n'est dépassé)", () => {
    const { doc, yarr } = lvDoc();
    const id1 = addPosition(doc, yarr, DRAFT)!;
    const id2 = addPosition(doc, yarr, { ...DRAFT, oz: "01.004" })!;
    expect(deletePosition(doc, yarr, id1)).toBe(true);
    expect(deletePosition(doc, yarr, "introuvable")).toBe(false);
    expect(positionsFromYArray(yarr).map((p) => p.id)).toEqual([id2]);

    const pack = lvDoc();
    pack.doc.transact(() => {
      for (let i = 0; i < LV_MAX_POSITIONS; i++) {
        const m = new Y.Map<unknown>();
        m.set("id", `x${i}`);
        m.set("qty", 1);
        m.set("unit_price", 1);
        pack.yarr.push([m]);
      }
    });
    expect(addPosition(pack.doc, pack.yarr, DRAFT)).toBeNull();
    expect(pack.yarr.length).toBe(LV_MAX_POSITIONS);
  });
});
