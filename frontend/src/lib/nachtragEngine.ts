// §176 — Nachtragsmanagement : le client change d'avis → l'architecte est PAYÉ.
//
// LE point de douleur n°1 des architectes (Reddit r/Architects, 2023/2025) :
// « Scope Creep is a killer » — le client dit « on pourrait utiliser ce nouveau
// grenier », l'architecte fait le travail SANS dire « ça fait X € d'honoraires
// en plus », et ce sont « les mille petites coupures de papier qui tuent la
// rentabilité ». En Allemagne, la branche appelle ça le NACHTRAG (VOB/HOAI) —
// et les outils génériques (sevDesk/Lexware) ne savent PAS le faire
// (« Nachtragsmanagement ❌ »), alors que c'est LA fonction qui rend un outil
// « indispensable » (planlogic.de, janvier 2026).
//
// Ce moteur calcule, à partir du HOAI-engine EXISTANT (calcHoai, log-linéaire,
// decimal.js) :
//   - le delta d'honoraires = calcHoai(base + Δkosten) − calcHoai(base) ;
//   - la part des Leistungsphasen touchées ;
//   - une BEGRÜNDUNG (justification) en allemand, prête à joindre au
//     Nachtragsangebot — la « Mit Begründung » que la concurrence n'a pas.
//
// HONNÊTETÉ (charta §36) : c'est un OUTIL de calcul et de formulation, pas un
// avis juridique — la VOB et la HOAI ont leurs règles (Bedenkenanzeige,
// Nachtragsprüfung) ; le texte dit explicitement « Entwurf, rechtlich zu
// prüfen ». Les chiffres viennent du moteur HOAI réel, jamais inventés.

import Decimal from "decimal.js";
import { calcHoai } from "@/lib/hoaiEngine";
import { LEISTUNGSPHASEN } from "@/data/hoai";

export type NachtragGrund =
  | "aenderungswunsch"   // client change d'avis (le scope creep classique)
  | "planungsaenderung"  // changement imposé (norme, autorité)
  | "zusatzleistung"     // prestation supplémentaire explicite
  | "stoerung"           // entrave (planning bloqué, sous-traitant défaillant)
  ;

export interface NachtragInput {
  /** Anrechenbare Kosten INITIALES (DIN 276, KG 300+400+500), €. */
  baseKosten: number;
  /** Anrechenbare Kosten SUPPLÉMENTAIRES dues au changement, €. */
  deltaKosten: number;
  honorarzone: number; // 1..5
  zusatzId: string;
  modeId: string;
  /** Leistungsphasen touchées (ex. [3, 5]). */
  leistungsphasen: readonly number[];
  /** Description du changement (« Ausbau des Dachbodens »). */
  beschreibung: string;
  grund: NachtragGrund;
}

export interface NachtragResult {
  honorarBase: number;
  honorarNeu: number;
  /** Honoraires SUPPLÉMENTAIRES netto (le montant du Nachtrag). */
  deltaHonorarNetto: number;
  deltaHonorarBrutto: number; // +19 % MwSt
  /** Δ en % du honorar de base. */
  deltaPct: number;
  /** Somme des satz des Leistungsphasen touchées (%). */
  phasenAnteilPct: number;
  /** Noms des phases touchées (dans l'ordre HOAI). */
  phasenNamen: string[];
  /** Justification client (allemand), prête à joindre. */
  begruendung: string;
  /** Intitulé du Nachtragsangebot. */
  titel: string;
}

const GRUND_LABEL: Record<NachtragGrund, string> = {
  aenderungswunsch: "Änderungswunsch des Auftraggebers",
  planungsaenderung: "Planungsänderung (z. B. Behörde / Norm)",
  zusatzleistung: "Zusätzliche Leistung",
  stoerung: "Behinderung / Störung des Planungsablaufs",
};

const MWSATZ = 0.19;

/** Arrondit en € centimes (HALF_UP, règle maison §145 — jamais de banker's). */
function eur(n: number | Decimal): number {
  return new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function buildNachtrag(input: NachtragInput): NachtragResult {
  const base = calcHoai({
    anrechenbareKosten: input.baseKosten,
    honorarzone: input.honorarzone,
    zusatzId: input.zusatzId,
    modeId: input.modeId,
  });
  const neu = calcHoai({
    anrechenbareKosten: input.baseKosten + input.deltaKosten,
    honorarzone: input.honorarzone,
    zusatzId: input.zusatzId,
    modeId: input.modeId,
  });

  const deltaNetto = eur(new Decimal(neu.total).minus(base.total));
  const deltaBrutto = eur(new Decimal(deltaNetto).times(1 + MWSATZ));
  const deltaPct =
    base.total > 0 ? new Decimal(deltaNetto).div(base.total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : 0;

  const phasen = LEISTUNGSPHASEN.filter((p) => input.leistungsphasen.includes(p.nr));
  const phasenAnteilPct = phasen.reduce((s, p) => s + p.satz * 100, 0);
  const phasenNamen = phasen.map((p) => `LP ${p.nr} ${p.name}`);

  const grundLabel = GRUND_LABEL[input.grund];
  const titel = `Nachtragsangebot — ${input.beschreibung || grundLabel}`;

  const begruendung =
    `Nachtragsangebot (Entwurf, rechtlich zu prüfen)\n\n` +
    `1. Anlass\n${grundLabel}. Beschreibung: ${input.beschreibung || "—"}.\n\n` +
    `2. Honorarauswirkung (HOAI 2021, §34 Gebäude und Innenräume)\n` +
    `Anrechenbare Kosten: ${base.input.anrechenbareKosten.toLocaleString("de-DE")} € → ` +
    `${neu.input.anrechenbareKosten.toLocaleString("de-DE")} € (zusätzlich ${input.deltaKosten.toLocaleString("de-DE")} €).\n` +
    `Betroffene Leistungsphasen: ${phasenNamen.join(", ")} (zusammen ${phasenAnteilPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % des Honorars).\n` +
    `Zusätzliches Honorar: **${deltaNetto.toLocaleString("de-DE")} € netto** (${deltaBrutto.toLocaleString("de-DE")} € brutto, 19 % MwSt) — das entspricht ${deltaPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % des bisherigen Honorars.\n\n` +
    `3. Hinweis\nDieser Nachtrag wird erst nach schriftlicher Beauftragung durch den Auftraggeber bearbeitet. Der Betrag ist ein Richtwert nach Honorartafel; die endgültige Höhe richtet sich nach den tatsächlich erbrachten Leistungen.`;

  return {
    honorarBase: base.total,
    honorarNeu: neu.total,
    deltaHonorarNetto: deltaNetto,
    deltaHonorarBrutto: deltaBrutto,
    deltaPct,
    phasenAnteilPct,
    phasenNamen,
    begruendung,
    titel,
  };
}
