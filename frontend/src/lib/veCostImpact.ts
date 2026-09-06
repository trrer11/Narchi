// §165 — Pont VE ↔ coût : la sélection what-if agit sur le DEVIS DIN 276.
//
// Jusqu'ici le VE-Studio montrait le Δ€ des substitutions, mais SANS le relier
// au devis — l'architecte devait faire le lien à la main dans Excel. Ce module
// calcule la « Kostenwirkung » : le devis netto AVANT/APRÈS la sélection VE, et
// l'écart en % du devis ET du budget du projet.
//
// HONNÊTETÉ (charta §36) : le devis DIN 276 est PARAMÉTRIQUE (typologie × NGF
// × région), pas un métré élément par élément. Le Δ€ VE est un delta de
// substitution MATÉRIAU appliqué EN PLUS, dit comme tel (« Orientierung ») —
// jamais prétendu comme un recalcul complet du devis. Signe : totalEurDelta < 0
// = économie (win-win), > 0 = surcoût (premium).

import type { VEWhatIf } from "@/lib/veEngine";

export interface VECostImpact {
  /** Devis netto de référence (null si aucune estimation disponible). */
  estimateNetBefore: number | null;
  /** Devis netto APRÈS application de la sélection VE (= before + delta). */
  estimateNetAfter: number | null;
  /** Δ€ de la sélection (négatif = économie). */
  deltaEur: number;
  /** Δ en % du devis (null sans devis). */
  deltaPctOfEstimate: number | null;
  /** Budget du projet (null si absent). */
  budget: number | null;
  /** Δ en % du budget du projet (null sans budget). */
  deltaPctOfBudget: number | null;
  hasEstimate: boolean;
  hasBudget: boolean;
}

export interface VECostImpactInput {
  whatIf: VEWhatIf;
  estimateNet?: number | null;
  budget?: number | null;
}

export function buildVECostImpact(input: VECostImpactInput): VECostImpact {
  const { whatIf } = input;
  const deltaEur = whatIf.totalEurDelta;
  const estimateNetBefore =
    input.estimateNet != null && input.estimateNet > 0 ? input.estimateNet : null;
  const budget = input.budget != null && input.budget > 0 ? input.budget : null;
  const estimateNetAfter =
    estimateNetBefore != null ? estimateNetBefore + deltaEur : null;
  return {
    estimateNetBefore,
    estimateNetAfter,
    deltaEur,
    deltaPctOfEstimate:
      estimateNetBefore != null ? (deltaEur / estimateNetBefore) * 100 : null,
    budget,
    deltaPctOfBudget: budget != null ? (deltaEur / budget) * 100 : null,
    hasEstimate: estimateNetBefore != null,
    hasBudget: budget != null,
  };
}
