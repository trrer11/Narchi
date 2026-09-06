import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Icon,
  PageHeader,
  SegmentedControl,
  complianceStatusMeta,
  severityMeta,
} from "@/components/ui";
import { RadialGauge } from "@/components/charts";
import { formatNumber } from "@/lib/format";
import type { ComplianceRule } from "@/data/types";

type StatusFilter = "all" | "pass" | "warn" | "fail";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportReport(rules: ComplianceRule[]) {
  const header = ["Regel", "Bereich", "Schwere", "Status", "Soll", "Ist", "Betroffene Bauteile", "Beschreibung"];
  const lines = [header.join(","), ...rules.map((r) =>
    [r.name, r.domain, r.severity, r.status, r.target, r.actual, r.affected, r.description].map(csvEscape).join(",")
  )];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "narchi-konformitaet.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Compliance() {
  const { compliance } = useApp();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [domain, setDomain] = useState("all");

  const domains = useMemo(() => Array.from(new Set(compliance.map((c) => c.domain))), [compliance]);

  const pass = compliance.filter((c) => c.status === "pass").length;
  const warn = compliance.filter((c) => c.status === "warn").length;
  const fail = compliance.filter((c) => c.status === "fail").length;
  const score = compliance.length ? Math.round((pass / compliance.length) * 100) : 0;

  const filtered = compliance.filter((c) => (status === "all" || c.status === status) && (domain === "all" || c.domain === domain));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konformität"
        subtitle="Nur gespeicherte Regeln — kein 100 %-Score ohne Prüfung. Planprüfung/Qualität messen das IFC."
        actions={<Button variant="secondary" size="sm" icon="download" disabled={compliance.length === 0} onClick={() => exportReport(compliance)}>Bericht exportieren</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center gap-3 p-6">
          <RadialGauge value={score} size={150} label={compliance.length ? "konform" : "n.a."} color={compliance.length ? (score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : "#f43f5e") : "#94a3b8"} />
          <p className="text-center text-sm text-slate-500">{compliance.length ? "Gesamtscore (nur hinterlegte Regeln)" : "Keine Regeln — Score nicht erfunden"}</p>
        </Card>
        <Card className="p-6 lg:col-span-2">
          <CardHeader title="Übersicht nach Status" />
          <div className="grid grid-cols-3 gap-4 p-2">
            <StatusTile label="Konform" value={pass} total={compliance.length} color="#34d399" icon="check" />
            <StatusTile label="Prüfen" value={warn} total={compliance.length} color="#f59e0b" icon="alert" />
            <StatusTile label="Nicht konform" value={fail} total={compliance.length} color="#f43f5e" icon="x" />
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Alle" },
            { value: "pass", label: "Konform" },
            { value: "warn", label: "Prüfen" },
            { value: "fail", label: "Fehler" },
          ]}
        />
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
        >
          <option value="all">Alle Bereiche</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {compliance.length === 0 && (
        <Card className="p-8 text-center text-sm text-slate-600">
          Keine Konformitätsregeln im Speicher. Das ist kein « alles konform ».
          Clash und IDS stehen unter Planprüfung / Qualität (gemessen am IFC).
        </Card>
      )}
      <div className="space-y-3">
        {filtered.map((r) => {
          const sm = complianceStatusMeta(r.status);
          const sev = severityMeta(r.severity);
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="h-full w-1 shrink-0 self-stretch rounded-full" style={{ background: sm.color }} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display font-semibold text-slate-900">{r.name}</h3>
                    <Badge tone={sev.tone}>{sev.label}</Badge>
                    <Badge tone="slate">{r.domain}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{r.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-5 sm:flex-col sm:items-end sm:gap-1">
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Soll</div>
                    <div className="text-sm font-semibold text-slate-700">{r.target}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Réel</div>
                    <div className={`text-sm font-bold ${r.status === "fail" ? "text-rose-600" : r.status === "warn" ? "text-brand-600" : "text-emerald-600"}`}>{r.actual}</div>
                  </div>
                  <Badge tone={sm.tone} dot>{sm.label}</Badge>
                </div>
              </div>
              {r.affected > 0 && (
                <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-xs text-slate-500">
                  <Icon name="cube" size={14} /> {formatNumber(r.affected)} Bauteil(e) betroffen
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatusTile({ label, value, total, color, icon }: { label: string; value: number; total: number; color: string; icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4 text-center">
      <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: color + "22", color }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="font-display text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(value / total) * 100}%`, background: color }} /></div></div>
    </div>
  );
}
