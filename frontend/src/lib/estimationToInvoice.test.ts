/** §151 — Pont estimation → facture : le helper de conversion est éprouvé. */
import { describe, expect, it } from "vitest";

import { estimationToInvoiceLines, moneyStr } from "@/lib/estimationToInvoice";
import type { CostResult } from "@/lib/costEngine";

describe("moneyStr (float → chaîne décimale HALF_UP)", () => {
  it("arrondit au centime HALF_UP", () => {
    expect(moneyStr(4000)).toBe("4000.00");
    expect(moneyStr(0.025)).toBe("0.03"); // half-up, pas banker's
    expect(moneyStr(1234567.895)).toBe("1234567.90");
    expect(moneyStr(33.335)).toBe("33.34");
  });
  it("gère les valeurs non finies", () => {
    expect(moneyStr(Number.NaN)).toBe("0.00");
    expect(moneyStr(Number.POSITIVE_INFINITY)).toBe("0.00");
  });
});

function cost(over: Partial<CostResult> = {}): CostResult {
  return {
    input: {} as CostResult["input"],
    din276: "2018",
    bgf: 1200,
    benchmarkBase: 0,
    benchmarkAdj: 0,
    regionFactor: 1,
    qualityFactor: 1,
    yearFactorValue: 1,
    sizeFactor: 1,
    basementFactor: 1,
    floorsFactor: 1,
    bauweiseFactor: 1,
    energiestandardFactor: 1,
    kg200: 0,
    kg300: 0,
    kg400: 0,
    kg500: 0,
    kg700: 0,
    basementCost: 0,
    lines200: [],
    lines300: [],
    lines400: [],
    lines500: [],
    lines700: [],
    netTotal: 0,
    vatAmount: 0,
    grossTotal: 0,
    landNet: 0,
    perM2Ngf: 0,
    perM2Bgf: 0,
    perM2NgfNet: 0,
    low: 0,
    high: 0,
    lowPerM2: 0,
    highPerM2: 0,
    uncertaintyPct: 0,
    ...over,
  };
}

describe("estimationToInvoiceLines", () => {
  it("convertit les Kostengruppen détaillées en lignes de facture", () => {
    const c = cost({
      lines300: [
        { code: "310", label: "Baugrube", amount: 50000, share: 0, perM2: 0 },
        { code: "320", label: "Gründung", amount: 80000.5, share: 0, perM2: 0 },
      ],
      lines400: [{ code: "410", label: "Abwasser", amount: 12000, share: 0, perM2: 0 }],
    });
    const lignes = estimationToInvoiceLines(c);
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toMatchObject({
      designation: "KG 310 — Baugrube",
      quantite: "1",
      unite: "forfait",
      prix_unitaire_ht: "50000.00",
      taux_tva: "19",
    });
    expect(lignes[1].prix_unitaire_ht).toBe("80000.50");
    expect(lignes[2].designation).toBe("KG 410 — Abwasser");
  });

  it("ignore les montants nuls/négatifs/non finis", () => {
    const c = cost({
      lines300: [
        { code: "310", label: "Vide", amount: 0, share: 0, perM2: 0 },
        { code: "320", label: "Négatif", amount: -5, share: 0, perM2: 0 },
        { code: "330", label: "NaN", amount: Number.NaN, share: 0, perM2: 0 },
        { code: "340", label: "Ok", amount: 100, share: 0, perM2: 0 },
      ],
    });
    const lignes = estimationToInvoiceLines(c);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].designation).toBe("KG 340 — Ok");
  });
});
