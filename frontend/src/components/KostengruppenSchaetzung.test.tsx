// Rendu du tableau « Kostenschätzung nach DIN 276 » (composant présentationnel).
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import KostengruppenSchaetzung from "@/components/KostengruppenSchaetzung";
import type { QuickEstimateResponse } from "@/lib/quickEstimate";

function fixture(): QuickEstimateResponse {
  return {
    region: "de_ni",
    lines: [
      {
        kostengruppe: "kg320_aussenwaende_rohbau",
        titel: "Tragende Wände (Rohbau)",
        menge: 7.2,
        einheit: "m³",
        einheitspreis_netto: 176.99,
        gesamt_netto: 1274.33,
        anzahl_elemente: 3,
        beispiele: ["AW-1", "AW-2", "AW-3"],
        preis_quelle: "richtwert",
      },
    ],
    totals: {
      netto: 1274.33,
      ust_satz: 19,
      ust: 242.12,
      brutto: 1516.45,
      kosten_pro_m2: 10.62,
    },
    range: { low: 1095.92, high: 1452.74, assumption: "±14 % (Sicherheitsband)" },
    score: {
      value: 97,
      grade: "A",
      mapping_coverage: 1,
      quantity_coverage: 1,
      avg_confidence: 0.9,
    },
    element_count: 3,
    office_quote: { kgs_mit_bueropreis: 0, eigenpreis_quote: 0 },
    warnings: ["Parametrische NARCHI-Richtwerte 2026 — Hinweisfixture."],
  };
}

/// §50 — fixture avec prix DU BUREAU (badge « eigene Preise » attendu).
function fixtureBueropreis(): QuickEstimateResponse {
  const base = fixture();
  base.lines = [
    {
      ...base.lines[0],
      preis_quelle: "büro",
      preis_quelle_detail: {
        auswahl: "einzelpreis",
        oz: "07.01.25",
        kurztext: "Außenwand MW 36,5 nach Büro",
        preisstand_jahr: 2025,
        index_faktor: 1.048,
      },
    },
  ];
  base.office_quote = { kgs_mit_bueropreis: 1, eigenpreis_quote: 1 };
  return base;
}

/// §99 — fixture médiane : 3 prix propres m² (2018/2024/2026), 1 autre
/// position « St » écartée — la règle doit être visible en entier.
function fixtureMedianBueropreis(): QuickEstimateResponse {
  const base = fixture();
  base.lines = [
    {
      ...base.lines[0],
      preis_quelle: "büro",
      preis_quelle_detail: {
        auswahl: "median",
        n_quellen: 3,
        einheit: "m²",
        median_steht_auf: 2026,
        jahr_von: 2018,
        jahr_bis: 2026,
        nicht_vermischt: 1,
      },
    },
  ];
  base.office_quote = { kgs_mit_bueropreis: 1, eigenpreis_quote: 1 };
  return base;
}

async function mount(estimate: QuickEstimateResponse) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(KostengruppenSchaetzung, { estimate }));
  });
  return host;
}

describe("KostengruppenSchaetzung (BOQ DIN 276)", () => {
  it("affiche la position agrégée avec exemples d'éléments", async () => {
    const host = await mount(fixture());
    expect(host.textContent).toContain("Tragende Wände (Rohbau)");
    expect(host.textContent).toContain("KG 320");
    expect(host.textContent).toContain("AW-1, AW-2, AW-3");
    expect(host.textContent).toContain("3 Element(e)");
  });

  it("affiche totaux netto, USt 19 % et brutto", async () => {
    const host = await mount(fixture());
    expect(host.textContent).toContain("Umsatzsteuer");
    expect(host.textContent).toContain("19");
    expect(host.textContent).toContain("Summe brutto");
    expect(host.textContent).toContain("Kosten je m²");
  });

  it("affiche le score de plausibilité et les avertissements", async () => {
    const host = await mount(fixture());
    expect(host.textContent).toContain("Plausibilität");
    expect(host.textContent).toContain("97");
    expect(host.textContent).toContain("Hinweisfixture");
  });

  it("§50 — sans prix du bureau : badge « Richtwert », mention dans le sous-titre", async () => {
    const host = await mount(fixture());
    expect(host.textContent).toContain("Richtwert");
    expect(host.textContent).toContain("Richtwerte NARCHI");
    expect(host.textContent).not.toContain("eigene Büropreise");
  });

  it("§50 — avec prix du bureau : badge « eigene Preise » + provenance OZ/Stand/Destatis", async () => {
    const host = await mount(fixtureBueropreis());
    expect(host.textContent).toContain("eigene Preise");
    expect(host.textContent).toContain("100 % eigene Büropreise");
    expect(host.textContent).toContain("OZ 07.01.25");
    expect(host.textContent).toContain("Stand 2025");
    expect(host.textContent).toContain("Destatis");
  });

  it("§99 — médiane : badge n=3, règle complète visible, jamais de fausse OZ", async () => {
    const host = await mount(fixtureMedianBueropreis());
    expect(host.textContent).toContain("eigene Preise · Median n=3");
    expect(host.textContent).toContain("Median aus 3 eigenen Preisen (m²)");
    expect(host.textContent).toContain("je auf 2026 indexiert");
    expect(host.textContent).toContain("Jahrgänge 2018–2026");
    expect(host.textContent).toContain("1 Preis(e) anderer Einheit nicht vermischt");
    expect(host.textContent).not.toContain("(Destatis)");  // médiane : pas de facteur unique
  });
});
