import { describe, expect, it } from "vitest";
import {
  canonicalClass,
  classifyConnection,
  classOfElements,
  DEFAULT_CONNECTION_FILTER,
  groupClashes,
  splitConnections,
  withGroupLevels,
} from "@/lib/clashGroups";
import type { Clash } from "@/lib/planpruefung";
import type { BuildingElement } from "@/data/types";

// ---------------------------------------------------------------------------
// Fabriques synthétiques (zéro dépendance au navigateur — pur moteur)
// ---------------------------------------------------------------------------

function element(id: string, type: string, level = "EG"): BuildingElement {
  return {
    id,
    guid: `g-${id}`,
    code: "320",
    classificationLabel: "Test",
    name: id,
    type,
    materialId: "m",
    level,
    projectId: "p",
    status: "modeled",
    qty: 1,
    unit: "m",
    weightKg: 1,
    cost: 1,
    carbonKg: 1,
    properties: [],
    lastUpdated: "2026-08-06T00:00:00.000Z",
    conflicts: 0,
  };
}

function clash(
  id: string,
  elA: string,
  elB: string,
  severity: Clash["severity"],
  hotspot: [number, number, number],
  overlap: [number, number, number] = [0.2, 0.2, 0.2],
): Clash {
  return {
    id,
    elementA: elA,
    elementB: elB,
    expressIdA: null,
    expressIdB: null,
    center: hotspot,
    size: [1, 1, 1],
    nameA: `A-${id}`,
    nameB: `B-${id}`,
    overlap,
    hotspot: { center: hotspot, size: overlap },
    severity,
    type: "hard",
    description: `${elA} ⇄ ${elB}`,
  };
}

const els = (...defs: [string, string, string?][]) => defs.map(([id, type, level]) => element(id, type, level));
const mapOf = (list: BuildingElement[]) => new Map(list.map((e) => [e.id, e]));
const classOf = (m: Map<string, BuildingElement>) => classOfElements((id) => m.get(id));

// ---------------------------------------------------------------------------

describe("canonicalClass — classes IFC → classes de constat", () => {
  it("mapping fonde (casse tolérée, cas spéciaux avant généraux)", () => {
    expect(canonicalClass("IFCWALL")).toBe("WAND");
    expect(canonicalClass("IfcCurtainWall")).toBe("WAND");
    expect(canonicalClass("IFCWINDOW")).toBe("FENSTER");
    expect(canonicalClass("IFCWINDOWSTANDARDCASE")).toBe("FENSTER");
    expect(canonicalClass("IFCDOOR")).toBe("TUER");
    expect(canonicalClass("IFCFOOTING")).toBe("DECKE");
    expect(canonicalClass("IFCBEAM")).toBe("TRAEGER");
    expect(canonicalClass("IFCSTAIRFLIGHT")).toBe("TREPPE");
    expect(canonicalClass("IFCFLOWSEGMENT")).toBe("ROHRLEITUNG");
    expect(canonicalClass("IFCAIRTERMINAL")).toBe("LUFTKANAL");
    expect(canonicalClass("IfcBuildingElementProxy")).toBe("SONSTIGES");
    expect(canonicalClass(undefined)).toBe("SONSTIGES");
  });
});

describe("classifyConnection — whitelist « Anschluss » (jamais silencieuse)", () => {
  it("fenêtre dans son mur → Öffnung (recouvrement intentionnel)", () => {
    const c = clash("c1", "w1", "wall1", "minor", [0, 0, 1]);
    const v = classifyConnection(c, "FENSTER", "WAND");
    expect(v.isConnection).toBe(true);
    expect(v.kind).toBe("oeffnung");
    expect(v.reason).toContain("Öffnung");
  });

  it("Stütze × Decke à 25 cm → flacher Anschluss à part", () => {
    const c = clash("c2", "s1", "d1", "critical", [0, 0, 3], [0.25, 0.4, 0.4]);
    const v = classifyConnection(c, "STUETZE", "DECKE");
    expect(v.isConnection).toBe(true);
    expect(v.kind).toBe("anschluss");
    expect(v.reason).toContain("250 mm");
  });

  it("Stütze × Decke traversante (60 cm) → VRAIE collision (honk!) ", () => {
    const c = clash("c3", "s1", "d1", "critical", [0, 0, 3], [0.6, 0.7, 0.65]);
    expect(classifyConnection(c, "STUETZE", "DECKE").isConnection).toBe(false);
  });

  it("Rohrleitung × Decke à 10 cm → VRAIE collision (paire non structurale)", () => {
    const c = clash("c4", "p1", "d1", "major", [0, 0, 3], [0.1, 0.1, 0.3]);
    expect(classifyConnection(c, "ROHRLEITUNG", "DECKE").isConnection).toBe(false);
  });

  it("filtre désactivé → tout reste collision (ré-affichable en un clic)", () => {
    const c = clash("c5", "w1", "wall1", "minor", [0, 0, 1]);
    const v = classifyConnection(c, "FENSTER", "WAND", { ...DEFAULT_CONNECTION_FILTER, enabled: false });
    expect(v.isConnection).toBe(false);
  });

  it("splitConnections sépare et COMPTE les connexions", () => {
    const m = mapOf(els(["w1", "IFCWINDOW"], ["wa", "IFCWALL"], ["s1", "IFCCOLUMN"], ["d1", "IFCSLAB"]));
    const cs = [
      clash("c1", "w1", "wa", "minor", [0, 0, 1]),
      clash("c2", "s1", "d1", "critical", [1, 1, 3], [1, 1, 1]),
    ];
    const { real, connections } = splitConnections(cs, classOf(m));
    expect(real.map((c) => c.id)).toEqual(["c2"]);
    expect(connections).toHaveLength(1);
    expect(connections[0].clash.id).toBe("c1");
    expect(connections[0].verdict.reason).toBeTruthy();
  });
});

describe("groupClashes — Befundgruppen (signature × foyer spatial)", () => {
  it("deux foyers de MÊME signature éloignés → 2 constats distincts", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"]));
    const cs = [
      clash("c1", "a1", "b1", "major", [0, 0, 3]),
      clash("c2", "a1", "b1", "major", [1, 0, 3.5]),
      clash("c3", "a1", "b1", "major", [50, 0, 3]),
    ];
    const groups = groupClashes(cs, classOf(m));
    expect(groups).toHaveLength(2);
    // Signature triée alphabétiquement : DECKE avant WAND.
    expect(groups.every((g) => g.title === "Decke/Gründung × Wand")).toBe(true);
    const counts = groups.map((g) => g.count).sort((x, y) => x - y);
    expect(counts).toEqual([1, 2]);
  });

  it("chaînage transitif le long d'un mur (A-B liés, B-C liés → 1 constat)", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"]));
    const cs = [
      clash("c1", "a1", "b1", "major", [0, 0, 3]),
      clash("c2", "a1", "b1", "major", [3.5, 0, 3]),
      clash("c3", "a1", "b1", "major", [7, 0, 3]),
    ];
    const groups = groupClashes(cs, classOf(m));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    // Barycentre du foyer au milieu
    expect(groups[0].centroid[0]).toBeCloseTo(3.5);
  });

  it("même lieu mais signatures différentes → JAMAIS fusionnés", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"], ["k1", "IFCFLOWSEGMENT"]));
    const cs = [
      clash("c1", "a1", "b1", "major", [0, 0, 3]),
      clash("c2", "k1", "b1", "major", [0.5, 0, 3]),
    ];
    const groups = groupClashes(cs, classOf(m));
    expect(groups).toHaveLength(2);
  });

  it("tri bureau : sévérité d'abord (critical), puis taille, ids BG-xx stables", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"], ["s1", "IFCCOLUMN"]));
    const cs = [
      clash("c1", "a1", "b1", "major", [0, 0, 3]),
      clash("c2", "a1", "b1", "major", [10, 0, 3]),
      clash("c3", "a1", "b1", "major", [20, 0, 3]),
      clash("c4", "s1", "b1", "critical", [40, 0, 3], [1, 1, 1]),
    ];
    const groups = groupClashes(cs, classOf(m));
    // 3 groupes Wand×Decke (éloignés) + 1 groupe Stütze×Decke (critical).
    expect(groups).toHaveLength(4);
    expect(groups[0].id).toBe("BG-01");
    expect(groups[0].severity).toBe("critical");
    expect(groups[0].classes).toEqual(["DECKE", "STUETZE"]);
    // Ensuite les 3 groupes major, tailles égales → ordre alphabétique titre.
    expect(groups[1].severity).toBe("major");
    expect(groups.filter((g) => g.severity === "major")).toHaveLength(3);
  });

  it("représentant = pire sévérité puis plus GROSSE intersection", () => {
    const m = mapOf(els(["s1", "IFCCOLUMN"], ["b1", "IFCSLAB"]));
    const small = clash("c1", "s1", "b1", "critical", [0, 0, 3], [0.1, 0.1, 0.1]);
    const big = clash("c2", "s1", "b1", "critical", [2, 0, 3], [2, 2, 2]);
    const minor = clash("c3", "s1", "b1", "minor", [1, 0, 3], [50, 50, 50]);
    const [group] = groupClashes([small, big, minor], classOf(m));
    // critical l'emporte sur le volume du minor (50³) : le pire pilote.
    expect(group.representative.id).toBe("c2");
    expect(group.severity).toBe("critical");
    expect(group.count).toBe(3);
  });

  it("pénétration typique = médiane par axe (robuste aux valeurs folles)", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"]));
    const cs = [
      clash("c1", "a1", "b1", "major", [0, 0, 3], [0.1, 0.2, 0.3]),
      clash("c2", "a1", "b1", "major", [1, 0, 3], [0.2, 0.2, 0.4]),
      clash("c3", "a1", "b1", "major", [2, 0, 3], [0.3, 0.2, 3.0]),
    ];
    const [group] = groupClashes(cs, classOf(m));
    expect(group.typicalOverlap[0]).toBeCloseTo(0.2);
    expect(group.typicalOverlap[2]).toBeCloseTo(0.4); // médiane, pas moyenne
  });

  it("liste vide → aucun groupe, zéro exception", () => {
    expect(groupClashes([], classOf(mapOf([])))).toEqual([]);
  });

  it("performance : 20 000 collisions groupées bien sous la seconde de grogne", () => {
    const m = mapOf(els(["a1", "IFCWALL"], ["b1", "IFCSLAB"]));
    const cs: Clash[] = [];
    for (let i = 0; i < 20000; i++) {
      cs.push(clash(`c${i}`, "a1", "b1", "major", [(i % 200) * 1.5, Math.floor(i / 200) * 1.5, (i % 3) * 3]));
    }
    const start = Date.now();
    const groups = groupClashes(cs, classOf(m));
    const elapsed = Date.now() - start;
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(20000);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("withGroupLevels — étages triés règle bureau (cave → Dach)", () => {
  it("concatène et trie les niveaux des deux Bauteiles", () => {
    const m = mapOf(
      els(["a1", "IFCWALL", "1. OG"], ["b1", "IFCSLAB", "EG"], ["c1", "IFCWALL", "1. UG"], ["d1", "IFCSLAB", "Dach"]),
    );
    // Trois hotspots dans le même foyer de 4 m → UN seul constat.
    const cs = [clash("x1", "a1", "b1", "major", [0, 0, 3]), clash("x2", "a1", "d1", "major", [1, 0, 3.4]), clash("x3", "c1", "b1", "major", [0.6, 0, 1.2])];
    const groups = withGroupLevels(groupClashes(cs, classOf(m)), (id) => m.get(id));
    expect(groups).toHaveLength(1);
    expect(groups[0].levels).toEqual(["1. UG", "EG", "1. OG", "Dach"]);
  });

  it("« — » et vides ignorés (zéro pollution de badge)", () => {
    const m = mapOf(els(["a1", "IFCWALL", "—"], ["b1", "IFCSLAB", ""]));
    const [group] = withGroupLevels(groupClashes([clash("x1", "a1", "b1", "major", [0, 0, 3])], classOf(m)), (id) => m.get(id));
    expect(group.levels).toEqual([]);
  });
});
