/**
 * §263 — IDS-Abnahme → BCF 2.1 ZIP.
 * Un topic par Bauteil fautif (cap FAIL_CAP déjà dans l'engine).
 * IfcGuid seulement 22 Zeichen. Pas de collage. Pas de mesh.
 */
import type { BuildingElement } from "@/data/types";
import type { IdsReport } from "@/lib/idsEngine";
import { expressIdKey } from "@/lib/qcSources";
import { isIfcGuid22, packBcf21Zip, type GenericBcf21Topic } from "@/lib/bcf21Zip";

export function bboxCenter(el: BuildingElement): [number, number, number] | null {
  const raw = el.properties.find((p) => p.key === "bbox")?.value;
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as number[];
    if (!Array.isArray(b) || b.length < 6) return null;
    const c: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    if (c.every((n) => Number.isFinite(n))) return c;
  } catch {
    return null;
  }
  return null;
}

export function idsFailuresToTopics(report: IdsReport, elements: BuildingElement[]): GenericBcf21Topic[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: GenericBcf21Topic[] = [];
  for (const rule of report.requirements) {
    for (const fail of rule.failing) {
      const el = byId.get(fail.elementId);
      const guid = el && isIfcGuid22(el.guid) ? el.guid : null;
      const hot = el ? bboxCenter(el) : null;
      const ex = el ? expressIdKey(el) : fail.expressId;
      const desc = [
        `NARCHI IDS-Abnahme (kein Clash-Mesh). ${rule.id} ${rule.title}.`,
        `Basis: ${rule.basis}.`,
        fail.detail,
        `Bauteil: ${fail.name}. Ebene: ${fail.level}.`,
        ex != null ? `Express-ID #${ex}.` : "Keine Express-ID.",
        guid ? `IfcGuid ${guid}.` : "Kein gültiger IfcGuid (22 Zeichen) — Selection weggelassen.",
        hot
          ? `Hotspot [${hot[0].toFixed(3)}, ${hot[1].toFixed(3)}, ${hot[2].toFixed(3)}] m.`
          : "Keine Bounding-Box — Kamera auf Ursprung (gesagt).",
        rule.suggestion,
      ].join(" ");
      out.push({
        title: `${rule.id} ${fail.name}`.slice(0, 120),
        description: desc,
        priority: rule.failed >= 5 ? "High" : "Normal",
        ifcGuids: guid ? [guid] : [],
        hotspot: hot,
      });
    }
  }
  return out;
}

export async function buildIdsBcf21Zip(
  report: IdsReport,
  elements: BuildingElement[],
  opts?: { created?: string; maxTopics?: number },
): Promise<Uint8Array> {
  const topics = idsFailuresToTopics(report, elements);
  if (topics.length === 0) {
    throw new Error("Keine IDS-Fehler — kein BCF. n.a. ist kein Fail.");
  }
  return packBcf21Zip(topics, opts);
}

export async function downloadIdsBcf21Zip(
  report: IdsReport,
  elements: BuildingElement[],
  fileName = "narchi-ids.bcfzip",
): Promise<void> {
  const bytes = await buildIdsBcf21Zip(report, elements);
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
