/**
 * §258 — BCF 2.1 ZIP (buildingSMART).
 *
 * L'ancien generateBcf() écrit UN xml « version 3.0 » et le nomme .bcf :
 * Bimcollab / Solibri refusent ça. Ici : archive réelle
 *   bcf.version
 *   {guid}/markup.bcf
 *   {guid}/viewpoint.bcfv
 *
 * Honnêteté : AABB-Radar, pas mesh. IfcGuid seulement si 22 caractères
 * (base64 IFC). Express-ID va dans Description, jamais inventé comme GUID.
 */
import JSZip from "jszip";
import type { ClashGroup } from "@/lib/clashGroups";
import type { BuildingElement } from "@/data/types";

const BCF_NS_VERSION = "http://www.buildingsmart-tech.org/bcf/20140516/version";

export interface Bcf21TopicFiles {
  guid: string;
  markup: string;
  viewpoint: string;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

export function newBcfGuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isIfcGuid22(s: string | undefined | null): s is string {
  return typeof s === "string" && /^[0-9A-Za-z_$]{22}$/.test(s);
}

export function isoBcf(iso: string): string {
  const d = iso.includes("T") ? iso : new Date().toISOString();
  return d.replace(/\.\d{3}Z$/, "Z");
}

const SEV_PRIO: Record<string, string> = {
  critical: "Critical",
  major: "High",
  minor: "Normal",
};

export function bcfVersionXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Version xmlns="${BCF_NS_VERSION}" VersionId="2.1"/>\n`
  );
}

export function cameraFromHotspot(center: [number, number, number]): {
  eye: [number, number, number];
  dir: [number, number, number];
  up: [number, number, number];
} {
  const dist = 4;
  const eye: [number, number, number] = [center[0] + dist, center[1] - dist, center[2] + dist * 0.6];
  const dx = center[0] - eye[0];
  const dy = center[1] - eye[1];
  const dz = center[2] - eye[2];
  const n = Math.hypot(dx, dy, dz) || 1;
  return { eye, dir: [dx / n, dy / n, dz / n], up: [0, 0, 1] };
}

function vecXml(tag: string, v: [number, number, number]): string {
  return (
    `<${tag}><X>${v[0].toFixed(6)}</X><Y>${v[1].toFixed(6)}</Y><Z>${v[2].toFixed(6)}</Z></${tag}>`
  );
}

export function buildTopicFiles(
  group: ClashGroup,
  elementsById: Map<string, BuildingElement>,
  created: string,
  topicGuid: string,
  viewGuid: string,
): Bcf21TopicFiles {
  const rep = group.representative;
  const mm = (m: number) => Math.max(0, Math.round(m * 1000));
  const elA = elementsById.get(rep.elementA);
  const elB = elementsById.get(rep.elementB);
  const ifcA = isIfcGuid22(elA?.guid) ? elA!.guid : null;
  const ifcB = isIfcGuid22(elB?.guid) ? elB!.guid : null;
  const desc = [
    `NARCHI AABB-Radar (kein Mesh). ${group.title}.`,
    `${group.count} Paar(e). Schwere: ${group.severity}.`,
    group.levels.length ? `Ebenen: ${group.levels.join(", ")}.` : "",
    `Eindringung ${mm(group.typicalOverlap[0])}×${mm(group.typicalOverlap[1])}×${mm(group.typicalOverlap[2])} mm.`,
    `Stellvertreter: ${rep.nameA} × ${rep.nameB}.`,
    `Hotspot [${rep.hotspot.center[0].toFixed(3)}, ${rep.hotspot.center[1].toFixed(3)}, ${rep.hotspot.center[2].toFixed(3)}] m.`,
    rep.expressIdA != null ? `Express-ID #${rep.expressIdA} / #${rep.expressIdB}.` : "Keine Express-ID.",
    ifcA || ifcB ? "" : "Kein gültiger IfcGuid (22 Zeichen) — Selection weggelassen.",
  ]
    .filter(Boolean)
    .join(" ");

  const cam = cameraFromHotspot(rep.hotspot.center);
  const selection =
    ifcA || ifcB
      ? `<Components><Selection>${ifcA ? `<Component IfcGuid="${escapeXml(ifcA)}"/>` : ""}${
          ifcB ? `<Component IfcGuid="${escapeXml(ifcB)}"/>` : ""
        }</Selection></Components>`
      : "";

  const viewpoint =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VisualizationInfo Guid="${viewGuid}">\n` +
    `  ${selection}\n` +
    `  <PerspectiveCamera>\n` +
    `    ${vecXml("CameraViewPoint", cam.eye)}\n` +
    `    ${vecXml("CameraDirection", cam.dir)}\n` +
    `    ${vecXml("CameraUpVector", cam.up)}\n` +
    `    <FieldOfView>60</FieldOfView>\n` +
    `  </PerspectiveCamera>\n` +
    `</VisualizationInfo>\n`;

  const title = `${group.id} ${group.title} (${group.count})`.slice(0, 120);
  const markup =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Markup>\n` +
    `  <Topic Guid="${topicGuid}" TopicType="Issue" TopicStatus="Open">\n` +
    `    <Title>${escapeXml(title)}</Title>\n` +
    `    <Priority>${SEV_PRIO[group.severity] ?? "Normal"}</Priority>\n` +
    `    <Index>0</Index>\n` +
    `    <CreationDate>${isoBcf(created)}</CreationDate>\n` +
    `    <CreationAuthor>NARCHI</CreationAuthor>\n` +
    `    <Description>${escapeXml(desc)}</Description>\n` +
    `  </Topic>\n` +
    `  <Comment Guid="${newBcfGuid()}">\n` +
    `    <Date>${isoBcf(created)}</Date>\n` +
    `    <Author>NARCHI</Author>\n` +
    `    <Comment>${escapeXml(desc)}</Comment>\n` +
    `    <Viewpoint Guid="${viewGuid}"/>\n` +
    `  </Comment>\n` +
    `  <Viewpoints Guid="${viewGuid}">\n` +
    `    <Viewpoint>viewpoint.bcfv</Viewpoint>\n` +
    `  </Viewpoints>\n` +
    `</Markup>\n`;

  return { guid: topicGuid, markup, viewpoint };
}

export interface GenericBcf21Topic {
  title: string;
  description: string;
  priority?: string;
  ifcGuids: string[];
  hotspot: [number, number, number] | null;
}

export function buildGenericTopicFiles(
  topic: GenericBcf21Topic,
  created: string,
  topicGuid: string,
  viewGuid: string,
): Bcf21TopicFiles {
  const guids = topic.ifcGuids.filter(isIfcGuid22);
  const center = topic.hotspot ?? [0, 0, 0];
  const cam = cameraFromHotspot(center);
  const selection =
    guids.length > 0
      ? `<Components><Selection>${guids
          .map((g) => `<Component IfcGuid="${escapeXml(g)}"/>`)
          .join("")}</Selection></Components>`
      : "";
  const viewpoint =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VisualizationInfo Guid="${viewGuid}">\n` +
    `  ${selection}\n` +
    `  <PerspectiveCamera>\n` +
    `    ${vecXml("CameraViewPoint", cam.eye)}\n` +
    `    ${vecXml("CameraDirection", cam.dir)}\n` +
    `    ${vecXml("CameraUpVector", cam.up)}\n` +
    `    <FieldOfView>60</FieldOfView>\n` +
    `  </PerspectiveCamera>\n` +
    `</VisualizationInfo>\n`;
  const desc = topic.description;
  const markup =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Markup>\n` +
    `  <Topic Guid="${topicGuid}" TopicType="Issue" TopicStatus="Open">\n` +
    `    <Title>${escapeXml(topic.title.slice(0, 120))}</Title>\n` +
    `    <Priority>${escapeXml(topic.priority ?? "Normal")}</Priority>\n` +
    `    <Index>0</Index>\n` +
    `    <CreationDate>${isoBcf(created)}</CreationDate>\n` +
    `    <CreationAuthor>NARCHI</CreationAuthor>\n` +
    `    <Description>${escapeXml(desc)}</Description>\n` +
    `  </Topic>\n` +
    `  <Comment Guid="${newBcfGuid()}">\n` +
    `    <Date>${isoBcf(created)}</Date>\n` +
    `    <Author>NARCHI</Author>\n` +
    `    <Comment>${escapeXml(desc)}</Comment>\n` +
    `    <Viewpoint Guid="${viewGuid}"/>\n` +
    `  </Comment>\n` +
    `  <Viewpoints Guid="${viewGuid}">\n` +
    `    <Viewpoint>viewpoint.bcfv</Viewpoint>\n` +
    `  </Viewpoints>\n` +
    `</Markup>\n`;
  return { guid: topicGuid, markup, viewpoint };
}

export async function packBcf21Zip(
  topics: GenericBcf21Topic[],
  opts?: { created?: string; maxTopics?: number },
): Promise<Uint8Array> {
  if (topics.length === 0) {
    throw new Error("Keine BCF-Themen — nichts zu packen.");
  }
  const created = opts?.created ?? new Date().toISOString();
  const max = opts?.maxTopics ?? 200;
  const zip = new JSZip();
  zip.file("bcf.version", bcfVersionXml());
  for (const t of topics.slice(0, max)) {
    const files = buildGenericTopicFiles(t, created, newBcfGuid(), newBcfGuid());
    zip.file(`${files.guid}/markup.bcf`, files.markup);
    zip.file(`${files.guid}/viewpoint.bcfv`, files.viewpoint);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildBcf21Zip(
  groups: ClashGroup[],
  elements: BuildingElement[],
  opts?: { created?: string; maxTopics?: number },
): Promise<Uint8Array> {
  const created = opts?.created ?? new Date().toISOString();
  const max = opts?.maxTopics ?? 200;
  const zip = new JSZip();
  zip.file("bcf.version", bcfVersionXml());
  const byId = new Map(elements.map((e) => [e.id, e]));
  const slice = groups.slice(0, max);
  for (const g of slice) {
    const topicGuid = newBcfGuid();
    const viewGuid = newBcfGuid();
    const files = buildTopicFiles(g, byId, created, topicGuid, viewGuid);
    zip.file(`${files.guid}/markup.bcf`, files.markup);
    zip.file(`${files.guid}/viewpoint.bcfv`, files.viewpoint);
  }
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return buf;
}

export async function downloadBcf21Zip(
  groups: ClashGroup[],
  elements: BuildingElement[],
  fileName = "narchi-clash.bcfzip",
): Promise<void> {
  const bytes = await buildBcf21Zip(groups, elements);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
