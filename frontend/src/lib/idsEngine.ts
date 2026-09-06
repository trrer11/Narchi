// NARCHI V6.10 — IDS-Abnahme (Information Delivery Specification) §41.
// Inspiration ibuilder/massing de la veille §36 (plateforme IFC-native +
// IDS/COBie) adaptée au marché allemand : un bureau d'architecture doit
// pouvoir vérifier SI une maquette livrée contient les informations
// exigées — DIN EN 17412 (IDS), buildingSMART IDS, champs COBie usuels.
//
// Honnêteté absolue (charte §36) : chaque exigence rend pass / fail /
// N.A. (« nicht prüfbar » quand la donnée n'existe pas dans la maquette —
// un U-Wert absent ne devient jamais un « conforme » silencieux). Les
// éléments fautifs sont listés cliquables vers le focus 3D.

import type { BuildingElement } from "@/data/types";
import { levelKey } from "@/lib/levelSort";
import { matchCategory } from "@/lib/materialMatch";
import { expressIdKey } from "@/lib/qcSources";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type IdsCategory = "ALLGEMEIN" | "ARCH" | "TRAG" | "TGA" | "COBIE";
export type IdsVerdict = "pass" | "fail" | "na";

export interface IdsRequirement {
  id: string;
  title: string;
  category: IdsCategory;
  /** Référence de la règle (norme/bonne pratique allemande). */
  basis: string;
  /** Suggestion bureau quand ça échoue — affichée au clic. */
  suggestion: string;
}

interface CheckContext {
  elements: BuildingElement[];
  guIds: Map<string, number>;
}

interface CheckResult {
  verdict: IdsVerdict;
  detail: string;
}

type IdsCheck = (el: BuildingElement, ctx: CheckContext) => CheckResult;

export interface IdsRuleStat extends IdsRequirement {
  checked: number;
  passed: number;
  failed: number;
  na: number;
  /** % réussite sur les mesurables seuls (na exclus — jamais faussé). */
  passRate: number | null;
  failing: IdsFailure[];
}

export interface IdsFailure {
  elementId: string;
  expressId: number | null;
  name: string;
  level: string;
  detail: string;
}

export interface IdsReport {
  requirements: IdsRuleStat[];
  /** Éléments mesurables globalement (au moins une règle non-na). */
  measurableElements: number;
  totalElements: number;
  /** % global (toutes mesurables confondues, na exclus) ou null. */
  overallPassRate: number | null;
  overallLabel: string;
}

// ---------------------------------------------------------------------------
// Helpers de lecture (identiques à l'esprit AuditEngine : clés tolérantes)
// ---------------------------------------------------------------------------

function propNumber(el: BuildingElement, keys: string[]): number | null {
  for (const k of keys) {
    const p = el.properties.find((x) => x.key.toLowerCase() === k || x.key.toLowerCase().replace(/\s+/g, "") === k.replace(/\s+/g, ""));
    if (p) {
      const n = Number(String(p.value).replace(",", "."));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

const WIDTH_KEYS = ["width", "breite", "nominalwidth", "overallwidth", "clearopening", "lichtebreite"];
const UVALUE_KEYS = ["u-value", "uvalue", "u_value", "thermaltransmittance", "u-wert", "uwert"];

const isType = (el: BuildingElement, ...needles: string[]) => {
  const t = el.type.toUpperCase();
  return needles.some((n) => t.includes(n));
};

/// Nom « parlant » COBie : ni vide, ni générique du CAD (« Wall-0123 »,
/// « Grundelement 5 », « Unbenannt »…).
function hasMeaningfulName(el: BuildingElement): boolean {
  const n = el.name.trim();
  if (n.length < 4) return false;
  if (/^(unbenannt|unnamed|element|bauteil|grundelement|generic)[\s:_-]*\d*$/i.test(n)) return false;
  if (/^(wall|fenster|door|tuer|tür|wand|decke|slab|column|stuetze)[\s:_-]*\d+$/i.test(n)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Exigences du profil NARCHI marché allemand (règles auditables en test)
// ---------------------------------------------------------------------------

interface IdsRule extends IdsRequirement {
  appliesTo: (el: BuildingElement) => boolean;
  check: IdsCheck;
}

const ALL = () => true;

const IDS_RULES: IdsRule[] = [
  {
    id: "NQI-01",
    title: "Eindeutige GUID je Bauteil",
    category: "ALLGEMEIN",
    basis: "buildingSMART IDS — GlobalId obligatoire",
    suggestion: "GlobalId depuis l'export IFC vérifier (duplicate ou vide).",
    appliesTo: ALL,
    check: (el, ctx) => {
      const g = el.guid?.trim() ?? "";
      if (!g || g.length < 8) {
        return { verdict: "fail", detail: "GUID manquant ou trop court" };
      }
      if ((ctx.guIds.get(g.toLowerCase()) ?? 0) > 1) {
        return { verdict: "fail", detail: `GUID dupliziert (${ctx.guIds.get(g.toLowerCase())}×)` };
      }
      return { verdict: "pass", detail: "GUID eindeutig" };
    },
  },
  {
    id: "NQI-02",
    title: "Zuordnung zu einem Geschoss",
    category: "ALLGEMEIN",
    basis: "IDS/COBie — chaque Bauteil porte son Geschoss",
    suggestion: "Storey-Zuordnung dans Revit/ArchiCAD avant export.",
    appliesTo: (el) => !isType(el, "SPACE"),
    check: (el) => {
      const lv = el.level?.trim() ?? "";
      if (!lv || lv === "—" || lv === "-") return { verdict: "fail", detail: "Kein Geschoss zugeordnet" };
      const k = levelKey(lv);
      if (k.rank === 500 && k.label === lv) {
        return { verdict: "na", detail: `Ebene « ${lv} » folgt nicht dem deutschen Schema (EG/OG/UG/Dach)` };
      }
      return { verdict: "pass", detail: `Ebene ${k.label}` };
    },
  },
  {
    id: "NQI-03",
    title: "Geometrie (Bounding-Box) der tragenden Bauteile",
    category: "TRAG",
    basis: "DIN 276 KG 330 — tragende Teile müssen räumlich fassbar sein",
    suggestion: "Vollständige Körper (keine Linien/2D-Symbole) exportieren.",
    appliesTo: (el) => isType(el, "WALL", "SLAB", "COLUMN", "BEAM", "FOOTING", "FOUNDATION", "PILE", "STAIR"),
    check: (el) => {
      const bbox = el.properties.find((p) => p.key === "bbox");
      if (!bbox) return { verdict: "fail", detail: "Keine Geometrie (bbox) — nicht lokaliserbar" };
      try {
        const b = JSON.parse(bbox.value) as number[];
        const vol = Math.abs((b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]));
        if (!Number.isFinite(vol) || vol <= 0) return { verdict: "fail", detail: "Geometrie entartet (Volumen 0)" };
        return { verdict: "pass", detail: `BBox ${vol.toFixed(2)} m³` };
      } catch {
        return { verdict: "fail", detail: "Geometrie unleserlich (JSON)" };
      }
    },
  },
  {
    id: "NQI-04",
    title: "Material ÖKOBAUDAT-zuordenbar",
    category: "TRAG",
    basis: "BNB 4.1.1 / ÖKOBAUDAT — graue Energie nur mit benannten Baustoffen",
    suggestion: "Materialnamen im IFC pflegen (« Stahlbeton C30/37 » statt « Beton 1 »).",
    appliesTo: (el) => !isType(el, "SPACE") && (el.weightKg ?? 0) > 0,
    check: (el) => {
      const m = matchCategory(el.name, el.type);
      if (!m) return { verdict: "fail", detail: "Kein Material zuordenbar (Name + Klasse ohne Treffer)" };
      if (m.basis === "ifc-klasse") {
        return { verdict: "na", detail: `Nur Klassen-Näherung (0,55) : ${m.category.label}` };
      }
      return { verdict: "pass", detail: `Materialname → ${m.category.label}` };
    },
  },
  {
    id: "NQI-05",
    title: "Lichte Durchgangsbreite der Türen ≥ 0,80 m",
    category: "ARCH",
    basis: "DIN 18101 / DIN 18040-1 §6.3 (barrierefrei 0,80 m, PMR 0,85 m)",
    suggestion: "Türblatt verbreitern (Rohbaumaß 1,00/1,125 m).",
    appliesTo: (el) => isType(el, "DOOR"),
    check: (el) => {
      const w = propNumber(el, WIDTH_KEYS);
      if (w === null) return { verdict: "na", detail: "Breite nicht im Modell (kein Pset) — nicht prüfbar" };
      if (w < 0.8) return { verdict: "fail", detail: `Nur ${w.toFixed(2)} m licht — unter DIN 18101-Mindestmaß` };
      if (w < 0.85) return { verdict: "fail", detail: `${w.toFixed(2)} m — DIN 18101 ok, aber nicht barrierefrei (≥ 0,85 m)` };
      return { verdict: "pass", detail: `${w.toFixed(2)} m ≥ 0,85 m` };
    },
  },
  {
    id: "NQI-06",
    title: "U-Wert der Außenwände ≤ 0,28 W/(m²K)",
    category: "TRAG",
    basis: "GEG 2024 §Anlage 7 (WDVS Referenzwand)",
    suggestion: "Dämmung verstärken oder WDVS-Verbund prüfen (Referenz 0,28).",
    appliesTo: (el) => isType(el, "WALL") && !isType(el, "CURTAINWALL"),
    check: (el) => {
      const u = propNumber(el, UVALUE_KEYS);
      if (u === null) return { verdict: "na", detail: "Kein U-Wert im Modell — GEG-Nachweis nachzureichen" };
      if (u > 0.28) return { verdict: "fail", detail: `U = ${u.toFixed(2)} > 0,28 W/(m²K)` };
      return { verdict: "pass", detail: `U = ${u.toFixed(2)} ≤ 0,28` };
    },
  },
  {
    id: "NQI-07",
    title: "COBie-Basis : sprechender Bauteilname",
    category: "COBIE",
    basis: "COBie/VDI 2552 — Namen lesbar statt CAD-Generika",
    suggestion: "Benennungsrichtlinie vor Export (z. B. « AW-EG-01 KS 36 »).",
    appliesTo: (el) => !isType(el, "SPACE"),
    check: (el) =>
      hasMeaningfulName(el)
        ? { verdict: "pass", detail: "Name lesbar" }
        : { verdict: "fail", detail: `Generischer Name « ${el.name} » — COBie-Abnahme riskiert` },
  },
  {
    id: "NQI-08",
    title: "Kostengruppe (DIN 276) am Bauteil",
    category: "COBIE",
    basis: "DIN 276-1:2018-12 — KG-Zuordnung für AVA/Kosten",
    suggestion: "KG-Code in den Export-Parametern ergänzen.",
    appliesTo: (el) => !isType(el, "SPACE"),
    check: (el) => {
      const code = el.code?.trim() ?? "";
      if (!code || code === "—" || !/^\d{3}/.test(code)) {
        return { verdict: "fail", detail: "Keine gültige Kostengliederung (KG 3xx/4xx)" };
      }
      return { verdict: "pass", detail: `KG ${code}` };
    },
  },
  {
    id: "NQI-09",
    title: "Quantität (Länge/Fläche/Volumen) messbar",
    category: "ALLGEMEIN",
    basis: "DIN 276 + AVA — Massenermittlung braucht Mengen",
    suggestion: "BaseQuantities im IFC-Export aktivieren.",
    appliesTo: (el) => !isType(el, "SPACE"),
    check: (el) => {
      if (el.qty > 0) return { verdict: "pass", detail: `${el.qty.toFixed(2)} ${el.unit}` };
      return { verdict: "fail", detail: "Keine Quantität — AVA nicht möglich" };
    },
  },
  {
    id: "NQI-10",
    title: "Keine IFCSPACE-Zombies im Bauteilregister",
    category: "ALLGEMEIN",
    basis: "IDS-Hygiene — Räume sind virtuelle Objekte, keine Bauteile",
    suggestion: "Nur physische Klassen ins Modell-Register aufnehmen.",
    appliesTo: (el) => isType(el, "SPACE"),
    check: () => ({ verdict: "fail", detail: "IFCSPACE fälschlich im Bauteilregister" }),
  },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const FAIL_CAP = 12;

export function runIdsAudit(elements: BuildingElement[]): IdsReport {
  const guIds = new Map<string, number>();
  for (const el of elements) {
    const g = (el.guid ?? "").trim().toLowerCase();
    if (g) guIds.set(g, (guIds.get(g) ?? 0) + 1);
  }
  const ctx: CheckContext = { elements, guIds };

  const measurable = new Set<string>();

  const requirements: IdsRuleStat[] = IDS_RULES.map((rule) => {
    const stat: IdsRuleStat = {
      id: rule.id,
      title: rule.title,
      category: rule.category,
      basis: rule.basis,
      suggestion: rule.suggestion,
      checked: 0,
      passed: 0,
      failed: 0,
      na: 0,
      passRate: null,
      failing: [],
    };
    for (const el of elements) {
      if (!rule.appliesTo(el)) continue;
      stat.checked += 1;
      const r = rule.check(el, ctx);
      if (r.verdict === "na") {
        stat.na += 1;
        continue;
      }
      measurable.add(el.id);
      if (r.verdict === "pass") {
        stat.passed += 1;
      } else {
        stat.failed += 1;
        if (stat.failing.length < FAIL_CAP) {
          stat.failing.push({
            elementId: el.id,
            expressId: expressIdKey(el),
            name: el.name,
            level: el.level || "—",
            detail: r.detail,
          });
        }
      }
    }
    const decided = stat.passed + stat.failed;
    stat.passRate = decided > 0 ? stat.passed / decided : null;
    return stat;
  });

  // Tri bureau : pires d'abord (fails desc), puis alpha par id.
  const sorted = [...requirements].sort(
    (a, b) =>
      (b.failed - a.failed) ||
      (b.checked - b.na) - (a.checked - a.na) ||
      a.id.localeCompare(b.id),
  );

  const totalPass = requirements.reduce((n, r) => n + r.passed, 0);
  const totalDecided = requirements.reduce((n, r) => n + r.passed + r.failed, 0);
  const overallPassRate = totalDecided > 0 ? totalPass / totalDecided : null;

  let overallLabel = "Kein Modell prüfbar";
  if (overallPassRate !== null) {
    if (overallPassRate >= 0.98) overallLabel = "Abnahme-reif ✅";
    else if (overallPassRate >= 0.9) overallLabel = "Fast abnahme-reif — Restpunkte klären";
    else if (overallPassRate >= 0.75) overallLabel = "Klärungsbedarf vor Eingang";
    else overallLabel = "Nicht abnahme-fähig — Maquette rückmelden";
  }

  return {
    requirements: sorted,
    measurableElements: measurable.size,
    totalElements: elements.length,
    overallPassRate,
    overallLabel,
  };
}
