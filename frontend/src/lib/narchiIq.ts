// NARCHI V6.11 — « NARCHI IQ » : L'UNIQUE chat de NARCHI (§42).
// Fusion NARCHI IQ (§40, outils sur la MAQUETTE) + Narchi-Copilot
// (estimation & workflow AD-HOC) — un seul cerveau, une seule vérité.
//
//   1) OUTILS MODÈLE : routeur d'intentions → moteurs déterministes
//      (radar clash + Befundgruppen §37 + whitelist, Norm-Audit, DIN 276,
//      ÖKOBAUDAT §38, GEG 2024, registre). Les chiffres cités sont les
//      SORTIES BRUTES — jamais générées (garanti par construction).
//   2) OUTILS AD-HOC (ex-Copilot, SANS modèle) : « Wieviel kostet ein MFH
//      3000 m² in Berlin? » → estimation DIN 276 paramétrée par TYPologie +
//      ville (vrai estimateCost, pas un ordre de grandeur inventé) ;
//      « Honorar bei 2 Mio » → VRAIE Tafel HOAI (calcHoai, interpolation
//      log-linéaire — fini les barèmes fixes ~8,5/11/15 %) ; import,
//      énergie-explication, aides → boutons d'ouverture de module.
//   3) Scope honnête : une question « Modell! » sans modèle chargé → état
//      vide honnête (jamais de remplissage) ; une question ad-hoc marche
//      TOUJOURS.

import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";
import type { AuditReport } from "@/lib/AuditEngine";
import type { CostResult } from "@/lib/costEngine";
import type { EnergyResult } from "@/lib/energyEngine";
import type { MatchSummary } from "@/lib/materialMatch";
import { CLASH_CLASS_LABEL, type ClashClass, type ClashGroup } from "@/lib/clashGroups";
import { canonicalClass } from "@/lib/clashGroups";
import { MATCH_SOURCE } from "@/lib/materialMatch";
import { levelKey } from "@/lib/levelSort";
// Outils ad-hoc (fusion ex-Copilot §42)
import { estimateCost, fmtMoney } from "@/lib/costEngine";
import { typologyById } from "@/data/typologies";
import { DE_REGIONS, QUALITY_STANDARDS } from "@/data/countries";
import { calcHoai } from "@/lib/hoaiEngine";
import { buildVEOpportunities, takeoffVolumeM3BySubstitution } from "@/lib/veEngine";

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

export interface IqTool {
  id: string;
  name: string;
}

export interface IqRow {
  label: string;
  value: string;
  hint?: string;
}

/// Bouton d'ouverture de module (intentions « workflow »).
export interface IqAction {
  type: "navigate";
  /** Vue NARCHI cible (id VIEW_MAP). */
  target: string;
  label: string;
}

export interface IqAnswer {
  /** Réponse textuelle (allemand) — chiffres = sorties moteurs. */
  text: string;
  /** Outils réellement exécutés (transparence affichée dans l'UI). */
  tools: IqTool[];
  /** Tableau facultatif (détail calculé, jamais décoratif). */
  rows?: IqRow[];
  /** Avertissement honnête (donnée manquante, approximation…). */
  warning?: string;
  /** Bouton « Öffnen » proposé avec la réponse (workflow). */
  action?: IqAction;
}

/// Contexte de vérité fourni par la page (store + moteurs en GETTERS
/// paresseux : une question « Kosten » ne recalcule pas le radar).
export interface IqContext {
  source: "project" | "takeoff" | "none";
  sourceLabel: string;
  projectName: string;
  typologyName: string;
  ngf: number;
  elements: BuildingElement[];
  costResult: CostResult | null;
  energyResult: EnergyResult | null;
  getClashes: () => Clash[];
  getGroups: () => ClashGroup[];
  getConnectionCount: () => number;
  getAudit: () => AuditReport;
  getMatch: () => MatchSummary;
}

const TOOL = {
  clashes: { id: "bim.clash-radar", name: "Clash-Radar (ClashDetector)" },
  groups: { id: "bim.befundgruppen", name: "Befundgruppen (§37)" },
  connections: { id: "bim.anschluss-whitelist", name: "Anschluss-Whitelist (§37)" },
  audit: { id: "bim.norm-audit", name: "Norm-Audit (AuditEngine DIN/GEG)" },
  cost: { id: "bim.cost-engine", name: "Kosten-Schätzung (DIN 276)" },
  carbon: { id: "bim.material-match", name: "CO₂-Material-Match (ÖKOBAUDAT A1–A3)" },
  ve: { id: "bim.ve-studio", name: "VE-Studio (Materialsubstitution CO₂ + Kosten)" },
  energy: { id: "bim.energy-engine", name: "Energiebilanz (GEG 2024, Monatsverfahren)" },
  elements: { id: "bim.element-register", name: "Bauteil-Register (Takeoff)" },
  quickCost: { id: "bim.quick-estimate", name: "Schnell-Schätzung (DIN 276 · Region/Typologie)" },
  hoai: { id: "bim.hoai-tafel", name: "HOAI-Tafel 2021 (log-lineare Interpolation)" },
} satisfies Record<string, IqTool>;

const de = (n: number, digits = 0): string =>
  n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const eur = (n: number): string => `${de(Math.round(n / 1000))} T€`;
const fmtCo2 = (kg: number): string => (Math.abs(kg) >= 1000 ? `${de(kg / 1000, 1)} t CO₂e` : `${de(kg, 0)} kg CO₂e`);

// ---------------------------------------------------------------------------
// Capacités affichées (aide + fallback honnête — aucune promesse cachée)
// ---------------------------------------------------------------------------

export interface IqCapability {
  intent: string;
  example: string;
  tools: string[];
  /** « modell » = exige une maquette · « adhoc » = marche toujours. */
  scope: "modell" | "adhoc";
}

export const IQ_CAPABILITIES: IqCapability[] = [
  { intent: "Kollisionen & Befundgruppen", example: "Wie viele Kollisionen hat das Modell?", tools: [TOOL.clashes.id, TOOL.groups.id, TOOL.connections.id], scope: "modell" },
  { intent: "Norm-Audit (DIN/GEG, BNB)", example: "Gibt es Regel-Verstöße?", tools: [TOOL.audit.id], scope: "modell" },
  { intent: "Kosten des Modells (DIN 276)", example: "Was kostet das Projekt?", tools: [TOOL.cost.id], scope: "modell" },
  { intent: "CO₂ der Baustoffe (A1–A3)", example: "Wie viel CO₂ steckt im Modell?", tools: [TOOL.carbon.id], scope: "modell" },
  { intent: "CO₂ sparen (VE-Studio)", example: "Wieviel CO₂ spart CLT statt Beton?", tools: [TOOL.ve.id], scope: "modell" },
  { intent: "Energiebilanz GEG 2024", example: "Wie ist die Energiebilanz (PEB/HWB)?", tools: [TOOL.energy.id], scope: "modell" },
  { intent: "Bauteile zählen / listen", example: "Wie viele Fenster gibt es?", tools: [TOOL.elements.id], scope: "modell" },
  { intent: "Geschosse & Ebenen", example: "Welche Geschosse hat das Modell?", tools: [TOOL.elements.id], scope: "modell" },
  { intent: "Bauteile suchen", example: "Finde Fenster im 1. OG", tools: [TOOL.elements.id], scope: "modell" },
  { intent: "Flächen (NGF/BGF)", example: "Wie groß ist die NGF?", tools: [TOOL.cost.id], scope: "modell" },
  { intent: "Massen & Materialien", example: "Wie schwer ist das Gebäude?", tools: [TOOL.carbon.id, TOOL.elements.id], scope: "modell" },
  // — Famille AD-HOC (marche sans modèle, ex-Copilot fusionnée §42) —
  { intent: "Schnell-Schätzung beliebig", example: "Wieviel kostet ein MFH 3000 m² in Berlin?", tools: [TOOL.quickCost.id], scope: "adhoc" },
  { intent: "HOAI-Honorar (Tafel 2021)", example: "Honorar bei 2 Mio Kosten", tools: [TOOL.hoai.id], scope: "adhoc" },
  { intent: "GEG-Energie einrichten", example: "GEG-Energie berechnen", tools: [TOOL.energy.id], scope: "adhoc" },
  { intent: "Modell & IFC-Import", example: "IFC importieren", tools: [TOOL.elements.id], scope: "adhoc" },
  { intent: "Fördermittel (KfW/BAFA)", example: "Welche Förderungen gibt es?", tools: [], scope: "adhoc" },
];

function helpAnswer(prefix: string): IqAnswer {
  return {
    text:
      `${prefix} Ich beantworte nur, was die Werkzeuge direkt messen oder berechnen ` +
      `— stelle z. B. eine dieser Fragen:`,
    tools: [],
    rows: IQ_CAPABILITIES.map((c) => ({ label: c.example, value: c.intent })),
  };
}

function noModelAnswer(): IqAnswer {
  const modellCaps = IQ_CAPABILITIES.filter((c) => c.scope === "modell");
  return {
    text:
      "Es ist kein Modell geladen — ohne Maquette kann ich nichts messen, " +
      "und ich rate nichts. (Parametrische Schätzungen & HOAI funktionieren " +
      "auch schon ohne Modell, s. Beispiele am Seitenanfang.)",
    tools: [],
    warning: "Keine Modell-Daten (Quelle: „none“).",
    rows: modellCaps.slice(0, 6).map((c) => ({ label: c.example, value: c.intent })),
    action: { type: "navigate", target: "import", label: "Maquette 3D öffnen (IFC)" },
  };
}

// ---------------------------------------------------------------------------
// Utilitaires partagés (réutilisent les moteurs — mêmes chiffres que les pages)
// ---------------------------------------------------------------------------

/// Regroupe les Bauteiles par classe de constat (même canonisation que §37 —
/// cohérence du comptage avec le radar).
function countByClass(elements: BuildingElement[]): Map<ClashClass, number> {
  const counts = new Map<ClashClass, number>();
  for (const el of elements) {
    const cls = canonicalClass(el.type);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return counts;
}

const LEVEL_HINT = /\b(\d+\.?\s?(?:og|ug)|eg|dach(?:geschoss)?)\b/i;

/// Niveau visé par la question (« im 1. OG ») → libelle normalisé levelSort.
function askedLevel(query: string): string | null {
  const m = query.match(LEVEL_HINT);
  if (!m) return null;
  return levelKey(m[1].trim().toUpperCase()).label;
}

// ---------------------------------------------------------------------------
// Extraction AD-HOC (ex-Copilot) : typologie, surface, ville — transparente
// ---------------------------------------------------------------------------

const TYPOLOGY_WORDS: Record<string, string> = {
  wohnung: "mfh", mfh: "mfh", mehrfamilien: "mfh", wohnhaus: "mfh", wohn: "mfh",
  efh: "efh", einfamilien: "efh", haus: "efh",
  büro: "office", buero: "office", verwaltung: "office", office: "office",
  schule: "school", gymnasium: "school", unterricht: "school",
  krankenhaus: "hospital", klinik: "hospital", hospital: "hospital",
  industrie: "industrial", halle: "industrial", produktion: "industrial",
  logistik: "logistics", lager: "logistics",
  labor: "lab", forschung: "lab",
  kita: "kindergarten", kindertagesstätte: "kindergarten",
  parkhaus: "parking", garage: "parking",
};

function findTypologyId(q: string): string | null {
  const ql = q.toLowerCase();
  for (const [word, id] of Object.entries(TYPOLOGY_WORDS)) {
    if (ql.includes(word)) return id;
  }
  return null;
}

export function findRegionName(q: string): string | null {
  const ql = q.toLowerCase();
  for (const r of DE_REGIONS) {
    if (ql.includes(r.name.toLowerCase().split(" ")[0])) return r.name;
  }
  return null;
}

/// Premier nombre réel de la question (« 1.500,5 m² », « 2 Mio » géré le
/// « Mio » à part par le HOAI). Séparateurs de-DE tolérés.
export function firstNumber(q: string): number | undefined {
  const m = q.match(/(\d[\d\s.,]*)/);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

const hasAreaSignature = (q: string) => /\d[\d\s.,]*\s*(m²|m2|qm|sqm)/i.test(q);

// ---------------------------------------------------------------------------
// Routeur d'intentions — ordre significatif (le plus spécifique d'abord)
// ---------------------------------------------------------------------------

interface IntentRule {
  re: RegExp;
  /** « modell » exige la maquette chargée ; « adhoc » répond toujours. */
  scope: "modell" | "adhoc";
  answer: (ctx: IqContext, query: string) => IqAnswer;
}

const SEV_DE: Record<Clash["severity"], string> = { critical: "kritisch", major: "Major", minor: "Minor" };

const RULES: IntentRule[] = [
  // --- Aide / capacités (toujours) ----------------------------------------
  {
    re: /\b(was kannst|hilfe|help|funktionen|welche fragen|fragen stellen)\b/i,
    scope: "adhoc",
    answer: () => helpAnswer("Gerne! "),
  },

  // --- HOAI (AVANT coûts : « Honorar bei 2 Mio Kosten » contient « kosten »)
  {
    re: /honorar|hoai|geb[uü]hr(?:en)?rechnung|architektenhonorar|planungskosten/i,
    scope: "adhoc",
    answer: (_ctx, q) => {
      const kosten = (() => {
        const n = firstNumber(q);
        if (n === undefined) return 2_000_000;
        if (/mio|million/i.test(q)) return n * 1_000_000;
        return n;
      })();
      const hoai = calcHoai({ anrechenbareKosten: kosten, honorarzone: 3, zusatzId: "none", modeId: "reference" });
      return {
        text:
          `Honorar nach **HOAI 2021, Tafel A** (log-linear interpoliert, zone II = Saalbau) pour ` +
          `${fmtMoney(kosten)} anrechenbare Kosten : **${fmtMoney(hoai.honorar)} netto** ` +
          `(bande HZ-I ${fmtMoney(hoai.zonenHonorar[0])} – HZ-V ${fmtMoney(hoai.zonenHonorar[4])}), ` +
          `brutto 19 % MwSt : ${fmtMoney(hoai.brutto)}. Honorarzonen & Leistungsphasen im Modul.`,
        tools: [TOOL.hoai],
        rows: [
          { label: "Honorarzone I (Mindestsatz)", value: fmtMoney(hoai.zonenHonorar[0]) },
          { label: "Honorarzone III (Mittlerer Satz)", value: fmtMoney(hoai.zonenHonorar[2]) },
          { label: "Honorarzone V (Höchstsatz)", value: fmtMoney(hoai.zonenHonorar[4]) },
        ],
        action: { type: "navigate", target: "hoai", label: "Honoraires HOAI (8 Leistungsphasen)" },
      };
    },
  },

  // --- Recherche de Bauteiles (AVANT le comptage : « Finde Fenster… » est
  //     une recherche, pas une question d'effectif) ---------------------------
  {
    re: /suche|find[et]|zeig .*bauteil|wo (ist|sind)/i,
    scope: "modell",
    answer: (ctx, query) => {
      const stop = new Set(["suche", "finde", "findet", "zeig", "zeige", "wo", "ist", "sind", "die", "der", "das", "im", "in", "am", "bitte", "mal", "mir", "alle", "nach", "bauteile", "bauteil"]);
      const terms = query.toLowerCase().split(/[^a-zäöüß0-9-]+/i).filter((t) => t.length >= 3 && !stop.has(t));
      const asked = askedLevel(query);
      const pool = asked ? ctx.elements.filter((el) => levelKey(el.level).label === asked) : ctx.elements;
      const hits = terms
        .flatMap((t) => pool.filter((el) => el.name.toLowerCase().includes(t)))
        .filter((el, i, arr) => arr.findIndex((x) => x.id === el.id) === i)
        .sort((a, b) => levelKey(a.level).rank - levelKey(b.level).rank || a.name.localeCompare(b.name, "de"));
      if (hits.length === 0) {
        return {
          text:
            `Kein Bauteil gefunden für « ${terms.join(" ") || query} »` +
            (asked ? ` auf Ebene ${asked}` : "") +
            " — ich suche nur in echten Bauteil-Namen, nichts wird erfunden.",
          tools: [TOOL.elements],
          warning: "0 Treffer.",
        };
      }
      return {
        text:
          `**${de(hits.length)} Treffer** für « ${terms.join(" ") || query} »` +
          (asked ? ` auf Ebene ${asked}` : "") +
          ` (erste 10, triés cave → Dach, alphabétique allemand):`,
        tools: [TOOL.elements],
        rows: hits.slice(0, 10).map((el) => ({
          label: el.name,
          value: levelKey(el.level).label,
          hint: `${el.type.replace(/^IFC/i, "")} · ${de(el.qty, el.unit === "Stk" ? 0 : 1)} ${el.unit}`,
        })),
      };
    },
  },

  // --- Kollisionen / Befundgruppen ------------------------------------------
  {
    re: /kollision|clash|überschneid|befund|anschluss|durchdring|detection/i,
    scope: "modell",
    answer: (ctx) => {
      const clashes = ctx.getClashes();
      const groups = ctx.getGroups();
      const connections = ctx.getConnectionCount();
      if (clashes.length === 0) {
        return {
          text: `Das Radar findet aktuell **keine geometrischen Kollisionen**${connections > 0 ? ` — nur ${de(connections)} dokumentierte Anschlüsse (vorgesehene Öffnungen/Appuis, siehe QC-Seite)` : ""}. Quelle : ${ctx.sourceLabel}.`,
          tools: [TOOL.clashes, TOOL.groups, TOOL.connections],
          action: { type: "navigate", target: "planpruefung", label: "QC & Conformité öffnen" },
        };
      }
      const bySeverity = (["critical", "major", "minor"] as const).map(
        (sev) => `${de(clashes.filter((c) => c.severity === sev).length)} ${SEV_DE[sev]}`,
      );
      const top = groups.slice(0, 5);
      return {
        text:
          `Gemessen am geladenen Modell: **${de(clashes.length)} paires de collision**, fondues en ` +
          `**${de(groups.length)} Befundgruppen** (${bySeverity.join(", ")}). ` +
          (connections > 0 ? `Dazu ${de(connections)} documentierte Anschlüsse (kein Konflikt). ` : "") +
          `Wichtigste Befunde unten — Klick sur QC & Conformité pour la 3D.`,
        tools: [TOOL.clashes, TOOL.groups, TOOL.connections],
        rows: top.map((g) => ({
          label: `${g.id} · ${g.title}${g.levels.length > 0 ? ` (${g.levels.join(", ")})` : ""}`,
          value: `${de(g.count)} ${g.count === 1 ? "Stelle" : "Stellen"}`,
          hint: SEV_DE[g.severity],
        })),
        action: { type: "navigate", target: "planpruefung", label: "QC & Conformité öffnen" },
      };
    },
  },

  // --- Norm-Audit ------------------------------------------------------------
  {
    re: /verst[oö][ßs]|norm(?:en)?-?audit|konform|regelverletz|barrierefrei|brandschutz|din-?audit|bnb|planprüf/i,
    scope: "modell",
    answer: (ctx) => {
      const audit = ctx.getAudit();
      const measurable = audit.ruleStats.reduce((n, r) => n + r.measurable, 0);
      if (audit.totalIssues === 0) {
        return {
          text:
            measurable > 0
              ? `Alle geprüften Norm-Regeln sind eingehalten — ${de(measurable)} messbare Bauteile ohne Verstoß (DIN 18040, DIN 18101, GEG…).`
              : "Es gibt aktuell nichts Messbares am Modell (keine Türen/Wände/Fenster mit Bin-Daten) — das Audit schweigt ehrlich statt „0 Verstöße“ zu behaupten.",
          tools: [TOOL.audit],
          action: { type: "navigate", target: "planpruefung", label: "QC & Conformité öffnen" },
        };
      }
      return {
        text:
          `Das Norm-Audit meldet **${de(audit.totalIssues)} Verstöße** ` +
          `(${de(audit.criticalCount)} kritisch, ${de(audit.majorCount)} major, ${de(audit.minorCount)} minor) ` +
          `bei ${de(measurable)} messbaren Bauteilen. Kritischste Regeln unten.`,
        tools: [TOOL.audit],
        rows: audit.ruleStats
          .filter((r) => r.violations > 0)
          .sort((a, b) => b.violations - a.violations)
          .slice(0, 6)
          .map((r) => ({ label: `${r.name} (${r.lawReference})`, value: `${de(r.violations)} Verstöße`, hint: `${de(r.measurable)} messbar` })),
        action: { type: "navigate", target: "planpruefung", label: "QC & Conformité öffnen" },
      };
    },
  },

  // --- VE-Studio (AVANT CO₂ : « Wieviel CO₂ spart CLT? » contient « CO₂ ») ------
  {
    // Intentions VE = un signal CO₂/émission PROCHE d'un verbe d'économie
    // (dans les deux ordres) OU un mot de substitution matériau explicite —
    // « Kosten optimieren » (coût) ne doit JAMAIS atterrir ici.
    re: /substitut|holzbau|\bclt\b|materialwechsel|(co\s?2|co₂|carbon|emission|klima|graue energie).*(spar|reduzier|senk|optimier|minimier|einspar)|(spar|reduzier|senk|einspar|minimier).*(co\s?2|co₂|carbon|emission)|weniger\s?co|niedriger\s?co|emissionsarm|(ersetz|ersetze|tausch|wechsel|alternativ).*(beton|ziegel|material|baustoff|d[aä]mm|mauerwerk|stahlbeton|eps)/i,
    scope: "modell",
    answer: (ctx) => {
      const m = ctx.getMatch();
      const volumes = takeoffVolumeM3BySubstitution(m);
      const opps = buildVEOpportunities(volumes, m.co2Kg);
      const inProject = opps.filter((o) => o.inProject);
      if (inProject.length === 0) {
        return {
          text:
            "Kein substituierbares Material mit Masse im Modell — das VE-Studio schlägt nichts vor " +
            "(kein Raten). Importez une maquette IFC, ou ouvrez le « Beispielprojekt » pour voir le flux.",
          tools: [TOOL.ve],
          warning: "Keine substituierbaren Mengen.",
          action: { type: "navigate", target: "lca?mode=ve", label: "VE-Studio öffnen" },
        };
      }
      const winWin = inProject.filter((o) => o.rec.eurDeltaPerUnit <= 0).length;
      const top = opps.slice(0, 5);
      return {
        text:
          `Das VE-Studio findet **${de(inProject.length)} Substitutionen** auf echte Mengen Ihrer Maquette ` +
          `— davon ${de(winWin)} « Win-Win » (weniger CO₂ UND günstiger). Beste Vorschläge unten ` +
          `(ΔCO₂/Δ€ par m³, appliqués aux vrais m³ du takeoff) :`,
        tools: [TOOL.ve],
        rows: top.map((o) => ({
          label: `${o.rec.from.label} → ${o.rec.to.label}`,
          value: `−${de(o.rec.co2SavedPerUnit, 0)} kg CO₂/m³ · ${o.rec.eurDeltaPerUnit <= 0 ? "−" : "+"}${de(Math.abs(o.rec.eurDeltaPerUnit), 0)} €/m³`,
          hint: o.inProject
            ? o.rec.eurDeltaPerUnit <= 0
              ? "Win-Win"
              : `${de(o.rec.eurPerTonneCo2, 0)} €/t CO₂e`
            : "nicht im Projekt",
        })),
        action: { type: "navigate", target: "lca?mode=ve", label: "VE-Studio öffnen (What-if & PDF)" },
      };
    },
  },

  // --- CO₂ / Material-Match ------------------------------------------------------
  {
    re: /co\s?2|co₂|carbon|klima|graue?\s?energie|[oö]kobilanz|lca|material-?match|epd|[oö]kobaudat|emission/i,
    scope: "modell",
    answer: (ctx) => {
      const m = ctx.getMatch();
      if (m.considered === 0) {
        return {
          text: "Kein Bauteil mit Masse — CO₂-Match nicht möglich (kein Raten).",
          tools: [TOOL.carbon],
          warning: "Aucune masse mesurable.",
        };
      }
      return {
        text:
          `CO₂-Bilanz A1–A3 (${MATCH_SOURCE}): **${fmtCo2(m.co2Kg)}** ` +
          `(Bande honnête ${fmtCo2(m.lowKg)} – ${fmtCo2(m.highKg)})` +
          (m.perM2Ngf !== null ? `, also ${de(m.perM2Ngf)} kg CO₂e/m² NGF` : "") +
          `. Abdeckung réelle : ${de(m.coveragePct)} % der Masse rapprochée ` +
          `(${de(m.unmatched.length)} Bauteile nicht zugeordnet — aufgelistet statt geraten).`,
        tools: [TOOL.carbon],
        rows: m.byCategory.slice(0, 6).map((c) => ({
          label: c.label,
          value: `${fmtCo2(c.co2Kg)} · ${de(c.massKg / 1000, 1)} t`,
          hint: `${de(c.share * 100, 1)} % · ${c.basis === "materialname" ? "Materialname" : "IFC-Klasse ~"}`,
        })),
        action: { type: "navigate", target: "lca", label: "CO₂-Bilanz (LCA) öffnen" },
      };
    },
  },

  // --- Energiebilanz (modèle si calculée, sinon accès au module — ex-Copilot) -----
  {
    re: /energiebilanz|peb|prim[aä]renergie|hwb|heizw[aä]rme|kfw\s?(40|55)|geg\b|u-?wert|d[aä]mmung|endenergie|geg[-\s]?energie/i,
    scope: "adhoc",
    answer: (ctx) => {
      const e = ctx.energyResult;
      if (!e) {
        return {
          text:
            "GEG-Energiebilanz wird im Modul **„Énergie & LCA“** nach dem Monatsverfahren " +
            "(DIN V 18599) berechnet — Primärenergie PEB, Heizwärme HWB, CO₂, KfW 40/55. " +
            "Ich öffne es dir; dort gibt's auch das Ergebnis direkt zum Zitieren.",
          tools: [TOOL.energy],
          warning: "Energiebilanz nicht verfügbar (energyResult = null).",
          action: { type: "navigate", target: "energy", label: "Énergie & LCA öffnen" },
        };
      }
      return {
        text:
          `Energiebilanz GEG 2024 (Monatsverfahren DIN V 18599): ` +
          `**PEB ${de(e.PEB)} kWh/(m²·a)**, HWB ${de(e.HWB)} kWh/(m²·a), ` +
          `Endenergie ${de(e.endenergieM2)} kWh/(m²·a) → **${e.gegLabel}**. ` +
          `CO₂-Betrieb ≈ ${de(e.co2)} kg/a (${de(e.co2M2, 1)} kg/(m²·a)).`,
        tools: [TOOL.energy],
        rows: [
          { label: "Primärenergiebedarf (PEB)", value: `${de(e.PEB)} kWh/(m²·a)`, hint: "Grenzwert KfW55 = 55" },
          { label: "Heizwärmebedarf (HWB)", value: `${de(e.HWB)} kWh/(m²·a)` },
          { label: "Transmissionswärmeverlust H′T", value: `${de(e.HTges, 1)} W/K` },
          { label: "GEG-Status", value: e.gegLabel, hint: e.gegStatus },
        ],
        action: { type: "navigate", target: "energy", label: "Énergie & LCA öffnen" },
      };
    },
  },

  // --- KOSTENR (unifié §42) : signature ad-hoc (typologie/surface/ville) → vraie
  //     Schnell-Schätzung ; sinon coût du MODÈLE s'il est calculé ; sinon honnête.
  {
    re: /kost(?:en|et)|euro|€|budget|sch[aä]tz|rohbau|kg\s?[34]00|gesamtkosten|preis|teuer/i,
    scope: "adhoc",
    answer: (ctx, q) => {
      const typologyId = findTypologyId(q);
      const regionName = findRegionName(q);
      const surface = firstNumber(q);
      const adhoc = Boolean(
        typologyId || regionName || (hasAreaSignature(q) && surface !== undefined && surface >= 20),
      );
      if (adhoc) {
        const t = typologyById(typologyId ?? "mfh");
        const ngf = surface && surface >= 20 && surface < 500_000 ? surface : 1_000;
        const region = DE_REGIONS.find((r) => r.name === regionName) ?? DE_REGIONS[0];
        const result = estimateCost({
          typology: t, ngf, region, quality: QUALITY_STANDARDS[1],
          country: { vatRate: 0.19, currency: "EUR" } as never, year: 2026,
          includeVat: true, includeLand: false, landValue: 0,
          untergeschosse: 1, obergeschosse: 4, bauweiseId: "massiv", energiestandardId: "geg",
        });
        return {
          text:
            `Schnell-Schätzung **DIN 276** pour ${t.name}, ${de(ngf)} m² NGF, ${region.name.split(" ")[0]} ` +
            `(même moteur que le module Estimation) : **${fmtMoney(result.grossTotal)} brutto**, ` +
            `${de(result.perM2Ngf)} €/m² — bande d'honnêteté ${fmtMoney(result.low)} – ${fmtMoney(result.high)}.`,
          tools: [TOOL.quickCost],
          rows: [
            { label: "KG 300 (Rohbau)", value: fmtMoney(result.kg300) },
            { label: "KG 400 (Technik)", value: fmtMoney(result.kg400) },
            { label: "KG 500 (Außenanlagen)", value: fmtMoney(result.kg500) },
            { label: "KG 700 (Nebenkosten)", value: fmtMoney(result.kg700) },
          ],
          action: { type: "navigate", target: "cost", label: "Estimation DIN 276 öffnen (volle Gliederung)" },
        };
      }
      const c = ctx.costResult;
      if (!c) {
        return {
          text:
            "Für **dieses Modell** ist die Schätzung noch nicht berechnet — aber parametrische " +
            "Schnell-Schätzungen funktionieren sofort, exemple : « Wieviel kostet ein Büro 5000 m² in München? »",
          tools: [TOOL.quickCost],
          warning: "Modell-Schätzung nicht verfügbar (costResult = null).",
          action: { type: "navigate", target: "cost", label: "Estimation DIN 276 öffnen" },
        };
      }
      return {
        text:
          `Kosten-Schätzung DIN 276 für **${ctx.projectName}** (${ctx.typologyName}, NGF ${de(ctx.ngf)} m²): ` +
          `**${eur(c.netTotal)} netto** ≈ ${de(c.perM2Ngf)} €/m². ` +
          `Bande d'honnêteté ${eur(c.low)} – ${eur(c.high)} (±${de(c.uncertaintyPct)} %).`,
        tools: [TOOL.cost],
        rows: [
          { label: "KG 300 Rohbau", value: eur(c.kg300) },
          { label: "KG 400 Technik", value: eur(c.kg400) },
          { label: "KG 500 Außenanlagen", value: eur(c.kg500) },
          { label: "KG 700 Nebenkosten", value: eur(c.kg700) },
        ],
        action: { type: "navigate", target: "cost", label: "Estimation DIN 276 öffnen" },
      };
    },
  },

  // --- NGF / BGF / Flächen --------------------------------------------------------
  {
    re: /ngf|bgf|fl[aä]che|wohnfl[aä]che|nutzfl[aä]che|grundfl[aä]che/i,
    scope: "modell",
    answer: (ctx) => ({
      text:
        `Flächen des Projekts **${ctx.projectName}**: NGF **${de(ctx.ngf)} m²**` +
        (ctx.costResult ? `, BGF ${de(ctx.costResult.bgf)} m² (Schätzung aus NGF×1,25)` : "") +
        `. Quelle : Projekteinstellungen/DIN-276-Eingaben — keine Modell-Messung, darum als Eingabe gekennzeichnet.`,
      tools: [TOOL.cost],
      ...(ctx.costResult ? { rows: [{ label: "Nettogrundfläche (NGF)", value: `${de(ctx.ngf)} m²` }, { label: "Bruttogrundfläche (BGF, NGF×1,25)", value: `${de(ctx.costResult.bgf)} m²` }] } : {}),
    }),
  },

  // --- Massen & matériaux ------------------------------------------------------------
  {
    re: /masse|gewicht|tonnage|wie schwer/i,
    scope: "modell",
    answer: (ctx) => {
      const m = ctx.getMatch();
      if (m.considered === 0) {
        return { text: "Keine Messbaren Massen am Modell (keine Mengen).", tools: [TOOL.carbon, TOOL.elements], warning: "Keine Mengen." };
      }
      return {
        text:
          `Gesamtmasse des Modells: **${de(m.totalMassKg / 1000, 1)} t** über ${de(m.considered)} Bauteile. ` +
          `Schwerste Materialfamilien unten (Takeoff-Massen, ÖKOBAUDAT-Klassen).`,
        tools: [TOOL.carbon, TOOL.elements],
        rows: m.byCategory.slice(0, 6).map((c) => ({
          label: c.label,
          value: `${de(c.massKg / 1000, 1)} t`,
          hint: `${de(c.count)} Bauteile`,
        })),
      };
    },
  },

  // --- Geschosse / Ebenen ----------------------------------------------------------------
  {
    re: /geschoss|ebene|stockwerk|etagen?|dachgeschoss/i,
    scope: "modell",
    answer: (ctx) => {
      const byLevel = new Map<string, number>();
      for (const el of ctx.elements) {
        const lv = el.level && el.level !== "—" ? el.level : "Ohne Ebene";
        byLevel.set(lv, (byLevel.get(lv) ?? 0) + 1);
      }
      const rows = [...byLevel.entries()]
        .sort((a, b) => levelKey(a[0]).rank - levelKey(b[0]).rank || a[0].localeCompare(b[0], "de"))
        .map(([lv, n]) => ({ label: levelKey(lv).label, value: `${de(n)} Bauteile` }));
      return {
        text: `Das Modell hat **${de(byLevel.size)} Geschosse/Ebenen** (Tri bureau : cave → Dach ${ctx.sourceLabel}):`,
        tools: [TOOL.elements],
        rows,
      };
    },
  },

  // --- Comptage par classe ----------------------------------------------------------------------
  {
    re: /wie viele|anzahl|z[aä]hl|fenster|t[uü]ren?|w[aä]nde|decke|st[uü]tzen?|tr[aä]ger|treppe|dach|rohr|kanal|möbel|gel[aä]nder|bauteile/i,
    scope: "modell",
    answer: (ctx, query) => {
      const counts = countByClass(ctx.elements);
      const total = ctx.elements.length;
      const asked = askedLevel(query);
      if (asked) {
        const inLevel = ctx.elements.filter((el) => levelKey(el.level).label === asked);
        const c = countByClass(inLevel);
        const rows = [...c.entries()]
          .sort((a, b) => b[1] - a[1] || CLASH_CLASS_LABEL[a[0]].localeCompare(CLASH_CLASS_LABEL[b[0]], "de"))
          .map(([cls, n]) => ({ label: CLASH_CLASS_LABEL[cls], value: de(n) }));
        return {
          text: `Auf Ebene **${asked}**: ${de(inLevel.length)} Bauteile — Aufschlüsselung nach Klasse:`,
          tools: [TOOL.elements],
          rows,
        };
      }
      const rows = [...counts.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || CLASH_CLASS_LABEL[a[0]].localeCompare(CLASH_CLASS_LABEL[b[0]], "de"))
        .map(([cls, n]) => ({ label: CLASH_CLASS_LABEL[cls], value: de(n), hint: `${de((n / total) * 100, 1)} %` }));
      return {
        text: `Das Register misst **${de(total)} Bauteile** (${ctx.sourceLabel}) — Aufschlüsselung nach Klasse (même canonisation que le radar §37):`,
        tools: [TOOL.elements],
        rows,
      };
    },
  },

  // --- Material (nom des matériaux — après masse/classe car plus spécifique au
  //     libellé ; traité adhoc-y compris sans masse ? Non : nécessite le registre.) ---
  {
    re: /materialien?/i,
    scope: "modell",
    answer: (ctx) => {
      const m = ctx.getMatch();
      if (m.considered === 0) {
        return { text: "Keine Materialien mit Masse am Modell.", tools: [TOOL.carbon], warning: "Keine Mengen." };
      }
      return {
        text:
          `Materials des Modells (${de(m.totalMassKg / 1000, 1)} t over ${de(m.considered)} Bauteile), ` +
          `Abdeckung ÖKOBAUDAT ${de(m.coveragePct)} % :`,
        tools: [TOOL.carbon],
        rows: m.byCategory.slice(0, 6).map((c) => ({
          label: c.label,
          value: `${de(c.massKg / 1000, 1)} t`,
          hint: c.basis === "materialname" ? "Materialname" : "IFC-Klasse ~",
        })),
        action: { type: "navigate", target: "materials", label: "Bauteile & Materialien öffnen" },
      };
    },
  },

  // --- Fördermittel (honest : pas d'inventaire inventé) ------------------------------------ ----
  {
    re: /f[oö]rder|bafa|zuschuss|subvention|grant|kfw\s?2(61|82|97|98)/i,
    scope: "adhoc",
    answer: () => ({
      text:
        "Fördermittel werden im **Dashboard** deines Projekts ausgewiesen (KfW 297/298 Neubau, " +
        "261/282 Sanierung, BAFA) — Sobald ein echtes Funding-Match berechnet ist (§36 : nur " +
        "messbare Zuordnung, keine erfundene Prozentsätze), findest du es dort.",
      tools: [],
      action: { type: "navigate", target: "overview", label: "Vue d'ensemble öffnen" },
    }),
  },

  // --- Import / workflow (ex-Copilot) -------------------------------------------------------- ----
  {
    re: /\bifc\b|import|revit|dwg|dxf|upload|datei\b|bim datei/i,
    scope: "adhoc",
    answer: () => ({
      text:
        "**Modell-Import** : IFC/STEP/DXF-Datei in die Maquette 3D ziehen — NARCHI extrahiert " +
        "Mengen (DIN 276), erkennt Kollisionen und matcht Baustoffe (ÖKOBAUDAT). Ich öffne dir den Bereich.",
      tools: [TOOL.elements],
      action: { type: "navigate", target: "import", label: "Maquette 3D öffnen" },
    }),
  },
];

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

/**
 * Répond à une question — en exécutant des OUTILS réels. Jamais d'exception
 * vers l'UI : toute anomalie devient une réponse honnête.
 */
export function answerQuestion(question: string, ctx: IqContext): IqAnswer {
  const q = question.trim();
  if (!q) return helpAnswer("");
  try {
    const noModel = ctx.source === "none" || ctx.elements.length === 0;
    for (const rule of RULES) {
      if (!rule.re.test(q)) continue;
      // Intention liée au modèle sans maquette → état vide honnête.
      if (rule.scope === "modell" && noModel) return noModelAnswer();
      return rule.answer(ctx, q);
    }
    return helpAnswer("Diese Frage kann ich mit den vorhandenen Werkzeugen (noch) nicht beantworten. ");
  } catch (err) {
    return {
      text: "Beim Rechnen ist ein Fehler aufgetreten — ich zeige keine halbfertigen Zahlen. Details in der Konsole.",
      tools: [],
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}
