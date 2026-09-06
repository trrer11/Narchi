/** §182 — Abschlagsrechnung par Leistungsphase (pur, testé). */
import { describe, expect, it } from "vitest";

import {
  abschlagLpsAusPayload,
  abschlagPayloadMerken,
  abschlagToInvoiceLines,
  abschlagsPositionen,
  abschlagsrechnung,
} from "@/lib/abschlagsrechnung";
import { calcHoai } from "@/lib/hoaiEngine";

const hoai = calcHoai({
  anrechenbareKosten: 2_000_000, honorarzone: 3, zusatzId: "none", modeId: "reference",
});

describe("abschlagsPositionen (§182)", () => {
  it("satz officiels + cumul = honorar total (à 2 déc près)", () => {
    const pos = abschlagsPositionen(100_000);
    expect(pos).toHaveLength(8);
    // LP1 = 3 %, LP2 = 7 %, LP3 = 11 % …
    expect(pos[0].satzPct).toBe(3);
    expect(pos[2].satzPct).toBe(11);
    expect(pos[7].satzPct).toBe(30);
    // cumul final = 100 % du honorar
    expect(pos[7].kumuliertNetto).toBeCloseTo(100_000, 2);
  });
  it("cumul est croissant", () => {
    const pos = abschlagsPositionen(100_000);
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i].kumuliertNetto).toBeGreaterThan(pos[i - 1].kumuliertNetto);
    }
  });
});

describe("abschlagsrechnung (§182)", () => {
  it("LP 1–3 facturées, LP 4 nouvelle → montant = 6 % du honorar", () => {
    const r = abschlagsrechnung(hoai, [1, 2, 3], [4]);
    expect(r.betragNetto).toBeCloseTo(hoai.total * 0.06, 2);
    expect(r.fakturiertNetto).toBeCloseTo(hoai.total * (0.03 + 0.07 + 0.11), 2);
    expect(r.betragBrutto).toBeCloseTo(r.betragNetto * 1.19, 2);
  });
  it("plusieurs nouvelles LP → somme des satz", () => {
    const r = abschlagsrechnung(hoai, [], [1, 2]);
    expect(r.betragNetto).toBeCloseTo(hoai.total * 0.10, 2);
  });
  it("texte contient montant, phases, et l'avertissement honnête", () => {
    const r = abschlagsrechnung(hoai, [1], [2, 3]);
    expect(r.text).toContain("Abschlagsrechnung");
    expect(r.text).toContain("LP 2 Vorplanung");
    expect(r.text).toContain("LP 3 Entwurfsplanung");
    expect(r.text).toContain("netto");
    expect(r.text).toContain("Orientierung");
    expect(r.text).toContain("abweichende vertragliche Regelungen");
  });
  it("aucune nouvelle LP → montant 0", () => {
    const r = abschlagsrechnung(hoai, [1, 2, 3], []);
    expect(r.betragNetto).toBe(0);
  });
});

describe("abschlagToInvoiceLines (§213)", () => {
  it("une ligne Pauschal 19 % par LP neu, montant = satz × Honorar", () => {
    const r = abschlagsrechnung(hoai, [1], [2, 3]);
    const lines = abschlagToInvoiceLines(r, [2, 3]);
    expect(lines).toHaveLength(2);
    expect(lines[0].unite).toBe("forfait");
    expect(lines[0].taux_tva).toBe("19");
    expect(lines[0].designation).toContain("LP 2");
    const sum = lines.reduce((s, l) => s + Number(l.prix_unitaire_ht), 0);
    expect(sum).toBeCloseTo(r.betragNetto, 2);
  });
  it("LP vides → aucune ligne (pas de facture fantôme)", () => {
    const r = abschlagsrechnung(hoai, [1], []);
    expect(abschlagToInvoiceLines(r, [])).toEqual([]);
  });
});

describe("abschlag je Projekt (§235)", () => {
  it("liest byProjekt, nicht den Nachbarn", () => {
    const payload = { byProjekt: { a: [1, 2], b: [3] } };
    expect(abschlagLpsAusPayload(payload, "a")).toEqual([1, 2]);
    expect(abschlagLpsAusPayload(payload, "b")).toEqual([3]);
    expect(abschlagLpsAusPayload(payload, "c")).toEqual([]);
    const next = abschlagPayloadMerken(payload, "a", [1, 2, 4]);
    expect(next.byProjekt.a).toEqual([1, 2, 4]);
    expect(next.byProjekt.b).toEqual([3]);
  });

  it("altes { lps } nur dem aktuellen Projekt", () => {
    expect(abschlagLpsAusPayload({ lps: [1, 2] }, "p1")).toEqual([1, 2]);
    expect(abschlagLpsAusPayload({ lps: [1] }, "")).toEqual([]);
  });
});
