import { useState } from "react";
import { useApp } from "@/store/AppStore";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Icon,
  PageHeader,
  ProgressBar,
  SegmentedControl,
} from "@/components/ui";
import { IsometricBuilding, TwinLegend, METRIC_META, type TwinMetric } from "@/components/IsometricBuilding";
import { formatCarbon, formatMoney, formatNumber } from "@/lib/format";

export default function DigitalTwin() {
  const { activeLevels, activeProject, projects, setActiveProjectId, settings, navigate } = useApp();
  const [metric, setMetric] = useState<TwinMetric>("completion");
  const [selected, setSelected] = useState<string | null>(null);

  const selectedLevel = activeLevels.find((l) => l.name === selected) ?? null;
  const total = {
    cost: activeLevels.reduce((s, l) => s + l.cost, 0),
    carbon: activeLevels.reduce((s, l) => s + l.carbonKg, 0),
    elements: activeLevels.reduce((s, l) => s + l.elementCount, 0),
    completion: Math.round(activeLevels.reduce((s, l) => s + l.completion, 0) / (activeLevels.length || 1)),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Digitaler Zwilling"
        subtitle={activeProject.id ? `Isometrische Geschossansicht — ${activeProject.name} (Geschosse aus dem Modell, kein Live-Sensor)` : "Kein Projekt — keine Geschosse"}
        actions={
          <select
            value={activeProject.id}
            onChange={(e) => { setActiveProjectId(e.target.value); setSelected(null); }}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Isometrische Ansicht"
            subtitle={`${activeLevels.length} Geschosse · Ebene anklicken zum Prüfen`}
            action={<TwinLegend metric={metric} />}
          />
          <div className="flex flex-col items-center gap-4 p-4">
            <SegmentedControl
              value={metric}
              onChange={(v) => setMetric(v as TwinMetric)}
              options={[
                { value: "completion", label: "Fortschritt" },
                { value: "carbon", label: "CO₂" },
                { value: "cost", label: "Kosten" },
              ]}
            />
            <div className="w-full">
              <IsometricBuilding levels={activeLevels} metric={metric} activeLevel={selected} onLevel={(n) => setSelected(n)} height={460} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-slate-400">
              <Icon name="gauge" size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">Zwilling — Übersicht</span>
            </div>
            <div className="mt-3 space-y-3">
              <SynthRow label="Modellierte Geschosse" value={String(activeLevels.length)} />
              <SynthRow label="Bauteile indexiert" value={formatNumber(total.elements)} />
              <SynthRow label="Kosten gesamt" value={formatMoney(total.cost, settings.currency, true)} />
              <SynthRow label="CO₂ inkarniert" value={formatCarbon(total.carbon)} accent="text-emerald-600" />
              <SynthRow label="Fortschritt im Mittel" value={`${total.completion}%`} accent="text-brand-600" />
            </div>
          </Card>

          {selectedLevel ? (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900">{selectedLevel.name}</h3>
                  <p className="text-xs text-slate-400">Höhe +{selectedLevel.elevation.toFixed(1)} m · {selectedLevel.type}</p>
                </div>
                <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <Icon name="x" size={16} />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Tile label="Fläche" value={`${formatNumber(selectedLevel.grossArea)} m²`} />
                <Tile label="Bauteile" value={formatNumber(selectedLevel.elementCount)} />
                <Tile label="Kosten" value={formatMoney(selectedLevel.cost, settings.currency, true)} />
                <Tile label="CO₂" value={formatCarbon(selectedLevel.carbonKg)} accent="text-emerald-600" />
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Fortschritt dieser Ebene</span><span className="font-semibold">{selectedLevel.completion}%</span></div>
                <ProgressBar value={selectedLevel.completion} color={selectedLevel.completion < 40 ? "#f43f5e" : selectedLevel.completion < 70 ? "#f59e0b" : "#34d399"} />
              </div>
              <Button className="mt-4 w-full" size="sm" variant="secondary" iconRight="arrowRight" onClick={() => navigate("/app/elements")}>
                Bauteile dieser Ebene
              </Button>
            </Card>
          ) : (
            <Card className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <Icon name="cube" size={22} />
              </div>
              <p className="text-sm font-medium text-slate-600">Geschoss wählen</p>
              <p className="text-xs text-slate-400">Eine Ebene anklicken, um die Werte zu sehen.</p>
            </Card>
          )}
        </div>
      </div>

      {/* level table */}
      <Card>
        <CardHeader title="Données par niveau" subtitle={`Métrique active : ${METRIC_META[metric].label}`} action={<Badge tone="slate">{activeLevels.length} niveaux</Badge>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Geschoss</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-right">Fläche</th>
                <th className="px-4 py-3 text-right">Bauteile</th>
                <th className="px-4 py-3 text-right">Kosten</th>
                <th className="px-4 py-3 text-right">CO₂</th>
                <th className="px-4 py-3 text-right">Fortschritt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeLevels.map((l) => (
                <tr
                  key={l.name}
                  onClick={() => setSelected(l.name)}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${selected === l.name ? "bg-brand-50/60" : ""}`}
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{l.name}</td>
                  <td className="px-4 py-3"><Badge tone="slate">{l.type}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(l.grossArea)} m²</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(l.elementCount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(l.cost, settings.currency, true)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCarbon(l.carbonKg)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="ml-auto flex w-24 items-center gap-2">
                      <ProgressBar value={l.completion} color={l.completion < 40 ? "#f43f5e" : l.completion < 70 ? "#f59e0b" : "#34d399"} />
                      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{l.completion}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SynthRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`font-display font-bold ${accent ?? "text-slate-900"}`}>{value}</span>
    </div>
  );
}
function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 font-display text-base font-bold ${accent ?? "text-slate-900"}`}>{value}</div>
    </div>
  );
}
