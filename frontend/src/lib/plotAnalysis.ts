// Narchi — Grundstücksanalyse (Plot Analysis) Engine.
// The FIRST calculation every architect does before anything else.
// Checks what's buildable on a plot per Bebauungsplan (B-Plan) and BauO.
//
// Computes: GRZ (Grundflächenzahl), GFZ (Geschossflächenzahl),
// BMZ (Baumassenzahl), Abstandsflächen, Firsthöhe, Vollgeschosse,
// max Wohnfläche (DIN 277), and feasibility score.

export interface PlotInput {
  plotArea: number;           // m² Grundstücksfläche
  grz: number;                // Grundflächenzahl (B-Plan, z.B. 0.3)
  gfz: number;                // Geschossflächenzahl (B-Plan, z.B. 0.6)
  bmz: number;                // Baumassenzahl (optional, z.B. 1.8)
  maxFloors: number;          // max Vollgeschosse (B-Plan, z.B. 2)
  maxHeight: number;          // max Firsthöhe (m, B-Plan)
  baugebiet: string;          // WA, WR, MI, GE, etc.
  plannedFootprint: number;   // geplante Grundfläche (m²)
  plannedFloors: number;      // geplante Vollgeschosse
  plannedHeight: number;      // geplante Firsthöhe (m)
  plannedFloorArea: number;   // geplante Geschossfläche gesamt (m²)
  wallLengthOver5m: number;   // m Wandlänge >5m (für Abstandsflächen)
}

export interface PlotResult {
  // GRZ
  maxBuildableArea: number;     // zulässige Grundfläche
  grzUsed: number;              // geplante GRZ-Ausnutzung
  grzConform: boolean;
  // GFZ
  maxFloorArea: number;         // zulässige Geschossfläche
  gfzUsed: number;
  gfzConform: boolean;
  // BMZ
  maxVolume: number;            // zulässiges Volumen (m³)
  plannedVolume: number;
  bmzConform: boolean;
  // Height
  heightConform: boolean;
  // Floors
  floorsConform: boolean;
  // Abstandsflächen
  requiredDistanceArea: number;  // m² Abstandsfläche
  // Wohnfläche
  estimatedWohnflaeche: number; // m² DIN 277 WoFV
  // Effizienz
  efficiencyGrade: "A" | "B" | "C" | "D";
  // Score
  feasibilityScore: number;     // 0-100
  checks: { label: string; value: string; limit: string; conform: boolean }[];
  warnings: string[];
  opportunities: string[];
}

export function analyzePlot(input: PlotInput): PlotResult {
  const checks: PlotResult["checks"] = [];
  const warnings: string[] = [];
  const opportunities: string[] = [];

  // GRZ
  const maxBuildableArea = input.plotArea * input.grz;
  const grzUsed = input.plannedFootprint / input.plotArea;
  const grzConform = input.plannedFootprint <= maxBuildableArea;
  checks.push({
    label: "GRZ — Grundfläche",
    value: `${input.plannedFootprint.toFixed(0)} m² (${grzUsed.toFixed(2)})`,
    limit: `≤ ${maxBuildableArea.toFixed(0)} m² (${input.grz})`,
    conform: grzConform,
  });
  if (!grzConform) warnings.push(`Grundfläche überschreitet GRZ: ${input.plannedFootprint.toFixed(0)} m² > ${maxBuildableArea.toFixed(0)} m² zulässig.`);

  // GFZ
  const maxFloorArea = input.plotArea * input.gfz;
  const gfzUsed = input.plannedFloorArea / input.plotArea;
  const gfzConform = input.plannedFloorArea <= maxFloorArea;
  checks.push({
    label: "GFZ — Geschossfläche",
    value: `${input.plannedFloorArea.toFixed(0)} m² (${gfzUsed.toFixed(2)})`,
    limit: `≤ ${maxFloorArea.toFixed(0)} m² (${input.gfz})`,
    conform: gfzConform,
  });
  if (!gfzConform) warnings.push(`Geschossfläche überschreitet GFZ: ${input.plannedFloorArea.toFixed(0)} m² > ${maxFloorArea.toFixed(0)} m².`);

  // BMZ
  const maxVolume = input.plotArea * input.bmz * 3.0; // rough: 3m per Geschoss
  const plannedVolume = input.plannedFloorArea * 3.0;
  const bmzConform = plannedVolume <= maxVolume;
  if (input.bmz > 0) {
    checks.push({
      label: "BMZ — Baumasse",
      value: `${plannedVolume.toFixed(0)} m³`,
      limit: `≤ ${maxVolume.toFixed(0)} m³ (${input.bmz})`,
      conform: bmzConform,
    });
  }

  // Height
  const heightConform = input.plannedHeight <= input.maxHeight;
  checks.push({
    label: "Firsthöhe",
    value: `${input.plannedHeight.toFixed(1)} m`,
    limit: `≤ ${input.maxHeight.toFixed(1)} m`,
    conform: heightConform,
  });
  if (!heightConform) warnings.push(`Firsthöhe überschritten: ${input.plannedHeight.toFixed(1)} m > ${input.maxHeight.toFixed(1)} m.`);

  // Floors
  const floorsConform = input.plannedFloors <= input.maxFloors;
  checks.push({
    label: "Vollgeschosse",
    value: `${input.plannedFloors}`,
    limit: `≤ ${input.maxFloors}`,
    conform: floorsConform,
  });
  if (!floorsConform) warnings.push(`Anzahl Vollgeschosse überschritten: ${input.plannedFloors} > ${input.maxFloors}.`);

  // Abstandsflächen (vereinfacht nach MBO/BO)
  // Wand >9m hoch: h/2 + 3m, Wand 3-9m: h/2, Wand <3m: 3m
  // For walls >5m length: typically 0.4 × height as distance
  const avgWallHeight = input.plannedHeight / input.plannedFloors;
  const requiredDistancePerMeter = avgWallHeight * 0.4; // simplified
  const requiredDistanceArea = input.wallLengthOver5m * requiredDistancePerMeter;
  checks.push({
    label: "Abstandsflächen (geschätzt)",
    value: `${requiredDistanceArea.toFixed(0)} m²`,
    limit: "Nach Landesbauordnung",
    conform: true, // can't verify without neighbor data
  });

  // Wohnfläche (DIN 277 / WoFV)
  // Rough: GFZ area × 0.85 (Netto-Brutto ratio) × 0.82 (Wohnflächen-Anteil)
  const estimatedWohnflaeche = input.plannedFloorArea * 0.85 * 0.82;

  // Efficiency grade
  const utilization = gfzUsed / input.gfz;
  let efficiencyGrade: PlotResult["efficiencyGrade"] = "D";
  if (utilization >= 0.9) efficiencyGrade = "A";
  else if (utilization >= 0.75) efficiencyGrade = "B";
  else if (utilization >= 0.6) efficiencyGrade = "C";

  // Opportunities
  const remainingFloorArea = maxFloorArea - input.plannedFloorArea;
  if (remainingFloorArea > 50) {
    opportunities.push(`${remainingFloorArea.toFixed(0)} m² Geschossfläche noch verfügbar — Ausbau oder Erweiterung möglich.`);
  }
  if (grzUsed < input.grz * 0.8) {
    opportunities.push(`GRZ nur zu ${(grzUsed / input.grz * 100).toFixed(0)}% ausgenutzt — größere Grundfläche möglich.`);
  }
  const possibleUnits = Math.floor(estimatedWohnflaeche / 75); // 75 m² pro WE
  if (possibleUnits > 0) {
    opportunities.push(`~${possibleUnits} Wohneinheiten möglich (bei 75 m²/WE).`);
  }

  // Feasibility score
  const passedChecks = checks.filter((c) => c.conform).length;
  const totalChecks = checks.length;
  const feasibilityScore = Math.round((passedChecks / totalChecks) * 100);

  return {
    maxBuildableArea, grzUsed, grzConform,
    maxFloorArea, gfzUsed, gfzConform,
    maxVolume, plannedVolume, bmzConform,
    heightConform, floorsConform,
    requiredDistanceArea, estimatedWohnflaeche,
    efficiencyGrade, feasibilityScore,
    checks, warnings, opportunities,
  };
}
