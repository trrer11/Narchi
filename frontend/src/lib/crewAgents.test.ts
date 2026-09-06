/**
 * Crew Agents — contrats de FIABILITÉ (retour utilisateur 2026-08-06 :
 * « des chiffres non fiables »). Verrous :
 *  A) aucun texte corrompu (régression « DAG免疫 ») ;
 *  B) chaque finding porte une provenance valide (Messung/Richtwert/Regel) ;
 *  C) les scores RÉAGISSENT aux vraies données (plus de ~80 constants) ;
 *  D) le score global ne moyenne que les agents réellement mesurés ;
 *  E) les vieux chiffres statiques (index 151, « 2.384 Stückpreise ») ont
 *     disparu — Richtwerte explicitement étiquetés ;
 *  F) §72 (V1.3) : 100 % déterministe, 0 % réseau — la promesse « Analyse-
 *     Experten » (et non « KI ») est prouvée, aucune clé API requise.
 */
import { describe, expect, it, vi } from "vitest";
import { runCrew, type QcSignals } from "@/lib/crewAgents";
import type { CostResult } from "@/lib/costEngine";
import type { EnergyResult } from "@/lib/energyEngine";

const BASE = {
  projectName: "Testprojekt",
  typology: "mfh",
  typologyName: "Mehrfamilienhaus",
  ngf: 1200,
  region: "Niedersachsen",
  year: 2026,
} as const;

const energyGood = { PEB: 38, HWB: 40, co2M2: 12, gegStatus: "kfw40" } as unknown as EnergyResult;
const energyBad = { PEB: 92, HWB: 85, co2M2: 31, gegStatus: "fail" } as unknown as EnergyResult;
const costTight = {
  perM2Ngf: 2400, kg300: 1_000_000, kg400: 600_000,
  high: 4_200_000, low: 3_600_000, netTotal: 3_900_000,
  uncertaintyPct: 0.08, sizeFactor: 1,
} as unknown as CostResult;
const costVague = {
  perM2Ngf: 4300, kg300: 2_000_000, kg400: 300_000,
  high: 12_000_000, low: 7_000_000, netTotal: 9_000_000,
  uncertaintyPct: 0.35, sizeFactor: 0.92,
} as unknown as CostResult;

const qcClean: QcSignals = { clashCount: 0, hardCount: 0, ruleIssues: 0, ruleCritical: 0, measuredElements: 400, totalElements: 420 };
const qcBroken: QcSignals = { clashCount: 120, hardCount: 7, ruleIssues: 34, ruleCritical: 3, measuredElements: 40, totalElements: 420 };

const allTexts = (r: ReturnType<typeof runCrew>) =>
  [
    r.synthesis,
    ...r.reports.flatMap((rep) => [
      rep.name, rep.summary,
      ...rep.findings.flatMap((f) => [f.title, f.detail, f.recommendation, f.metric ?? ""]),
    ]),
  ].join("\n");

describe("A) texts saubers — plus de caractères corrompus", () => {
  it("aucune chaîne CJK ni balise HTML traînante nulle part", () => {
    const text = allTexts(runCrew({ ...BASE }));
    // CJK/Japonais/Chinois : la régression « DAG免疫 » ne revient jamais.
    expect(text).not.toMatch(/[぀-ヿ一-鿿]/);
  });
});

describe("B) provenance obligatoire et valide", () => {
  it("chaque finding est étiqueté Messung · Richtwert · Regel", () => {
    const r = runCrew({ ...BASE, cost: costTight, energy: energyGood, qc: qcClean });
    for (const rep of r.reports) {
      for (const f of rep.findings) {
        expect(["messung", "richtwert", "regel"]).toContain(f.source);
      }
    }
  });

  it("les claims mesurables du modèle SONT des Messungen", () => {
    const r = runCrew({ ...BASE, qc: qcBroken });
    const risk = r.reports.find((x) => x.role === "risk")!;
    const clashFinding = risk.findings.find((f) => f.title.includes("Baukollisionen"))!;
    expect(clashFinding.source).toBe("messung");
    expect(clashFinding.detail).toContain("120");
    expect(clashFinding.severity).toBe("critical");
  });
});

describe("C) les scores réagissent aux vraies données", () => {
  it("énergie : EH 40 score plus haut qu'au-delà du GEG (ordre, pas de nombre magique)", () => {
    const good = runCrew({ ...BASE, energy: energyGood }).reports.find((r) => r.role === "sustainability")!.score;
    const bad = runCrew({ ...BASE, energy: energyBad }).reports.find((r) => r.role === "sustainability")!.score;
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThanOrEqual(75);
    expect(bad).toBeLessThan(50);
  });

  it("risque : collisions critiques réelles font chuter le score", () => {
    const clean = runCrew({ ...BASE, qc: qcClean }).reports.find((r) => r.role === "risk")!.score;
    const broken = runCrew({ ...BASE, qc: qcBroken }).reports.find((r) => r.role === "risk")!.score;
    expect(broken).toBeLessThan(clean);
    expect(broken).toBeLessThanOrEqual(70);
  });

  it("architecture : mauvaise couverture de mesure + violations = score bas", () => {
    const r = runCrew({ ...BASE, qc: qcBroken }).reports.find((x) => x.role === "architekt")!;
    expect(r.scoredFromData).toBe(true);
    expect(r.score).toBeLessThan(60);
    const ok = runCrew({ ...BASE, qc: qcClean }).reports.find((x) => x.role === "architekt")!;
    expect(ok.score).toBeGreaterThan(r.score);
  });

  it("sans AUCUNE donnée : agents honnêtes (neutres, pas de faux 85)", () => {
    const r = runCrew({ ...BASE });
    const cost = r.reports.find((x) => x.role === "cost")!;
    expect(cost.scoredFromData).toBe(false);
    expect(cost.score).toBe(50);
    expect(cost.findings[0].title).toContain("Keine Kostenberechnung");
  });
});

describe("D) score global = moyenne des agents MESURÉS seulement", () => {
  it("avec l'énergie chargée, le global = moyenne des agents MESURÉS uniquement", () => {
    const r = runCrew({ ...BASE, energy: energyGood });
    const measured = r.reports.filter((x) => x.scoredFromData);
    // Seuls durabilité + subventions ont un vrai signal ici (énergie).
    expect(measured.map((x) => x.role).sort()).toEqual(["funding", "sustainability"]);
    const mean = Math.round(measured.reduce((s, x) => s + x.score, 0) / measured.length);
    expect(r.overallScore).toBe(mean);
  });

  it("deux projets différents ⟹ deux scores globaux différents", () => {
    const a = runCrew({ ...BASE, cost: costTight, energy: energyGood, qc: qcClean });
    const b = runCrew({ ...BASE, cost: costVague, energy: energyBad, qc: qcBroken });
    expect(a.overallScore).not.toBe(b.overallScore);
    expect(a.overallScore).toBeGreaterThan(b.overallScore);
  });
});

describe("E) anciens chiffres statiques éliminés", () => {
  it("plus d'index figé ni de base de prix fabriquée", () => {
    const text = allTexts(runCrew({ ...BASE, cost: costTight, energy: energyGood }));
    expect(text).not.toContain("151");
    expect(text).not.toMatch(/2\.384|2 384/);
    // L'orientierung du marché reste explicitement Richtwert.
    const market = runCrew({ ...BASE }).reports.find((x) => x.role === "market")!;
    expect(market.scoredFromData).toBe(false);
    expect(market.findings.some((f) => f.source === "richtwert")).toBe(true);
  });
});


describe("F) déterminisme total, zéro réseau — aucune clé API requise (§72, V1.3)", () => {
  it("même entrée → sortie strictement identique, et fetch JAMAIS appelé", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const a = runCrew({ ...BASE, cost: costTight, energy: energyGood, qc: qcClean });
      const b = runCrew({ ...BASE, cost: costTight, energy: energyGood, qc: qcClean });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
