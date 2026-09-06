import { useEffect, useRef } from "react";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, sourceStatusMeta } from "@/components/ui";
import { formatNumber, relativeTime } from "@/lib/format";
import type { SyncLogEntry } from "@/data/types";

const LEVEL_STYLE: Record<SyncLogEntry["level"], string> = {
  info: "text-slate-400",
  success: "text-emerald-400",
  warn: "text-brand-300",
  error: "text-rose-400",
};
const LEVEL_DOT: Record<SyncLogEntry["level"], string> = {
  info: "bg-slate-500", success: "bg-emerald-500", warn: "bg-brand-400", error: "bg-rose-500",
};

export default function Synchronization() {
  const { sync, runSync, sources, retrySource } = useApp();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [sync.log]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Synchronisierung"
        subtitle="Abgleich der Baudatenquellen — ehrlich, ohne Theater"
        actions={
          <Button icon="refresh" onClick={() => void runSync()} disabled={sync.running}>
            {sync.running ? "Abgleich…" : "Abgleich starten"}
          </Button>
        }
      />

      {/* progress */}
      <Card className="overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="flex items-center gap-2">
              {sync.running ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
                </span>
              ) : (
                <Icon name={sync.lastRun ? "check" : "clock"} size={16} className={sync.lastRun ? "text-emerald-500" : "text-slate-400"} />
              )}
              <span className="text-sm font-semibold text-slate-700">{sync.phase}</span>
            </div>
            <div className="mt-3">
              <ProgressBar value={sync.progress} color="#f59e0b" className="h-2.5" />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {sync.running ? "Abgleich läuft — Fenster nicht schließen." : sync.lastRun ? `Letzter Lauf ${relativeTime(sync.lastRun)}` : "Noch kein Lauf."}
            </p>
          </div>
          <div className="text-center">
            <div className="font-display text-5xl font-bold text-slate-900">{sync.progress}%</div>
            <div className="text-xs text-slate-400">Fortschritt</div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
          <Metric label="Einträge" value={formatNumber(sync.records)} icon="database" />
          <Metric label="Konflikte erkannt" value={formatNumber(sync.conflicts)} icon="alert" />
          <Metric label="Konflikte gelöst" value={formatNumber(sync.resolved)} icon="check" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* console */}
        <Card className="lg:col-span-2">
          <CardHeader title="Live-Protokoll" subtitle="Deterministische Abgleich-Pipeline" action={<Badge tone={sync.running ? "amber" : "slate"} dot>{sync.running ? "Live" : "Bereit"}</Badge>} />
          <div ref={logRef} className="scroll-thin max-h-[360px] overflow-y-auto bg-ink-950 p-4 font-mono text-[12.5px] leading-relaxed">
            {sync.log.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-slate-500">
                <Icon name="pulse" size={22} className="text-slate-600" />
                <p>Keine Einträge. Synchronisation starten, um den Verlauf zu sehen.</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {sync.log.map((l) => (
                  <li key={l.id} className="flex items-start gap-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[l.level]}`} />
                    <span className="shrink-0 text-slate-600">{new Date(l.ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
                    <span className="shrink-0 text-cyan-400">[{l.phase.slice(0, 16)}]</span>
                    <span className={LEVEL_STYLE[l.level]}>{l.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* sources */}
        <Card>
          <CardHeader title="Angeschlossene Quellen" subtitle="Leer = keine Demo-Cloud" />
          {sources.length === 0 && (
            <p className="px-4 pb-4 text-sm text-slate-500">Keine Fremdquelle. Abgleich betrifft lokale Spiegel — kein erfundener Destatis-Feed hier.</p>
          )}
          <ul className="divide-y divide-slate-100">
            {sources.map((s) => {
              const meta = sourceStatusMeta(s.status);
              return (
                <li key={s.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.kind} · {formatNumber(s.records)} enr.</p>
                    </div>
                    <Badge tone={meta.tone} dot>{meta.label}</Badge>
                  </div>
                  <div className="mt-2.5"><ProgressBar value={s.health} color={s.status === "error" ? "#f43f5e" : "#34d399"} /></div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{relativeTime(s.lastSync)}</span>
                    {s.status === "error" ? (
                      <button onClick={() => retrySource(s.id)} className="font-semibold text-brand-600 hover:text-brand-700">Erneut verbinden</button>
                    ) : (
                      <span className={s.delta > 0 ? "font-semibold text-emerald-600" : ""}>{s.delta > 0 ? `+${s.delta}` : "aktuell"}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon name={icon} size={18} /></span>
      <div>
        <div className="font-display text-lg font-bold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}
