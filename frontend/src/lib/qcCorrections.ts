// NARCHI — « Suggérer Correction IA » : plan d'actions réel et local.
//
// AVANT : le bouton n'affichait qu'un alert("IA Analysis starting...") — il
// n'avait AUCUN rôle (constat utilisateur, juste).
//
// DÉSORMAIS : moteur de suggestions déterministe, sans serveur ni magie.
// Pour chaque collision, la géométrie parle : la pénétration par axe est
// connue (Clash.overlap). Le plus PETIT déplacement qui sépare les deux
// éléments est la pénétration minimale — c'est la correction la moins
// coûteuse à reporter dans Revit. Les violations de règles réutilisent
// leur suggestion normative existante.

import type { Clash } from "@/lib/planpruefung";
import type { AuditIssue } from "@/lib/AuditEngine";

export interface CorrectionItem {
  id: string;
  kind: "clash" | "rule";
  severity: "critical" | "major" | "minor";
  /// Ligne d'action courte (allemand métier).
  title: string;
  /// Détail chiffré de la correction.
  detail: string;
  /// Référence interne (clic → localisation 3D).
  clash?: Clash;
  issue?: AuditIssue;
}

export interface CorrectionPlan {
  items: CorrectionItem[];
  /** Collisions restantes au-delà de la limite d'affichage. */
  moreClashes: number;
  totalClashes: number;
  totalIssues: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 };

const AXIS_LABEL = [
  { axis: "in X-Richtung (Längsrichtung)", verb: "versetzen" },
  { axis: "in Y-Richtung (Querrichtung)", verb: "versetzen" },
  { axis: "in Z-Richtung (Höhe)", verb: "absenken/anheben" },
] as const;

/// Axe du plus petit déplacement résolvant la collision.
export function cheapestCorrectionAxis(overlap: [number, number, number]): number {
  let axis = 0;
  for (let i = 1; i < 3; i++) if (overlap[i] < overlap[axis]) axis = i;
  return axis;
}

/// Suggestion textuelle chiffrée pour UN clash (allemand métier).
export function clashCorrectionText(clash: Clash): { title: string; detail: string } {
  const axis = cheapestCorrectionAxis(clash.overlap);
  const mm = Math.max(1, Math.ceil(clash.overlap[axis] * 1000));
  const { axis: axisLabel, verb } = AXIS_LABEL[axis];
  return {
    title: `« ${clash.nameA} » ⇄ « ${clash.nameB} » trennen`,
    detail:
      `Eindringtiefe nur ${mm} mm ${axisLabel}. Das beweglichere Bauteil um ${mm} mm (+ 5 mm Sicherheit) ${verb} — ` +
      `kleinster Eingriff. 👁 Vorschau montre den Eingriff live in 3D, ✓ Anwenden beweist ihn per Simulation ` +
      `(Kollision verschwindet im Radar).Danach in Revit nachziehen, IFC neu exportieren.`,
  };
}

/// Construit le plan de correction : collisions (par sévérité) puis règles.
export function buildCorrectionPlan(
  clashes: Clash[],
  issues: AuditIssue[],
  limit = 6,
): CorrectionPlan {
  const clashItems: CorrectionItem[] = clashes.map((clash) => ({
    id: `corr-${clash.id}`,
    kind: "clash",
    severity: clash.severity,
    ...clashCorrectionText(clash),
    clash,
  }));

  const ruleItems: CorrectionItem[] = issues.map((issue) => ({
    id: `corr-${issue.id}`,
    kind: "rule",
    severity: issue.severity,
    title: issue.description,
    detail: issue.suggestion || `Gemessen ${issue.measuredValue} — gefordert ${issue.requiredValue} (${issue.lawReference}).`,
    issue,
  }));

  const sorted = [...clashItems, ...ruleItems].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return {
    items: sorted.slice(0, limit),
    moreClashes: Math.max(0, sorted.length - limit),
    totalClashes: clashes.length,
    totalIssues: issues.length,
  };
}
