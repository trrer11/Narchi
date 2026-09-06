import { describe, expect, it } from "vitest";
import { clashProtocolHinweis, clashProtocolLines } from "./clashProtocol";
import type { RadarAnalysisResult } from "./qcRadarAnalysis";

describe("clashProtocol §254", () => {
  it("Hinweis sagt AABB, nicht Mesh", () => {
    expect(clashProtocolHinweis()).toMatch(/Bounding-Box/);
    expect(clashProtocolHinweis()).not.toMatch(/Solibri-genau/);
  });

  it("leere Analyse → keine Zeilen", () => {
    const empty: RadarAnalysisResult = {
      clashes: [],
      realClashes: [],
      connections: [],
      connectionCount: 0,
      groups: [],
    };
    expect(clashProtocolLines(empty)).toEqual([]);
  });
});
