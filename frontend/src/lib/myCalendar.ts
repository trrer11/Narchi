// NARCHI — « Mein Kalender » : calendrier personnel intelligent.
//
// Objectif utilisateur (2026-08-06) : chaque personne gère SON calendrier —
// tâches avec durées → heures travaillées calculées automatiquement, congés,
// maladie, jours fériés ALLEMANDS (par Bundesland, calculés — jamais semés),
// réunions/conférences avec RAPPEL configurable (« notification qui apparaît
// avant la date »). Aucune donnée fictive : base vide au premier démarrage.

import { storage } from "@/utils/localStore";
import { uid } from "@/utils/uid";

// ---------------------------------------------------------------------------
// Types & méta
// ---------------------------------------------------------------------------

export type CalKind = "aufgabe" | "termin" | "urlaub" | "krank" | "fortbildung" | "konferenz";

export const CAL_KIND_META: Record<CalKind, { label: string; emoji: string; chip: string; dot: string }> = {
  aufgabe:     { label: "Aufgabe",    emoji: "🛠️", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/30", dot: "#10b981" },
  termin:      { label: "Termin",     emoji: "🗓️", chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/30",    dot: "#6366f1" },
  urlaub:      { label: "Urlaub",     emoji: "🏖️", chip: "bg-sky-50 text-sky-700 ring-sky-600/30",             dot: "#0ea5e9" },
  krank:       { label: "Krankheit",  emoji: "🤒", chip: "bg-rose-50 text-rose-700 ring-rose-600/30",          dot: "#f43f5e" },
  fortbildung: { label: "Fortbildung",emoji: "🎓", chip: "bg-amber-50 text-amber-700 ring-amber-600/30",       dot: "#f59e0b" },
  konferenz:   { label: "Konferenz",  emoji: "🎤", chip: "bg-violet-50 text-violet-700 ring-violet-600/30",    dot: "#8b5cf6" },
};

export interface CalEntry {
  id: string;
  userId: string;
  /** Date ISO « YYYY-MM-DD » du (premier) jour. */
  date: string;
  /** Fin ISO incluse — uniquement pour les plages (Urlaub…). Défaut = date. */
  end?: string;
  kind: CalKind;
  title: string;
  /** Heure de début « HH:MM » (déclenche le rappel et le compte à rebours). */
  startTime?: string;
  /** Durée en HEURES — les tâches alimentent le calcul des heures. */
  durationH?: number;
  /** Rappel AVANT le début, en heures (0 = aucun). */
  remindH?: number;
  note?: string;
  createdAt: number;
  /** Horodatage du rappel déjà émis (anti-doublon). */
  notifiedAt?: number;
}

// ---------------------------------------------------------------------------
// Persistance (localStorage, clé narchi:my-calendar)
// ---------------------------------------------------------------------------

const STORE_KEY = "my-calendar";

function loadAll(): CalEntry[] {
  const raw = storage.get<CalEntry[]>(STORE_KEY, []);
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}
function saveAll(list: CalEntry[]): void {
  storage.set(STORE_KEY, list);
}

export function listAllEntries(): CalEntry[] {
  return loadAll();
}

/** Remplace tout le calendrier bureau (après pull office-blob). */
export function replaceAllEntries(list: CalEntry[]): void {
  saveAll(Array.isArray(list) ? list.filter(Boolean) : []);
}

export function listMyEntries(userId: string): CalEntry[] {
  return loadAll()
    .filter((e) => e.userId === userId)
    .sort((a, b) => (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? "")));
}

export function createMyEntry(input: Omit<CalEntry, "id" | "createdAt">): CalEntry {
  const entry: CalEntry = { ...input, id: uid(), createdAt: Date.now() };
  saveAll([...loadAll(), entry]);
  return entry;
}

export function deleteMyEntry(id: string, userId: string): void {
  saveAll(loadAll().filter((e) => !(e.id === id && e.userId === userId)));
}

export function markReminded(id: string, at: number): void {
  const list = loadAll();
  const e = list.find((x) => x.id === id);
  if (e) {
    e.notifiedAt = at;
    saveAll(list);
  }
}

// ---------------------------------------------------------------------------
// Dates utilitaires (locale, sans fuseau caché)
// ---------------------------------------------------------------------------

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
export function todayISO(): string {
  return toISO(new Date());
}
/** Numéro de semaine ISO 8601 (KW — convention allemande). */
export function isoWeekNumber(iso: string): number {
  const d = parseISODate(iso);
  // Jeudi de la semaine courante (référence ISO).
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000));
}
/** Les 42 cases (6 semaines, début lundi) du mois affiché. */
export function monthGridDates(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const mondayOffset = (first.getDay() + 6) % 7; // lundi = 0
  const start = new Date(year, month0, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toISO(d);
  });
}
/** Début du rendez-vous en ms (date + heure; 09:00 par défaut). */
export function entryStartsAt(e: CalEntry): number {
  const base = parseISODate(e.date);
  const [hh, mm] = (e.startTime ?? "09:00").split(":").map(Number);
  base.setHours(hh || 0, mm || 0, 0, 0);
  return base.getTime();
}

// ---------------------------------------------------------------------------
// Jours fériés ALLEMANDS — calculés (Pâques gaussienne + règles Bundesland)
// ---------------------------------------------------------------------------

export interface GermanHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  /** Codes des Bundesländer concernés ; vide = dans toute l'Allemagne. */
  states: string[];
}

/** Dimanche de Pâques grégorien (algorithme de Gauss/Meeus) — YYYY-MM-DD. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Liste complète des fériés valables pour le Bundesland donné (code ISO). */
export function germanHolidays(year: number, state: string): GermanHoliday[] {
  const p = (mmdd: string) => `${year}-${mmdd}`;
  const easter = easterSunday(year);
  const out: GermanHoliday[] = [
    { date: p("01-01"), name: "Neujahr", states: [] },
    { date: p("01-06"), name: "Heilige Drei Könige", states: ["BW", "BY", "ST"] },
    { date: p("03-08"), name: "Internationaler Frauentag", states: ["BE", "MV"] },
    { date: addDaysISO(easter, -2), name: "Karfreitag", states: [] },
    { date: easter, name: "Ostersonntag", states: ["BB"] },
    { date: addDaysISO(easter, 1), name: "Ostermontag", states: [] },
    { date: p("05-01"), name: "Tag der Arbeit", states: [] },
    { date: addDaysISO(easter, 39), name: "Christi Himmelfahrt", states: [] },
    { date: addDaysISO(easter, 49), name: "Pfingstsonntag", states: ["BB"] },
    { date: addDaysISO(easter, 50), name: "Pfingstmontag", states: [] },
    { date: addDaysISO(easter, 60), name: "Fronleichnam", states: ["BW", "BY", "HE", "NW", "RP", "SL"] },
    { date: p("10-03"), name: "Tag der Deutschen Einheit", states: [] },
    { date: p("10-31"), name: "Reformationstag", states: ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"] },
    { date: p("11-01"), name: "Allerheiligen", states: ["BW", "BY", "NW", "RP", "SL"] },
    { date: p("12-25"), name: "1. Weihnachtsfeiertag", states: [] },
    { date: p("12-26"), name: "2. Weihnachtsfeiertag", states: [] },
    { date: bussUndBettag(year), name: "Buß- und Bettag", states: ["SN"] },
  ];
  return out
    .filter((h) => h.states.length === 0 || h.states.includes(state))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Buß- und Bettag : mercredi AVANT le 23 novembre (Saxe uniquement). */
function bussUndBettag(year: number): string {
  const d = new Date(year, 10, 23); // 23 novembre
  d.setDate(d.getDate() - (((d.getDay() + 6) % 7) + 4)); // recule au mercredi précédent
  return toISO(d);
}

export function holidayOn(dateISO: string, state: string): GermanHoliday | null {
  const year = Number(dateISO.slice(0, 4));
  return germanHolidays(year, state).find((h) => h.date === dateISO) ?? null;
}

// ---------------------------------------------------------------------------
// Présences / abscences & expansion des plages
// ---------------------------------------------------------------------------

export function isWeekendISO(iso: string): boolean {
  const dow = parseISODate(iso).getDay();
  return dow === 0 || dow === 6;
}

/// Jours couverts par une entrée (plage urlaub incluse ; sinon jour seul).
export function expandEntryDays(e: CalEntry): string[] {
  if (!e.end || e.end <= e.date) return [e.date];
  const out: string[] = [];
  let cur = e.date;
  for (let guard = 0; cur <= e.end && guard < 370; guard++) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export function entriesOnDate(entries: CalEntry[], dateISO: string): CalEntry[] {
  return entries.filter((e) => expandEntryDays(e).includes(dateISO));
}

// ---------------------------------------------------------------------------
// Calculs automatiques — heures travaillées, objectif, bilan du mois
// ---------------------------------------------------------------------------

/** Heures SOLL d'une journée (8 h si jour ouvré, sinon 0). */
export function sollHoursDay(dateISO: string, state: string, absences: CalEntry[]): number {
  if (isWeekendISO(dateISO) || holidayOn(dateISO, state)) return 0;
  const dayAbsence = entriesOnDate(absences, dateISO).some(
    (e) => e.kind === "urlaub" || e.kind === "krank",
  );
  return dayAbsence ? 0 : 8;
}

/** Heures effectivement notées sur une journée (durées des tâches/termes…).
    Le paramètre date est accepté pour la symétrie d'appel (filtrage externe),
    la somme se fait sur les entrées déjà du jour. */
export function istHoursDay(dayEntries: CalEntry[], _dateISO?: string): number {
  return (dayEntries ?? [])
    .filter((e) => e.kind !== "urlaub" && e.kind !== "krank")
    .reduce((sum, e) => sum + (e.durationH ?? 0), 0);
}

export interface MonthSummary {
  workH: number;       // heures notées (IST)
  targetH: number;     // heures de travail contractuelles restantes après fériés/absences
  deltaH: number;      // IST − SOLL (positif = heures sup.)
  vacationD: number;   // jours d'urlaub (jours de semaine couverts)
  sickD: number;       // jours de maladie
  trainingD: number;   // Fortbildung/Konferenz (jours distincts)
  meetingCount: number;
  holidays: GermanHoliday[];
}

export function monthSummary(
  entries: CalEntry[],
  year: number,
  month0: number,
  state: string,
): MonthSummary {
  const dim = new Date(year, month0 + 1, 0).getDate();
  const dates = Array.from({ length: dim }, (_, i) => toISO(new Date(year, month0, i + 1)));
  const inMonth = entries.filter((e) =>
    expandEntryDays(e).some((d) => d.startsWith(`${year}-${String(month0 + 1).padStart(2, "0")}`)),
  );
  const absences = inMonth.filter((e) => e.kind === "urlaub" || e.kind === "krank");

  let workH = 0;
  let targetH = 0;
  let vacationD = 0;
  let sickD = 0;
  const trainingDays = new Set<string>();
  let meetingCount = 0;

  for (const iso of dates) {
    const day = entriesOnDate(inMonth, iso);
    workH += istHoursDay(day.filter((e) => e.date === iso), iso); // heures comptées au jour de début
    targetH += sollHoursDay(iso, state, absences);
    if (!isWeekendISO(iso) && !holidayOn(iso, state)) {
      if (day.some((e) => e.kind === "urlaub")) vacationD++;
      if (day.some((e) => e.kind === "krank")) sickD++;
    }
    for (const e of day) {
      if (e.kind === "fortbildung" || e.kind === "konferenz") trainingDays.add(iso);
      if (e.kind === "termin" && e.date === iso) meetingCount++;
    }
  }

  return {
    workH: round1(workH),
    targetH: round1(targetH),
    deltaH: round1(workH - targetH),
    vacationD,
    sickD,
    trainingD: trainingDays.size,
    meetingCount,
    holidays: germanHolidays(year, state).filter((h) => Number(h.date.slice(5, 7)) === month0 + 1),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Rappels & échéances
// ---------------------------------------------------------------------------

/// Termes/tâches à venir (défaut : 7 jours), triés par échéance — pour la
/// colonne « Bevorstehend » et le compte à rebours.
export function upcomingReminders(entries: CalEntry[], nowMs: number, horizonDays = 7): CalEntry[] {
  const max = nowMs + horizonDays * 86400000;
  return entries
    .filter((e) => e.kind === "termin" || e.kind === "aufgabe" || e.kind === "konferenz")
    .filter((e) => {
      const at = entryStartsAt(e);
      return at > nowMs - 3600000 && at <= max; // y compris « en cours » (< 1 h passée)
    })
    .sort((a, b) => entryStartsAt(a) - entryStartsAt(b))
    .slice(0, 10);
}

/// Rappels DÛS : commence dans ≤ remindH heures, pas déjà notifié.
export function dueReminders(entries: CalEntry[], nowMs: number): CalEntry[] {
  return entries.filter((e) => {
    const remind = e.remindH ?? 0;
    if (remind <= 0 || e.notifiedAt) return false;
    const at = entryStartsAt(e);
    return at > nowMs && at - nowMs <= remind * 3600000;
  });
}

/// Compte à rebours lisible (allemand) — « in 2 Std. », « in 3 Tagen »,
/// « jetzt » en cours (< 1 h), « vorbei » au-delà.
export function countdownLabel(startsAtMs: number, nowMs: number): string {
  const diff = startsAtMs - nowMs;
  if (diff < -3600000) return "vorbei";
  if (diff <= 0) return "jetzt";
  const h = diff / 3600000;
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} Min.`;
  if (h < 24) return `in ${Math.round(h)} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "morgen" : `in ${d} Tagen`;
}

export function formatH(h: number): string {
  return `${h.toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`;
}
