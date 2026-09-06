// Narchi — Wellbeing service via the unified remote/local DB.
// Online → real Supabase (team-wide, cross-device). Offline → local SharedStore.

import * as db from "@/lib/remoteDb";
import { uid } from "@/utils/uid";

export type MoodLevel = 1 | 2 | 3 | 4 | 5;

export interface MoodCheckIn {
  id: string;
  userId: string;
  userName: string;
  level: MoodLevel;
  emoji: string;
  energy: number;
  stress: number;
  workload: number;
  note?: string;
  date: string;
  createdAt: string;
  created_at?: string;
}

export const MOOD_META: Record<MoodLevel, { emoji: string; label: string; color: string }> = {
  1: { emoji: "😣", label: "Überlastet", color: "#f43f5e" },
  2: { emoji: "😕", label: "Gestresst", color: "#fb923c" },
  3: { emoji: "😐", label: "Solala", color: "#fbbf24" },
  4: { emoji: "🙂", label: "Gut", color: "#34d399" },
  5: { emoji: "🤩", label: "Fantastisch", color: "#22d3ee" },
};
export const MOOD_OPTIONS: MoodLevel[] = [1, 2, 3, 4, 5];

const COLL = "mood_checkins";
const todayISO = () => new Date().toISOString().slice(0, 10);

export async function listCheckIns(): Promise<MoodCheckIn[]> {
  return db.getAll<MoodCheckIn>(COLL);
}

export async function todaysCheckIn(userId: string): Promise<MoodCheckIn | undefined> {
  const today = todayISO();
  const all = await db.getAll<MoodCheckIn>(COLL);
  return all.find((c: MoodCheckIn) => c.userId === userId && c.date === today);
}

export async function checkIn(input: Omit<MoodCheckIn, "id" | "date" | "createdAt">): Promise<MoodCheckIn> {
  const today = todayISO();
  const all = await db.getAll<MoodCheckIn>(COLL);
  for (const c of all) {
    if (c.userId === input.userId && c.date === today) {
      await db.remove(COLL, c.id);
    }
  }
  const item: MoodCheckIn = { ...input, id: uid("mood"), date: today, createdAt: new Date().toISOString() };
  await db.insert(COLL, item);
  return item;
}

export async function teamMoodForDate(iso: string): Promise<{ avg: number; count: number } | null> {
  const all = await db.getAll<MoodCheckIn>(COLL);
  const list = all.filter((c: MoodCheckIn) => c.date === iso);
  if (list.length === 0) return null;
  return { avg: list.reduce((s: number, c: MoodCheckIn) => s + c.level, 0) / list.length, count: list.length };
}

export async function teamMoodTrend(days = 7): Promise<{ date: string; avg: number | null; count: number }[]> {
  const out: { date: string; avg: number | null; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const m = await teamMoodForDate(date);
    out.push({ date, avg: m?.avg ?? null, count: m?.count ?? 0 });
  }
  return out;
}

export interface TeamSummary {
  todayAvg: number | null;
  todayCount: number;
  weekAvg: number | null;
  stressAvg: number | null;
  energyAvg: number | null;
  workloadAvg: number | null;
}

export async function teamSummary(userIds: string[]): Promise<TeamSummary> {
  const all = (await db.getAll<MoodCheckIn>(COLL)).filter((c: MoodCheckIn) => userIds.includes(c.userId));
  const today = todayISO();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const todayList = all.filter((c: MoodCheckIn) => c.date === today);
  const weekList = all.filter((c: MoodCheckIn) => c.date >= weekStartStr);
  const avg = (arr: MoodCheckIn[], fn: (c: MoodCheckIn) => number) =>
    arr.length ? arr.reduce((s: number, c: MoodCheckIn) => s + fn(c), 0) / arr.length : null;
  return {
    todayAvg: avg(todayList, (c: MoodCheckIn) => c.level),
    todayCount: todayList.length,
    weekAvg: avg(weekList, (c: MoodCheckIn) => c.level),
    stressAvg: avg(weekList, (c: MoodCheckIn) => c.stress),
    energyAvg: avg(weekList, (c: MoodCheckIn) => c.energy),
    workloadAvg: avg(weekList, (c: MoodCheckIn) => c.workload),
  };
}

export function subscribeMood(cb: () => void): () => void {
  return db.subscribe(COLL, cb);
}

const WEEKDAY_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function weekdayShortDE(iso: string): string {
  return WEEKDAY_DE[new Date(iso + "T00:00:00").getDay()];
}
