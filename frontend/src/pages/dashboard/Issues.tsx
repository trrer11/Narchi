import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { NMC_GROUPS } from "@/data/classification";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Icon,
  PageHeader,
  SegmentedControl,
} from "@/components/ui";
import type { IssueSeverity, IssueStatus } from "@/data/types";
import { cn } from "@/utils/cn";

const SEV: Record<IssueSeverity, { label: string; tone: "rose" | "amber" | "slate"; color: string }> = {
  critical: { label: "Kritisch", tone: "rose", color: "#f43f5e" },
  major: { label: "Schwer", tone: "amber", color: "#f59e0b" },
  minor: { label: "Gering", tone: "slate", color: "#94a3b8" },
};
const ST: Record<IssueStatus, { label: string; tone: "rose" | "amber" | "emerald" }> = {
  open: { label: "Offen", tone: "rose" },
  "in-review": { label: "In Prüfung", tone: "amber" },
  resolved: { label: "Erledigt", tone: "emerald" },
};

export default function Issues() {
  const { activeIssues, setIssueStatus, activeProject, projects, setActiveProjectId } = useApp();
  const [filter, setFilter] = useState<"all" | IssueStatus>("all");

  const counts = useMemo(() => ({
    open: activeIssues.filter((i) => i.status === "open").length,
    review: activeIssues.filter((i) => i.status === "in-review").length,
    resolved: activeIssues.filter((i) => i.status === "resolved").length,
    critical: activeIssues.filter((i) => i.severity === "critical").length,
  }), [activeIssues]);

  const filtered = activeIssues.filter((i) => filter === "all" || i.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mängel & Vorbehalte"
        subtitle={`Koordination und Klärung — ${activeProject.name}`}
        actions={
          <select
            value={activeProject.id}
            onChange={(e) => setActiveProjectId(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Mini label="Offen" value={String(counts.open)} icon="flag" tone="rose" />
        <Mini label="In Prüfung" value={String(counts.review)} icon="clock" tone="amber" />
        <Mini label="Erledigt" value={String(counts.resolved)} icon="check" tone="emerald" />
        <Mini label="Kritisch" value={String(counts.critical)} icon="alert" tone="violet" />
      </div>

      <div className="flex items-center justify-between">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as "all" | IssueStatus)}
          options={[
            { value: "all", label: "Alle" },
            { value: "open", label: "Offen" },
            { value: "in-review", label: "In Prüfung" },
            { value: "resolved", label: "Erledigt" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"><Icon name="check" size={26} /></div>
          <p className="font-semibold text-slate-700">Keine Mängel in dieser Kategorie</p>
          <p className="text-sm text-slate-400">Für diesen Filter ist nichts offen.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((issue) => {
            const sev = SEV[issue.severity];
            const st = ST[issue.status];
            const groupLabel = NMC_GROUPS.find((g) => g.code === issue.classificationCode.split("-").slice(0, 2).join("-"))?.label ?? issue.classificationCode;
            return (
              <Card key={issue.id} className="overflow-hidden">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                  <div className="h-full w-1 shrink-0 self-stretch rounded-full sm:self-auto" style={{ background: sev.color }} />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400">{issue.id.toUpperCase()}</span>
                      <Badge tone={sev.tone}>{sev.label}</Badge>
                      <Badge tone="slate">{groupLabel}</Badge>
                      <Badge tone="slate">{issue.level}</Badge>
                    </div>
                    <h3 className="mt-2 font-display font-semibold text-slate-900">{issue.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">{issue.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Icon name="users" size={13} /> Resp. {issue.assignee}</span>
                      <span className="flex items-center gap-1"><Icon name="calendar" size={13} /> Gemeldet Tag {issue.raisedDay}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-44">
                    <Badge tone={st.tone} dot className="self-center">{st.label}</Badge>
                    <div className="flex flex-col gap-1.5">
                      {(["open", "in-review", "resolved"] as IssueStatus[]).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={issue.status === s ? "primary" : "secondary"}
                          disabled={issue.status === s}
                          onClick={() => setIssueStatus(issue.id, s)}
                          className={cn("justify-center")}
                        >
                          {ST[s].label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader title="Projektrisiken" subtitle="Matrix Eintrittswahrscheinlichkeit × Auswirkung" />
        <div className="p-5">
          <RiskMatrix />
        </div>
      </Card>
    </div>
  );
}

function Mini({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "rose" | "amber" | "emerald" | "violet" }) {
  const c = { rose: "bg-rose-50 text-rose-600", amber: "bg-brand-50 text-brand-600", emerald: "bg-emerald-50 text-emerald-600", violet: "bg-violet-50 text-violet-600" }[tone];
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

function RiskMatrix() {
  const { risks } = useApp();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2 sm:grid-cols-[auto_repeat(5,1fr)]">
        <div />
        {[1, 2, 3, 4, 5].map((imp) => (
          <div key={imp} className="pb-1 text-center text-[10px] font-semibold text-slate-400">Auswirkung {imp}</div>
        ))}
        {[5, 4, 3, 2, 1].map((lik) => (
          <RiskRow key={lik} likelihood={lik} risks={risks} />
        ))}
        <div />
        <div className="col-span-5 hidden text-center text-[10px] font-semibold text-slate-400 sm:block">Wahrscheinlichkeit ↓</div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {risks.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-3">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: riskColor(r.likelihood, r.impact) }} />
            <div>
              <p className="text-sm font-semibold text-slate-800">{r.title}</p>
              <p className="text-xs text-slate-500">{r.mitigation}</p>
              <p className="mt-1 text-[11px] text-slate-400">Kategorie {r.category} · Verantw. {r.owner}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function riskColor(lik: number, imp: number): string {
  const score = lik * imp;
  if (score >= 16) return "#f43f5e";
  if (score >= 9) return "#f59e0b";
  if (score >= 4) return "#fbbf24";
  return "#34d399";
}

function RiskRow({ likelihood, risks }: { likelihood: number; risks: ReturnType<typeof useApp>["risks"] }) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[10px] font-semibold text-slate-400">L{likelihood}</div>
      {[1, 2, 3, 4, 5].map((imp) => {
        const here = risks.filter((r) => r.likelihood === likelihood && r.impact === imp);
        return (
          <div
            key={imp}
            className="relative flex aspect-square items-center justify-center rounded-lg border border-slate-100"
            style={{ background: riskColor(likelihood, imp) + "22" }}
          >
            {here.length > 0 && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow" style={{ background: riskColor(likelihood, imp) }}>
                {here.length}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
