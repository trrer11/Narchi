import { useEffect, useState } from "react";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, SegmentedControl } from "@/components/ui";
import { NMC_GROUPS } from "@/data/classification";
import type { ScheduleTask, TaskStatus } from "@/data/types";
import { cn } from "@/utils/cn";
import { EmptyProjectState } from "@/components/EmptyProjectState";

const STATUS_META: Record<TaskStatus, { label: string; tone: "emerald" | "amber" | "slate" | "rose"; color: string }> = {
  completed: { label: "Erledigt", tone: "emerald", color: "#10b981" },
  "in-progress": { label: "Laufend", tone: "amber", color: "#f59e0b" },
  upcoming: { label: "Geplant", tone: "slate", color: "#94a3b8" },
  delayed: { label: "Verzögert", tone: "rose", color: "#f43f5e" },
};

const PHASE_COLOR: Record<string, string> = {
  Enabling: "#94a3b8",
  Substructure: "#a78bfa",
  Superstructure: "#f59e0b",
  Envelope: "#22d3ee",
  Services: "#34d399",
  Interiors: "#fb7185",
  Handover: "#38bdf8",
};

const groupColorOf = (code: string) => PHASE_COLOR[NMC_GROUPS.find((g) => g.code === code.split("-").slice(0, 2).join("-"))?.label ?? ""] ?? "#cbd5e1";

export default function Schedule() {
  const { schedule, milestones } = useApp();

  // AXE 1 : sans donnees de planification, etat vide + CTA (pas de Gantt casse).
  if (schedule.length === 0) {
    return (
      <EmptyProjectState
        title="Noch kein Bauablauf"
        subtitle="HOAI-Phasen und Fortschritt brauchen ein Projekt mit Terminen — nichts wird erfunden."
      />
    );
  }
  const [playing, setPlaying] = useState(false);
  const [day, setDay] = useState(186);
  const [phaseFilter, setPhaseFilter] = useState<"all" | TaskStatus>("all");

  const totalDays = Math.max(...schedule.map((t) => t.startDay + t.duration), milestones.at(-1)?.day ?? 340);

  // play/pause animation
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setDay((d) => {
        if (d >= totalDays) { setPlaying(false); return totalDays; }
        return Math.min(totalDays, d + 4);
      });
    }, 80);
    return () => clearInterval(id);
  }, [playing, totalDays]);

  const tasks = schedule.filter((t) => phaseFilter === "all" || t.status === phaseFilter);
  const phases = Array.from(new Set(schedule.map((t) => t.phase)));

  const completed = schedule.filter((t) => t.status === "completed").length;
  const inProgress = schedule.filter((t) => t.status === "in-progress").length;
  const delayed = schedule.filter((t) => t.status === "delayed").length;

  const visibleTasks = tasks.filter((t) => t.startDay <= day);

  const dayLabel = (d: number) => {
    const base = new Date(2025, 2, 1);
    base.setDate(base.getDate() + d);
    return base.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bauablauf 4D"
        subtitle="Baufolge am Modell — zeitliche Simulation, keine erfundenen Termine"
        actions={
          <Button size="sm" variant={playing ? "danger" : "primary"} icon={playing ? "x" : "bolt"} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Stopp" : "Simulieren"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini label="Vorgänge" value={String(schedule.length)} icon="calendar" tone="cyan" />
        <Mini label="Erledigt" value={String(completed)} icon="check" tone="emerald" />
        <Mini label="Laufend" value={String(inProgress)} icon="bolt" tone="amber" />
        <Mini label="Verzögert" value={String(delayed)} icon="alert" tone="rose" />
      </div>

      {/* timeline scrubber */}
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="clock" size={16} className="text-brand-500" />
              <span className="font-display font-semibold text-slate-900">Zeitcursor</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">Tag {day} / {totalDays} · <span className="font-medium text-slate-700">{dayLabel(day)}</span></p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDay(0)}>Start</Button>
            <Button size="sm" variant="secondary" onClick={() => setDay(totalDays)}>Ende</Button>
            <Button size="sm" variant="secondary" onClick={() => setDay(186)}>Heute</Button>
          </div>
        </div>
        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={totalDays}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="narchi-range w-full"
          />
        </div>
      </Card>

      {/* Gantt */}
      <Card>
        <CardHeader
          title="Gantt-Diagramm"
          subtitle="Vorgänge nach Phase gefärbt; graue Linie = Zeitcursor"
          action={
            <SegmentedControl
              value={phaseFilter}
              onChange={(v) => setPhaseFilter(v as "all" | TaskStatus)}
              options={[
                { value: "all", label: "Alle" },
                { value: "in-progress", label: "Laufend" },
                { value: "upcoming", label: "Geplant" },
                { value: "delayed", label: "Verzug" },
              ]}
            />
          }
        />
        <div className="overflow-x-auto p-4">
          <div className="min-w-[820px]">
            {/* phase legend */}
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {phases.map((p) => (
                <span key={p} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[p] ?? "#cbd5e1" }} />
                  {p}
                </span>
              ))}
            </div>

            {/* grid header */}
            <div className="relative">
              <div className="mb-2 flex justify-between border-b border-slate-100 pb-1 text-[10px] font-medium text-slate-400">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => (
                  <span key={f}>J{Math.round(totalDays * f)}</span>
                ))}
              </div>

              <div className="relative">
                {/* vertical playhead */}
                <div className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: `${(day / totalDays) * 100}%` }}>
                  <div className="h-full w-px bg-ink-950/40" />
                </div>

                <ul className="space-y-2">
                  {tasks.map((t) => {
                    const meta = STATUS_META[t.status];
                    const left = (t.startDay / totalDays) * 100;
                    const width = (t.duration / totalDays) * 100;
                    const isFuture = t.startDay > day;
                    const isStarted = t.startDay <= day;
                    return (
                      <li key={t.id} className="flex items-center gap-3">
                        <div className="w-48 shrink-0">
                          <div className="truncate text-xs font-semibold text-slate-800">{t.name}</div>
                          <div className="text-[10px] text-slate-400">{t.level} · {t.responsible}</div>
                        </div>
                        <div className="relative h-8 flex-1 rounded-md bg-slate-50">
                          <div
                            className={cn(
                              "absolute top-1 h-6 overflow-hidden rounded-md transition-all duration-300",
                              isFuture ? "opacity-30" : "opacity-100"
                            )}
                            style={{ left: `${left}%`, width: `${Math.max(width, 2)}%`, background: groupColorOf(t.classificationCode) + "33", border: `1px solid ${groupColorOf(t.classificationCode)}` }}
                          >
                            {/* progress fill */}
                            <div
                              className="h-full rounded-md"
                              style={{
                                width: `${t.progress}%`,
                                background: groupColorOf(t.classificationCode),
                                opacity: isStarted ? 1 : 0.4,
                              }}
                            />
                          </div>
                          {/* status pip */}
                          <div
                            className="absolute top-1.5 h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white shadow"
                            style={{ left: `${left}%`, background: meta.color }}
                          />
                        </div>
                        <div className="w-20 shrink-0 text-right">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* milestones */}
                <div className="relative mt-4 border-t border-dashed border-slate-200 pt-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Meilensteine</div>
                  {milestones.map((m) => (
                    <div
                      key={m.id}
                      className="absolute -translate-x-1/2"
                      style={{ left: `${(m.day / totalDays) * 100}%`, top: 0 }}
                      title={`${m.name} — Tag ${m.day}`}
                    >
                      <div className={cn("flex flex-col items-center", m.day > day && "opacity-40")}>
                        <Icon name="flag" size={14} className={m.reached ? "text-emerald-500" : m.day <= day ? "text-brand-500" : "text-slate-400"} />
                        <span className="mt-1 w-16 text-center text-[9px] leading-tight text-slate-500">{m.name}</span>
                      </div>
                    </div>
                  ))}
                  <div className="h-12" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* task table */}
      <Card>
        <CardHeader title="Vorgänge im Detail" subtitle={`${visibleTasks.length} Vorgang/Vorgänge am Cursor`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Tâche</th>
                <th className="px-4 py-3 text-left">Phase</th>
                <th className="px-4 py-3 text-left">Niveau</th>
                <th className="px-4 py-3 text-left">Responsable</th>
                <th className="px-4 py-3 text-right">Durée</th>
                <th className="px-4 py-3 text-right">Progression</th>
                <th className="px-4 py-3 text-right">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleTasks.map((t: ScheduleTask) => {
                const meta = STATUS_META[t.status];
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{t.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: PHASE_COLOR[t.phase] }} />
                        {t.phase}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.level}</td>
                    <td className="px-4 py-3 text-slate-600">{t.responsible}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{t.duration} j</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20"><ProgressBar value={t.progress} color={meta.color} /></div>
                        <span className="w-9 text-right text-xs tabular-nums text-slate-500">{t.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Mini({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "cyan" | "emerald" | "amber" | "rose" }) {
  const c = { cyan: "bg-cyan-50 text-cyan-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-brand-50 text-brand-600", rose: "bg-rose-50 text-rose-600" }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c)}><Icon name={icon} size={20} /></span>
      <div>
        <div className="font-display text-lg font-bold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}
