import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/store/AppStore";
import { NMC_GROUPS } from "@/data/classification";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, StatCard } from "@/components/ui";
import { BarChart, DonutChart, Legend, RadialGauge } from "@/components/charts";
import { IsometricBuilding } from "@/components/IsometricBuilding";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { formatCarbon, formatMoney, formatNumber, relativeTime } from "@/lib/format";
import { fmtMoney, fmtNumber as fmtNumDE } from "@/lib/costEngine";
import { savedToday, bausuendeOfTheDay, LIABILITY_RISKS, SEVERITY_META } from "@/lib/inspiration";
import { buildCarbonCockpit, carbonBudgetAlerts, projectCarbonSummaries } from "@/lib/carbonCockpit";
import { getKlimaTotals, reachedMilestones } from "@/lib/klimaErfolg";
import { generateKlimaBerichtPdf } from "@/lib/klimaBericht";
import { loadImageDims, type PdfBranding } from "@/lib/reportEngine";
import { fetchBranding } from "@/lib/branding";
import { matchMaterials } from "@/lib/materialMatch";
import { buildVEOpportunities, takeoffVolumeM3BySubstitution, VERDICT_META } from "@/lib/veEngine";
import { cn } from "@/utils/cn";
import { EmptyProjectState } from "@/components/EmptyProjectState";
import { Leistungskette } from "@/components/Leistungskette";
import { AuditEngine } from "@/lib/AuditEngine";

const GROUP_COLORS: Record<string, string> = {
  "NMC-10": "#94a3b8", "NMC-20": "#a78bfa", "NMC-30": "#f59e0b",
  "NMC-40": "#22d3ee", "NMC-50": "#fb7185", "NMC-60": "#34d399",
};
const groupCodeOf = (code: string) => code.split("-").slice(0, 2).join("-");

const ACTIVITY_ICON: Record<string, { icon: Parameters<typeof Icon>[0]["name"]; tone: string }> = {
  sync: { icon: "refresh", tone: "bg-cyan-50 text-cyan-600" },
  create: { icon: "cube", tone: "bg-brand-50 text-brand-600" },
  validate: { icon: "check", tone: "bg-emerald-50 text-emerald-600" },
  alert: { icon: "alert", tone: "bg-rose-50 text-rose-600" },
  export: { icon: "download", tone: "bg-slate-100 text-slate-600" },
  carbon: { icon: "leaf", tone: "bg-emerald-50 text-emerald-600" },
};

export default function Overview() {
  const { kpis, projects, activeElements, elements, activity, compliance, sources, settings, activeProject, activeLevels, risks, activeIssues, navigate, costConfig, updateProject, addNotification, notifications } = useApp();
  const currency = settings.currency;
  // §167 — édition du budget carbone (ancre de toute la boucle budget/verdict).
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");

  // AXE 1 : premier lancement (store vierge) => etat vide accueillant + CTA,
  // jamais de tableaux de KPI a "0" qui font passer le produit pour casse.
  if (projects.length === 0 && activeElements.length === 0) {
    return (
      <div className="space-y-6">
        <OnboardingBanner />
        <EmptyProjectState
          title="Willkommen im NARCHI-Cockpit"
          subtitle="IFC ablegen oder unter Projekte ein Beispielprojekt (Demo) — Zahlen bleiben leer, nicht erfunden."
        />
      </div>
    );
  }

  const openIssues = activeIssues.filter((i) => i.status !== "resolved").length;
  const topRisks = useMemo(() => [...risks].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact).slice(0, 4), [risks]);
  const avgCompletion = activeLevels.length ? Math.round(activeLevels.reduce((s, l) => s + l.completion, 0) / activeLevels.length) : 0;

  const donut = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of activeElements) {
      const g = groupCodeOf(e.code);
      totals[g] = (totals[g] ?? 0) + 1;
    }
    return Object.entries(totals)
      .map(([code, value]) => ({
        label: NMC_GROUPS.find((g) => g.code === code)?.label ?? code,
        value,
        color: GROUP_COLORS[code] ?? "#cbd5e1",
      }))
      .sort((a, b) => b.value - a.value);
  }, [activeElements]);

  const pass = compliance.filter((c) => c.status === "pass").length;
  const warn = compliance.filter((c) => c.status === "warn").length;
  const fail = compliance.filter((c) => c.status === "fail").length;

  // §161 — cockpit carbone du projet ACTIF : bilan A1–A3, budget, potentiel VE.
  const carbon = useMemo(() => {
    if (activeElements.length === 0) return null;
    const match = matchMaterials(activeElements, costConfig.ngf);
    const opps = buildVEOpportunities(takeoffVolumeM3BySubstitution(match), match.co2Kg);
    return buildCarbonCockpit({
      match,
      carbonBudgetKg: activeProject.carbonBudgetKg,
      opportunities: opps,
      projectType: activeProject.type,
    });
  }, [activeElements, costConfig.ngf, activeProject.carbonBudgetKg]);

  // §173 — Klima-Bericht : export PDF du portefeuille (bragging honnête).
  const exportKlimaBericht = async () => {
    let branding: PdfBranding | undefined;
    try {
      const b = await fetchBranding();
      if (b.office_name || b.logo) {
        branding = { officeName: b.office_name };
        if (b.logo) {
          try {
            const dims = await loadImageDims(b.logo.data_url);
            branding.logo = { dataUrl: b.logo.data_url, width: dims.width, height: dims.height };
          } catch {
            branding.logo = null;
          }
        }
      }
    } catch {
      // serveur injoignable → rapport standard (dégradation honnête).
    }
    const totals = getKlimaTotals();
    const summaries = projectCarbonSummaries(projects, elements);
    generateKlimaBerichtPdf(
      {
        officeName: branding?.officeName,
        totalKg: totals.totalKg,
        records: totals.records,
        milestones: reachedMilestones(totals.totalKg),
        projects: projects.map((p) => {
          const s = summaries[p.id];
          return {
            name: p.name,
            a1a3Kg: s?.a1a3Kg ?? 0,
            verdictLabel: s?.verdict ? VERDICT_META[s.verdict.level].short : "—",
            overBudget: s?.overBudget ?? false,
            usedPct: s?.usedPct ?? null,
          };
        }),
      },
      branding,
    );
  };

  // §169 — alerte passive : chaque projet au-dessus de SON budget carbone
  // remonte en notification (id déterministe → jamais de doublon).
  useEffect(() => {
    const alerts = carbonBudgetAlerts(projects, elements);
    for (const a of alerts) {
      const id = `carbon-budget-${a.projectId}`;
      if (notifications.some((n) => n.id === id)) continue;
      addNotification({
        id,
        kind: "carbon",
        title: `CO₂-Budget überschritten — ${a.projectName}`,
        detail: `A1–A3 ${Math.round(a.a1a3Kg)} kg vs Budget ${Math.round(a.budgetKg)} kg (+${Math.round(a.excessKg)} kg). VE-Studio schlägt Substitutionen vor.`,
        time: new Date().toISOString(),
        read: false,
      });
    }
  }, [projects, elements, notifications, addNotification]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Übersicht"
        subtitle={`Portfolio: ${projects.length} Projekte · ${formatNumber(kpis.totalElements)} Bauteile indexiert`}
      />

      <OnboardingBanner />

      <Leistungskette />

      <DinCostBanner />

      <DopamineBanner />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Portfolio-Wert" value={formatMoney(kpis.portfolioValue, currency, true)} sub="Kumulierte Baukosten" icon="scale" tone="amber" />
        <StatCard label="Bauteile indexiert" value={formatNumber(kpis.totalElements)} sub={`${Math.round(kpis.validatedPct)} % geprüft`} icon="cube" tone="cyan" />
        <StatCard label="CO₂ (A1–A3)" value={formatCarbon(kpis.totalCarbonKg)} sub="Über das Portfolio · Ökobaudat" icon="leaf" tone="emerald" />
        <StatCard
          label="Konformitäts-Score"
          value={compliance.length ? `${kpis.complianceScore}%` : "—"}
          sub={compliance.length ? `${pass} konform · ${fail} nicht konform` : "Keine Regeln geprüft"}
          icon="shield"
          tone="violet"
        />
      </div>

      {carbon && (
        <Card>
          <CardHeader
            title={`CO₂-Bilanz — ${activeProject.name}`}
            subtitle="Herstellungsemissionen (A1–A3) · Ökobaudat, Budget als Richtwert"
            action={
              <div className="flex gap-2">
                <Button icon="download" variant="outline" size="sm" onClick={() => void exportKlimaBericht()}>
                  Klima-Bericht (PDF)
                </Button>
                <Button icon="bolt" variant="outline" size="sm" onClick={() => navigate("/app/lca", { mode: "ve" })}>
                  ⚡ VE-Studio
                </Button>
              </div>
            }
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">A1–A3 gesamt</p>
              <p className="font-display text-xl font-bold text-slate-900">{formatCarbon(carbon.a1a3Kg)}</p>
              {carbon.perM2Kg != null && (
                <p className="text-[11px] text-slate-500">{formatNumber(carbon.perM2Kg, 0)} kg/m² NGF</p>
              )}
              {carbon.verdict && (
                <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold", VERDICT_META[carbon.verdict.level].badge)}>
                  ⚑ {VERDICT_META[carbon.verdict.level].short}
                </span>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Budget carbone</p>
              {editingBudget ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const n = Number(budgetDraft);
                        if (Number.isFinite(n) && n >= 0) {
                          updateProject(activeProject.id, { carbonBudgetKg: n });
                          setEditingBudget(false);
                        }
                      }
                      if (e.key === "Escape") setEditingBudget(false);
                    }}
                    placeholder="kg CO₂e"
                    className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none focus:border-brand-400"
                  />
                  <span className="text-[10px] text-slate-400">kg</span>
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number(budgetDraft);
                      if (Number.isFinite(n) && n >= 0) {
                        updateProject(activeProject.id, { carbonBudgetKg: n });
                        setEditingBudget(false);
                      }
                    }}
                    className="rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-brand-700"
                  >
                    OK
                  </button>
                </div>
              ) : carbon.budgetKg != null ? (
                <>
                  <p className="font-display text-xl font-bold text-slate-900">
                    {formatCarbon(carbon.budgetKg)}
                    <button
                      type="button"
                      onClick={() => {
                        setBudgetDraft(String(Math.round(carbon.budgetKg!)));
                        setEditingBudget(true);
                      }}
                      className="ml-1 text-[10px] font-semibold text-brand-600 hover:text-brand-700"
                    >
                      Ändern
                    </button>
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", carbon.overBudget ? "bg-rose-500" : "bg-emerald-500")}
                      style={{ width: `${Math.min(100, Math.max(0, carbon.budgetUsedPct ?? 0))}%` }}
                    />
                  </div>
                  <p className={cn("mt-1 text-[11px] font-semibold", carbon.overBudget ? "text-rose-600" : "text-emerald-600")}>
                    {carbon.overBudget
                      ? `Überschritten (+${formatCarbon(carbon.a1a3Kg - carbon.budgetKg)})`
                      : `${formatNumber(carbon.budgetUsedPct ?? 0, 0)} % verbraucht`}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBudgetDraft("");
                    setEditingBudget(true);
                  }}
                  className="mt-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
                >
                  Budget setzen
                </button>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">VE-Potenzial</p>
              {carbon.vePotentialKg != null ? (
                <>
                  <p className="font-display text-xl font-bold text-emerald-600">bis zu −{formatCarbon(carbon.vePotentialKg)}</p>
                  <p className="text-[11px] text-slate-500">{carbon.veOpportunityCount} Substitutionen möglich</p>
                </>
              ) : (
                <p className="text-sm text-slate-400">Importieren Sie ein IFC-Modell</p>
              )}
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => navigate("/app/lca", { mode: "ve" })}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-emerald-700"
              >
                CO₂ sparen → VE-Studio
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Nach Klassifikation" subtitle={activeProject.name} />
          <div className="flex flex-col items-center gap-5 p-5">
            <DonutChart
              segments={donut}
              centerLabel={String(activeElements.length)}
              centerSub="Bauteile"
            />
            <div className="w-full">
              <Legend items={donut.map((d) => ({ label: d.label, value: String(d.value), color: d.color }))} />
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Fortschritt Portfolio" subtitle="Fortschritt je Projekt (%)" />
          <div className="p-5">
            <BarChart
              height={230}
              data={projects.map((p) => ({ label: p.code.replace("PRJ-", "P"), value: p.progress }))}
              format={(n) => `${n}%`}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-slate-900">Konformität</h3>
            <Badge tone={compliance.length ? "emerald" : "slate"} dot>{compliance.length ? `${pass} OK` : "nicht geprüft"}</Badge>
          </div>
          <div className="mt-2 flex items-center gap-5">
            <RadialGauge value={compliance.length ? kpis.complianceScore : 0} label={compliance.length ? "konform" : "—"} color="#34d399" />
            <ul className="flex-1 space-y-2 text-sm">
              <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Konform</span><span className="font-semibold">{pass}</span></li>
              <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-brand-500" />Prüfen</span><span className="font-semibold">{warn}</span></li>
              <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Nicht konform</span><span className="font-semibold">{fail}</span></li>
            </ul>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Letzte Aktivität" subtitle="Betriebslog (keine Erfindung)" />
          {activity.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Keine Aktivität aufgezeichnet.</p>
          ) : (
          <ul className="divide-y divide-slate-100">
            {activity.slice(0, 6).map((a) => {
              const meta = ACTIVITY_ICON[a.kind] ?? ACTIVITY_ICON.alert;
              return (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    <Icon name={meta.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">{a.message}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{a.user} · {relativeTime(a.time)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Zwilling des Projekts"
            subtitle={activeProject.name}
            action={<Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => navigate("/app/twin")}>Öffnen</Button>}
          />
          <div className="flex flex-col items-center gap-3 p-4">
            <div className="w-full"><IsometricBuilding levels={activeLevels} metric="completion" height={210} onLevel={() => navigate("/app/twin")} /></div>
            <div className="grid w-full grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-400">Geschosse</div><div className="font-display text-sm font-bold text-slate-900">{activeLevels.length}</div></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-400">Fortschritt</div><div className="font-display text-sm font-bold text-brand-600">{avgCompletion}%</div></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-400">Mängel</div><div className="font-display text-sm font-bold text-rose-600">{openIssues}</div></div>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Risiken & Hinweise" subtitle="Priorität Wahrscheinlichkeit × Wirkung" action={<Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => navigate("/app/issues")}>Öffnen</Button>} />
          {topRisks.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Keine Projektrisiken erfasst — keine Erfindung.</p>
          ) : (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {topRisks.map((r) => {
              const score = r.likelihood * r.impact;
              const color = score >= 16 ? "#f43f5e" : score >= 9 ? "#f59e0b" : score >= 4 ? "#fbbf24" : "#34d399";
              return (
                <div key={r.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{r.title}</p>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: color }}>L{r.likelihood}·I{r.impact}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{r.mitigation}</p>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="capitalize">{r.category}</span><span>Verantw. {r.owner}</span>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Datenquellen" subtitle="Status der angebundenen Quellen" />
        {sources.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Keine Datenquellen angebunden.</p>
        ) : (
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((s) => {
            const tone = s.status === "connected" ? "bg-emerald-500" : s.status === "syncing" ? "bg-brand-500" : s.status === "error" ? "bg-rose-500" : "bg-slate-400";
            return (
              <div key={s.id} className="bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                  <span className={`relative flex h-2.5 w-2.5 ${s.status === "syncing" ? "" : ""}`}>
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${tone}`} />
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{s.kind} · {formatNumber(s.records)} Einträge</p>
                <div className="mt-3"><ProgressBar value={s.health} color={s.status === "error" ? "#f43f5e" : "#34d399"} /></div>
              </div>
            );
          })}
        </div>
        )}
      </Card>

      <Haftungsradar />
    </div>
  );
}

/* Haftungsradar — loss-aversion psychology.
   Surfaces where liability hides and how Narchi already mitigates it.
   Fear of Haftung is the single strongest driver for German planning offices. */
function Haftungsradar() {
  const { activeElements, navigate } = useApp();
  const audit = useMemo(() => (activeElements.length ? AuditEngine.runFullAudit(activeElements) : null), [activeElements]);
  const risks = LIABILITY_RISKS.slice(0, 4);
  const messbar = audit ? audit.ruleStats.reduce((n, r) => n + r.measurable, 0) : 0;
  return (
    <Card>
      <CardHeader
        title="Haftungsradar"
        subtitle={
          audit && messbar > 0
            ? `Modell: ${audit.totalIssues} gemessene Verstöße · ${messbar} Werte gelesen. Plus Merkblatt.`
            : "Merkblatt typischer Planerhaftung — ohne Messung im Modell keine grünen Häkchen."
        }
        action={
          <Badge tone={audit && audit.totalIssues > 0 ? "rose" : "slate"}>
            {audit && messbar > 0 ? `${audit.totalIssues} Messung` : "Merkblatt"}
          </Badge>
        }
      />
      {audit && messbar > 0 && (
        <div className="border-b border-slate-100 px-5 py-3 text-sm">
          <p className="font-semibold text-slate-800">
            AuditEngine: {audit.criticalCount} kritisch · {audit.majorCount} major · {audit.minorCount} minor
          </p>
          <button type="button" className="mt-1 text-xs font-semibold text-brand-700" onClick={() => navigate("/app/qualitaet")}>
            Qualität / QC öffnen
          </button>
        </div>
      )}
      <div className="grid gap-3 p-5 md:grid-cols-2">
        {risks.map((r) => {
          const meta = SEVERITY_META[r.severity];
          return (
            <div key={r.id} className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                  <h4 className="text-sm font-bold text-slate-800">{r.title}</h4>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold text-white", meta.tone === "rose" ? "bg-rose-500" : meta.tone === "amber" ? "bg-brand-500" : "bg-slate-400")}>{meta.label}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500"><span className="font-semibold text-rose-600">Risiko:</span> {r.risk}</p>
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600">
                <Icon name="shield" size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                <span><span className="font-semibold text-slate-600">Hinweis:</span> {r.mitigated}</span>
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* DIN 276 cost banner — surfaces the active project's real cost estimate */
function DinCostBanner() {
  const { activeProject, estimateForProject, country, navigate } = useApp();
  const est = estimateForProject(activeProject.id);
  if (!est || est.input.ngf <= 0) return null;
  const cur = country.currency;
  const budgetDelta = activeProject.budget - est.netTotal;
  const budgetPct = budgetDelta < 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-ink-950 to-ink-800 p-6 text-white">
      <div className="absolute inset-0 bp-grid-fine opacity-30" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-ink-950">
            <Icon name="gauge" size={24} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-bold">Kostenschätzung nach DIN 276</h3>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-200">{country.flag} {country.framework}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-300">{activeProject.name} · {fmtNumDE(est.input.ngf)} m² NGF · Standard</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Metric label="Geschätzte Baukosten (netto)" value={fmtMoney(est.netTotal, cur)} sub={`${fmtNumDE(est.perM2Ngf)} €/m² NGF`} />
          <Metric label="Projektbudget" value={fmtMoney(activeProject.budget, cur)} sub={activeProject.code} />
          <div className="rounded-xl bg-white/5 p-3">
            <div className="text-[11px] text-slate-400">Abweichung Budget</div>
            <div className={`font-display text-lg font-bold ${budgetPct ? "text-rose-400" : "text-emerald-400"}`}>
              {budgetPct ? "+" : "−"}{fmtMoney(Math.abs(budgetDelta), cur)}
            </div>
          </div>
          <Button iconRight="arrowRight" onClick={() => navigate("/app/cost")}>Calculateur DIN 276</Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-display text-lg font-bold text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

/* "Heute gerettet" — dopamine engine + daily humor.
   Psychology: visible wins (saved hours, money, errors avoided) trigger
   reward; humor lowers cortisol. Makes opening the dashboard feel good. */
function DopamineBanner() {
  const { sync, takeoff, estimateForProject, activeProject } = useApp();
  const est = estimateForProject(activeProject.id);
  const saved = savedToday({
    estimates: est && est.input.ngf > 0 ? 1 : 0,
    energyRuns: 0,
    syncs: sync.lastRun ? 1 : 0,
    imports: takeoff ? 1 : 0,
  });
  const suende = bausuendeOfTheDay();
  // §172 — Klima-Erfolg : le cumul de CO₂ économisé (dopamine honnête).
  const klima = getKlimaTotals();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* saved today */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 lg:col-span-2">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="relative flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white"><Icon name="bolt" size={18} /></span>
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Was heute wirklich vorliegt</h3>
            <p className="text-xs text-slate-500">Keine geschätzten Stunden oder Euro — nur Ereignisse, die Narchi kennt.</p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Saved icon="leaf" value={klima.totalKg > 0 ? formatCarbon(klima.totalKg) + " CO₂e" : "0 kg CO₂e"} label="Klima-Erfolg (nur gebuchte Einsparung)" tone="text-emerald-600" />
        </div>
        <ul className="relative mt-4 space-y-1.5">
          {saved.highlights.slice(0, 3).map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
              <Icon name="check" size={13} className="mt-0.5 shrink-0 text-emerald-500" /> {h}
            </li>
          ))}
        </ul>
      </div>

      {/* daily humor */}
      <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600">🙈 Bausünde des Tages</span>
        <div className="mt-3 flex flex-1 flex-col">
          <p className="flex items-center gap-2 font-display text-base font-bold text-slate-900"><span className="text-2xl">{suende.emoji}</span>{suende.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{suende.desc}</p>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">Schmunzeln senkt den Cortisol-Spiegel. 😉</p>
      </div>
    </div>
  );
}

function Saved({ icon, value, label, tone }: { icon: Parameters<typeof Icon>[0]["name"]; value: string; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-white/70 p-3 ring-1 ring-slate-100">
      <Icon name={icon} size={16} className={tone} />
      <div className="mt-1 font-display text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
