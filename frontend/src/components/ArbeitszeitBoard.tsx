// NARCHI — « Arbeitszeit & Tagesbericht » : chaque membre de l'équipe gère
// ici SON calendrier de travail : heure d'entrée (Kommen), heure de sortie
// (Gehen), pause, et les tâches réalisées dans la journée. Les absences
// (Urlaub, Krank) de la planification d'équipe sont visibles et bloquent la
// saisie du jour concerné. Persistance locale via lib/worklog (testée).

import { useEffect, useMemo, useState } from "react";
import { Badge, Card, CardHeader, Icon } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  TYPE_META,
  addDays,
  toISODate,
  type Assignment,
} from "@/lib/scheduling";
import {
  WEEK_TARGET_HOURS,
  computeWorkedHours,
  emptyWorkday,
  loadAllWorklog,
  loadWorklog,
  replaceAllWorklog,
  upsertWorkday,
  weekTotals,
  workdayWarning,
  type WorkdayEntry,
} from "@/lib/worklog";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import { cn } from "@/utils/cn";

const DE_DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export interface MemberLite {
  id: string;
  name: string;
  role?: string;
}

export default function ArbeitszeitBoard({
  members,
  defaultMemberId,
  weekStart,
  schedule,
  onRequestAbsence,
}: {
  members: MemberLite[];
  defaultMemberId?: string;
  weekStart: Date;
  schedule: Assignment[];
  /// Ouvre le dialogue de saisie d'absence (Kalender possède le dialogue).
  onRequestAbsence: (memberId: string, dateISO: string) => void;
}) {
  const [memberId, setMemberId] = useState(
    defaultMemberId && members.some((m) => m.id === defaultMemberId)
      ? defaultMemberId
      : members[0]?.id ?? "",
  );
  const [entries, setEntries] = useState<Record<string, WorkdayEntry>>({});
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekStartISO = toISODate(weekStart);
  const todayISO = toISODate(new Date());

  useEffect(() => {
    if (!memberId) return;
    const map: Record<string, WorkdayEntry> = {};
    for (const entry of loadWorklog(memberId)) map[entry.date] = entry;
    setEntries(map);
    let live = true;
    void (async () => {
      const remote = await pullOfficeBlob("worklog");
      if (!live || !remote || remote.empty || !Array.isArray(remote.payload.entries)) return;
      const list = remote.payload.entries as WorkdayEntry[];
      replaceAllWorklog(list);
      const next: Record<string, WorkdayEntry> = {};
      for (const entry of list.filter((e) => e.userId === memberId)) next[entry.date] = entry;
      setEntries(next);
    })();
    return () => {
      live = false;
    };
  }, [memberId, weekStartISO]);

  const entryOf = (iso: string): WorkdayEntry =>
    entries[iso] ?? emptyWorkday(memberId, iso);

  const update = (iso: string, patch: Partial<WorkdayEntry>) => {
    if (!memberId) return;
    const next = { ...entryOf(iso), ...patch, userId: memberId, date: iso };
    upsertWorkday(next);
    setEntries((prev) => ({ ...prev, [iso]: next }));
    void pushOfficeBlob("worklog", { entries: loadAllWorklog() });
  };

  const addTask = (iso: string) => {
    const draft = (taskDrafts[iso] ?? "").trim();
    if (!draft) return;
    const entry = entryOf(iso);
    update(iso, {
      tasks: [
        ...entry.tasks,
        { id: `t-${Date.now().toString(36)}-${entry.tasks.length}`, text: draft },
      ],
    });
    setTaskDrafts((prev) => ({ ...prev, [iso]: "" }));
  };

  const removeTask = (iso: string, taskId: string) => {
    const entry = entryOf(iso);
    update(iso, { tasks: entry.tasks.filter((task) => task.id !== taskId) });
  };

  const absenceOf = (iso: string): Assignment | null =>
    schedule.find(
      (a) =>
        a.userId === memberId &&
        (a.type === "urlaub" || a.type === "krank") &&
        a.start <= iso &&
        a.end >= iso,
    ) ?? null;

  const weekEntries = days.map((d) => entryOf(toISODate(d)));
  const totals = weekTotals(weekEntries);
  const absenceCount = days.filter((d) => absenceOf(toISODate(d))).length;
  const inputCls =
    "rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30";

  return (
    <Card>
      <CardHeader
        title="Arbeitszeit & Tagesbericht"
        subtitle="Kommen/Gehen, Pause und erledigte Aufgaben je Arbeitstag — Urlaub und Krank aus der Teamplanung blockieren die Eingabe"
        action={
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Mitarbeiter
            <select
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
        }
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2.5 text-left">Tag</th>
              <th className="px-3 py-2.5 text-left">Kommen</th>
              <th className="px-3 py-2.5 text-left">Gehen</th>
              <th className="px-3 py-2.5 text-left">Pause (Min.)</th>
              <th className="px-3 py-2.5 text-right">Std</th>
              <th className="px-3 py-2.5 text-left">Tätigkeiten (Tagesbericht)</th>
              <th className="px-3 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {days.map((d, i) => {
              const iso = toISODate(d);
              const entry = entryOf(iso);
              const absence = absenceOf(iso);
              const worked = computeWorkedHours(entry);
              const warning = workdayWarning(entry);
              const isToday = iso === todayISO;
              return (
                <tr key={iso} className={cn(isToday && "bg-brand-50/40", absence && "bg-slate-50/70")}>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className={cn("font-semibold", isToday ? "text-brand-600" : "text-slate-700")}>
                      {DE_DAYS[i]} {d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                    </span>
                    {isToday && <span className="ml-1 text-[10px] font-bold uppercase text-brand-500">· heute</span>}
                  </td>
                  {absence ? (
                    <td className="px-3 py-2.5" colSpan={5}>
                      <Badge tone={absence.type === "urlaub" ? "sky" : "rose"} dot>
                        {TYPE_META[absence.type].label}
                      </Badge>
                      <span className="ml-2 text-xs text-slate-400">Eintragung nicht möglich — Tag frei.</span>
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2.5">
                        <input
                          type="time"
                          aria-label={`Kommen ${iso}`}
                          value={entry.startTime}
                          onChange={(event) => update(iso, { startTime: event.target.value })}
                          className={inputCls}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="time"
                          aria-label={`Gehen ${iso}`}
                          value={entry.endTime}
                          onChange={(event) => update(iso, { endTime: event.target.value })}
                          className={inputCls}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="number"
                          min={0}
                          max={480}
                          step={5}
                          aria-label={`Pause ${iso}`}
                          value={entry.pauseMinutes}
                          onChange={(event) =>
                            update(iso, { pauseMinutes: Math.max(0, Number(event.target.value) || 0) })
                          }
                          className={cn(inputCls, "w-20")}
                        />
                        {warning && <p className="mt-1 text-[10px] font-medium text-rose-600">{warning}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {worked !== null ? (
                          <span className={cn("font-semibold", worked >= 8 ? "text-emerald-600" : "text-slate-700")}>
                            {formatNumber(worked, 1)} h
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {entry.tasks.map((task) => (
                            <span
                              key={task.id}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                            >
                              {task.text}
                              <button
                                aria-label="Aufgabe entfernen"
                                className="text-slate-400 hover:text-rose-500"
                                onClick={() => removeTask(iso, task.id)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <input
                            aria-label={`Neue Aufgabe ${iso}`}
                            value={taskDrafts[iso] ?? ""}
                            placeholder="+ Aufgabe…"
                            onChange={(event) =>
                              setTaskDrafts((prev) => ({ ...prev, [iso]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addTask(iso);
                              }
                            }}
                            className="min-w-[120px] flex-1 rounded-lg border border-dashed border-slate-200 px-2 py-1 text-[11px] focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          className="text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-brand-500 hover:underline"
                          onClick={() => onRequestAbsence(memberId, iso)}
                        >
                          Urlaub eintragen
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bilan hebdomadaire */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <span>
          Σ Stunden:{" "}
          <strong className="text-slate-900">
            {totals.hours !== null ? `${formatNumber(totals.hours, 1)} h` : "—"}
          </strong>{" "}
          von {WEEK_TARGET_HOURS} h Soll
          {totals.restHours !== null && (
            <span className={cn("ml-1", totals.restHours > 0 ? "text-amber-600" : "text-emerald-600")}>
              ({totals.restHours > 0
                ? `${formatNumber(totals.restHours, 1)} h offen`
                : `${formatNumber(-totals.restHours, 1)} h Überstunden`})
            </span>
          )}
        </span>
        <span>Tätigkeiten: <strong className="text-slate-900">{totals.tasksCount}</strong></span>
        <span>Erfasste Tage: <strong className="text-slate-900">{totals.daysLogged}</strong> / 7</span>
        {absenceCount > 0 && (
          <span>Abwesenheiten: <strong className="text-slate-900">{absenceCount}</strong> Tag(e)</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
          <Icon name="check" size={12} /> Lokal + Sync Büro (best effort)
        </span>
      </div>
    </Card>
  );
}
