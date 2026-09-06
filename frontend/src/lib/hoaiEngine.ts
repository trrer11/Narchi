// Narchi — HOAI honorar engine. Log-linear interpolation of the Honorartafel
// across Honorarzonen and anrechenbare Kosten, plus Leistungsphasen split.
// Mathematically robust and immune to JavaScript double-precision binary float instabilities.

import Decimal from "decimal.js";
import { HOAI_TAFEL, LEISTUNGSPHASEN, HONORARZUSAETZE, HONORAR_MODEN, type HonorarRow } from "@/data/hoai";

export interface HoaiInput {
  anrechenbareKosten: number; // € (KG 300+400+500 DIN 276)
  honorarzone: number; // 1..5
  zusatzId: string;
  modeId: string; // reference | freelow | premium
}

export interface PhaseResult {
  nr: number;
  name: string;
  desc: string;
  satz: number;
  betrag: number;
}

export interface HoaiResult {
  input: HoaiInput;
  /** false = anrechenbar ≤ 0 — kein Tafelwert, alle Beträge 0 */
  orientierungGueltig: boolean;
  basisHonorar: number; // honorar at zone III (mittlere)
  zonenHonorar: number[]; // [HZ1..HZ5]
  honorar: number; // selected zone, before zusatz
  zusatz: number;
  modeFactor: number;
  modeLabel: string;
  total: number; // final honorar incl. zusatz + mode
  mwst: number;
  brutto: number;
  phases: PhaseResult[];
}

/* Log-linear interpolation within & between tafel brackets using decimal.js. */
function interpRow(kostenVal: number | Decimal, zoneIdx: number): Decimal {
  const rows = HOAI_TAFEL;
  const kosten = new Decimal(kostenVal);
  
  // Garde dure : s'assurer que kosten est strictement positif pour éviter log(0) ou log de valeurs négatives
  const k = kosten.isPositive() && !kosten.isZero() ? kosten : new Decimal(1);
  
  const firstKosten = new Decimal(rows[0].kosten);
  const lastKosten = new Decimal(rows[rows.length - 1].kosten);

  if (k.lessThanOrEqualTo(firstKosten)) {
    return new Decimal(rows[0].zonen[zoneIdx]);
  }
  
  if (k.greaterThanOrEqualTo(lastKosten)) {
    // Extrapoler avec la pente du dernier segment en espace logarithmique
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    
    const lastZonen = new Decimal(last.zonen[zoneIdx]);
    const prevZonen = new Decimal(prev.zonen[zoneIdx]);
    const lastK = new Decimal(last.kosten);
    const prevK = new Decimal(prev.kosten);

    // slope = (ln(lastZonen) - ln(prevZonen)) / (ln(lastK) - ln(prevK))
    const numerator = lastZonen.ln().minus(prevZonen.ln());
    const denominator = lastK.ln().minus(prevK.ln());
    
    // Garde d'exclusion contre la division par zéro
    const slope = denominator.isZero() ? new Decimal(0) : numerator.dividedBy(denominator);
    
    // lastZonen * exp(slope * (ln(k) - ln(lastK)))
    const logDiff = k.ln().minus(lastK.ln());
    const exponent = slope.times(logDiff);
    return lastZonen.times(exponent.exp());
  }

  let lo: HonorarRow = rows[0];
  let hi: HonorarRow = rows[1];
  for (let i = 0; i < rows.length - 1; i++) {
    const currentK = new Decimal(rows[i].kosten);
    const nextK = new Decimal(rows[i + 1].kosten);
    if (k.greaterThan(currentK) && k.lessThanOrEqualTo(nextK)) {
      lo = rows[i];
      hi = rows[i + 1];
      break;
    }
  }

  const loK = new Decimal(lo.kosten);
  const hiK = new Decimal(hi.kosten);
  const loZonen = new Decimal(lo.zonen[zoneIdx]);
  const hiZonen = new Decimal(hi.zonen[zoneIdx]);

  // t = (ln(k) - ln(loK)) / (ln(hiK) - ln(loK))
  const tNumerator = k.ln().minus(loK.ln());
  const tDenominator = hiK.ln().minus(loK.ln());
  const t = tDenominator.isZero() ? new Decimal(0) : tNumerator.dividedBy(tDenominator);

  // exp(ln(loZonen) + (ln(hiZonen) - ln(loZonen)) * t)
  const loV = loZonen.ln();
  const hiV = hiZonen.ln();
  const val = loV.plus(hiV.minus(loV).times(t));
  return val.exp();
}

export function calcHoai(input: HoaiInput): HoaiResult {
  const kInput = new Decimal(input.anrechenbareKosten);
  const zoneIdx = Math.max(0, Math.min(4, input.honorarzone - 1));
  const zusatz = HONORARZUSAETZE.find((z) => z.id === input.zusatzId) ?? HONORARZUSAETZE[0];
  const mode = HONORAR_MODEN.find((m) => m.id === input.modeId) ?? HONORAR_MODEN[0];
  const stamped: HoaiInput = {
    anrechenbareKosten: kInput.toNumber(),
    honorarzone: input.honorarzone,
    zusatzId: input.zusatzId,
    modeId: input.modeId,
  };

  if (!kInput.isPositive() || kInput.isZero()) {
    return {
      input: stamped,
      orientierungGueltig: false,
      basisHonorar: 0,
      zonenHonorar: [0, 0, 0, 0, 0],
      honorar: 0,
      zusatz: 0,
      modeFactor: mode.factor,
      modeLabel: mode.name,
      total: 0,
      mwst: 0,
      brutto: 0,
      phases: LEISTUNGSPHASEN.map((lp) => ({
        nr: lp.nr, name: lp.name, desc: lp.desc, satz: lp.satz, betrag: 0,
      })),
    };
  }

  const k = kInput;
  const zonenHonorarDec = [0, 1, 2, 3, 4].map((i) => interpRow(k, i));
  const basisHonorarDec = zonenHonorarDec[2];
  const honorarDec = zonenHonorarDec[zoneIdx];
  const zusatzFactor = new Decimal(zusatz.factor);
  const modeFactorDec = new Decimal(mode.factor);
  const zusatzBetragDec = honorarDec.times(zusatzFactor.minus(1));
  const totalDec = honorarDec.plus(zusatzBetragDec).times(modeFactorDec);
  const mwstDec = totalDec.times(0.19);
  const bruttoDec = totalDec.plus(mwstDec);

  return {
    input: stamped,
    orientierungGueltig: true,
    basisHonorar: basisHonorarDec.toNumber(),
    zonenHonorar: zonenHonorarDec.map((d) => d.toNumber()),
    honorar: honorarDec.toNumber(),
    zusatz: zusatzBetragDec.toNumber(),
    modeFactor: modeFactorDec.toNumber(),
    modeLabel: mode.name,
    total: totalDec.toNumber(),
    mwst: mwstDec.toNumber(),
    brutto: bruttoDec.toNumber(),
    phases: LEISTUNGSPHASEN.map((lp) => ({
      nr: lp.nr,
      name: lp.name,
      desc: lp.desc,
      satz: lp.satz,
      betrag: totalDec.times(new Decimal(lp.satz)).toNumber(),
    })),
  };
}

export function fmtEUR(n: number | Decimal): string {
  const val = n instanceof Decimal ? n.toNumber() : n;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(val);
}
export function fmtEUR2(n: number | Decimal): string {
  const val = n instanceof Decimal ? n.toNumber() : n;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}
export function fmtNum(n: number | Decimal, d = 0): string {
  const val = n instanceof Decimal ? n.toNumber() : n;
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d }).format(val);
}
