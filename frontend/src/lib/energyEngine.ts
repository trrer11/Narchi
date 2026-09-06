// Narchi — energy-balance engine (Monatsbilanzverfahren, DIN V 18599 / EnEV).
// Computes Heizwärmebedarf, Endenergie and Primärenergiebedarf for a building,
// then evaluates GEG 2024 conformity. Real physics, transparent calculation.

import {
  BAUTEILE,
  DAYS,
  climateById,
  heizsystemById,
  massById,
  orientationById,
  type Bauteil,
} from "@/data/energy";

export interface EnergyInput {
  tfa: number; // thermische Gebäudefläche / NGF [m²]
  geschosse: number;
  fensteranteil: number; // window-to-wall fraction (0..1)
  climateId: string;
  bauteilWandId: string;
  bauteilDachId: string;
  bauteilFensterId: string;
  bauteilBodenId: string;
  gValue: number; // g-Wert (Sonneneintragskennzahl)
  fShading: number; // shading reduction factor
  orientationId: string;
  nAir: number; // Luftwechselrate [1/h] (incl. infiltration + Lüftung)
  massId: string;
  heizsystemId: string;
  dhwDemand: number; // Trinkwarmwasserbedarf [kWh/(m²a)]
  thetaI: number; // Raumtemperatur [°C]
}

export interface MonthRow {
  month: string;
  temp: number;
  Q_T: number; // transmission losses [kWh]
  Q_V: number; // ventilation losses [kWh]
  Q_S: number; // solar gains [kWh]
  Q_I: number; // internal gains [kWh]
  Q_h: number; // monthly heating demand [kWh]
  active: boolean;
}

export interface EnergyResult {
  input: EnergyInput & {
    bauteile: { wand: Bauteil; dach: Bauteil; fenster: Bauteil; boden: Bauteil };
  };
  areas: { aWand: number; aFenster: number; aDach: number; aBoden: number; volumen: number };
  HT: number; // transmission heat loss coeff [W/K]
  HV: number; // ventilation heat loss coeff [W/K]
  HTges: number; // incl. thermal bridges [W/K]
  monthly: MonthRow[];
  qhTotal: number; // kWh/a
  HWB: number; // Heizwärmebedarf [kWh/(m²a)]
  endenergie: number; // kWh/a
  endenergieM2: number;
  primaerenergie: number; // kWh/a
  PEB: number; // Primärenergiebedarf [kWh/(m²a)]
  co2: number; // kg/a
  co2M2: number;
  gegStatus: "kfw40" | "kfw55" | "fail";
  gegLabel: string;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Derive envelope areas from footprint & geometry (compact rectangular block). */
function deriveAreas(tfa: number, geschosse: number, fensteranteil: number) {
  if (!(tfa > 0)) {
    return { aWand: 0, aFenster: 0, aDach: 0, aBoden: 0, volumen: 0 };
  }
  const floor = tfa / Math.max(geschosse, 1);
  const side = Math.sqrt(floor);
  const perimeter = 4 * side;
  const height = geschosse * 2.9;
  const aWandBrutto = perimeter * height;
  const aFenster = aWandBrutto * clamp(fensteranteil, 0.05, 0.7);
  const aWand = Math.max(aWandBrutto - aFenster, 0);
  const aDach = floor;
  const aBoden = floor;
  const volumen = floor * height;
  return { aWand, aFenster, aDach, aBoden, volumen };
}

export function calcEnergy(input: EnergyInput): EnergyResult {
  const climate = climateById(input.climateId);
  const bauteile = {
    wand: bauteil(input.bauteilWandId, "Außenwand"),
    dach: bauteil(input.bauteilDachId, "Dach"),
    fenster: bauteil(input.bauteilFensterId, "Fenster"),
    boden: bauteil(input.bauteilBodenId, "Boden"),
  };

  const areas = deriveAreas(input.tfa, input.geschosse, input.fensteranteil);

  if (!(input.tfa > 0)) {
    const monthLabels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    return {
      input: { ...input, bauteile },
      areas,
      HT: 0,
      HV: 0,
      HTges: 0,
      monthly: monthLabels.map((month, i) => ({
        month,
        temp: climate.temp[i],
        Q_T: 0, Q_V: 0, Q_S: 0, Q_I: 0, Q_h: 0,
        active: false,
      })),
      qhTotal: 0,
      HWB: 0,
      endenergie: 0,
      endenergieM2: 0,
      primaerenergie: 0,
      PEB: 0,
      co2: 0,
      co2M2: 0,
      gegStatus: "fail",
      gegLabel: "Keine NGF/TFA — kein GEG-Status, nichts gerechnet",
    };
  }

  // Heat loss coefficients
  const HT = bauteile.wand.u * areas.aWand + bauteile.dach.u * areas.aDach + bauteile.boden.u * areas.aBoden + bauteile.fenster.u * areas.aFenster;
  const aEnv = areas.aWand + areas.aDach + areas.aBoden + areas.aFenster;
  const dUwb = 0.05; // Wärmebrückenzuschlag [W/(m²K)]
  const HTges = HT + dUwb * aEnv;
  const HV = input.nAir * areas.volumen * 0.34; // [W/K]

  // Thermal capacity & utilization parameter a
  const cEff = massById(input.massId).cEff; // Wh/(m²K)
  const C = cEff * Math.max(input.tfa, 0); // Wh/K
  const denom = HTges + HV;
  const tau = denom > 0 ? C / denom : 0; // h
  const aParam = clamp(1 + 0.1 * (tau / 24), 1, 4);

  const orient = orientationById(input.orientationId);
  const thetaI = input.thetaI;

  const monthly: MonthRow[] = [];
  let qhTotal = 0;

  for (let m = 0; m < 12; m++) {
    const te = climate.temp[m];
    const dT = thetaI - te;
    const hours = DAYS[m] * 24;
    const active = dT > 0.5;
    if (!active) {
      monthly.push({ month: "", temp: te, Q_T: 0, Q_V: 0, Q_S: 0, Q_I: 0, Q_h: 0, active: false });
      continue;
    }
    const Q_T = (HTges * dT * hours) / 1000; // kWh
    const Q_V = (HV * dT * hours) / 1000;
    const I = climate.rad[m] * orient.factor; // kWh/m² on oriented facade
    const Q_S = areas.aFenster * input.gValue * input.fShading * I;
    const qInt = 4.1; // W/m² (residential, DIN 4108-6 net)
    const Q_I = (qInt * input.tfa * hours) / 1000;
    const losses = Q_T + Q_V;
    const gains = Q_S + Q_I;
    const gamma = losses > 0 ? gains / losses : 0;
    let eta: number;
    if (gamma >= 1) eta = aParam / (aParam + 1);
    else eta = gamma <= 0 ? 0 : (1 - Math.pow(gamma, aParam)) / (1 - Math.pow(gamma, aParam + 1));
    const Q_h = Math.max(0, losses - eta * gains);
    qhTotal += Q_h;
    monthly.push({ month: "", temp: te, Q_T, Q_V, Q_S, Q_I, Q_h, active: true });
  }

  // label heating months
  const monthLabels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  monthly.forEach((r, i) => (r.month = monthLabels[i]));

  const HWB = qhTotal / input.tfa;

  // System & DHW → Endenergie & Primärenergie
  const sys = heizsystemById(input.heizsystemId);
  const Q_dhw = input.dhwDemand * input.tfa;
  const endH = qhTotal / sys.eta;
  const endDhw = Q_dhw / sys.eta;
  const endenergie = endH + endDhw;
  const endenergieM2 = endenergie / input.tfa;
  const primaerenergie = endH * sys.fPE + endDhw * sys.fPE;
  const PEB = primaerenergie / input.tfa;

  const co2 = ((qhTotal / sys.eta) * sys.co2 + (Q_dhw / sys.eta) * sys.co2) / 1000; // kg/a
  const co2M2 = co2 / input.tfa;

  let gegStatus: EnergyResult["gegStatus"] = "fail";
  let gegLabel = "Nicht GEG-konform";
  if (PEB <= 40) { gegStatus = "kfw40"; gegLabel = "KfW 40 · Beststandard"; }
  else if (PEB <= 55) { gegStatus = "kfw55"; gegLabel = "GEG-konform (Effizienzhaus 55)"; }

  return {
    input: { ...input, bauteile },
    areas,
    HT,
    HV,
    HTges,
    monthly,
    qhTotal,
    HWB,
    endenergie,
    endenergieM2,
    primaerenergie,
    PEB,
    co2,
    co2M2,
    gegStatus,
    gegLabel,
  };
}

function bauteil(id: string, group: Bauteil["group"]): Bauteil {
  return BAUTEILE.find((b) => b.id === id && b.group === group) ?? BAUTEILE.find((b) => b.group === group)!;
}
