// §161 — Cockpit carbone : le carbone devient une métrique QUOTIDIENNE.
//
// Le bilan carbone (LCA) et le VE-Studio étaient relégués dans un onglet
// « CO₂-Bilanz ». Or pour être « indispensable à chaque bureau », la métrique
// doit être visible CHAQUE MATIN sur le cockpit, avec un appel à l'action :
// « voilà le CO₂ de CE projet, voilà ce qui reste sous le budget, et voilà ce
// que vous pourriez économiser avec N substitutions ». Ce module calcule ce
// résumé de façon PURE (testable), à partir des données déjà sourcées
// (matchMaterials A1–A3, carbonBudgetKg du projet, opportunités VE).

import type { MatchSummary } from "@/lib/materialMatch";
import type { BuildingElement } from "@/data/types";
import {
  carbonVerdict,
  typologyOfProjectType,
  type CarbonVerdict,
  type VEOpportunity,
} from "@/lib/veEngine";
import { matchMaterials } from "@/lib/materialMatch";
import { VERDICT_META } from "@/lib/veEngine";
import type { CarbonReportData } from "@/lib/reportEngine";

export interface CarbonCockpit {
  /** Bilan A1–A3 (Herstellung) du projet actif, kg CO₂e. */
  a1a3Kg: number;
  /** kg CO₂e/m² NGF (A1–A3), null si NGF absente. */
  perM2Kg: number | null;
  /** Budget carbone du projet (carbonBudgetKg), null si absent/0. */
  budgetKg: number | null;
  /** Part du budget déjà consommée par l'A1–A3 (%), null sans budget. */
  budgetUsedPct: number | null;
  /** Le budget est-il dépassé par l'A1–A3 actuel ? */
  overBudget: boolean;
  /** Nombre de substitutions VE applicables (volume présent). */
  veOpportunityCount: number;
  /** Plus GROSSE économie possible en UNE substitution (kg CO₂e) — les
   *  substitutions se chevauchent sur le même matériau, on ne somme donc
   *  jamais : on donne le meilleur coup, honnêtement. */
  vePotentialKg: number | null;
  /** Verdict BNB (Gold/Silber/Bronze/über) sur l'A1–A3 kg/m², null sans NGF. */
  verdict: CarbonVerdict | null;
}

export interface CarbonCockpitInput {
  match: MatchSummary;
  carbonBudgetKg?: number | null;
  opportunities: VEOpportunity[];
  /** Libellé libre du type de projet (pour la typologie BNB). */
  projectType?: string | null;
}

export function buildCarbonCockpit(input: CarbonCockpitInput): CarbonCockpit {
  const { match, opportunities } = input;
  const budgetKg = input.carbonBudgetKg && input.carbonBudgetKg > 0 ? input.carbonBudgetKg : null;
  const inProject = opportunities.filter((o) => o.inProject);
  const vePotentialKg = inProject.length
    ? Math.max(...inProject.map((o) => o.co2SavedKgTotal))
    : null;
  const budgetUsedPct =
    budgetKg != null && budgetKg > 0 ? (match.co2Kg / budgetKg) * 100 : null;
  return {
    a1a3Kg: match.co2Kg,
    perM2Kg: match.perM2Ngf,
    budgetKg,
    budgetUsedPct,
    overBudget: budgetKg != null && match.co2Kg > budgetKg,
    veOpportunityCount: inProject.length,
    vePotentialKg,
    verdict:
      match.perM2Ngf != null
        ? carbonVerdict(match.perM2Ngf, typologyOfProjectType(input.projectType))
        : null,
  };
}

// ---------------------------------------------------------------------------
// §162 — carbone PAR PROJET (portefeuille) : le même A1–A3 cohérent LCA/VE,
// comparé au budget de CHAQUE projet — pour la liste « Projekte ».
// ---------------------------------------------------------------------------

export interface ProjectCarbonSummary {
  a1a3Kg: number;
  overBudget: boolean;
  usedPct: number | null;
  verdict: CarbonVerdict | null;
}

export interface ProjectCarbonRef {
  id: string;
  grossFloorArea?: number;
  carbonBudgetKg?: number;
  type?: string;
}

export function projectCarbonSummaries(
  projects: ProjectCarbonRef[],
  elements: BuildingElement[],
): Record<string, ProjectCarbonSummary> {
  const out: Record<string, ProjectCarbonSummary> = {};
  for (const p of projects) {
    const els = elements.filter((e) => e.projectId === p.id);
    if (els.length === 0) continue;
    const match = matchMaterials(els, p.grossFloorArea);
    const budget = p.carbonBudgetKg && p.carbonBudgetKg > 0 ? p.carbonBudgetKg : null;
    out[p.id] = {
      a1a3Kg: match.co2Kg,
      overBudget: budget != null && match.co2Kg > budget,
      usedPct: budget != null ? (match.co2Kg / budget) * 100 : null,
      verdict:
        match.perM2Ngf != null
          ? carbonVerdict(match.perM2Ngf, typologyOfProjectType(p.type))
          : null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// §168 — données carbone pour le rapport FINANCIER unifié (section 6).
// ---------------------------------------------------------------------------

export interface CarbonReportInput {
  match: MatchSummary;
  carbonBudgetKg?: number | null;
  projectType?: string | null;
  opportunities: VEOpportunity[];
}

export function buildCarbonReportData(input: CarbonReportInput): CarbonReportData {
  const { match, opportunities } = input;
  const budgetKg = input.carbonBudgetKg && input.carbonBudgetKg > 0 ? input.carbonBudgetKg : null;
  const verdict =
    match.perM2Ngf != null
      ? carbonVerdict(match.perM2Ngf, typologyOfProjectType(input.projectType))
      : null;
  // Top VE applicable, win-win d'abord (déjà trié par buildVEOpportunities).
  const veTop = opportunities
    .filter((o) => o.inProject)
    .slice(0, 5)
    .map((o) => ({
      label: `${o.rec.from.label} -> ${o.rec.to.label}`,
      co2PerM3: o.rec.co2SavedPerUnit,
      eurPerM3: o.rec.eurDeltaPerUnit,
      winWin: o.rec.eurDeltaPerUnit <= 0,
    }));
  return {
    a1a3Kg: match.co2Kg,
    perM2Kg: match.perM2Ngf,
    verdictLabel: verdict ? VERDICT_META[verdict.level].short : "—",
    budgetKg,
    budgetUsedPct: budgetKg != null ? (match.co2Kg / budgetKg) * 100 : null,
    overBudget: budgetKg != null && match.co2Kg > budgetKg,
    veTop,
  };
}

// ---------------------------------------------------------------------------
// §169 — Alertes budget carbone : les projets AU-DESSUS du budget remontent
// en notification (le carbone agit aussi PASSIVEMENT, pas seulement au cockpit).
// ---------------------------------------------------------------------------

export interface CarbonBudgetAlert {
  projectId: string;
  projectName: string;
  a1a3Kg: number;
  budgetKg: number;
  /** Dépassement (kg CO₂e, positif). */
  excessKg: number;
}

export function carbonBudgetAlerts(
  projects: (ProjectCarbonRef & { name: string })[],
  elements: BuildingElement[],
): CarbonBudgetAlert[] {
  const summaries = projectCarbonSummaries(projects, elements);
  const out: CarbonBudgetAlert[] = [];
  for (const p of projects) {
    const s = summaries[p.id];
    if (!s || !s.overBudget) continue;
    const budget = p.carbonBudgetKg ?? 0;
    out.push({
      projectId: p.id,
      projectName: p.name,
      a1a3Kg: s.a1a3Kg,
      budgetKg: budget,
      excessKg: s.a1a3Kg - budget,
    });
  }
  return out;
}
