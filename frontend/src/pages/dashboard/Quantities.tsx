import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { NMC_GROUPS } from "@/data/classification";
import { Badge, Card, CardHeader, Icon, PageHeader, SegmentedControl } from "@/components/ui";
import { DonutChart, HBars, Legend } from "@/components/charts";
import { formatCarbon, formatMoney, formatNumber, formatWeight } from "@/lib/format";
import { compareAlpha } from "@/lib/levelSort";

const PALETTE = ["#f59e0b", "#22d3ee", "#34d399", "#a78bfa", "#fb7185", "#38bdf8", "#facc15", "#4ade80", "#f472b6"];
const groupCodeOf = (code: string) => code.split("-").slice(0, 2).join("-");

interface AggRow {
  key: string;
  label: string;
  meta: string;
  color: string;
  qty?: number;
  unit?: string;
  count?: number;
  weightKg: number;
  cost: number;
  carbonKg: number;
}

export default function Quantities() {
  const { activeElements, getMaterial, activeProject, projects, setActiveProjectId, settings } = useApp();
  const currency = settings.currency;
  const [mode, setMode] = useState<"material" | "group">("material");

  const rows: AggRow[] = useMemo(() => {
    if (mode === "material") {
      const map: Record<string, AggRow> = {};
      for (const e of activeElements) {
        const r = (map[e.materialId] ??= { key: e.materialId, label: "", meta: "", color: "", qty: 0, unit: "", weightKg: 0, cost: 0, carbonKg: 0 });
        r.qty = (r.qty ?? 0) + e.qty; r.weightKg += e.weightKg; r.cost += e.cost; r.carbonKg += e.carbonKg;
      }
      let i = 0;
      return Object.values(map)
        .map((r) => {
          const mat = getMaterial(r.key)!;
          r.label = mat.name;
          r.unit = mat.unit;
          r.meta = `${mat.category} · ${mat.recycledContent}% Recycling`;
          r.color = PALETTE[i++ % PALETTE.length];
          return r;
        })
        // ORDRE BUREAU : alphabétique naturel (demande 2026-08-06).
        .sort((a, b) => compareAlpha(a.label, b.label));
    }
    const map: Record<string, AggRow> = {};
    for (const e of activeElements) {
      const g = groupCodeOf(e.code);
      const r = (map[g] ??= { key: g, label: "", meta: g, color: "", count: 0, weightKg: 0, cost: 0, carbonKg: 0 });
      r.count = (r.count ?? 0) + 1; r.weightKg += e.weightKg; r.cost += e.cost; r.carbonKg += e.carbonKg;
    }
    let i = 0;
    return Object.values(map)
      .map((r) => {
        r.label = NMC_GROUPS.find((x) => x.code === r.key)?.label ?? r.key;
        r.meta = r.key;
        r.color = PALETTE[i++ % PALETTE.length];
        return r;
      })
      // ORDRE BUREAU : alphabétique naturel (demande 2026-08-06).
      .sort((a, b) => compareAlpha(a.label, b.label));
  }, [activeElements, getMaterial, mode]);

  const totals = useMemo(() => ({
    cost: activeElements.reduce((s, e) => s + e.cost, 0),
    carbon: activeElements.reduce((s, e) => s + e.carbonKg, 0),
    weight: activeElements.reduce((s, e) => s + e.weightKg, 0),
    count: activeElements.length,
  }), [activeElements]);

  const costSegments = rows.map((r) => ({ label: r.label, value: r.cost, color: r.color }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mengen & Aufmaß"
        subtitle="Mengen, Kosten und CO₂ aus den Bauteilen — keine erfundene Summe"
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
        <MiniStat label="Kosten gesamt" value={formatMoney(totals.cost, currency, true)} icon="scale" tone="amber" />
        <MiniStat label="CO₂ inkarniert" value={formatCarbon(totals.carbon)} icon="leaf" tone="emerald" />
        <MiniStat label="Masse gesamt" value={formatWeight(totals.weight)} icon="cube" tone="violet" />
        <MiniStat label="Gemessene Bauteile" value={formatNumber(totals.count)} icon="layers" tone="cyan" />
      </div>

      <div className="flex items-center justify-between">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[{ value: "material", label: "Nach Stoff" }, { value: "group", label: "Nach Klassifikation" }]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={mode === "material" ? "Nach Stoff" : "Nach Klassifikation"} subtitle="Inkarniertes CO₂e" />
          <div className="space-y-4 p-5">
            <HBars
              data={rows.slice(0, 8).map((r) => ({ label: r.label, value: r.carbonKg, color: r.color }))}
              format={(n) => formatCarbon(n)}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Kostenanteil" subtitle="Aufteilung" />
          <div className="flex flex-col items-center gap-4 p-5">
            <DonutChart segments={costSegments} centerLabel={formatMoney(totals.cost, currency, true)} centerSub="total" size={168} />
            <div className="w-full"><Legend items={costSegments.slice(0, 6).map((s) => ({ label: s.label, value: formatMoney(s.value, currency, true), color: s.color }))} /></div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={mode === "material" ? "Stoffkatalog" : "Klassifikation"} subtitle={activeProject.name} action={<Badge tone="slate">{rows.length} Zeilen</Badge>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Bezeichnung</th>
                {mode === "material" ? <th className="px-4 py-3 text-right">Menge</th> : <th className="px-4 py-3 text-right">Bauteile</th>}
                <th className="px-4 py-3 text-right">Masse</th>
                <th className="px-4 py-3 text-right">Coût</th>
                <th className="px-4 py-3 text-right">CO₂</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                      <div>
                        <div className="font-semibold text-slate-800">{r.label}</div>
                        <div className="text-[11px] text-slate-400">{r.meta}</div>
                      </div>
                    </div>
                  </td>
                  {mode === "material" ? (
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(r.qty ?? 0, (r.qty ?? 0) < 100 ? 1 : 0)} <span className="text-slate-400">{r.unit}</span></td>
                  ) : (
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(r.count ?? 0)}</td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatWeight(r.weightKg)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(r.cost, currency, true)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCarbon(r.carbonKg)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{mode === "group" ? formatNumber(totals.count) : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatWeight(totals.weight)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(totals.cost, currency, true)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCarbon(totals.carbon)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "amber" | "emerald" | "violet" | "cyan" }) {
  const toneClass = {
    amber: "bg-brand-50 text-brand-600", emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600", cyan: "bg-cyan-50 text-cyan-600",
  }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}><Icon name={icon} size={20} /></span>
      <div>
        <div className="font-display text-lg font-bold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}
