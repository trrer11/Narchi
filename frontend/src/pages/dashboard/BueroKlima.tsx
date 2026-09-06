import { useEffect, useState } from "react";
import { useAuth } from "@/store/AuthStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import {
  MOOD_META,
  MOOD_OPTIONS,
  checkIn,
  listCheckIns,
  subscribeMood,
  teamMoodTrend,
  teamSummary,
  todaysCheckIn,
  weekdayShortDE,
  type MoodLevel,
  type MoodCheckIn,
} from "@/lib/moodService";
import { bausuendeOfTheDay, jokeOfTheDay, quoteOfTheDay } from "@/lib/inspiration";
import { cn } from "@/utils/cn";

export default function BueroKlima() {
  const { user, users } = useAuth();
  const [level, setLevel] = useState<MoodLevel>(3);
  const [energy, setEnergy] = useState(60);
  const [stress, setStress] = useState(40);
  const [workload, setWorkload] = useState(55);
  const [note, setNote] = useState("");
  const [mine, setMine] = useState<MoodCheckIn | undefined>();
  const [allCheckIns, setAllCheckIns] = useState<MoodCheckIn[]>([]);
  const [, force] = useState(0);

  const refresh = async () => {
    if (!user) return;
    setMine(await todaysCheckIn(user.id));
    setAllCheckIns(await listCheckIns());
    force((n) => n + 1);
  };
  useEffect(() => {
    void refresh();
    const unsub = subscribeMood(() => void refresh());
    return unsub;
  }, [user]);

  if (!user) return null;

  const teamIds = users.map((u) => u.id);
  const [summary, setSummary] = useState<{ todayAvg: number | null; todayCount: number } | null>(null);
  const [trend, setTrend] = useState<{ date: string; avg: number | null; count: number }[]>([]);
  useEffect(() => {
    void (async () => {
      setSummary(await teamSummary(teamIds));
      setTrend(await teamMoodTrend(7));
    })();
  }, [allCheckIns, teamIds]);

  const submit = async () => {
    await checkIn({
      userId: user.id,
      userName: user.name,
      level,
      emoji: MOOD_META[level].emoji,
      energy, stress, workload,
      note: note.trim() || undefined,
    });
    setNote("");
    void refresh();
  };

  const joke = jokeOfTheDay();
  const quote = quoteOfTheDay();
  const suende = bausuendeOfTheDay();
  const todayAvg = summary?.todayAvg;
  const todayAvgLabel = todayAvg ? MOOD_META[Math.round(todayAvg) as MoodLevel] : null;
  const checkInRate = teamIds.length ? Math.round(((summary?.todayCount ?? 0) / teamIds.length) * 100) : 0;

  // latest check-in per user (today)
  const today = new Date().toISOString().slice(0, 10);
  const todayByUser = new Map<string, MoodCheckIn>();
  for (const c of allCheckIns) if (c.date === today && !todayByUser.has(c.userId)) todayByUser.set(c.userId, c);

  return (
    <div className="space-y-6">
      <PageHeader title="Büro-Klima" subtitle="Wie geht es dem Team heute? Stimmung, Energie & eine Prise Humor" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* check-in card */}
        <Card className="lg:col-span-2">
          <CardHeader title="Dein Stimmungs-Check-in" subtitle={mine ? "Heute schon eingetragen — jederzeit änderbar" : "Wie läuft dein Tag?"} />
          <div className="p-5">
            <div className="flex justify-between gap-2">
              {MOOD_OPTIONS.map((lvl) => {
                const meta = MOOD_META[lvl];
                const sel = (mine?.level ?? level) === lvl;
                return (
                  <button
                    key={lvl}
                    onClick={() => setLevel(lvl)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1.5 rounded-2xl border-2 p-3 transition-all",
                      sel ? "border-transparent text-ink-950 shadow-lg" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    )}
                    style={sel ? { background: meta.color } : undefined}
                  >
                    <span className="text-3xl">{meta.emoji}</span>
                    <span className={cn("text-[11px] font-semibold", sel ? "text-ink-950" : "text-slate-500")}>{meta.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Slider label="Energie" value={mine?.energy ?? energy} onChange={setEnergy} color="#22d3ee" icon="bolt" />
              <Slider label="Stress" value={mine?.stress ?? stress} onChange={setStress} color="#f43f5e" icon="pulse" />
              <Slider label="Auslastung" value={mine?.workload ?? workload} onChange={setWorkload} color="#f59e0b" icon="scale" />
            </div>

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mine ? "Tagesnotiz ergänzen…" : "Was läuft heute? (optional)"}
              className="mt-4 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            />
            <Button className="mt-3 w-full" icon="check" onClick={submit}>{mine ? "Aktualisieren" : "Eintragen"}</Button>
          </div>
        </Card>

        {/* team mood */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-slate-900">Team heute</h3>
            <Badge tone={checkInRate >= 50 ? "emerald" : "amber"}>{checkInRate}% dabei</Badge>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-4xl">{todayAvgLabel ? todayAvgLabel.emoji : "🤔"}</span>
            <div>
              <div className="font-display text-lg font-bold text-slate-900">{todayAvg ? todayAvg.toFixed(1) : "—"} <span className="text-sm font-normal text-slate-400">/ 5</span></div>
              <div className="text-xs text-slate-500">{summary?.todayCount ?? 0} von {teamIds.length} haben eingetragen</div>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-cyan-50 p-3 text-[11px] text-cyan-700">
            <Icon name="shield" size={13} className="mr-1 inline" /> SharedStore-Datenbank — alle Check-ins sind teamweit sichtbar.
          </div>
        </Card>
      </div>

      {/* team mood trend chart */}
      <Card>
        <CardHeader title="Stimmungs-Trend (7 Tage)" subtitle="Team-Durchschnitt — je höher, desto besser" />
        <div className="p-5">
          <div className="flex items-end justify-between gap-2" style={{ height: 180 }}>
            {trend.map((d) => {
              const pct = d.avg ? (d.avg / 5) * 100 : 0;
              const color = d.avg ? MOOD_META[Math.round(d.avg) as MoodLevel].color : "#e2e8f0";
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[11px] font-semibold text-slate-400">{d.avg ? d.avg.toFixed(1) : "—"}</span>
                  <div className="flex w-full max-w-[42px] items-end justify-center" style={{ height: 130 }}>
                    <div className="w-full rounded-t-md transition-all duration-500" style={{ height: `${Math.max(pct, 4)}%`, background: color, opacity: d.avg ? 1 : 0.4 }} title={d.avg ? `Ø ${d.avg.toFixed(1)} (${d.count})` : "Keine Daten"} />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">{weekdayShortDE(d.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* team check-ins today */}
      <Card>
        <CardHeader title="Wer ist heute dabei?" subtitle={`${summary?.todayCount ?? 0} Eintrag/Beiträge heute`} />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => {
            const ci = todayByUser.get(u.id);
            return (
              <div key={u.id} className={cn("flex items-center gap-3 rounded-xl border p-3", ci ? "border-slate-200 bg-white" : "border-dashed border-slate-200 bg-slate-50/50")}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-brand-400">{u.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{u.name}{u.id === user.id && " (du)"}</p>
                  <p className="text-xs text-slate-400">{ci ? MOOD_META[ci.level].label : "Noch nicht"}</p>
                  {ci?.note && <p className="truncate text-[11px] italic text-slate-500">„{ci.note}"</p>}
                </div>
                {ci && <span className="text-2xl">{ci.emoji}</span>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* humor row */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col p-5">
          <Badge tone="amber">Witz des Tages 😄</Badge>
          <div className="mt-3 flex-1">
            <p className="font-medium text-slate-700">{joke.setup}</p>
            <p className="mt-2 font-display text-base font-bold text-slate-900">{joke.punchline}</p>
          </div>
        </Card>
        <Card className="flex flex-col p-5">
          <Badge tone="rose">Bausünde des Tages 🙈</Badge>
          <div className="mt-3 flex-1">
            <p className="flex items-center gap-2 font-display text-base font-bold text-slate-900"><span className="text-2xl">{suende.emoji}</span>{suende.title}</p>
            <p className="mt-2 text-sm text-slate-500">{suende.desc}</p>
          </div>
        </Card>
        <Card className="flex flex-col p-5">
          <Badge tone="cyan">Zitat des Tages 💡</Badge>
          <div className="mt-3 flex flex-1 flex-col justify-center">
            <p className="font-display text-base font-semibold italic leading-relaxed text-slate-800">„{quote.text}"</p>
            <p className="mt-2 text-sm font-medium text-slate-400">— {quote.author}</p>
          </div>
        </Card>
      </div>

      <p className="text-center text-xs text-slate-400">
        <Icon name="spark" size={12} className="mr-1 inline" />
        Ein Büro, das lacht, plant besser. Stimmung ist Daten — und Narchi nimmt sie ernst.
      </p>
    </div>
  );
}

function Slider({ label, value, onChange, color, icon }: {
  label: string; value: number; onChange: (v: number) => void; color: string; icon: Parameters<typeof Icon>[0]["name"];
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-semibold text-slate-500"><Icon name={icon} size={13} /> {label}</span>
        <span className="font-bold tabular-nums text-slate-700">{value}%</span>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="narchi-range w-full" style={{ accentColor: color }} />
    </div>
  );
}
