// NARCHI — Journal de travail d'équipe (« Arbeitszeit & Tagesbericht »).
// Chaque membre consigne par jour : heure d'entrée (Kommen), heure de
// sortie (Gehen), pause, et les tâches réalisées. Persistance locale
// (localStorage) — même philosophie que le reste du frontend : le moteur de
// calcul est pur et testé, la synchro backend viendra se brancher dessus.

export interface WorkTask {
  id: string;
  text: string;
  projectName?: string;
}

export interface WorkdayEntry {
  userId: string;
  /// Jour au format ISO « YYYY-MM-DD ».
  date: string;
  /// Heure d'entrée « HH:MM » (peut être vide si non saisi).
  startTime: string;
  /// Heure de sortie « HH:MM ».
  endTime: string;
  /// Pause en minutes (0 = pas de pause).
  pauseMinutes: number;
  /// Tâches réalisées dans la journée (Tagesbericht).
  tasks: WorkTask[];
}

export const WORKLOG_STORAGE_KEY = "narchi:worklog";
/// Cible hebdomadaire par défaut (5 × 8 h) — affichage du reste à faire.
export const WEEK_TARGET_HOURS = 40;

/* ------------------------------ calculs purs ------------------------------ */

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/// Message d'anomalie de saisie (null si tout est cohérent).
export function workdayWarning(entry: WorkdayEntry): string | null {
  const start = parseTime(entry.startTime);
  const end = parseTime(entry.endTime);
  if (entry.pauseMinutes < 0 || entry.pauseMinutes > 8 * 60) {
    return "Pause unplausibel.";
  }
  if (entry.startTime && start === null) return "Kommen-Zeit ungültig (Format hh:mm).";
  if (entry.endTime && end === null) return "Gehen-Zeit ungültig (Format hh:mm).";
  if (start !== null && end !== null) {
    if (end < start) return "Gehen liegt vor Kommen — bitte prüfen.";
    if (end - start - entry.pauseMinutes < 0) return "Pause länger als Arbeitszeit.";
  }
  return null;
}

/// Heures travaillées du jour (décimal). null tant que Kommen ou Gehen
/// manque, ou si la saisie est incohérente (warning à afficher).
export function computeWorkedHours(entry: WorkdayEntry): number | null {
  if (workdayWarning(entry) !== null) return null;
  const start = parseTime(entry.startTime);
  const end = parseTime(entry.endTime);
  if (start === null || end === null) return null;
  return Math.round(((end - start - entry.pauseMinutes) / 60) * 100) / 100;
}

export interface WorkWeekTotals {
  hours: number | null;
  tasksCount: number;
  daysLogged: number;
  restHours: number | null;
}

/// Totaux d'une semaine (espaces vierges tolérés : ils ne comptent pas).
export function weekTotals(entries: WorkdayEntry[]): WorkWeekTotals {
  let hours = 0;
  let anyHours = false;
  let tasksCount = 0;
  let daysLogged = 0;
  for (const entry of entries) {
    const worked = computeWorkedHours(entry);
    const hasContent = worked !== null || entry.tasks.length > 0;
    if (hasContent) daysLogged += 1;
    if (worked !== null) {
      hours += worked;
      anyHours = true;
    }
    tasksCount += entry.tasks.length;
  }
  const rounded = anyHours ? Math.round(hours * 100) / 100 : null;
  return {
    hours: rounded,
    tasksCount,
    daysLogged,
    restHours: rounded !== null ? Math.round((WEEK_TARGET_HOURS - rounded) * 100) / 100 : null,
  };
}

/* ------------------------------ persistance ------------------------------- */

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readAll(storage: Storage | null): WorkdayEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(WORKLOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is WorkdayEntry =>
        typeof item === "object" && item !== null &&
        typeof (item as WorkdayEntry).userId === "string" &&
        typeof (item as WorkdayEntry).date === "string" &&
        Array.isArray((item as WorkdayEntry).tasks),
    );
  } catch {
    return [];
  }
}

function writeAll(entries: WorkdayEntry[], storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(WORKLOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota / mode privé : dégradation silencieuse
  }
}

/// Entrées d'un membre, triées par date croissante.
export function loadAllWorklog(storage: Storage | null = defaultStorage()): WorkdayEntry[] {
  return readAll(storage);
}

/** Remplace tout le journal (après pull serveur). */
export function replaceAllWorklog(
  entries: WorkdayEntry[],
  storage: Storage | null = defaultStorage(),
): void {
  writeAll(entries, storage);
}

export function loadWorklog(userId: string, storage: Storage | null = defaultStorage()): WorkdayEntry[] {
  return readAll(storage)
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getWorkday(
  userId: string,
  dateISO: string,
  storage: Storage | null = defaultStorage(),
): WorkdayEntry | null {
  return readAll(storage).find((entry) => entry.userId === userId && entry.date === dateISO) ?? null;
}

export function emptyWorkday(userId: string, dateISO: string): WorkdayEntry {
  return { userId, date: dateISO, startTime: "", endTime: "", pauseMinutes: 30, tasks: [] };
}

/// Insère ou remplace l'entrée (userId, date). Écrite telle quelle — la
/// validation d'affichage se fait via workdayWarning/computeWorkedHours.
export function upsertWorkday(entry: WorkdayEntry, storage: Storage | null = defaultStorage()): void {
  const rest = readAll(storage).filter(
    (item) => !(item.userId === entry.userId && item.date === entry.date),
  );
  writeAll([...rest, entry], storage);
}

export function removeWorkday(userId: string, dateISO: string, storage: Storage | null = defaultStorage()): void {
  writeAll(
    readAll(storage).filter((item) => !(item.userId === userId && item.date === dateISO)),
    storage,
  );
}
