/** §254 Clash-Protokoll — Befunde aus dem AABB-Radar. Kein Mesh/Solibri. */
import type { RadarAnalysisResult } from "@/lib/qcRadarAnalysis";

export interface ClashProtocolLine {
  id: string;
  title: string;
  a: string;
  b: string;
  severity: string;
  pairs: number;
  overlapMm: string;
  levels: string;
}

export function clashProtocolLines(analysis: RadarAnalysisResult): ClashProtocolLine[] {
  return analysis.groups.map((g) => ({
    id: g.id,
    title: g.title,
    a: g.representative.nameA,
    b: g.representative.nameB,
    severity: g.severity,
    pairs: g.count,
    overlapMm: g.typicalOverlap.map((m) => String(Math.round(m * 1000))).join(" × "),
    levels: g.levels.join(", ") || "—",
  }));
}

export function clashProtocolHinweis(): string {
  return "Verfahren: IFC-Bounding-Box, Anschlüsse/Öffnungen gefiltert. Keine Dreiecks-Kollision (kein Solibri/Manifold).";
}
