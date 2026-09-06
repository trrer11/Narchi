import { useState } from "react";
import { Badge, Card, CardHeader, Icon, PageHeader } from "@/components/ui";
import { analyzePlot, type PlotInput } from "@/lib/plotAnalysis";
import { formatNumber } from "@/lib/format";
import { Disclaimer } from "@/components/Disclaimer";
import { cn } from "@/utils/cn";

const BAUGEBIETE = [
  { code: "WS", desc: "Kleinsiedlungsgebiet" },
  { code: "WR", desc: "reines Wohngebiet" },
  { code: "WA", desc: "allgemeines Wohngebiet" },
  { code: "WB", desc: "besonderes Wohngebiet" },
  { code: "MD", desc: "Mischgebiet (Dorf)" },
  { code: "MI", desc: "Mischgebiet" },
  { code: "MK", desc: "Kerngebiet" },
  { code: "GE", desc: "Gewerbegebiet" },
  { code: "GI", desc: "Industriegebiet" },
  { code: "SO", desc: "Sondergebiet" },
];

export default function PlotAnalysis() {
  const [input, setInput] = useState<PlotInput>({
    plotArea: 800,
    grz: 0.3, gfz: 0.6, bmz: 1.8,
    maxFloors: 2, maxHeight: 9,
    baugebiet: "WA",
    plannedFootprint: 220, plannedFloors: 2, plannedHeight: 8.5,
    plannedFloorArea: 440, wallLengthOver5m: 48,
  });
  const upd = (patch: Partial<PlotInput>) => setInput({ ...input, ...patch });
  const result = analyzePlot(input);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grundstücksanalyse"
        subtitle="Bebaubarkeit prüfen nach B-Plan · GRZ · GFZ · BMZ · Abstandsflächen"
        actions={
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-display text-3xl font-bold" style={{ color: result.feasibilityScore >= 80 ? "#34d399" : result.feasibilityScore >= 50 ? "#f59e0b" : "#f43f5e" }}>{result.feasibilityScore}%</div>
              <div className="text-[10px] text-slate-400">Baubarkeit</div>
            </div>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* INPUT */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Icon name="pin" size={14} /> Grundstück (B-Plan)
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField label="Grundstücksfläche (m²)" value={input.plotArea} onChange={(v) => upd({ plotArea: v })} step={10} />
              <div>
                <label className="text-xs font-semibold text-slate-500">Baugebiet</label>
                <select value={input.baugebiet} onChange={(e) => upd({ baugebiet: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-2 text-sm">
                  {BAUGEBIETE.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.desc}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[11px] text-slate-400">Maß der baulichen Nutzung (Kennzahlen aus B-Plan):</p>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <NumField label="GRZ" value={input.grz} onChange={(v) => upd({ grz: v })} step={0.05} />
              <NumField label="GFZ" value={input.gfz} onChange={(v) => upd({ gfz: v })} step={0.05} />
              <NumField label="BMZ" value={input.bmz} onChange={(v) => upd({ bmz: v })} step={0.1} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <NumField label="Max. Geschosse" value={input.maxFloors} onChange={(v) => upd({ maxFloors: v })} />
              <NumField label="Max. Firsthöhe (m)" value={input.maxHeight} onChange={(v) => upd({ maxHeight: v })} step={0.5} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Icon name="building" size={14} /> Geplante Bebauung
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField label="Grundfläche (m²)" value={input.plannedFootprint} onChange={(v) => upd({ plannedFootprint: v })} step={5} />
              <NumField label="Geschosse" value={input.plannedFloors} onChange={(v) => upd({ plannedFloors: v })} />
              <NumField label="Firsthöhe (m)" value={input.plannedHeight} onChange={(v) => upd({ plannedHeight: v })} step={0.5} />
              <NumField label="Geschossfläche (m²)" value={input.plannedFloorArea} onChange={(v) => upd({ plannedFloorArea: v })} step={10} />
            </div>
          </Card>
        </div>

        {/* RESULTS */}
        <div className="space-y-6">
          {/* Checks */}
          <Card>
            <CardHeader title="Konformitätsprüfung" subtitle="Alle B-Plan-Vorgaben auf einen Blick" action={<Badge tone={result.feasibilityScore >= 80 ? "emerald" : result.feasibilityScore >= 50 ? "amber" : "rose"} dot>{result.feasibilityScore}% baubar</Badge>} />
            <div className="divide-y divide-slate-50">
              {result.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", c.conform ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600")}>
                    {c.conform ? "✓" : "✗"}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-slate-800">{c.label}</span>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-sm font-bold", c.conform ? "text-slate-900" : "text-rose-600")}>{c.value}</div>
                    <div className="text-[10px] text-slate-400">{c.limit}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Visual plot representation */}
          <Card className="overflow-hidden">
            <CardHeader title="Visualisierung" subtitle="Grundstücksausnutzung" />
            <div className="p-5">
              <div className="relative aspect-[4/3] w-full rounded-xl border-2 border-slate-300 bg-slate-50">
                {/* Plot boundary */}
                <div className="absolute inset-2 rounded-lg border border-dashed border-slate-400">
                  {/* Building footprint scaled to GRZ */}
                  {(() => {
                    const utilizationPct = input.plannedFootprint / input.plotArea;
                    const size = Math.sqrt(utilizationPct) * 100;
                    const conform = result.grzConform;
                    return (
                      <div
                        className={cn("absolute rounded-md transition-all", conform ? "bg-brand-500/70" : "bg-rose-500/70")}
                        style={{ width: `${size}%`, height: `${size}%`, left: `${(100 - size) / 2}%`, top: `${(100 - size) / 2}%` }}
                      >
                        <div className="flex h-full items-center justify-center text-center">
                          <div className="text-white">
                            <div className="font-display text-lg font-bold">{formatNumber(input.plannedFootprint)}</div>
                            <div className="text-[10px]">m² Grundfl.</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Floor count indicator */}
                  <div className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-700 shadow">
                    {input.plannedFloors} OG · {input.plannedHeight}m
                  </div>
                </div>
                {/* Scale label */}
                <div className="absolute bottom-1 left-2 text-[10px] text-slate-400">{formatNumber(input.plotArea)} m² Grundstück</div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded bg-brand-500/70" /> Gebäude
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded border border-dashed border-slate-400 bg-slate-50" /> Freifläche
                </span>
                <Badge tone={result.efficiencyGrade === "A" ? "emerald" : result.efficiencyGrade === "D" ? "rose" : "amber"}>
                  Effizienz: {result.efficiencyGrade}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Opportunities */}
          {result.opportunities.length > 0 && (
            <Card className="border-emerald-200 bg-emerald-50/50 p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display font-semibold text-slate-900">
                <Icon name="bolt" size={18} className="text-emerald-500" /> Potenziale
              </h3>
              <ul className="space-y-2">
                {result.opportunities.map((o, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-emerald-700">
                    <Icon name="arrowRight" size={14} className="mt-0.5 shrink-0" /> {o}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <Card className="border-rose-200 bg-rose-50/50 p-5">
              <h3 className="mb-3 flex items-center gap-2 font-display font-semibold text-slate-900">
                <Icon name="alert" size={18} className="text-rose-500" /> Konflikte
              </h3>
              <ul className="space-y-2">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-rose-700">
                    <Icon name="x" size={14} className="mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Disclaimer level="orientation" domain="Grundstücksanalyse (B-Plan / BauO)" />
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500">{label}</label>
      <input type="number" value={value} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value) || 0)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none" />
    </div>
  );
}
