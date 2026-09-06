import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { Badge, Button, Card, CardHeader, Icon, IconButton, PageHeader } from "@/components/ui";
import ArbeitszeitBoard from "@/components/ArbeitszeitBoard";
import {
  TYPE_META,
  addAssignment,
  addDays,
  ensureSeedSchedule,
  listSchedule,
  removeAssignment,
  startOfWeek,
  toISODate,
  type Assignment,
  type AssignmentType,
} from "@/lib/scheduling";
import { formatNumber } from "@/lib/format";
import { cn } from "@/utils/cn";

const DE_DAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface DialogSeed {
  userId?: string;
  start?: string;
  type?: AssignmentType;
}

export default function Kalender() {
  const { user, users } = useAuth();
  const { projects, activeProject } = useApp();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [schedule, setSchedule] = useState<Assignment[]>(() => ensureSeedSchedule());
  const [open, setOpen] = useState(false);
  const [dialogSeed, setDialogSeed] = useState<DialogSeed | null>(null);
  // Deux espaces : la planification d'équipe (existante) et le calendrier
  // personnel de chaque membre (heures + tâches du jour).
  const [tab, setTab] = useState<"team" | "arbeitstag">("team");
  const [, force] = useState(0);

  const refresh = () => { setSchedule(listSchedule()); force((n) => n + 1); };

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const teamMembers = users.filter((u) => u.role === "architect" || u.role === "owner");

  const assignmentsByUser = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of schedule) {
      const arr = map.get(a.userId) ?? [];
      arr.push(a);
      map.set(a.userId, arr);
    }
    return map;
  }, [schedule]);

  const stats = useMemo(() => {
    const weekEnd = toISODate(addDays(weekStart, 6));
    const weekStartISO = toISODate(weekStart);
    const inWeek = schedule.filter((a) => !(a.end < weekStartISO || a.start > weekEnd));
    const hours = inWeek.reduce((s, a) => s + a.hours, 0);
    const onLeave = inWeek.filter((a) => a.type === "urlaub" || a.type === "krank").length;
    return { count: inWeek.length, hours, onLeave };
  }, [schedule, weekStart]);

  const todayISO = toISODate(new Date());
  const weekLabel = `${weekStart.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – ${addDays(weekStart, 6).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ressourcenplanung"
        subtitle="Nur echte Einsätze — kein Demo-Kalender. Leer heißt: noch nichts geplant."
        actions={<Button icon="calendar" onClick={() => { setDialogSeed(null); setOpen(true); }}>Zuweisung</Button>}
      />

      {/* Deux espaces : planification d'équipe ⟷ calendrier personnel */}
      <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-1.5">
        {([["team", "Team-Planung"], ["arbeitstag", "Arbeitszeit & Tagesbericht"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition",
              tab === key ? "bg-ink-900 text-white shadow" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "team" && (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Team-Mitglieder" value={String(teamMembers.length)} icon="users" tone="cyan" />
        <Stat label="Einsätze (Woche)" value={String(stats.count)} icon="calendar" tone="amber" />
        <Stat label="Geplante Stunden" value={formatNumber(stats.hours)} icon="clock" tone="emerald" />
        <Stat label="Abwesend" value={String(stats.onLeave)} icon="pin" tone="violet" />
      </div>
      )}

      {/* week navigator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconButton icon="chevronLeft" label="Vorherige" onClick={() => setWeekStart(addDays(weekStart, -7))} />
          <span className="font-display font-semibold text-slate-900">{weekLabel}</span>
          <IconButton icon="chevronRight" label="Nächste" onClick={() => setWeekStart(addDays(weekStart, 7))} />
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>Heute</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(TYPE_META).slice(0, 6).map(([key, m]) => (
            <span key={key} className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: m.color }} />{m.label}</span>
          ))}
        </div>
      </div>

      {tab === "arbeitstag" && (
        <ArbeitszeitBoard
          members={teamMembers}
          defaultMemberId={user?.id}
          weekStart={weekStart}
          schedule={schedule}
          onRequestAbsence={(memberId, dateISO) => {
            setDialogSeed({ userId: memberId, start: dateISO, type: "urlaub" });
            setOpen(true);
          }}
        />
      )}

      {/* calendar grid */}
      {tab === "team" && (
      <>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* header row */}
            <div className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-slate-200 bg-slate-50">
              <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Mitarbeiter</div>
              {weekDays.map((d, i) => {
                const iso = toISODate(d);
                const isToday = iso === todayISO;
                return (
                  <div key={iso} className="border-l border-slate-200 px-3 py-2 text-center">
                    <div className="text-[11px] font-medium text-slate-400">{DE_DAYS_SHORT[i]}</div>
                    <div className={cn("font-display text-lg font-bold", isToday ? "text-brand-600" : "text-slate-700")}>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>

            {/* member rows */}
            {teamMembers.map((member) => {
              const asgs = assignmentsByUser.get(member.id) ?? [];
              return (
                <div key={member.id} className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-brand-400">{member.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}</span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-700">{member.name}</p>
                      <p className="truncate text-[10px] text-slate-400">{member.role === "owner" ? "Inhaber" : "Architekt"}</p>
                    </div>
                  </div>
                  {weekDays.map((d) => {
                    const iso = toISODate(d);
                    const dayAsgs = asgs.filter((a) => a.start <= iso && a.end >= iso);
                    return (
                      <div key={iso} className="group relative min-h-[64px] border-l border-slate-100 p-1">
                        {dayAsgs.map((a) => {
                          const meta = TYPE_META[a.type];
                          return (
                            <div key={a.id} className="mb-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-white" style={{ background: meta.color }} title={`${meta.label} · ${a.projectName}`}>
                              <span className="truncate">{a.projectName.split(" ")[0]}</span>
                              <button onClick={() => { removeAssignment(a.id); refresh(); }} className="ml-auto hidden rounded p-0.5 hover:bg-black/20 group-hover:block">×</button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* legend / detail table */}
      <Card>
        <CardHeader title="Einsätze im Detail" subtitle={`${schedule.length} Zuweisung(en) gesamt`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Mitarbeiter</th>
                <th className="px-4 py-3 text-left">Projekt</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-left">Zeitraum</th>
                <th className="px-4 py-3 text-right">Stunden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedule.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">Keine Einsätze geplant — nichts erfunden.</td></tr>
              )}
              {schedule.slice().reverse().map((a) => {
                const meta = TYPE_META[a.type];
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-700">{a.userName}</td>
                    <td className="px-4 py-3 text-slate-600">{a.projectName}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: meta.color }} />{meta.label}</span></td>
                    <td className="px-4 py-3 text-slate-500">{new Date(a.start).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – {new Date(a.end).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{a.hours > 0 ? formatNumber(a.hours) + " h" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}

      {/* create dialog */}
      {open && (
        <CreateDialog
          members={teamMembers}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          initial={dialogSeed}
          onClose={() => setOpen(false)}
          onCreate={(a) => { addAssignment(a); refresh(); setOpen(false); }}
        />
      )}
    </div>
  );
}

function CreateDialog({ members, projects, initial, onClose, onCreate, defaultProjectId }: {
  members: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  initial?: DialogSeed | null;
  onClose: () => void;
  onCreate: (a: Omit<Assignment, "id">) => void;
}) {
  const [userId, setUserId] = useState(initial?.userId && members.some((m) => m.id === initial.userId) ? initial.userId : members[0]?.id ?? "");
  const [projectId, setProjectId] = useState(
    defaultProjectId && projects.some((p) => p.id === defaultProjectId)
      ? defaultProjectId
      : (projects[0]?.id ?? ""),
  );
  const [type, setType] = useState<AssignmentType>(initial?.type ?? "entwurf");
  const [start, setStart] = useState(initial?.start ?? toISODate(new Date()));
  const [end, setEnd] = useState(initial?.start ?? toISODate(addDays(new Date(), 2)));
  const [hours, setHours] = useState(16);
  const [note, setNote] = useState("");

  const member = members.find((m) => m.id === userId);
  const project = projects.find((p) => p.id === projectId);
  const isAbsence = type === "urlaub" || type === "krank";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    onCreate({
      userId,
      userName: member.name,
      projectId: isAbsence ? "—" : projectId,
      projectName: isAbsence ? "Abwesenheit" : project?.name ?? "—",
      type,
      start,
      end: end < start ? start : end,
      hours: isAbsence ? 0 : hours,
      note: note.trim() || undefined,
    });
  };

  const inputCls = "mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-lg p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-slate-900">Einsatz zuweisen</h3>
          <IconButton icon="x" onClick={onClose} label="Schließen" />
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-slate-500">Mitarbeiter</label><select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            <div><label className="text-xs font-semibold text-slate-500">Typ</label><select value={type} onChange={(e) => setType(e.target.value as AssignmentType)} className={inputCls}>{Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></div>
          </div>
          {!isAbsence && (
            <div><label className="text-xs font-semibold text-slate-500">Projekt</label><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-slate-500">Von</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} /></div>
            <div><label className="text-xs font-semibold text-slate-500">Bis</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} /></div>
          </div>
          {!isAbsence && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-500">Stunden</label><input type="number" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} className={inputCls} /></div>
              <div><label className="text-xs font-semibold text-slate-500">Notiz</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} /></div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button type="submit" icon="check">Zuweisen</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "cyan" | "emerald" | "amber" | "violet" }) {
  const c = { cyan: "bg-cyan-50 text-cyan-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-brand-50 text-brand-600", violet: "bg-violet-50 text-violet-600" }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c)}><Icon name={icon} size={20} /></span>
      <div><div className="font-display text-lg font-bold text-slate-900">{value}</div><div className="text-xs text-slate-500">{label}</div></div>
    </Card>
  );
}
void Badge;
