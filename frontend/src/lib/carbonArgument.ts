// §159 — Argumentaire client bas-carbone : le « waouh » de communication.
//
// Le point de douleur n°6 des architectes (Reddit) : « la communication client
// est fragmentée » — convaincre un Bauherr de choisir une solution bas-carbone
// prend des heures d'e-mails et de réunions. Ce module GÉNÈRE l'argumentaire
// en allemand, À PARTIR DES CHIFFRES RÉELS du projet (what-if §156) — jamais de
// texte marketing creux : chaque phrase chiffrée vient du moteur VE
// (Ökobaudat/BKI), et les références réglementaires restent générales,
// marquées « Orientierung, kein Beratungsnachweis ».
//
// HONNÊTETÉ (charta §36) : ce n'est PAS une IA générative. C'est un gabarit
// déterministe qui interpole les vrais ΔCO2/Δ€ du projet. Les ancres
// réglementaires (CO2-Preis nEHS, KfW) sont des RICHTWERTE 2026, dits comme
// tels — l'architecte garde la responsabilité du conseil.

import type { VEWhatIf } from "@/lib/veEngine";

/** Ancres publiques (Richtwerte 2026) — affichées comme orientation. */
export const CO2_PRICE_EUR_PER_T = 55; // nEHS / EU-ETS2, corridor ~45–65 €/t (Richtwert)

export interface CarbonArgumentInput {
  projectName: string;
  whatIf: VEWhatIf;
  /** Bilan A1–A3 d'origine (kg CO2e). */
  totalCo2Kg?: number;
  /** kg CO2e/m² NGF avant substitution. */
  perM2Before?: number | null;
}

export interface CarbonArgument {
  /** Phrase d'accroche (titre de la section). */
  headline: string;
  /** Paragraphe d'introduction (projet + nombre de substitutions). */
  intro: string;
  /** Les arguments chiffrés, dans l'ordre (CO2 → coût → avenir). */
  bullets: string[];
  /** Phrase de conclusion + avertissement honnête. */
  closing: string;
}

const fmt = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
const fmt1 = (n: number): string => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const fmtCarbon = (kg: number): string =>
  Math.abs(kg) >= 1000 ? `${fmt1(kg / 1000)} t` : `${fmt(kg)} kg`;

/** Construit l'argumentaire client. Si aucune substitution n'est sélectionnée,
 * renvoie un argumentaire « neutre » qui invite à en choisir (jamais de vide). */
export function buildCarbonArgument(input: CarbonArgumentInput): CarbonArgument {
  const { whatIf } = input;
  const applied = whatIf.selected.length;
  const n = fmt(applied);

  if (applied === 0) {
    return {
      headline: "Warum wir auf CO2-arme Baustoffe setzen",
      intro: `Für « ${input.projectName} » empfehlen wir, die Baustoffe auch nach ihrem CO2-Fußabdruck zu wählen. Wählen Sie im VE-Studio die Substitutionen aus — dieser Text füllt sich dann automatisch mit den konkreten Zahlen Ihres Projekts.`,
      bullets: [
        "CO2-arme Bauweisen werden durch GEG 2024 und EU-Taxonomie begünstigt und sind zukunftssicherer.",
        `Die CO2-Bepreisung im Gebäudesektor (nEHS) macht fossile Bauweisen ab 2027 schrittweise teurer (Richtwert ~${fmt(CO2_PRICE_EUR_PER_T)} €/t CO2).`,
        "Förderprogramme (z. B. KfW) honorieren niedrige Treibhausgas-Emissionen.",
      ],
      closing:
        "Orientierungshinweis — kein Beratungsnachweis : die Zahlen stammen aus Ökobaudat (BMWSB) und Markt-Richtwerten 2026; die Statik ist je Substitution zu prüfen.",
    };
  }

  const winWin = whatIf.totalEurDelta <= 0;
  const eurPerTonne =
    whatIf.totalCo2SavedKg > 0
      ? (whatIf.totalEurDelta / whatIf.totalCo2SavedKg) * 1000
      : 0;

  const bullets: string[] = [];

  // 1) CO2 — le chiffre central.
  const co2Txt = `Mit ${n} gewählten Materialsubstitution(en) sparen wir ${fmtCarbon(whatIf.totalCo2SavedKg)} CO2e` +
    (whatIf.co2SavedPct != null ? ` — das sind ${fmt1(whatIf.co2SavedPct)} % der Herstellungsemissionen (A1–A3).` : ".");
  bullets.push(co2Txt);

  // 2) Coût — win-win ou premium (le cœur de la négociation).
  if (winWin) {
    bullets.push(
      `Und es ist sogar günstiger : die Substitutionen sparen zusätzlich ${fmt(Math.abs(whatIf.totalEurDelta))} € — weniger CO2 UND weniger Kosten (Win-Win).`,
    );
  } else {
    const cheaperThanCo2 = eurPerTonne < CO2_PRICE_EUR_PER_T;
    bullets.push(
      `Die Mehrkosten von ${fmt(whatIf.totalEurDelta)} € entsprechen ${fmt(eurPerTonne)} €/t CO2e — ${cheaperThanCo2 ? "günstiger" : "im Bereich"} des CO2-Preises (Richtwert ~${fmt(CO2_PRICE_EUR_PER_T)} €/t, nEHS). ${cheaperThanCo2 ? "Klimaschutz, der sich rechnet." : "Eine bewusste Investition in Klimaschutz."}`,
    );
  }

  // 3) Avenir / valeur.
  bullets.push(
    "Zukunftssicherheit : CO2-arme Bauweisen bleiben werthaltig, wenn die CO2-Bepreisung im Gebäudesektor (nEHS ab 2027) und die Anforderungen der EU-Taxonomie greifen.",
  );
  bullets.push(
    "Förderung : Programme wie der KfW-Klimafreundlicher Neubau honorieren niedrige Treibhausgas-Emissionen — das senkt die Finanzierungskosten.",
  );

  const beforeAfter =
    input.perM2Before != null && whatIf.newPerM2Kg != null
      ? ` A1–A3 sinkt von ${fmt1(input.perM2Before)} auf ${fmt1(whatIf.newPerM2Kg)} kg/m² NGF.`
      : "";

  return {
    headline: winWin
      ? "Weniger CO2, weniger Kosten — die klimafreundliche Wahl"
      : "Weniger CO2 — eine Investition in die Zukunft",
    intro: `Für « ${input.projectName} » haben wir ${n} Materialsubstitution(en) geprüft, die die Herstellungsemissionen messbar senken.${beforeAfter}`,
    bullets,
    closing:
      "Orientierungshinweis — kein Beratungsnachweis : CO2 aus Ökobaudat (BMWSB, A1–A3), Kosten als Markt-Richtwert 2026; die Äquivalenzfunktion (z. B. Beton != CLT in der Statik) ist je Substitution zu prüfen.",
  };
}
