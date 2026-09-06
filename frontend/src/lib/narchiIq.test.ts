import { describe, expect, it } from "vitest";
import { answerQuestion, IQ_CAPABILITIES, type IqContext } from "@/lib/narchiIq";
import { ClashDetector } from "@/lib/planpruefung";
import { classOfElements, groupClashes, splitConnections, withGroupLevels, DEFAULT_CONNECTION_FILTER } from "@/lib/clashGroups";
import { AuditEngine } from "@/lib/AuditEngine";
import { matchMaterials } from "@/lib/materialMatch";
import type { BuildingElement } from "@/data/types";
import type { CostResult } from "@/lib/costEngine";
import type { EnergyResult } from "@/lib/energyEngine";

// ---------------------------------------------------------------------------
// Modèle de test : 5 Bauteiles réels → moteurs RÉELS (aucun mock de chiffre)
// ---------------------------------------------------------------------------

function el(id: string, name: string, type: string, level: string, weightKg: number, bbox?: [number, number, number, number, number, number], extra: { key: string; value: string }[] = []): BuildingElement {
  return {
    id, guid: `g-${id}`, code: "330", classificationLabel: "T", name, type, materialId: "m", level,
    projectId: "p", status: "modeled", qty: 1, unit: "m³", weightKg, cost: 1, carbonKg: 1,
    properties: [
      ...(bbox ? [{ key: "bbox", value: JSON.stringify(bbox) }] : []),
      ...extra,
    ],
    lastUpdated: "2026-08-06T00:00:00.000Z", conflicts: 0,
  };
}

// mur × dalle = Anschluss (≤ 30 cm) ; tuyau × dalle = VRAIE collision (major).
const ELEMENTS = [
  el("e1", "Außenwand Stahlbeton", "IFCWALL", "EG", 4320, [0, 0, 0, 3, 0.2, 3]),
  el("e2", "Decke Stahlbeton", "IFCSLAB", "EG", 4800, [2, -0.5, 2.8, 6, 4, 3.0]),
  el("e3", "Tür Büro 0,60", "IFCDOOR", "EG", 0, undefined, [{ key: "width", value: "0.6" }]),
  el("e4", "Fenster 3-fach (Iso)", "IFCWINDOW", "1. OG", 50),
  el("e5", "Rohrleitung DN20 Kunststoff", "IFCFLOWSEGMENT", "1. UG", 20, [3.1, 1, 2.7, 4.1, 1.4, 3.2]),
];

const COST = {
  netTotal: 1_234_567, perM2Ngf: 1234, kg300: 500_000, kg400: 300_000, kg500: 80_000, kg700: 120_000,
  high: 1_358_024, low: 1_111_110, uncertaintyPct: 10, bgf: 625,
} as unknown as CostResult;

const ENERGY = {
  PEB: 41, HWB: 32, endenergieM2: 28, primaerenergie: 20500, HTges: 88.4,
  co2: 4300, co2M2: 8.6, gegStatus: "kfw40", gegLabel: "KfW 40 erreicht",
} as unknown as EnergyResult;

function makeCtx(opts: { elements?: BuildingElement[]; cost?: boolean; energy?: boolean } = {}): IqContext {
  const elements = opts.elements ?? ELEMENTS;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const classOf = classOfElements((id) => byId.get(id));
  const clashes = ClashDetector.detectClashes(elements);
  const { real, connections } = splitConnections(clashes, classOf, DEFAULT_CONNECTION_FILTER);
  return {
    source: elements.length ? "takeoff" : "none",
    sourceLabel: "IFC-Maquette (Test)",
    projectName: "EFH Muster",
    typologyName: "Einfamilienhaus",
    ngf: 500,
    elements,
    costResult: opts.cost === false ? null : COST,
    energyResult: opts.energy === false ? null : ENERGY,
    getClashes: () => real,
    getGroups: () => withGroupLevels(groupClashes(real, classOf), (id) => byId.get(id)),
    getConnectionCount: () => connections.length,
    getAudit: () => AuditEngine.runFullAudit(elements),
    getMatch: () => matchMaterials(elements, 500),
  };
}

const ctx = makeCtx();

// ---------------------------------------------------------------------------

describe("NARCHI IQ — chat outillé (jamais de chiffre inventé)", () => {
  it("« Wie viele Kollisionen… » → chiffres EXACTS du radar + groupes §37", () => {
    const a = answerQuestion("Wie viele Kollisionen hat das Modell?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.clash-radar");
    // Moteur réel : 1 vraie collision (tuyau×dalle), 1 Anschluss (mur×dalle).
    expect(a.text).toContain("1 paires de collision");
    expect(a.text).toContain("1 Befundgruppen");
    expect(a.rows?.[0].value).toBe("1 Stelle");
  });

  it("« Gibt es Regel-Verstöße? » → violation DIN 18040 porte 0,60 m (moteur réel)", () => {
    const a = answerQuestion("Gibt es Regel-Verstöße?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.norm-audit");
    const report = AuditEngine.runFullAudit(ELEMENTS);
    expect(report.totalIssues).toBeGreaterThan(0);
    expect(a.text).toContain(`${report.totalIssues}`);
    expect(a.rows).toBeDefined();
  });

  it("modèle sain → réponse « aucune » honnête (pas de bonne foi fabriquée)", () => {
    const sane = makeCtx({ elements: [el("w1", "Wand", "IFCWALL", "EG", 1000, [0, 0, 0, 2, 0.2, 3])] });
    const a = answerQuestion("Wie viele Kollisionen gibt es?", sane);
    expect(a.text).toContain("keine");
  });

  it("« Was kostet…? » → cite exactement la sortie costEngine ; sans coût → honnête", () => {
    const a = answerQuestion("Was kostet das Projekt?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.cost-engine");
    expect(a.text).toContain("1.235 T€");
    expect(a.rows!.map((r) => r.label)).toContain("KG 300 Rohbau");
    const a2 = answerQuestion("Was kostet das?", makeCtx({ cost: false }));
    expect(a2.warning).toContain("nicht verfügbar");
    expect(a2.text).not.toContain("T€");
  });

  it("« Wie viel CO₂… » → sortie materialMatch §38 (bande + couverture)", () => {
    const a = answerQuestion("Wie viel CO2 steckt im Modell?", ctx);
    const m = matchMaterials(ELEMENTS, 500);
    expect(a.tools.map((t) => t.id)).toContain("bim.material-match");
    expect(a.text).toContain("%");
    // le kg/m² cité == calcul moteur (arrondi de-DE)
    expect(a.text).toContain((m.co2Kg / 500).toLocaleString("de-DE", { maximumFractionDigits: 0 }));
  });

  it("« Wieviel CO₂ spart CLT? » → VE-Studio (vraies substitutions, jamais de coût détourné)", () => {
    const a = answerQuestion("Wieviel CO₂ spart CLT statt Beton?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.ve-studio");
    expect(a.text).toContain("Substitutionen");
    // Les stahlbeton du modèle → au moins une substitution applicable.
    expect(a.rows?.length).toBeGreaterThanOrEqual(1);
    // Le bouton ouvre le VE-Studio en mode direct.
    expect(a.action?.target).toBe("lca?mode=ve");
  });

  it("« Wie kann ich Kosten optimieren? » → coût (PAS le VE-Studio)", () => {
    const a = answerQuestion("Wie kann ich Kosten optimieren?", ctx);
    expect(a.tools.map((t) => t.id)).not.toContain("bim.ve-studio");
    expect(a.tools.map((t) => t.id)).toContain("bim.cost-engine");
  });

  it("« Energiebilanz? » → PEB/HWB exacts; sans bilan → honnête, zéro estimation", () => {
    const a = answerQuestion("Wie ist die Energiebilanz?", ctx);
    expect(a.text).toContain("PEB 41");
    expect(a.text).toContain("KfW 40 erreicht");
    const a2 = answerQuestion("Und die Energiebilanz?", makeCtx({ energy: false }));
    expect(a2.warning).toContain("nicht verfügbar");
    // Aucune VALEUR inventée (le terme explicatif « PEB » autorisé, pas ses chiffres)
    expect(a2.text).not.toContain("PEB 41");
    expect(a2.text).not.toContain("KfW 40 erreicht");
    expect(a2.action?.target).toBe("energy");
  });

  it("« Welche Geschosse… » → tri bureau cave → Dach avec comptages", () => {
    const a = answerQuestion("Welche Geschosse hat das Modell?", ctx);
    expect(a.rows!.map((r) => r.label)).toEqual(["1. UG", "EG", "1. OG"]);
    expect(a.rows![1].value).toContain("3");
  });

  it("« Wie viele Fenster / Bauteile » → comptage par canonisation §37", () => {
    const a = answerQuestion("Wie viele Fenster gibt es im Modell?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.element-register");
    const row = a.rows!.find((r) => r.label === "Fenster");
    expect(row?.value).toBe("1");
    const wall = a.rows!.find((r) => r.label === "Wand");
    expect(wall?.value).toBe("1");
  });

  it("« Finde Fenster im 1. OG » → recherche filtrée niveau ; 0 treffer honnête", () => {
    const a = answerQuestion("Finde Fenster im 1. OG", ctx);
    expect(a.text).toContain("1 Treffer");
    expect(a.rows![0].label).toContain("Fenster");
    expect(a.rows![0].value).toBe("1. OG");
    const none = answerQuestion("Finde Aufzug", ctx);
    expect(none.warning).toBe("0 Treffer.");
    expect(none.rows).toBeUndefined();
  });

  it("« Wie groß ist die NGF? » → NGF citée + BGF quand coût connu", () => {
    const a = answerQuestion("Wie groß ist die NGF?", ctx);
    expect(a.text).toContain("500 m²");
    expect(a.rows!.map((r) => r.label)).toContain("Bruttogrundfläche (BGF, NGF×1,25)");
  });

  it("« Wie schwer ist das Gebäude? » → masses réelles du takeoff", () => {
    const a = answerQuestion("Wie schwer ist das Gebäude?", ctx);
    expect(a.text).toContain("t");
    expect(a.rows!.length).toBeGreaterThan(0);
    expect(a.rows![0].label).toContain("Stahlbeton");
  });

  it("question hors champ → fallback honnête avec catalogue de capacités", () => {
    const a = answerQuestion("Welche Aktien soll ich kaufen?", ctx);
    expect(a.tools).toHaveLength(0);
    expect(a.rows).toHaveLength(IQ_CAPABILITIES.length);
    expect(a.text).toContain("(noch) nicht");
  });

  it("sans modèle → état vide honnête ; l'aide reste accessible", () => {
    const empty = makeCtx({ elements: [] });
    const a = answerQuestion("Wie viele Wände?", empty);
    expect(a.warning).toContain("Keine Modell-Daten");
    expect(a.text).toContain("kein Modell geladen");
    const help = answerQuestion("Was kannst du?", empty);
    expect(help.rows).toHaveLength(IQ_CAPABILITIES.length);
  });

  it("déterminisme : même question, même contexte → réponse bit-identique", () => {
    const q = "Wie viele Kollisionen hat das Modell?";
    expect(JSON.stringify(answerQuestion(q, ctx))).toBe(JSON.stringify(answerQuestion(q, ctx)));
  });

  it("contrat anti-corruption §36 : aucun CJK, aucun caractère plein-format", () => {
    const all =
      JSON.stringify(IQ_CAPABILITIES) +
      JSON.stringify(answerQuestion("hilfe", ctx)) +
      JSON.stringify(answerQuestion("Wie viel CO2?", ctx)) +
      JSON.stringify(answerQuestion("xyz ?", ctx));
    // eslint-disable-next-line no-control-regex
    expect(/[\u4e00-\u9fff\uff00-\uffef]/.test(all)).toBe(false);
  });

  it("outils déclarés ⊆ boîte à outils connue (transparence vérifiable)", () => {
    const known = new Set([
      "bim.clash-radar", "bim.befundgruppen", "bim.anschluss-whitelist", "bim.norm-audit",
      "bim.cost-engine", "bim.material-match", "bim.energy-engine", "bim.element-register",
      "bim.quick-estimate", "bim.hoai-tafel",
    ]);
    for (const q of [
      "Kollisionen?", "Regel-Verstöße?", "Kosten?", "CO2?", "Energie?", "Geschosse?", "Fenster?", "masse?",
      "Wieviel kostet ein MFH 3000 m² in Berlin?", "Honorar bei 2 Mio Kosten",
    ]) {
      for (const t of answerQuestion(q, ctx).tools) expect(known.has(t.id)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // §42 — CAPACITÉS AD-HOC (ex-Copilot fusionné : marche SANS modèle)
  // -----------------------------------------------------------------------

  it("« Wieviel kostet ein MFH 3000 m² in Berlin? » → VRAIE Schnell-Schätzung (même moteur que DIN 276)", () => {
    const a = answerQuestion("Wieviel kostet ein MFH 3000 m² in Berlin?", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.quick-estimate");
    expect(a.text).toContain("3.000");
    expect(a.text).toContain("Berlin");
    expect(a.text).toMatch(/€|EUR|brutto/);
    expect(a.rows!.map((r) => r.label)).toContain("KG 300 (Rohbau)");
    expect(a.action?.target).toBe("cost");
  });

  it("« Honorar bei 2 Mio Kosten » → VRAIE Tafel HOAI 2021 (HZ monotone) ", () => {
    const a = answerQuestion("Honorar bei 2 Mio Kosten", ctx);
    expect(a.tools.map((t) => t.id)).toContain("bim.hoai-tafel");
    expect(a.text).toContain("HOAI 2021");
    // HZ I ≤ HZ III ≤ HZ V — sortie calcHoai réelle (interpolation log-linéaire)
    const hzValue = (label: string) => {
      const row = a.rows!.find((r) => r.label.includes(label))!;
      return Number(row.value.replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."));
    };
    expect(hzValue("I")).toBeLessThanOrEqual(hzValue("III"));
    expect(hzValue("III")).toBeLessThanOrEqual(hzValue("V"));
    expect(a.action?.target).toBe("hoai");
  });

  it("ad-hoc marche SANS modèle : estimation MFH + HOAI répondent quand même", () => {
    const empty = makeCtx({ elements: [] });
    const a1 = answerQuestion("Wieviel kostet ein MFH 3000 m² in Berlin?", empty);
    expect(a1.tools.map((t) => t.id)).toContain("bim.quick-estimate");
    const a2 = answerQuestion("Honorar bei 1,5 Mio Kosten", empty);
    expect(a2.tools.map((t) => t.id)).toContain("bim.hoai-tafel");
    // …mais une question MODÈLE reste honnêtement vide
    const a3 = answerQuestion("Wie viele Kollisionen?", empty);
    expect(a3.warning).toContain("Keine Modell-Daten");
  });

  it("« IFC importieren » / « Förderungen » → réponses workflow + action navigate (ex-Copilot)", () => {
    const a1 = answerQuestion("IFC importieren", ctx);
    expect(a1.action?.type).toBe("navigate");
    expect(a1.action?.target).toBe("import");
    const a2 = answerQuestion("Welche Förderungen gibt es?", ctx);
    expect(a2.action?.target).toBe("overview");
  });

  it("catalogue §42 : 16 capacités (11 modèles + 5 ad-hoc), chacun tags scope connus", () => {
    expect(IQ_CAPABILITIES).toHaveLength(16);
    expect(IQ_CAPABILITIES.filter((c) => c.scope === "modell")).toHaveLength(11);
    expect(IQ_CAPABILITIES.filter((c) => c.scope === "adhoc")).toHaveLength(5);
    for (const c of IQ_CAPABILITIES) {
      expect(["modell", "adhoc"]).toContain(c.scope);
      expect(c.example.length).toBeGreaterThan(5);
    }
  });
});
