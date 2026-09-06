// Narchi — Practice Management Engine.
// Solves the #1 pain of small architecture firms (Reddit-confirmed):
// scope creep, untracked time, guesswork billing.
//
// 1. Time Tracker (billable vs non-billable, utilization rate)
// 2. Fee Proposal Generator (scope-based, HOAI-aligned)
// 3. Scope Guard (change order tracker)

import { storage } from "@/utils/localStore";
import { uid } from "@/utils/uid";
import { calcHoai } from "@/lib/hoaiEngine";

/* ============== TIME TRACKER ============== */
export interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  phase: string;        // LP1-LP9 (HOAI)
  description: string;
  hours: number;
  billable: boolean;
  date: string;         // ISO date
  createdAt: string;
}

const TIME_KEY = "narchi:time_entries";

export function listTimeEntries(): TimeEntry[] {
  return storage.get<TimeEntry[]>(TIME_KEY, []);
}

export function addTimeEntry(input: Omit<TimeEntry, "id" | "createdAt">): TimeEntry {
  const entries = listTimeEntries();
  const entry: TimeEntry = { ...input, id: uid("time"), createdAt: new Date().toISOString() };
  entries.push(entry);
  storage.set(TIME_KEY, entries);
  return entry;
}

export function deleteTimeEntry(id: string) {
  storage.set(TIME_KEY, listTimeEntries().filter((e) => e.id !== id));
}

export interface UtilizationStats {
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  utilizationRate: number; // %
  targetRate: number;      // 75% industry standard
  byPhase: Record<string, number>;
  byProject: Record<string, number>;
  byDay: { date: string; hours: number; billable: number }[];
  weeklyTrend: { week: string; hours: number; billable: number }[];
  healthStatus: "healthy" | "warning" | "critical";
  message: string;
}

export function utilizationStats(userId?: string, days = 30): UtilizationStats {
  const entries = listTimeEntries().filter((e) => {
    if (userId && e.userId !== userId) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return new Date(e.date) >= cutoff;
  });

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0);
  const nonBillableHours = totalHours - billableHours;
  const utilizationRate = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
  const targetRate = 75; // industry standard per Reddit research

  const byPhase: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const byDayMap = new Map<string, { hours: number; billable: number }>();

  for (const e of entries) {
    byPhase[e.phase] = (byPhase[e.phase] ?? 0) + e.hours;
    byProject[e.projectName] = (byProject[e.projectName] ?? 0) + e.hours;
    const day = e.date;
    const dayData = byDayMap.get(day) ?? { hours: 0, billable: 0 };
    dayData.hours += e.hours;
    if (e.billable) dayData.billable += e.hours;
    byDayMap.set(day, dayData);
  }

  const byDay = Array.from(byDayMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // weekly aggregation
  const weeklyMap = new Map<string, { hours: number; billable: number }>();
  for (const d of byDay) {
    const date = new Date(d.date);
    const week = `${date.getFullYear()}-W${Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7)}`;
    const weekData = weeklyMap.get(week) ?? { hours: 0, billable: 0 };
    weekData.hours += d.hours;
    weekData.billable += d.billable;
    weeklyMap.set(week, weekData);
  }
  const weeklyTrend = Array.from(weeklyMap.entries()).map(([week, data]) => ({ week, ...data }));

  let healthStatus: UtilizationStats["healthStatus"] = "healthy";
  let message: string;
  if (totalHours === 0) {
    healthStatus = "healthy";
    message = "Noch keine Stunden erfasst — keine Auslastung bewertbar (kein 0 %-Alarm).";
  } else if (utilizationRate < 50) {
    healthStatus = "critical";
    message = `Nur ${utilizationRate.toFixed(0)}% fakturierbar — Ziel 75 % ist Orientierung, kein Branchenzertifikat.`;
  } else if (utilizationRate < 65) {
    healthStatus = "warning";
    message = `${utilizationRate.toFixed(0)}% fakturierbar — unter der internen Orientierung 75 %.`;
  } else {
    message = `${utilizationRate.toFixed(0)}% fakturierbar — über der internen Orientierung 75 %.`;
  }

  return { totalHours, billableHours, nonBillableHours, utilizationRate, targetRate, byPhase, byProject, byDay, weeklyTrend, healthStatus, message };
}

/* ============== FEE PROPOSAL ============== */
export interface FeeProposalInput {
  projectName: string;
  projectType: "neubau" | "bestand" | "umbau" | "denkmal";
  buildingType: string;
  ngf: number;
  costPerM2: number;     // €/m² from DIN 276 estimate
  honorarzone: number;   // 1-5
  phases: number[];      // [1,2,3,4,5,6,7,8] selected LP
  hourlyRate: number;    // €/h for additional services
  deadline: string;
}

export interface FeeProposal {
  anrechenbareKosten: number;
  honorarTotal: number;
  honorarPerPhase: { phase: number; name: string; pct: number; amount: number }[];
  hourlyBudget: number;     // hours implied by the fee
  contingency: number;      // recommended reserve
  totalWithContingency: number;
  hourlyRateForAdditional: number;
  warnings: string[];
}

const LP_NAMES: Record<number, string> = {
  1: "Grundlagenermittlung", 2: "Vorplanung", 3: "Entwurfsplanung",
  4: "Genehmigungsplanung", 5: "Ausführungsplanung", 6: "Vorbereitung der Vergabe",
  7: "Mitwirkung bei der Vergabe", 8: "Objektüberwachung", 9: "Dokumentation",
};
const LP_PCT: Record<number, number> = {
  1: 0.03, 2: 0.07, 3: 0.11, 4: 0.06, 5: 0.25, 6: 0.10, 7: 0.08, 8: 0.30,
};

export function generateFeeProposal(input: FeeProposalInput): FeeProposal {
  const anrechenbareKosten = input.ngf * input.costPerM2;
  // §255 — echte HOAI-Tafel, kein 10 %-Daumen. 0 bleibt 0.
  const honorarBase =
    anrechenbareKosten > 0
      ? calcHoai({
          anrechenbareKosten,
          honorarzone: input.honorarzone,
          zusatzId: "none",
          modeId: "reference",
        }).total
      : 0;

  // distribute across selected phases
  const totalSelectedPct = input.phases.reduce((s, p) => s + (LP_PCT[p] ?? 0), 0);
  const honorarPerPhase = input.phases.map((phase) => {
    const pct = LP_PCT[phase] ?? 0;
    return {
      phase,
      name: LP_NAMES[phase] ?? `LP ${phase}`,
      pct,
      amount: honorarBase > 0 && totalSelectedPct > 0 ? honorarBase * (pct / totalSelectedPct) : 0,
    };
  });

  const honorarTotal = honorarPerPhase.reduce((s, p) => s + p.amount, 0);
  const hourlyBudget = input.hourlyRate > 0 ? honorarTotal / input.hourlyRate : 0;
  const contingency = honorarTotal * 0.10; // 10% reserve
  const totalWithContingency = honorarTotal + contingency;

  const warnings: string[] = [];
  if (honorarTotal > 0 && input.hourlyRate > 0 && hourlyBudget < 50) warnings.push(`Das Honorar deckt nur ~${Math.round(hourlyBudget)} Stunden bei ${input.hourlyRate} €/h — das ist sehr knapp für dieses Projekt.`);
  if (input.projectType === "denkmal") warnings.push("Denkmalpflege-Projekte haben hohes Risiko für Mehrkosten. Contingency von 15-20% empfohlen.");
  if (!input.phases.includes(8)) warnings.push("LP 8 (Objektüberwachung) nicht enthalten — Bauleitung gesondert vereinbaren?");
  if (input.deadline) {
    const days = Math.ceil((new Date(input.deadline).getTime() - Date.now()) / 86400000);
    if (days < 90 && input.phases.length >= 6) warnings.push(`Sehr enge Deadline (${days} Tage) für ${input.phases.length} Leistungsphasen —Teamkapazität prüfen.`);
  }

  return { anrechenbareKosten, honorarTotal, honorarPerPhase, hourlyBudget, contingency, totalWithContingency, hourlyRateForAdditional: input.hourlyRate, warnings };
}

/* ============== SCOPE GUARD ============== */
export interface ScopeItem {
  id: string;
  description: string;
  included: boolean;     // true = in scope, false = out of scope
  agreedAt: string;
  changeOrder?: { reason: string; additionalFee: number; approvedAt: string };
}

export interface ScopeBrief {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  items: ScopeItem[];
  createdAt: string;
  totalChangeOrderFees: number;
}

const SCOPE_KEY = "narchi:scope_briefs";

export function listScopeBriefs(): ScopeBrief[] {
  return storage.get<ScopeBrief[]>(SCOPE_KEY, []);
}

export function createScopeBrief(projectId: string, projectName: string, clientName: string): ScopeBrief {
  const briefs = listScopeBriefs();
  const brief: ScopeBrief = {
    id: uid("scope"),
    projectId, projectName, clientName,
    items: [],
    createdAt: new Date().toISOString(),
    totalChangeOrderFees: 0,
  };
  briefs.push(brief);
  storage.set(SCOPE_KEY, briefs);
  return brief;
}

export function addScopeItem(briefId: string, description: string, included: boolean) {
  const briefs = listScopeBriefs();
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) return;
  brief.items.push({ id: uid("item"), description, included, agreedAt: new Date().toISOString() });
  storage.set(SCOPE_KEY, briefs);
}

export function addChangeOrder(briefId: string, itemId: string, reason: string, additionalFee: number) {
  const briefs = listScopeBriefs();
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) return;
  const item = brief.items.find((i) => i.id === itemId);
  if (!item) return;
  item.changeOrder = { reason, additionalFee, approvedAt: new Date().toISOString() };
  brief.totalChangeOrderFees = brief.items.reduce((s, i) => s + (i.changeOrder?.additionalFee ?? 0), 0);
  storage.set(SCOPE_KEY, briefs);
}
