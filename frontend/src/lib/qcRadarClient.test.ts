import { describe, expect, it } from "vitest";
import { createRadarRunner, RadarCancelled } from "@/lib/qcRadarClient";
import { runRadarAnalysis } from "@/lib/qcRadarAnalysis";
import { ClashDetector } from "@/lib/planpruefung";
import { classOfElements, groupClashes, splitConnections, withGroupLevels, DEFAULT_CONNECTION_FILTER } from "@/lib/clashGroups";
import type { BuildingElement } from "@/data/types";

let seq = 0;
function el(type: string, bbox: [number, number, number, number, number, number] | null = null, level = "EG"): BuildingElement {
  seq += 1;
  const id = `e${seq}`;
  return {
    id, guid: `g-${id}`, code: "330", classificationLabel: "T", name: id, type,
    materialId: "m", level, projectId: "p", status: "modeled", qty: 1, unit: "m³",
    weightKg: 100, cost: 1, carbonKg: 1,
    properties: bbox ? [{ key: "bbox", value: JSON.stringify(bbox) }] : [],
    lastUpdated: "2026-08-06T00:00:00.000Z", conflicts: 0,
  };
}

/// Modèle réel : mur×dalle (Anschluss ≤ 30 cm) + tuyau×dalle (vraie
/// collision major) + colonne TRAVERSANTE 0,4 m (critical > seuil 30 cm).
const MODEL = [
  el("IFCWALL", [0, 0, 0, 3, 0.2, 3]),
  el("IFCSLAB", [2, -0.5, 2.8, 6, 4, 3.0]),
  el("IFCFLOWSEGMENT", [3.1, 1, 2.7, 4.1, 1.4, 3.2], "1. UG"),
  el("IFCCOLUMN", [30, 0, 0, 30.4, 0.4, 3]),
  el("IFCSLAB", [29, -1, 2.4, 31, 1, 2.9]),
];

describe("qcRadarAnalysis — pipeline partagée (même chiffres main & worker)", () => {
  it("résultat EXACT = moteurs bruts (radar + whitelist + groupes)", () => {
    const byId = new Map(MODEL.map((e) => [e.id, e]));
    const classOf = classOfElements((id) => byId.get(id));
    const rawClashes = ClashDetector.detectClashes(MODEL);
    const { real } = splitConnections(rawClashes, classOf, DEFAULT_CONNECTION_FILTER);
    const groupsRef = withGroupLevels(groupClashes(real, classOf), (id) => byId.get(id));

    const r = runRadarAnalysis(MODEL);
    expect(r.clashes).toEqual(rawClashes);
    expect(r.realClashes).toEqual(real);
    expect(r.connectionCount).toBe(1); // mur×dalle = Anschluss ≤ 30 cm
    expect(r.groups).toEqual(groupsRef);
    // Vraies collisions : tuyau×dalle (major) + colonne×dalle 0,4 m (critical).
    expect(r.realClashes).toHaveLength(2);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].severity).toBe("critical");
  });

  it("progression : fraction ≤ 1, phases déclarées, au moins un appel", () => {
    const events: { phase: string; fraction: number }[] = [];
    runRadarAnalysis(MODEL, (p) => events.push(p));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.fraction >= 0 && e.fraction <= 1)).toBe(true);
    expect(events.some((e) => e.phase === "groups")).toBe(true);
    expect(events[events.length - 1]).toEqual({ phase: "groups", fraction: 1 });
  });

  it("éléments sans bbox → 0 clash, zéro exception", () => {
    const r = runRadarAnalysis([el("IFCWALL", null), el("IFCSLAB", null)]);
    expect(r.clashes).toEqual([]);
    expect(r.connectionCount).toBe(0);
  });
});

describe("createRadarRunner — un seul job à la fois (jamais d'obsolète)", () => {
  it("annulation de l'ancien job quand un nouveau démarre", async () => {
    const runner = createRadarRunner();
    const slowElements = [...MODEL];
    // Grande boucle pour laisser le temps à l'annulation… mais la promesse
    // doit TOUJOURS se rejeter avec RadarCancelled même si rapide.
    const first = runner.run(slowElements);
    const second = runner.run(slowElements);
    await expect(first.promise).rejects.toThrow(RadarCancelled);
    const result = await second.promise;
    expect(result.clashes.length).toBeGreaterThan(0);
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it("relance après succès → le successeur est tenu informé", async () => {
    const runner = createRadarRunner();
    const r1 = await runner.run(MODEL).promise;
    expect(r1.connectionCount).toBe(1);
    const model2 = [...MODEL, el("IFCCOLUMN", [50, 50, 0, 50.4, 50.4, 3]), el("IFCSLAB", [49, 49, 2.4, 51, 51, 2.9])];
    const r2 = await runner.run(model2).promise;
    expect(r2.realClashes.length).toBe(r1.realClashes.length + 1);
  });

  it("résultat du runner (voie sync microtask) IDENTIQUE à la pipeline directe", async () => {
    const runner = createRadarRunner();
    const r = await runner.run(MODEL).promise;
    const direct = runRadarAnalysis(MODEL);
    expect(r).toEqual(direct);
  });

  it("cancel manuel → rejet RadarCancelled (propre et silencieux)", async () => {
    const runner = createRadarRunner();
    const run = runner.run(MODEL);
    run.cancel();
    await expect(run.promise).rejects.toThrow(RadarCancelled);
    // Le runner reste sain : un nouveau job réussit derrière.
    const ok = await runner.run(MODEL).promise;
    expect(ok.groups.length).toBeGreaterThan(0);
  });
});
