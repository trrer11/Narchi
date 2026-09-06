/** §249 Scope-Guard — Vertrag vs. « noch schnell ». Kein Fake-PDF. */
import { buildNachtrag, type NachtragGrund } from "@/lib/nachtragEngine";

const KEY = "narchi:scope";

export type ScopeLineKind = "vertrag" | "change";
export type ChangeStatus = "offen" | "beauftragt" | "abgelehnt";

export interface ScopeLine {
  id: string;
  projectId: string;
  kind: ScopeLineKind;
  text: string;
  createdAt: string;
  deltaKosten?: number;
  honorarzone?: number;
  lps?: number[];
  grund?: NachtragGrund;
  status?: ChangeStatus;
  deltaHonorarNetto?: number;
}

export interface ScopeStore {
  lines: ScopeLine[];
}

function load(): ScopeStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { lines: [] };
    const p = JSON.parse(raw) as { lines?: unknown };
    if (!Array.isArray(p.lines)) return { lines: [] };
    return { lines: p.lines.filter(isLine) };
  } catch {
    return { lines: [] };
  }
}

function isLine(x: unknown): x is ScopeLine {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.projectId === "string" && typeof o.text === "string";
}

function save(store: ScopeStore): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function listScope(projectId: string): ScopeLine[] {
  const id = projectId.trim();
  if (!id) return [];
  return load().lines.filter((l) => l.projectId === id);
}

export function addVertragspunkt(projectId: string, text: string): ScopeLine | null {
  const t = text.trim();
  const id = projectId.trim();
  if (!t || !id) return null;
  const line: ScopeLine = {
    id: "sv-" + Math.random().toString(36).slice(2, 10),
    projectId: id,
    kind: "vertrag",
    text: t,
    createdAt: new Date().toISOString(),
  };
  const s = load();
  s.lines.push(line);
  save(s);
  return line;
}

export function addChangeOrder(input: {
  projectId: string;
  text: string;
  deltaKosten: number;
  baseKosten: number;
  honorarzone: number;
  lps: number[];
  grund: NachtragGrund;
}): ScopeLine | null {
  const id = input.projectId.trim();
  const t = input.text.trim();
  if (!id || !t) return null;
  const delta = Number.isFinite(input.deltaKosten) ? Math.max(0, input.deltaKosten) : 0;
  const base = Number.isFinite(input.baseKosten) ? Math.max(0, input.baseKosten) : 0;
  const nt = buildNachtrag({
    baseKosten: base,
    deltaKosten: delta,
    honorarzone: input.honorarzone,
    zusatzId: "none",
    modeId: "reference",
    leistungsphasen: input.lps.length ? input.lps : [3],
    beschreibung: t,
    grund: input.grund,
  });
  const line: ScopeLine = {
    id: "sc-" + Math.random().toString(36).slice(2, 10),
    projectId: id,
    kind: "change",
    text: t,
    createdAt: new Date().toISOString(),
    deltaKosten: delta,
    honorarzone: input.honorarzone,
    lps: input.lps,
    grund: input.grund,
    status: "offen",
    deltaHonorarNetto: nt.deltaHonorarNetto,
  };
  const s = load();
  s.lines.push(line);
  save(s);
  return line;
}

export function setChangeStatus(id: string, status: ChangeStatus): void {
  const s = load();
  const line = s.lines.find((l) => l.id === id);
  if (!line || line.kind !== "change") return;
  line.status = status;
  save(s);
}

export function removeScopeLine(id: string): void {
  const s = load();
  s.lines = s.lines.filter((l) => l.id !== id);
  save(s);
}

export function openChangeHonorar(projectId: string): number {
  return listScope(projectId)
    .filter((l) => l.kind === "change" && l.status === "offen")
    .reduce((n, l) => n + (l.deltaHonorarNetto ?? 0), 0);
}

export function replaceAllFromRemote(lines: ScopeLine[]): void {
  save({ lines: lines.filter(isLine) });
}

export function allScopeLines(): ScopeLine[] {
  return load().lines;
}
