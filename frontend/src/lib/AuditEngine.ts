/**
 * AUDIT ENGINE - NARCHI CORE V2
 * Moteur de règles industriel pour la conformité architecturale automatisée.
 *
 * Le moteur est découplé des valeurs seuils : la configuration de contexte
 * (regulatoryRules.json) pilote les normes appliquées (ERP, Habitation…).
 *
 * V6.1 — Réparation du « 0 Violations » permanent :
 *  - Les éléments extraits d'un IFC portent leurs mesures dans les
 *    BaseQuantities (Width / Height / GrossSideArea…) souvent rangées en
 *    bloc JSON (« Quantité brute »). Les règles cherchent désormais par
 *    SYNONYMES dans les propriétés simples ET dans ces blocs.
 *  - Chaque règle rapporte combien d'éléments elle a réellement ÉVALUÉS
 *    (ruleStats) : l'UI distingue « 0 violation car tout est conforme » de
 *    « 0 violation car rien n'était mesurable ».
 */

import type { BuildingElement } from "@/data/types";
import regulatoryRules from "@/config/regulatoryRules.json";

export type AuditSeverity = "critical" | "major" | "minor";
export type RegulatoryContext = "HABITATION" | "ERP" | "INDUSTRIEL" | "DEFAULT";

export interface AuditIssue {
  id: string;
  elementId: string;
  ruleId: string;
  type: string;
  description: string;
  measuredValue: string;
  requiredValue: string;
  severity: AuditSeverity;
  lawReference: string;
  suggestion: string;
}

/// Couverture d'évaluation d'une règle sur le jeu d'éléments audités.
export interface AuditRuleStat {
  ruleId: string;
  name: string;
  category: "accessibility" | "energy" | "structure";
  lawReference: string;
  /** Éléments concernés par la règle (type correspondant). */
  checked: number;
  /** Éléments dont la mesure a pu être lue (donnée exploitable). */
  measurable: number;
  /** Violations constatées. */
  violations: number;
}

export interface AuditReport {
  timestamp: Date;
  context: RegulatoryContext;
  totalIssues: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  issues: AuditIssue[];
  /** Couverture réelle de l'audit, règle par règle. */
  ruleStats: AuditRuleStat[];
}

/* --------------------------------------------------------------------------
 * Lecture de mesures tolérante aux formats IFC
 * ------------------------------------------------------------------------ */

type RuleContext = Record<string, any>;

interface RuleCheckResult {
  pass: boolean;
  measured: string;
  required: string;
  suggestion: string;
  /** Valeur numérique lue (null = donnée manquante / non mesurable). */
  numeric: number | null;
}

interface RuleDefinition {
  id: string;
  name: string;
  category: "accessibility" | "energy" | "structure";
  severity: AuditSeverity;
  lawReference: string;
  check: (el: BuildingElement, config: RuleContext) => RuleCheckResult | null;
}

/// Parse « 0,85 » ou « 0.85 » en nombre (formats IFC/ALÉATOIRES).
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/// Cache d'aplatissement des mesures par élément (WeakMap : pas de fuite —
/// l'entrée disparaît avec l'élément). Avant : chaque règle re-parsait le
/// bloc JSON BaseQuantities de chaque élément (× 5 règles × 1 814 éléments).
const measuresCache = new WeakMap<BuildingElement, Map<string, number>>();

/// Toutes les mesures numériques de l'élément, clés en minuscules,
/// propriétés simples ET blocs JSON aplaties (parsés une seule fois).
function flattenedMeasures(el: BuildingElement): Map<string, number> {
  const cached = measuresCache.get(el);
  if (cached) return cached;

  const map = new Map<string, number>();
  for (const prop of el.properties) {
    const direct = toNumber(prop.value);
    if (direct !== null) map.set(prop.key.toLowerCase(), direct);
    if (typeof prop.value === "string" && prop.value.startsWith("{")) {
      try {
        const parsed = JSON.parse(prop.value) as Record<string, unknown>;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (map.has(key.toLowerCase())) continue;
            const n = toNumber(value);
            if (n !== null) map.set(key.toLowerCase(), n);
          }
        }
      } catch {
        // pas du JSON — ignoré
      }
    }
  }
  measuresCache.set(el, map);
  return map;
}

/// Cherche une mesure numérique par synonymes (fr/de/en) — propriétés
/// simples et blocs BaseQuantities, parsés une seule fois par élément.
export function numericProperty(el: BuildingElement, synonyms: string[]): number | null {
  const needles = synonyms.map((s) => s.toLowerCase());
  const measures = flattenedMeasures(el);
  for (const [key, value] of measures) {
    if (needles.some((n) => key.includes(n))) return value;
  }
  return null;
}

/// L'élément correspond-il à une famille de types IFC ?
function isType(el: BuildingElement, ...tokens: string[]): boolean {
  const t = el.type.toUpperCase();
  return tokens.some((token) => t.includes(token));
}

const WIDTH_KEYS = ["width", "breite", "nominalwidth", "overallwidth", "clearopening"];
const HEIGHT_KEYS = ["height", "höhe", "hoehe", "nominalheight", "overallheight"];
const THICKNESS_KEYS = ["thickness", "dicke", "wandstärke", "wandstaerke", "width"];
const UVALUE_KEYS = ["u-value", "uvalue", "u_value", "thermaltransmittance", "u-wert", "uwert"];

const RULES: RuleDefinition[] = [
  {
    id: "DIN-18040-DOOR-WIDTH",
    name: "Breite Türöffnung (barrierefrei)",
    category: "accessibility",
    severity: "critical",
    lawReference: "DIN 18040-1",
    check: (el, config) => {
      if (!isType(el, "DOOR", "TUER", "TÜR")) return null;
      const width = numericProperty(el, WIDTH_KEYS);
      const minWidth = config.accessibility?.minDoorWidth ?? 0.85;

      if (width === null) {
        return { pass: true, measured: "—", required: `≥ ${minWidth} m`, suggestion: "", numeric: null };
      }
      if (width > 0 && width < minWidth) {
        return {
          pass: false,
          measured: `${width.toFixed(2)} m`,
          required: `≥ ${minWidth} m`,
          suggestion: `Élargir le passage libre jusqu'à ${minWidth} m (porte au passage/à l'usage PMR).`,
          numeric: width,
        };
      }
      return { pass: true, measured: `${width.toFixed(2)} m`, required: `≥ ${minWidth} m`, suggestion: "", numeric: width };
    },
  },
  {
    id: "DIN-18040-DOOR-HEIGHT",
    name: "Hauteur libre de passage des portes",
    category: "accessibility",
    severity: "minor",
    lawReference: "DIN 18101 / DIN 18040-1",
    check: (el, _config) => {
      if (!isType(el, "DOOR", "TUER", "TÜR")) return null;
      const height = numericProperty(el, HEIGHT_KEYS);
      const minHeight = 2.0;

      if (height === null) {
        return { pass: true, measured: "—", required: `≥ ${minHeight.toFixed(2)} m`, suggestion: "", numeric: null };
      }
      if (height > 0 && height < minHeight) {
        return {
          pass: false,
          measured: `${height.toFixed(2)} m`,
          required: `≥ ${minHeight.toFixed(2)} m`,
          suggestion: `Relever le linteau / la hauteur de passage libre à ${minHeight.toFixed(2)} m minimum.`,
          numeric: height,
        };
      }
      return { pass: true, measured: `${height.toFixed(2)} m`, required: `≥ ${minHeight.toFixed(2)} m`, suggestion: "", numeric: height };
    },
  },
  {
    id: "STRUCT-WALL-THICKNESS",
    name: "Épaisseur minimale des murs",
    category: "structure",
    severity: "major",
    lawReference: "Eurocode 2 / DIN EN 1992",
    check: (el, config) => {
      if (!isType(el, "WALL", "MAUER", "WAND")) return null;
      const thick = numericProperty(el, THICKNESS_KEYS);
      const minThick = config.structure?.minWallThickness ?? 0.15;

      if (thick === null) {
        return { pass: true, measured: "—", required: `≥ ${minThick} m`, suggestion: "", numeric: null };
      }
      if (thick > 0 && thick < minThick) {
        return {
          pass: false,
          measured: `${thick.toFixed(2)} m`,
          required: `≥ ${minThick} m`,
          suggestion: `Augmenter l'épaisseur du mur pour satisfaire les exigences de stabilité (min. ${minThick} m).`,
          numeric: thick,
        };
      }
      return { pass: true, measured: `${thick.toFixed(2)} m`, required: `≥ ${minThick} m`, suggestion: "", numeric: thick };
    },
  },
  {
    id: "GEG-U-VALUE-WALL",
    name: "Performance thermique de l'enveloppe (mur)",
    category: "energy",
    severity: "major",
    lawReference: "GEG 2024, Anlage 7",
    check: (el, config) => {
      if (!isType(el, "WALL", "MAUER", "WAND")) return null;
      const uValue = numericProperty(el, UVALUE_KEYS);
      const maxUValue = config.energy?.maxUValueWall ?? 0.24;

      if (uValue === null) {
        return { pass: true, measured: "—", required: `≤ ${maxUValue} W/m²K`, suggestion: "", numeric: null };
      }
      if (uValue > 0 && uValue > maxUValue) {
        return {
          pass: false,
          measured: `${uValue.toFixed(2)} W/m²K`,
          required: `≤ ${maxUValue} W/m²K`,
          suggestion: `Renforcer l'isolation du mur extérieur pour passer sous ${maxUValue} W/m²K.`,
          numeric: uValue,
        };
      }
      return { pass: true, measured: `${uValue.toFixed(2)} W/m²K`, required: `≤ ${maxUValue} W/m²K`, suggestion: "", numeric: uValue };
    },
  },
  {
    id: "GEG-U-VALUE-WINDOW",
    name: "Performance thermique des fenêtres",
    category: "energy",
    severity: "major",
    lawReference: "GEG 2024, Anlage 7",
    check: (el, config) => {
      if (!isType(el, "WINDOW", "FENSTER", "GLAZ")) return null;
      const uValue = numericProperty(el, UVALUE_KEYS);
      const maxUValue = config.energy?.maxUValueWindow ?? 1.3;

      if (uValue === null) {
        return { pass: true, measured: "—", required: `≤ ${maxUValue} W/m²K`, suggestion: "", numeric: null };
      }
      if (uValue > 0 && uValue > maxUValue) {
        return {
          pass: false,
          measured: `${uValue.toFixed(2)} W/m²K`,
          required: `≤ ${maxUValue} W/m²K`,
          suggestion: `Fenêtre au-dessus du seuil GEG : vitrage/vitrage triple ou cadre performant requis (≤ ${maxUValue} W/m²K).`,
          numeric: uValue,
        };
      }
      return { pass: true, measured: `${uValue.toFixed(2)} W/m²K`, required: `≤ ${maxUValue} W/m²K`, suggestion: "", numeric: uValue };
    },
  },
];

/* --------------------------------------------------------------------------
 * Moteur
 * ------------------------------------------------------------------------ */

function toIssue(el: BuildingElement, rule: RuleDefinition, result: RuleCheckResult): AuditIssue {
  return {
    id: `${el.id}_${rule.id}`,
    elementId: el.id,
    ruleId: rule.id,
    type: rule.category,
    description: `${rule.name} : ${el.name}`,
    measuredValue: result.measured,
    requiredValue: result.required,
    severity: rule.severity,
    lawReference: rule.lawReference,
    suggestion: result.suggestion,
  };
}

export class AuditEngine {
  /**
   * Audit complet dans un contexte réglementaire donné.
   *
   * @param elements - Éléments du bâtiment à auditer
   * @param contextId - Contexte normatif (ex. « ERP », « HABITATION »)
   */
  public static runFullAudit(
    elements: BuildingElement[],
    contextId: RegulatoryContext = "DEFAULT"
  ): AuditReport {
    // Récupération sécurisée de la configuration (repli DEFAULT)
    const config = (regulatoryRules as Record<string, RuleContext>)[contextId] || regulatoryRules["DEFAULT"];
    const issues: AuditIssue[] = [];
    const stats = new Map<string, AuditRuleStat>(
      RULES.map((rule) => [
        rule.id,
        { ruleId: rule.id, name: rule.name, category: rule.category, lawReference: rule.lawReference, checked: 0, measurable: 0, violations: 0 },
      ])
    );

    for (const el of elements) {
      if (!el || !Array.isArray(el.properties)) continue;
      for (const rule of RULES) {
        let result: RuleCheckResult | null = null;
        try {
          result = rule.check(el, config);
        } catch {
          result = null;
        }
        if (!result) continue;
        const stat = stats.get(rule.id)!;
        stat.checked += 1;
        if (result.numeric !== null && result.numeric > 0) stat.measurable += 1;
        if (!result.pass) {
          stat.violations += 1;
          issues.push(toIssue(el, rule, result));
        }
      }
    }

    return {
      timestamp: new Date(),
      context: contextId,
      totalIssues: issues.length,
      criticalCount: issues.filter((i) => i.severity === "critical").length,
      majorCount: issues.filter((i) => i.severity === "major").length,
      minorCount: issues.filter((i) => i.severity === "minor").length,
      issues,
      ruleStats: Array.from(stats.values()),
    };
  }

  /**
   * Audit d'un élément isolé dans un contexte donné.
   */
  public static auditElement(
    el: BuildingElement,
    contextId: RegulatoryContext = "DEFAULT"
  ): AuditIssue[] {
    const config = (regulatoryRules as Record<string, RuleContext>)[contextId] || regulatoryRules["DEFAULT"];
    const issues: AuditIssue[] = [];

    for (const rule of RULES) {
      let result: RuleCheckResult | null = null;
      try {
        result = rule.check(el, config);
      } catch {
        result = null;
      }
      if (result && !result.pass) {
        issues.push(toIssue(el, rule, result));
      }
    }

    return issues;
  }
}
