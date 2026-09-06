// Narchi — staff scheduling & resource planning (Ressourcenplanung).
// Assign team members to projects, phases and tasks on a calendar timeline.

export type AssignmentType = "vorplanung" | "entwurf" | "genehmigung" | "ausfuehrung" | "bauleitung" | "urlaub" | "krank" | "fortbildung" | "meeting";

export interface Assignment {
  id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  type: AssignmentType;
  start: string; // ISO date
  end: string; // ISO date
  hours: number; // allocated hours
  note?: string;
}

import { storage } from "@/utils/localStore";
import { uid } from "@/utils/uid";

const KEY = "narchi:schedule";

function load(): Assignment[] {
  return storage.get<Assignment[]>(KEY, []);
}
function save(list: Assignment[]) {
  storage.set(KEY, list);
}

const FAKE_SEED_PROJECTS = new Set([
  "prj-helios", "prj-meridian", "prj-aurora", "prj-kestrel",
]);

/** §238 — keine erfundenen Einsätze. Altes Demo einmal entfernen. */
export function listSchedule(): Assignment[] {
  const list = load();
  const cleaned = list.filter((a) => !FAKE_SEED_PROJECTS.has(a.projectId));
  if (cleaned.length !== list.length) save(cleaned);
  return cleaned;
}

/** @deprecated leer — bleibt importierbar, schreibt nichts mehr. */
export function ensureSeedSchedule(): Assignment[] {
  return listSchedule();
}

export function addAssignment(a: Omit<Assignment, "id">): Assignment {
  const list = load();
  const item: Assignment = { ...a, id: uid() };
  list.push(item);
  save(list);
  return item;
}

export function updateAssignment(id: string, patch: Partial<Assignment>) {
  const list = load();
  const a = list.find((x) => x.id === id);
  if (a) { Object.assign(a, patch); save(list); }
}

export function removeAssignment(id: string) {
  save(load().filter((x) => x.id !== id));
}

export const TYPE_META: Record<AssignmentType, { label: string; color: string; icon: string }> = {
  vorplanung: { label: "Vorplanung", color: "#a78bfa", icon: "branch" },
  entwurf: { label: "Entwurf", color: "#f59e0b", icon: "cube" },
  genehmigung: { label: "Genehmigung", color: "#22d3ee", icon: "shield" },
  ausfuehrung: { label: "Ausführungsplanung", color: "#34d399", icon: "layers" },
  bauleitung: { label: "Bauleitung", color: "#fbbf24", icon: "building" },
  urlaub: { label: "Urlaub", color: "#38bdf8", icon: "pin" },
  krank: { label: "Krankheit", color: "#f43f5e", icon: "alert" },
  fortbildung: { label: "Fortbildung", color: "#fb7185", icon: "spark" },
  meeting: { label: "Meeting", color: "#94a3b8", icon: "users" },
};

/* Date helpers */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function overlaps(aStart: string, aEnd: string, dayISO: string): boolean {
  return aStart <= dayISO && aEnd >= dayISO;
}
