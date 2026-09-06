// Narchi — Building Physics Engine.
// Three critical German standards that every architect must comply with,
// unified in one place. No other lightweight tool covers all three.
//
// 1. Tageslichtquotient (Daylight Factor) — DIN 5034 / EN 17037
// 2. Schallschutz (Sound Insulation) — DIN 4109
// 3. Wärmebrücken (Thermal Bridges) — DIN EN ISO 14683

/* ============================================================
   1. TAGESLICHTQUOTIENT (Daylight Factor) — DIN 5034 / EN 17037
   ============================================================
   The daylight factor (T) is the ratio of interior illuminance to
   exterior horizontal illuminance under overcast sky. Required for
   residential (T ≥ 0.9%), educational (T ≥ 1.0–4.0%), offices.
   
   Simplified method per DIN 5034-6 / EN 17037:
   T = (Aw · τ · θ · M) / (A_boden · (1 - ρ_m))
   
   Where:
   - Aw = window area (m²)
   - τ = light transmittance of glazing (typically 0.65–0.78)
   - θ = geometry factor (depends on window position, height, depth)
   - M = maintenance factor (0.8–0.9)
   - A_boden = floor area (m²)
   - ρ_m = mean reflectance of room surfaces (0.3–0.6)
*/

export interface DaylightInput {
  roomName: string;
  roomDepth: number;      // m (depth from window wall)
  roomWidth: number;      // m
  roomHeight: number;     // m
  windowArea: number;     // m² (total glazing on the wall)
  windowHeight: number;   // m (height of window opening)
  sillHeight: number;     // m (from floor to window bottom)
  glassTransmission: number; // τ (0.65 standard, 0.78 triple low-e)
  surfaceReflectance: number; // ρ_m (walls+ceiling+floors average, 0.0–1.0)
  maintenanceFactor: number; // M (0.8 dirty, 0.9 clean)
  obstructionAngle: number; // degrees (0 = no obstruction, 45 = heavy)
  orientation: "nord" | "ost" | "sued" | "west" | "nordost" | "nordwest" | "suedost" | "suedwest";
}

export interface DaylightResult {
  daylightFactor: number;   // T (%)
  targetT: number;          // required minimum (DIN 5034)
  conform: boolean;
  daylightAutonomy: number; // estimated % of hours with sufficient daylight
  roomArea: number;
  awRatio: number;          // window/floor ratio
  points: { x: number; y: number; t: number }[]; // distribution grid
  severity: "critical" | "warning" | "ok";
  recommendation: string;
}

// Orientation modifier for daylight availability
const ORIENTATION_FACTOR: Record<DaylightInput["orientation"], number> = {
  sued: 1.0,
  suedost: 0.95,
  suedwest: 0.95,
  ost: 0.85,
  west: 0.85,
  nordost: 0.70,
  nordwest: 0.70,
  nord: 0.60,
};

export function calcDaylight(input: DaylightInput): DaylightResult {
  const roomArea = input.roomDepth * input.roomWidth;
  const awRatio = input.windowArea / roomArea;

  // Geometry factor θ — simplified per DIN 5034-6
  // Based on window height ratio and room depth
  const hRatio = input.windowHeight / input.roomHeight;
  const depthRatio = input.roomDepth / (input.windowHeight + input.sillHeight);
  
  // θ decreases with room depth
  let theta = Math.max(0.1, hRatio * (1 - Math.min(0.6, depthRatio * 0.15)));
  
  // Obstruction reduces daylight
  const obstructionFactor = 1 - (input.obstructionAngle / 90) * 0.5;
  theta *= obstructionFactor;
  
  // Orientation modifier
  const orientFactor = ORIENTATION_FACTOR[input.orientation] ?? 0.85;
  
  // Daylight Factor T (%)
  const T = (input.windowArea * input.glassTransmission * theta * input.maintenanceFactor * orientFactor) /
            (roomArea * (1 - input.surfaceReflectance)) * 100;

  // Target T per DIN 5034 / EN 17037 (minimum for residential: 0.9%, good: 2.0%, best: 4.0%)
  const targetT = 0.9; // minimum
  const targetGood = 2.0;
  const conform = T >= targetT;

  // Daylight Autonomy (rough estimate): fraction of year with >300 lux
  // Correlated with T: T=1% → ~30% DA, T=2% → ~50%, T=4% → ~70%
  const daylightAutonomy = Math.min(95, T * 28 + 5);

  // Distribution grid (T at points across the room depth)
  const points: { x: number; y: number; t: number }[] = [];
  for (let d = 0.5; d <= input.roomDepth; d += 0.5) {
    // T decreases exponentially with distance from window
    const tAtPoint = T * Math.exp(-d * 0.3);
    points.push({ x: d, y: 0, t: tAtPoint });
  }

  let severity: DaylightResult["severity"] = "ok";
  if (T < targetT) severity = "critical";
  else if (T < targetGood) severity = "warning";

  let recommendation = "";
  if (severity === "critical") {
    recommendation = `T = ${T.toFixed(2)}% liegt unter dem Mindestwert von 0,9% (DIN 5034). Maßnahmen: Fensterfläche vergrößern (aktuell ${input.windowArea.toFixed(1)} m²), Verglasung mit höherer Lichttransmission (τ ≥ 0,75), helle Raumoberflächen (ρ ≥ 0,6).`;
  } else if (severity === "warning") {
    recommendation = `T = ${T.toFixed(2)}% erfüllt die Mindestanforderung, liegt aber unter dem Empfehlungswert von 2,0%. Für gute Tageslichtqualität: Fensterfläche oder Raumnutzung optimieren.`;
  } else {
    recommendation = `T = ${T.toFixed(2)}% — ausgezeichnete Tageslichtversorgung. DIN 5034 / EN 17037 erfüllt.`;
  }

  return {
    daylightFactor: T,
    targetT,
    conform,
    daylightAutonomy,
    roomArea,
    awRatio,
    points,
    severity,
    recommendation,
  };
}

/* ============================================================
   2. SCHALLSCHUTZ (Sound Insulation) — DIN 4109
   ============================================================
   Calculates required and achieved airborne sound insulation
   for separating walls/floors between rooms/units.
   
   Requirements DIN 4109:
   - Between rooms within a unit: Rw ≥ 40 dB
   - Between residential units: Rw ≥ 53 dB (Schallschutzstufe 2)
   - To stairwells/corridors: Rw ≥ 52 dB
   - To commercial spaces: Rw ≥ 57 dB
*/

export interface SoundInput {
  roomType: "wohnung_zu_wohnung" | "wohnung_intern" | "treppenhaus" | "gewerbe" | "schule" | "krankenhaus";
  // Wall/floor assembly layers
  layers: { name: string; thickness: number; material: string }[];
  hasFloatingScreed: boolean;  // Estrich auf Trittschalldämmung
  hasAcousticPlasterboard: boolean; // Vorsatzschale
  doubleShell: boolean; // Doppelschaliger Aufbau (z.B. 2x KS mit Trennfuge)
}

export interface SoundResult {
  achievedRw: number;     // dB — calculated sound reduction index
  requiredRw: number;     // dB — DIN 4109 requirement
  conform: boolean;
  margin: number;         // dB above/below requirement
  severity: "critical" | "warning" | "ok";
  recommendation: string;
}

// Material Rw values (per thickness)
const MATERIAL_RW: Record<string, (thickness: number) => number> = {
  "ks": (t) => 38 + (t - 17.5) * 0.6,     // Kalksandstein
  "porenbeton": (t) => 35 + (t - 20) * 0.5, // Porenbeton (Ytong)
  "beton": (t) => 42 + (t - 20) * 0.7,    // Stahlbeton
  "ziegel": (t) => 36 + (t - 17.5) * 0.5,  // Hochlochziegel
  "gipskarton_einfach": () => 35,
  "gipskarton_doppelt": () => 42,
  "holz": (t: number) => 38 + (t - 10) * 0.3,
};

const DIN_4109_REQUIREMENTS: Record<SoundInput["roomType"], number> = {
  wohnung_zu_wohnung: 53,
  wohnung_intern: 40,
  treppenhaus: 52,
  gewerbe: 57,
  schule: 55,
  krankenhaus: 57,
};

export function calcSound(input: SoundInput): SoundResult {
  // Calculate base Rw from the primary layer (mass-based law)
  const primary = input.layers[0];
  if (!primary) {
    return { achievedRw: 0, requiredRw: 53, conform: false, margin: -53, severity: "critical", recommendation: "Keine Schicht definiert." };
  }

  const materialKey = primary.material.toLowerCase().split(" ")[0].includes("ks") ? "ks"
    : primary.material.toLowerCase().includes("porenbeton") || primary.material.toLowerCase().includes("ytong") ? "porenbeton"
    : primary.material.toLowerCase().includes("beton") ? "beton"
    : primary.material.toLowerCase().includes("ziegel") || primary.material.toLowerCase().includes("mauerwerk") ? "ziegel"
    : primary.material.toLowerCase().includes("gipskarton") && primary.material.toLowerCase().includes("doppelt") ? "gipskarton_doppelt"
    : primary.material.toLowerCase().includes("gipskarton") ? "gipskarton_einfach"
    : primary.material.toLowerCase().includes("holz") ? "holz"
    : "beton"; // default

  let rw = MATERIAL_RW[materialKey]?.(primary.thickness) ?? 38;

  // Additions
  if (input.hasFloatingScreed) rw += 4; // Trittschalldämmung helps
  if (input.hasAcousticPlasterboard) rw += 8; // Vorsatzschale with mineral wool
  if (input.doubleShell) rw += 12; // double-shell (Entkopplung)

  const requiredRw = DIN_4109_REQUIREMENTS[input.roomType];
  const conform = rw >= requiredRw;
  const margin = rw - requiredRw;

  let severity: SoundResult["severity"] = "ok";
  if (margin < 0) severity = "critical";
  else if (margin < 3) severity = "warning";

  const recommendation = severity === "critical"
    ? `Erreicht Rw = ${rw.toFixed(0)} dB, erforderlich sind ${requiredRw} dB (DIN 4109). Maßnahmen: Wandstärke erhöhen, Vorsatzschale mit Minerwolle, oder doppelschaliger Aufbau (+12 dB).`
    : severity === "warning"
    ? `Erreicht Rw = ${rw.toFixed(0)} dB mit nur ${margin.toFixed(0)} dB Reserve. Für sicheren Schallschutz: Vorsatzschale empfohlen.`
    : `Rw = ${rw.toFixed(0)} dB erfüllt DIN 4109 (${requiredRw} dB) mit ${margin.toFixed(0)} dB Reserve. Sehr gut.`;

  return { achievedRw: Math.round(rw), requiredRw, conform, margin, severity, recommendation };
}

/* ============================================================
   3. WÄRMEBRÜCKEN (Thermal Bridges) — DIN EN ISO 14683
   ============================================================
   Thermal bridge coefficient (ψ-value, psi) for linear thermal bridges.
   Reduces the overall thermal performance. Default: ψ = 0.10 W/(mK)
   if not detailed. Detailed: 0.05 W/(mK) or better.

   The Wärmebrückenzuschlag (thermal bridge surcharge) ΔUwb is added
   to the transmission heat transfer coefficient.
*/

export interface ThermalBridgeInput {
  // Construction details
  windowInstallation: "konventionell" | "wärmebrückenfrei" | "nachweis";
  wallJunction: "un gedämmt" | "gedämmt" | "kerndämmung";
  balcony: "kein" | "thermisch_getrennt" | "durchlaufend";
  cornerDetail: "innen_ecke" | "aussen_ecke" | "standard";
  perimeterLength: number; // m (total linear thermal bridge length)
  envelopeArea: number;    // m² (total heat-losing envelope area)
}

export interface ThermalBridgeResult {
  psiTotal: number;       // W/(mK) — average linear thermal bridge coefficient
  deltaUwb: number;       // W/(m²K) — thermal bridge surcharge
  heatLossKwh: number;    // estimated annual heat loss from bridges
  heatLossPct: number;    // % of total transmission loss
  severity: "critical" | "warning" | "ok";
  recommendation: string;
}

const PSI_VALUES: Record<string, number> = {
  "window_konventionell": 0.08,
  "window_wärmebrückenfrei": 0.02,
  "window_nachweis": 0.05,
  "wall_ungedämmt": 0.15,
  "wall_gedämmt": 0.05,
  "wall_kerndämmung": 0.10,
  "balcony_kein": 0.00,
  "balcony_thermisch_getrennt": 0.04,
  "balcony_durchlaufend": 0.20,
  "corner_innen_ecke": 0.10,
  "corner_aussen_ecke": -0.05,
  "corner_standard": 0.05,
};

export function calcThermalBridge(input: ThermalBridgeInput): ThermalBridgeResult {
  const windowPsi = PSI_VALUES[`window_${input.windowInstallation}`] ?? 0.08;
  const wallPsi = PSI_VALUES[`wall_${input.wallJunction.replace(/ü/g, "u").replace(/ä/g, "a")}`] ?? 0.10;
  const balconyPsi = PSI_VALUES[`balcony_${input.balcony}`] ?? 0.00;
  const cornerPsi = PSI_VALUES[`corner_${input.cornerDetail}`] ?? 0.05;

  // Weighted average psi
  const psiTotal = (windowPsi + wallPsi + balconyPsi + cornerPsi) / 4;

  // Thermal bridge surcharge ΔUwb = ψ_total × L / A_envelope
  const deltaUwb = (psiTotal * input.perimeterLength) / Math.max(input.envelopeArea, 1);

  // Estimate annual heat loss from bridges (assuming 3500 degree-hours, typical DE)
  const gradtage = 3500;
  const heatLossKwh = deltaUwb * input.envelopeArea * gradtage / 1000;

  // Percentage of total (assuming base HT ~ 0.5 W/(m²K))
  const baseHT = 0.5;
  const totalHT = baseHT + deltaUwb;
  const heatLossPct = (deltaUwb / totalHT) * 100;

  let severity: ThermalBridgeResult["severity"] = "ok";
  if (deltaUwb > 0.10) severity = "critical";
  else if (deltaUwb > 0.05) severity = "warning";

  const recommendation = severity === "critical"
    ? `Wärmebrückenzuschlag ΔUwb = ${deltaUwb.toFixed(3)} W/(m²K) ist kritisch (Grenzwert 0,05). Maßnahmen: Wärmebrückenfreie Anschlüsse, thermisch getrennte Balkone, Außendämmung durchlaufen lassen.`
    : severity === "warning"
    ? `ΔUwb = ${deltaUwb.toFixed(3)} W/(m²K) — über dem Zielwert von 0,05. Detailierung verbessern für GEG-Konformität.`
    : `ΔUwb = ${deltaUwb.toFixed(3)} W/(m²K) — exzellent. Wärmebrücken minimiert, Heizwärmebedarf optimiert.`;

  return { psiTotal, deltaUwb, heatLossKwh, heatLossPct, severity, recommendation };
}

/* ============================================================
   SUMMARY: Building Physics Score
   ============================================================ */

export interface PhysicsScore {
  daylight: "critical" | "warning" | "ok";
  sound: "critical" | "warning" | "ok";
  thermal: "critical" | "warning" | "ok";
  overall: number; // 0–100
}

export function physicsScore(
  daylight: DaylightResult,
  sound: SoundResult,
  thermal: ThermalBridgeResult
): PhysicsScore {
  const score = (s: string) => (s === "ok" ? 100 : s === "warning" ? 60 : 20);
  const overall = Math.round((score(daylight.severity) + score(sound.severity) + score(thermal.severity)) / 3);
  return {
    daylight: daylight.severity,
    sound: sound.severity,
    thermal: thermal.severity,
    overall,
  };
}
