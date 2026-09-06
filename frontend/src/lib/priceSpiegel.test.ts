/**
 * Tests §96 — Preisspiegel : mapping défensif (hostiles → null), rejet
 * d'une prétendue ligne à 1 observation (le serveur ne la sert pas, le
 * client ne l'accepte pas non plus), pluriels allemands, étendue %
 * signée/virgule, jamais de pourcentage sans médiane.
 */
import { describe, expect, it } from "vitest";
import {
  beobachtungenLabel,
  hatGemischteJahrgaenge,
  jahrgangText,
  spiegelItemOf,
  spiegelResponseOf,
  spiegelSubline,
  streuungText,
} from "./priceSpiegel";

describe("spiegelResponseOf", () => {
  it("mapping complet + lignes pourries filtrées", () => {
    const parsed = spiegelResponseOf({
      items: [
        { oz: "001.00001", kurztext: "Beton", einheit: "m³", n: 2,
          min_cents: 10000, median_cents: 10050, max_cents: 10100,
          latest_ep_cents: 10100, latest_company: "B", latest_jahr: 2026,
          latest_source: "Angebot: B", min_jahr: 2026, max_jahr: 2026 },
        { oz: "", n: 2 }, // pourrie — filtrée
      ],
      total_observations: 2, single_oz_count: 1, capped: false, hinweis: "H",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].oz).toBe("001.00001");
    expect(parsed!.singleOzCount).toBe(1);
    expect(parsed!.hinweis).toBe("H");
  });
  it("hostiles → null", () => {
    expect(spiegelResponseOf(null)).toBeNull();
    expect(spiegelResponseOf({ items: [] })).toBeNull();
  });
});

describe("spiegelItemOf", () => {
  it("mapping nominal complet", () => {
    const item = spiegelItemOf({
      oz: "001.00001", kurztext: "Beton C25/30", einheit: "m³",
      n: 3, min_cents: 10000, median_cents: 10100, max_cents: 19900,
      latest_ep_cents: 10100, latest_company: "B AG", latest_jahr: 2026,
      latest_source: "Angebot: B AG · notiz · 2026-08-10",
      min_jahr: 2026, max_jahr: 2026,
    });
    expect(item).not.toBeNull();
    expect(item!.oz).toBe("001.00001");
    expect(item!.medianCents).toBe(10100);
    expect(item!.latestCompany).toBe("B AG");
  });

  it("hostiles → null, jamais d'exception", () => {
    expect(spiegelItemOf(null)).toBeNull();
    expect(spiegelItemOf("boom")).toBeNull();
    expect(spiegelItemOf({ oz: "001.00001", n: 1, min_cents: 5, max_cents: 5,
      latest_ep_cents: 5, latest_jahr: 2026, min_jahr: 2026, max_jahr: 2026 })).toBeNull(); // n=1 refusé
    expect(spiegelItemOf({ n: 3, min_cents: 1, median_cents: 1, max_cents: 1,
      latest_ep_cents: 1, latest_jahr: 2026, min_jahr: 2026, max_jahr: 2026 })).toBeNull(); // sans oz
    expect(spiegelItemOf({ oz: "001", n: 2, min_cents: 1, max_cents: 2,
      latest_ep_cents: 1, latest_jahr: 800, min_jahr: 2020, max_jahr: 2020 })).toBeNull();  // année absurde
    expect(spiegelItemOf({ oz: "001", n: 2, min_cents: 1, max_cents: 2,
      latest_ep_cents: 1, latest_jahr: 2026 })).toBeNull(); // §97 Jahrgänge manquants
  });

  it("médiane absente tolérée (null), le reste conservé", () => {
    const item = spiegelItemOf({
      oz: "1.1", n: 2, min_cents: 10, median_cents: null, max_cents: 20,
      latest_ep_cents: 20, latest_jahr: 2026, min_jahr: 2018, max_jahr: 2026,
    });
    expect(item).not.toBeNull();
    expect(item!.medianCents).toBeNull();
  });
});

describe("beobachtungenLabel", () => {
  it("pluriel exact", () => {
    expect(beobachtungenLabel(1)).toBe("1 Beobachtung");
    expect(beobachtungenLabel(3)).toBe("3 Beobachtungen");
  });
});

describe("streuungText", () => {
  it("signe explicite, virgule allemande, 1 décimale", () => {
    expect(streuungText(10000, 10100, 19900)).toBe("-1,0 % bis +97,0 %");
    // NB : toLocaleString émet le trait d'union ASCII (U+002D) — pas le
    // signe moins typographique U+2212 (attendu mal écrit une fois, prouvé).
    expect(streuungText(10100, 10100, 10100)).toBe("+0,0 % bis +0,0 %");
  });
  it("jamais de pourcentage sans base", () => {
    expect(streuungText(10000, null, 19900)).toBeNull();
    expect(streuungText(10000, 0, 19900)).toBeNull();
  });
});

describe("spiegelSubline", () => {
  it("dit ce que l'écran ne montre pas", () => {
    expect(spiegelSubline(0, false)).toBe("");
    expect(spiegelSubline(1, false)).toContain("1 Position mit nur einer");
    expect(spiegelSubline(4, true)).toContain("4 Positionen");
    expect(spiegelSubline(4, true)).toContain("begrenzt");
  });
});

describe("jahrgangText / hatGemischteJahrgaenge (§97)", () => {
  it("une seule année : Jahrgang nu, pas de marqueur", () => {
    expect(jahrgangText(2026, 2026)).toBe("Jahrgang 2026");
    expect(hatGemischteJahrgaenge(2026, 2026)).toBe(false);
  });
  it("années mélangées : DIT, brutes, non indexées", () => {
    expect(jahrgangText(2018, 2026)).toBe("Jahrgänge 2018–2026 · Rohwerte, nicht indexiert");
    expect(hatGemischteJahrgaenge(2018, 2026)).toBe(true);
  });
});
