import { describe, expect, it } from "vitest";
import { befundTopics, clashesTopics, generateBcf } from "@/lib/bcfExport";
import { lookAtFromViewpoint, matchTopics, parseBcf21Zip, parseBcfXml, summarizeImport } from "@/lib/bcfImport";
import { buildBcf21Zip } from "@/lib/bcf21Zip";
import { classOfElements, groupClashes, withGroupLevels } from "@/lib/clashGroups";
import type { BuildingElement } from "@/data/types";
import type { Clash } from "@/lib/planpruefung";

function element(id: string, type: string, level = "EG", expressId: number | null = null): BuildingElement {
  return {
    id, guid: `g-${id}`, code: "320", classificationLabel: "T", name: id, type,
    materialId: "m", level, projectId: "p", status: "modeled", qty: 1, unit: "m",
    weightKg: 1, cost: 1, carbonKg: 1,
    properties: expressId !== null ? [{ key: "Express ID", value: String(expressId) }] : [],
    lastUpdated: "2026-08-06T00:00:00.000Z", conflicts: 0,
  };
}

function clash(id: string, elA: string, elB: string, severity: Clash["severity"], at: [number, number, number], exA: number | null = null, exB: number | null = null): Clash {
  return {
    id, elementA: elA, elementB: elB, expressIdA: exA, expressIdB: exB,
    center: at, size: [1, 1, 1], nameA: `A-${id}`, nameB: `B-${id}`, overlap: [0.2, 0.2, 0.2],
    hotspot: { center: at, size: [0.2, 0.2, 0.2] }, severity, type: "hard", description: `${elA} ⇄ ${elB}`,
  };
}

const model = () => [
  element("el-101", "IFCCOLUMN", "EG", 101),
  element("el-202", "IFCSLAB", "EG", 202),
  element("w1", "IFCWALL", "1. OG"),
];

const groups = () => {
  const m = new Map(model().map((e) => [e.id, e]));
  const classOf = classOfElements((id) => m.get(id));
  const cs = [
    clash("c1", "el-101", "el-202", "critical", [0, 0, 3], 101, 202),
    clash("c2", "el-101", "el-202", "critical", [2, 0, 3]),
    clash("c3", "w1", "el-202", "major", [40, 0, 3]),
  ];
  return withGroupLevels(groupClashes(cs, classOf), (id) => m.get(id));
};

describe("§44 parseBcfXml — relecture du Markup BCF 3.0", () => {
  it("ROUND-TRIP complet : export §39 → ré-import livre les mêmes constats", () => {
    const xml = generateBcf(befundTopics(groups()));
    const topics = parseBcfXml(xml);
    expect(topics).toHaveLength(2);
    const first = topics[0];
    expect(first.befundId).toBe("BG-01");
    expect(first.title).toContain("2 Stellen");
    expect(first.status).toBe("Open");
    expect(first.closed).toBe(false);
    expect(first.author).toBe("BIM-IQ Befundgruppen");
    // Les preuves du commentaire auditable sont relues à l'identique :
    expect(first.expressIds).toEqual([101, 202]);
    expect(first.hotspot).toEqual([0, 0, 3]);
  });

  it("échappement XML bidirectionnel : <, &, > dans un titre reviennent propres", () => {
    const xml = generateBcf([
      { id: "t-1", sheetId: "s", x: 0, y: 0, title: "Wand <Stütze> & Decke", note: "1 < 2 & 3 > 2", status: "open", author: "A", createdAt: "2026-08-06T00:00:00.000Z" },
    ]);
    const [t] = parseBcfXml(xml);
    expect(t.title).toBe("Wand <Stütze> & Decke");
    expect(t.comments[0]).toContain("1 < 2 & 3 > 2");
  });

  it("statut Closed détecté, comma-decimal hotspot toléré, doubles # dédupliqués", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Markup><Topic><Guid>g1</Guid><Title>Ticket fermé</Title><TopicStatus>Closed</TopicStatus></Topic>
<Comment><Guid>c1</Guid><Comment>Zone [1,5, 2, 3,25] m. Express IDs: #7 / #7 / #9.</Comment></Comment></Markup>`;
    const [t] = parseBcfXml(xml);
    expect(t.closed).toBe(true);
    expect(t.hotspot).toEqual([1.5, 2, 3.25]);
    expect(t.expressIds).toEqual([7, 9]);
  });

  it("XML mal formé → erreur claire et HONNÊTE (pas de regex à trous)", () => {
    expect(() => parseBcfXml("<BCF><Markup><Topic><Title>kaputt")).toThrowError(/kein gültiges XML/);
  });

  it("fichier sans aucun topic → erreur honnête", () => {
    expect(() => parseBcfXml("<BCF version=\"3.0\"></BCF>")).toThrowError(/Kein BCF-Topic/);
  });
});

describe("§44 matchTopics — recroisement avec la maquette chargée", () => {
  it("chaque constat retrouve ses deux fautifs réels par Express ID", () => {
    const matched = matchTopics(parseBcfXml(generateBcf(befundTopics(groups()))), model(), groups());
    expect(matched[0].elements.map((e) => e.id)).toEqual(["el-101", "el-202"]);
    expect(matched[0].group?.id).toBe("BG-01");
    // BG-02 (Wand × Decke, pas d'Express IDs dans ce topic) → matched via la
    // paire #null ? Non : matched via rien → 0 élément, honnête.
    expect(matched[1].befundId).toBe("BG-02");
    expect(matched[1].group?.count).toBe(1);
  });

  it("maquette ÉTRANGÈRE : aucun collage au hasard — unmatched compté", () => {
    const matched = matchTopics(parseBcfXml(generateBcf(befundTopics(groups()))), [], groups());
    const summary = summarizeImport(matched);
    expect(summary.matched).toBe(0);
    expect(summary.unmatched).toBe(2);
    expect(summary.closed).toBe(0);
  });

  it("export brut §44 (clashesTopics) : mêmes Express IDs relus", () => {
    const xml = generateBcf(clashesTopics(groups()[0].clashes));
    const topics = parseBcfXml(xml);
    expect(topics[0].expressIds).toEqual([101, 202]);
    expect(topics[0].befundId).toBeNull(); // pas de BG-xx dans le brut
  });
});

describe("§259 parseBcf21Zip — ZIP buildingSMART, pas XML déguisé", () => {
  it("round-trip export ZIP → import: Express-ID + BG-id", async () => {
    const bytes = await buildBcf21Zip(groups(), model(), {
      created: "2026-08-25T12:00:00.000Z",
      maxTopics: 10,
    });
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const topics = await parseBcf21Zip(bytes);
    expect(topics.length).toBeGreaterThanOrEqual(1);
    expect(topics[0].title).toMatch(/BG-01/);
    expect(topics[0].befundId).toBe("BG-01");
    expect(topics[0].expressIds).toEqual([101, 202]);
    expect(topics[0].hotspot).toEqual([0, 0, 3]);
    expect(topics[0].guid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("IfcGuid 22 Zeichen matcht das Modell, Express-ID-Fake nicht", async () => {
    const els = model();
    els[0] = { ...els[0], guid: "0u4M6q6iv4lxtm2l99j4X_" };
    const bytes = await buildBcf21Zip(groups(), els, { created: "2026-08-25T12:00:00.000Z" });
    const topics = await parseBcf21Zip(bytes);
    expect(topics[0].ifcGuids).toContain("0u4M6q6iv4lxtm2l99j4X_");
    const matched = matchTopics(topics, els, groups());
    expect(matched[0].elements.some((e) => e.id === "el-101")).toBe(true);
  });

  it("kein ZIP → Fehler ehrlich", async () => {
    await expect(parseBcf21Zip(new Uint8Array([60, 66, 67, 70]))).rejects.toThrow(/kein ZIP/);
  });
});

describe("§261 lookAtFromViewpoint", () => {
  it("eye + dir * 4", () => {
    const xml = `<?xml version="1.0"?>
<VisualizationInfo>
  <PerspectiveCamera>
    <CameraViewPoint><X>0</X><Y>0</Y><Z>0</Z></CameraViewPoint>
    <CameraDirection><X>1</X><Y>0</Y><Z>0</Z></CameraDirection>
  </PerspectiveCamera>
</VisualizationInfo>`;
    expect(lookAtFromViewpoint(xml)).toEqual([4, 0, 0]);
  });
});
