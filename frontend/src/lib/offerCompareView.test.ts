/** §92 — Angebotsvergleich : mapping défensif + présentation honnête. */
import { describe, expect, it } from "vitest";
import {
  cellClass,
  compareMatrixOf,
  deltaText,
  verdictText,
  type CompareRow,
} from "@/lib/offerCompareView";

const MATRIX_RAW = {
  room: "notiz-buero",
  rows: [
    {
      oz: "01.001", title: "Beton", qty: 12.5, unit: "m³",
      internal_up_cents: 10000, only_in_offer: false,
      cells: {
        A: { up_cents: 9500, it_cents: 118750, delta_pct: -5.0 },
        B: { up_cents: 9000, it_cents: 112500, delta_pct: -10.0 },
      },
      best_offer_id: "B",
    },
    {
      oz: "009.00001", title: "Extra", qty: 1, unit: "Stk",
      internal_up_cents: null, only_in_offer: true,
      cells: { A: { up_cents: 700, it_cents: 700, delta_pct: null } },
      best_offer_id: null,
    },
  ],
  offers: [
    { id: "A", company_name: "Bauer", dp: "83", ohne_ep: 0, missing_internal: 0, complete: true, total_cents: 119450 },
    { id: "B", company_name: "Müller", dp: "83", ohne_ep: 1, missing_internal: 1, complete: false, total_cents: 112500 },
  ],
  hinweis: "EP-Vergleich je Zeile.",
  duplicate_internal_oz: 0,
};

describe("§92 — compareMatrixOf défensif", () => {
  it("mapping complet serpent→chameau", () => {
    const m = compareMatrixOf(MATRIX_RAW);
    expect(m).not.toBeNull();
    expect(m!.rows).toHaveLength(2);
    expect(m!.rows[0].cells.B).toEqual({ upCents: 9000, itCents: 112500, deltaPct: -10 });
    expect(m!.rows[1].onlyInOffer).toBe(true);
    expect(m!.offers[1].complete).toBe(false);
  });

  it("hostiles : null, formes cassées, cellules pourries → filtrés, jamais d'exception", () => {
    expect(compareMatrixOf(null)).toBeNull();
    expect(compareMatrixOf({ rows: null, offers: [] })).toBeNull();
    const m = compareMatrixOf({
      rows: [null, { oz: "01", cells: { A: null, B: { up_cents: "viel" } }, best_offer_id: 7 }],
      offers: [{ id: 3 }, "corrompu", MATRIX_RAW.offers[0]],
    });
    expect(m!.rows).toHaveLength(1);
    expect(m!.rows[0].cells.A).toBeUndefined();
    expect(m!.rows[0].cells.B.upCents).toBeNull();
    expect(m!.rows[0].bestOfferId).toBeNull();
    expect(m!.offers.map((o) => o.id)).toEqual(["A"]);
  });
});

describe("§92 — présentation honnête", () => {
  const row: CompareRow = {
    oz: "01", title: "", qty: 1, unit: "Stk", internalUpCents: 100,
    onlyInOffer: false,
    cells: { A: { upCents: 90, itCents: 90, deltaPct: -10 }, B: { upCents: null, itCents: null, deltaPct: null } },
    bestOfferId: "A",
  };

  it("cellClass : best seulement avec prix, « — » sinon", () => {
    expect(cellClass(row, "A")).toBe("best");
    expect(cellClass(row, "B")).toBe("missing");
    expect(cellClass({ ...row, bestOfferId: null }, "A")).toBe("normal");
  });

  it("deltaText : signe explicite, virgule, null sans base", () => {
    expect(deltaText(-10)).toBe("−10,0 %");
    expect(deltaText(5.05)).toBe("+5,1 %");
    expect(deltaText(0)).toBe("±0,0 %");
    expect(deltaText(null)).toBeNull();
  });

  it("verdictText : le moins-disant PARMI LES COMPLÈTES seulement", () => {
    const m = compareMatrixOf(MATRIX_RAW)!;
    expect(verdictText(m.offers)).toContain("Bauer"), "Müller (Teilsumme) ne gagne jamais";
    expect(verdictText(m.offers.map((o) => ({ ...o, complete: false })))).toContain("Teilsummen");
    expect(verdictText(m.offers.slice(0, 1))).toBeNull();
  });
});
