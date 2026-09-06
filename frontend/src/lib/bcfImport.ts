// NARCHI V6.11 — Import BCF 3.0 XML (§44) + BCF 2.1 ZIP (§259).
// Honnêteté : topic sans Express-ID ni IfcGuid 22 → unmatched, jamais collé.

import JSZip from "jszip";
import type { BuildingElement } from "@/data/types";
import type { ClashGroup } from "@/lib/clashGroups";
import { expressIdKey } from "@/lib/qcSources";
import { isIfcGuid22 } from "@/lib/bcf21Zip";

export interface ImportedBcfTopic {
  guid: string;
  title: string;
  status: string;
  priority: string;
  author: string;
  createdAt: string | null;
  comments: string[];
  expressIds: number[];
  ifcGuids: string[];
  hotspot: [number, number, number] | null;
  befundId: string | null;
  closed: boolean;
}

export interface MatchedBcfTopic extends ImportedBcfTopic {
  elements: BuildingElement[];
  group: ClashGroup | null;
}

export interface BcfImportSummary {
  topics: MatchedBcfTopic[];
  matched: number;
  unmatched: number;
  closed: number;
}

const EXPRESS_RE = /#(\d{1,12})/g;
const HOTSPOT_RE = /\[(-?\d+(?:[.,]\d+)?),\s*(-?\d+(?:[.,]\d+)?),\s*(-?\d+(?:[.,]\d+)?)\]\s*m/;
const BEFUND_RE = /\b(BG-\d{2,})\b/;

function tagText(root: Element | Document, tag: string): string | null {
  const byName = root.getElementsByTagName(tag);
  const el = byName.length > 0 ? byName[0] : root.getElementsByTagNameNS("*", tag)[0];
  const text = el?.textContent?.trim();
  return text ? text : null;
}

function tagTexts(root: Element, tag: string): string[] {
  const list = root.getElementsByTagName(tag);
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i].textContent?.trim();
    if (t) out.push(t);
  }
  return out;
}

function extractExpressIds(comments: string[]): number[] {
  const seen = new Set<number>();
  for (const c of comments) {
    for (const m of c.matchAll(EXPRESS_RE)) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) seen.add(n);
    }
  }
  return [...seen];
}

function extractHotspot(comments: string[]): [number, number, number] | null {
  for (const c of comments) {
    const m = c.match(HOTSPOT_RE);
    if (m) {
      const f = (s: string) => Number(s.replace(",", "."));
      return [f(m[1]), f(m[2]), f(m[3])];
    }
  }
  return null;
}

function makeTopic(partial: Omit<ImportedBcfTopic, "ifcGuids"> & { ifcGuids?: string[] }): ImportedBcfTopic {
  return { ifcGuids: [], ...partial };
}

/** Parse un fichier .bcf/.xml (Markup BCF 3.0 ou export NARCHI §39). */
export function parseBcfXml(xml: string): ImportedBcfTopic[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("BCF-Datei ist kein gültiges XML Markup (kein .bcfzip — bitte das XML-Format verwenden).");
  }

  const markups = Array.from(doc.getElementsByTagName("Markup"));
  const roots = markups.length > 0 ? markups : [doc.documentElement];

  const topics: ImportedBcfTopic[] = [];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i] as Element;
    const title = tagText(root, "Title");
    if (title === null) continue;

    const commentBlocks = tagTexts(root, "Comment");
    const comments = commentBlocks.length > 0 ? commentBlocks : [title];

    const status = tagText(root, "TopicStatus") ?? tagText(root, "Status") ?? "Open";
    const guid = tagText(root, "Guid") ?? `topic-${i}`;
    const befundInTitle = title.match(BEFUND_RE)?.[1] ?? null;
    const befundInComment = comments.map((c) => c.match(BEFUND_RE)?.[1]).find(Boolean) ?? null;

    topics.push(
      makeTopic({
        guid,
        title,
        status,
        priority: tagText(root, "Priority") ?? "Medium",
        author: tagText(root, "CreationAuthor") ?? "—",
        createdAt: tagText(root, "CreationDate"),
        comments,
        expressIds: extractExpressIds(comments),
        hotspot: extractHotspot(comments),
        befundId: befundInTitle ?? befundInComment,
        closed: /closed|resolved|geschlossen/i.test(status),
      }),
    );
  }

  if (topics.length === 0) {
    throw new Error("Kein BCF-Topic gefunden — die Datei enthält kein Markup mit <Title>.");
  }
  return topics;
}

export function matchTopics(
  topics: ImportedBcfTopic[],
  elements: BuildingElement[],
  groups: ClashGroup[] = [],
): MatchedBcfTopic[] {
  const byExpress = new Map<number, BuildingElement>();
  const byIfc = new Map<string, BuildingElement>();
  for (const el of elements) {
    const ex = expressIdKey(el);
    if (ex !== null && !byExpress.has(ex)) byExpress.set(ex, el);
    if (isIfcGuid22(el.guid) && !byIfc.has(el.guid)) byIfc.set(el.guid, el);
  }
  const byGroupId = new Map(groups.map((g) => [g.id, g]));
  return topics.map((t) => {
    const els: BuildingElement[] = [];
    const seen = new Set<string>();
    const push = (el: BuildingElement | undefined) => {
      if (el && !seen.has(el.id)) {
        seen.add(el.id);
        els.push(el);
      }
    };
    for (const ex of t.expressIds) push(byExpress.get(ex));
    for (const g of t.ifcGuids ?? []) push(byIfc.get(g));
    return { ...t, elements: els, group: t.befundId ? byGroupId.get(t.befundId) ?? null : null };
  });
}

export function summarizeImport(topics: MatchedBcfTopic[]): BcfImportSummary {
  return {
    topics,
    matched: topics.filter((t) => t.elements.length > 0).length,
    unmatched: topics.filter((t) => t.elements.length === 0).length,
    closed: topics.filter((t) => t.closed).length,
  };
}

export function isZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function xyzOf(el: Element | undefined): [number, number, number] | null {
  if (!el) return null;
  const n = (tag: string) => {
    const t = el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
    const v = Number(t.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };
  const x = n("X");
  const y = n("Y");
  const z = n("Z");
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}

/** Caméra BCF 2.1 → point regardé (eye + dir). Pas le clash-centre si Solibri vise ailleurs. */
export function lookAtFromViewpoint(xml: string): [number, number, number] | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) return null;
  const cam =
    doc.getElementsByTagName("PerspectiveCamera")[0] ??
    doc.getElementsByTagName("OrthogonalCamera")[0];
  if (!cam) return null;
  const eye = xyzOf(cam.getElementsByTagName("CameraViewPoint")[0]);
  const dir = xyzOf(cam.getElementsByTagName("CameraDirection")[0]);
  if (!eye) return null;
  if (!dir) return eye;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [eye[0] + (dir[0] / len) * 4, eye[1] + (dir[1] / len) * 4, eye[2] + (dir[2] / len) * 4];
}

function parseIfcGuidsFromViewpoint(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) return [];
  const comps = doc.getElementsByTagName("Component");
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < comps.length; i++) {
    const g = comps[i].getAttribute("IfcGuid") ?? "";
    if (isIfcGuid22(g) && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

function topicFromMarkup21(xml: string, folderGuid: string): ImportedBcfTopic | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) {
    throw new Error("markup.bcf ist kein gültiges XML.");
  }
  const topicEl = doc.getElementsByTagName("Topic")[0];
  const title = tagText(doc, "Title");
  if (!title) return null;
  const desc = tagText(doc, "Description") ?? "";
  const commentBlocks = tagTexts(doc.documentElement, "Comment");
  const comments = [desc, ...commentBlocks].filter(Boolean);
  const status =
    topicEl?.getAttribute("TopicStatus") ??
    tagText(doc, "TopicStatus") ??
    tagText(doc, "Status") ??
    "Open";
  const guid = topicEl?.getAttribute("Guid") ?? tagText(doc, "Guid") ?? folderGuid;
  const befundInTitle = title.match(BEFUND_RE)?.[1] ?? null;
  const befundInComment = comments.map((c) => c.match(BEFUND_RE)?.[1]).find(Boolean) ?? null;
  return makeTopic({
    guid,
    title,
    status,
    priority: tagText(doc, "Priority") ?? "Normal",
    author: tagText(doc, "CreationAuthor") ?? "—",
    createdAt: tagText(doc, "CreationDate"),
    comments,
    expressIds: extractExpressIds(comments),
    hotspot: extractHotspot(comments),
    befundId: befundInTitle ?? befundInComment,
    closed: /closed|resolved|geschlossen/i.test(status),
  });
}

export async function parseBcf21Zip(data: ArrayBuffer | Uint8Array): Promise<ImportedBcfTopic[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isZipMagic(bytes)) {
    throw new Error("Datei ist kein ZIP (kein PK-Header) — .bcfzip erwartet.");
  }
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const markupNames = names.filter((n) => /markup\.bcf$/i.test(n) && !zip.files[n].dir);
  if (markupNames.length === 0) {
    throw new Error("Kein markup.bcf im Archiv — das ist kein BCF 2.1 ZIP.");
  }
  const topics: ImportedBcfTopic[] = [];
  for (const path of markupNames) {
    const xml = await zip.files[path].async("string");
    const folder = path.replace(/\/?markup\.bcf$/i, "");
    const topic = topicFromMarkup21(xml, folder || `topic-${topics.length}`);
    if (!topic) continue;
    const slash = folder.replace(/\\/g, "/");
    const vpPath = names.find((n) => n.replace(/\\/g, "/") === `${slash}/viewpoint.bcfv`);
    if (vpPath && zip.files[vpPath]) {
      const vpXml = await zip.files[vpPath].async("string");
      topic.ifcGuids = parseIfcGuidsFromViewpoint(vpXml);
      if (!topic.hotspot) topic.hotspot = lookAtFromViewpoint(vpXml);
    }
    topics.push(topic);
  }
  if (topics.length === 0) {
    throw new Error("Kein BCF-Topic im ZIP (markup ohne <Title>).");
  }
  return topics;
}

export async function parseBcfFile(file: File): Promise<ImportedBcfTopic[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (isZipMagic(buf)) return parseBcf21Zip(buf);
  return parseBcfXml(new TextDecoder("utf-8").decode(buf));
}
