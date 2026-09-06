import { useApp } from "@/store/AppStore";
import { Disclaimer } from "@/components/Disclaimer";
import type { MonthRow } from "@/lib/energyEngine";
import {
  BAUTEILE,
  CLIMATES,
  GEG_THRESHOLDS,
  HEIZSYSTEME,
  MASS_CLASS,
  ORIENTATIONS,
  bauteileByGroup,
} from "@/data/energy";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, Toggle } from "@/components/ui";
import { fmtNum, fmtEUR } from "@/lib/hoaiEngine";
import { cn } from "@/utils/cn";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export default function GegEnergie() {
  const { energyConfig, setEnergyConfig, energyResult: r, activeProject, costConfig } = useApp();

  const statusColor = r.gegStatus === "kfw40" ? "#10b981" : r.gegStatus === "kfw55" ? "#f59e0b" : "#f43f5e";

  const handleExport = () => {
    const rows: string[][] = [];
    rows.push(["Energiebilanz nach Monatsbilanzverfahren (DIN V 18599 / EnEV)"]);
    rows.push(["Klima", CLIMATES.find((c) => c.id === energyConfig.climateId)?.name ?? "", "Gradtagszahl", String(CLIMATES.find((c) => c.id === energyConfig.climateId)?.gradtagszahl)]);
    rows.push(["TFA/NGF", fmtNum(r.input.tfa) + " m²", "Volumen", fmtNum(r.areas.volumen) + " m³"]);
    rows.push(["H_T", fmtNum(r.HTges, 1) + " W/K", "H_V", fmtNum(r.HV, 1) + " W/K"]);
    rows.push(["Monat", "Transmission kWh", "Lüftung kWh", "Solar kWh", "Intern kWh", "Heizwärme kWh"]);
    for (const m of r.monthly) rows.push([m.month, fmtNum(m.Q_T), fmtNum(m.Q_V), fmtNum(m.Q_S), fmtNum(m.Q_I), fmtNum(m.Q_h)]);
    rows.push(["Heizwärmebedarf (HWB)", fmtNum(r.HWB, 1) + " kWh/(m²a)"]);
    rows.push(["Endenergie", fmtNum(r.endenergieM2, 1) + " kWh/(m²a)"]);
    rows.push(["Primärenergiebedarf (PEB)", fmtNum(r.PEB, 1) + " kWh/(m²a)"]);
    rows.push(["CO₂-Emissionen", fmtNum(r.co2M2, 1) + " kg/(m²a)"]);
    rows.push(["GEG-Status", r.gegLabel]);
    const csv = "\ufeff" + rows.map((row) => row.map((c) => `"${c}"`).join(";")).join("\r\n");
    download(csv, "narchi-energiebilanz-geg.csv");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="GEG-Energiebilanz"
        subtitle={`Energie für « ${activeProject.name} » · DIN V 18599 — andere Projekte haben eigene TFA.`}
        actions={<Button size="sm" variant="secondary" icon="download" onClick={handleExport}>CSV-Export</Button>}
      />

      {/* conformity headline */}
      <Card className="overflow-hidden">
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-4">
          <Head label="Heizwärmebedarf" value={fmtNum(r.HWB, 1)} unit="kWh/(m²a)" tone="amber" />
          <Head label="Primärenergiebedarf" value={fmtNum(r.PEB, 1)} unit="kWh/(m²a)" tone="cyan" />
          <Head label="CO₂-Emissionen" value={fmtNum(r.co2M2, 1)} unit="kg/(m²a)" tone="emerald" />
          <Head label="GEG-Status" value={r.gegLabel} unit="Bewertung" tone={r.gegStatus === "kfw40" ? "emerald" : r.gegStatus === "kfw55" ? "amber" : "rose"} big />
        </div>
      </Card>

      <Disclaimer level="orientation" domain="GEG-Energiebilanz nach DIN V 18599 (vereinfachtes Monatsbilanzverfahren)" />
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        Kein EnergyPlus, kein TEASER, keine dynamische Gebäudesimulation. Orientierung — Nachweis beim Energieberater.
      </p>

      {energyConfig.tfa <= 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Keine NGF/TFA — Kennwerte je m² und GEG-Status sind ohne Fläche nicht bewertbar. Fläche tippen oder aus Projekt / IFC übernehmen.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {/* ===== INPUT ===== */}
        <div className="space-y-6">
          {/* geometry */}
          <Card className="p-5">
            <Label icon="building">Gebäudegeometrie</Label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField label="NGF / TFA (m²)" value={energyConfig.tfa} onChange={(v) => setEnergyConfig({ tfa: v })} />
              <NumField label="Geschosse" value={energyConfig.geschosse} onChange={(v) => setEnergyConfig({ geschosse: v })} />
            </div>
            {(costConfig.ngf > 0 || (activeProject.grossFloorArea ?? 0) > 0) && (
              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-left text-xs font-semibold text-brand-800 hover:bg-brand-100"
                onClick={() => {
                  const n = costConfig.ngf > 0 ? costConfig.ngf : (activeProject.grossFloorArea || 0);
                  if (n > 0) setEnergyConfig({ tfa: n });
                }}
              >
                Fläche übernehmen ({costConfig.ngf > 0 ? `DIN-276 NGF ${costConfig.ngf}` : `Projekt ${activeProject.grossFloorArea}`} m²) — keine Erfindung
              </button>
            )}
            <SliderField label={`Fensterflächenanteil: ${(energyConfig.fensteranteil * 100).toFixed(0)} %`} value={energyConfig.fensteranteil} min={0.05} max={0.7} step={0.01} onChange={(v) => setEnergyConfig({ fensteranteil: v })} />
            <p className="mt-2 text-xs text-slate-400">Umschlossen: <span className="font-semibold text-slate-600">{fmtNum(r.areas.aWand)} m² Wand · {fmtNum(r.areas.aFenster)} m² Fenster · {fmtNum(r.areas.volumen)} m³</span></p>
          </Card>

          {/* climate */}
          <Card className="p-5">
            <Label icon="pin">Standort & Klima (DWD)</Label>
            <SelectField value={energyConfig.climateId} onChange={(v) => setEnergyConfig({ climateId: v })}>
              {CLIMATES.map((c) => <option key={c.id} value={c.id}>{c.name} · GTZ {c.gradtagszahl}</option>)}
            </SelectField>
            <Label icon="sliders" className="mt-4">Hauptausrichtung Fenster</Label>
            <SelectField value={energyConfig.orientationId} onChange={(v) => setEnergyConfig({ orientationId: v })}>
              {ORIENTATIONS.map((o) => <option key={o.id} value={o.id}>{o.name} (×{o.factor})</option>)}
            </SelectField>
            <SliderField label={`g-Wert (Sonneneintragskennzahl): ${energyConfig.gValue.toFixed(2)}`} value={energyConfig.gValue} min={0.1} max={0.8} step={0.05} onChange={(v) => setEnergyConfig({ gValue: v })} />
          </Card>

          {/* envelope */}
          <Card className="p-5">
            <Label icon="layers">Bauteile (U-Werte)</Label>
            <BauteilSelect group="Außenwand" value={energyConfig.bauteilWandId} onChange={(v) => setEnergyConfig({ bauteilWandId: v })} />
            <BauteilSelect group="Dach" value={energyConfig.bauteilDachId} onChange={(v) => setEnergyConfig({ bauteilDachId: v })} />
            <BauteilSelect group="Fenster" value={energyConfig.bauteilFensterId} onChange={(v) => setEnergyConfig({ bauteilFensterId: v })} />
            <BauteilSelect group="Boden" value={energyConfig.bauteilBodenId} onChange={(v) => setEnergyConfig({ bauteilBodenId: v })} />
          </Card>

          {/* system */}
          <Card className="p-5">
            <Label icon="bolt">Wärmeerzeuger</Label>
            <SelectField value={energyConfig.heizsystemId} onChange={(v) => setEnergyConfig({ heizsystemId: v })}>
              {HEIZSYSTEME.map((h) => <option key={h.id} value={h.id}>{h.name} (η {h.eta}, fPE {h.fPE})</option>)}
            </SelectField>
            <Label icon="cube" className="mt-4">Bauart (Speichermasse)</Label>
            <SelectField value={energyConfig.massId} onChange={(v) => setEnergyConfig({ massId: v })}>
              {MASS_CLASS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </SelectField>
            <SliderField label={`Luftwechselrate: ${energyConfig.nAir.toFixed(2)} 1/h`} value={energyConfig.nAir} min={0.2} max={1.5} step={0.05} onChange={(v) => setEnergyConfig({ nAir: v })} />
            <SliderField label={`WW-Bedarf: ${energyConfig.dhwDemand.toFixed(1)} kWh/(m²a)`} value={energyConfig.dhwDemand} min={5} max={20} step={0.1} onChange={(v) => setEnergyConfig({ dhwDemand: v })} />
          </Card>
        </div>

        {/* ===== RESULTS ===== */}
        <div className="space-y-6">
          {/* monthly balance */}
          <Card>
            <CardHeader title="Monatsbilanz" subtitle="Verluste & Gewinne [kWh] je Monat" action={<Badge tone="slate">DIN V 18599</Badge>} />
            <div className="p-5">
              <MonthlyBalanceChart rows={r.monthly} statusColor={statusColor} />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                <Legend color="#fda4af" label="Transmission" />
                <Legend color="#f43f5e" label="Lüftung" />
                <Legend color="#fbbf24" label="Solar" />
                <Legend color="#34d399" label="Intern" />
                <Legend color={statusColor} label="Heizwärmebedarf (Linie)" />
              </div>
            </div>
          </Card>

          {/* PEB gauge + thresholds */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="font-display font-semibold text-slate-900">GEG-Konformität</h3>
              <div className="mt-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm text-slate-500">Primärenergiebedarf</span>
                  <span className="font-display text-2xl font-bold" style={{ color: statusColor }}>{fmtNum(r.PEB, 1)} <span className="text-sm text-slate-400">kWh/(m²a)</span></span>
                </div>
                <ProgressBar value={Math.min((r.PEB / 100) * 100, 100)} color={statusColor} className="h-3" />
                <div className="relative mt-1 h-4">
                  {[40, 55, 70].map((th) => (
                    <span key={th} className="absolute -translate-x-1/2 text-[9px] font-semibold text-slate-400" style={{ left: `${th}%` }}>|{th}</span>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {GEG_THRESHOLDS.map((th) => {
                    const ok = r.PEB <= th.peb;
                    return (
                      <div key={th.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm text-slate-600">
                          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white", ok ? "bg-emerald-500" : "bg-slate-200")}>
                            {ok ? "✓" : "—"}
                          </span>
                          {th.name}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">≤ {th.peb} kWh/(m²a)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-display font-semibold text-slate-900">Kalkulationskennwerte</h3>
              <div className="mt-4 space-y-3 text-sm">
                <KV label="Transmissionswärmeverlust H_T" value={fmtNum(r.HTges, 1) + " W/K"} />
                <KV label="Lüftungswärmeverlust H_V" value={fmtNum(r.HV, 1) + " W/K"} />
                <KV label="Jahres-Heizwärmebedarf" value={fmtNum(r.qhTotal / 1000, 1) + " MWh/a"} />
                <KV label="Endenergie (Wärme + WW)" value={fmtNum(r.endenergie / 1000, 1) + " MWh/a"} />
                <KV label="Primärenergie (Gesamt)" value={fmtNum(r.primaerenergie / 1000, 1) + " MWh/a"} />
                <KV label="CO₂-Emissionen" value={fmtNum(r.co2 / 1000, 1) + " t/a"} />
              </div>
            </Card>
          </div>

          {/* bauteil table */}
          <Card>
            <CardHeader title="U-Werte der Bauteile" subtitle="Aktuelle Ausführung im Modell" />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {[r.input.bauteile.wand, r.input.bauteile.dach, r.input.bauteile.fenster, r.input.bauteile.boden].map((b, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-5 py-3"><Badge tone="slate">{b.group}</Badge></td>
                    <td className="px-5 py-3 font-medium text-slate-700">{b.name}</td>
                    <td className="px-5 py-3 text-slate-400">{b.desc}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={cn("rounded-md px-2 py-0.5 font-mono text-xs font-bold", b.u <= 0.2 ? "bg-emerald-50 text-emerald-600" : b.u <= 0.9 ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600")}>{b.u} W/(m²K)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* --- helpers --- */
function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Label({ icon, children, className }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400", className)}><Icon name={icon} size={14} /> {children}</div>;
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-slate-400">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30" />
    </div>
  );
}
function SelectField({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30">{children}</select>;
}
function SliderField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="mt-4">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="narchi-range mt-2 w-full" />
    </div>
  );
}
function BauteilSelect({ group, value, onChange }: { group: "Außenwand" | "Dach" | "Fenster" | "Boden"; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-3">
      <label className="text-[11px] font-medium text-slate-400">{group}</label>
      <SelectField value={value} onChange={onChange}>
        {bauteileByGroup(group).map((b) => <option key={b.id} value={b.id}>{b.name} · U {b.u}</option>)}
      </SelectField>
    </div>
  );
}
function Head({ label, value, unit, tone, big }: { label: string; value: string; unit: string; tone: "amber" | "cyan" | "emerald" | "rose"; big?: boolean }) {
  const c = { amber: "text-brand-600", cyan: "text-cyan-600", emerald: "text-emerald-600", rose: "text-rose-600" }[tone];
  return (
    <div className="bg-white p-5">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={cn("mt-1 font-display font-bold", big ? "text-lg" : "text-2xl", c)}>{value}</div>
      <div className="text-xs text-slate-400">{unit}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>;
}

/* --- Diagramme Monatsbilanz (SVG précis, échelle commune) ---
 * Par mois : barre des PERTES (Transmission + Lüftung empilées, rose) et
 * barre des GAINS (Solaire + Internes empilés, ambre/vert), plus la courbe
 * du Heizwärmebedarf. Grille graduée en kWh, infobulles natives au survol. */
const CHART_W = 760;
const CHART_H = 300;
const MARGIN = { left: 54, right: 14, top: 12, bottom: 28 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

/// Arrondi « lisible » d'un plafond d'échelle (1·10ⁿ · {1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8}).
function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const mantissa = value / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((s) => mantissa <= s) ?? 10;
  return nice * base;
}

function MonthlyBalanceChart({ rows, statusColor }: { rows: MonthRow[]; statusColor: string }) {
  // Échelle commune : max(pertes, gains, HWB) + 8 % de garde.
  const rawMax = Math.max(
    1,
    ...rows.map((m) => Math.max(m.Q_T + m.Q_V, m.Q_S + m.Q_I, m.Q_h)),
  );
  const yMax = niceCeil(rawMax * 1.08);
  const y = (value: number) => MARGIN.top + PLOT_H - (value / yMax) * PLOT_H;
  const step = PLOT_W / 12;
  const barW = Math.min(20, step * 0.34);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const linePoints = rows.map((m, i) => `${MARGIN.left + step * (i + 0.5)},${y(m.Q_h)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full select-none"
      role="img"
      aria-label="Monatsbilanz: Wärmeverluste, solare und interne Gewinne sowie Heizwärmebedarf je Monat"
    >
      {/* grille horizontale + graduations */}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={MARGIN.left}
            x2={CHART_W - MARGIN.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? "#94a3b8" : "#e2e8f0"}
            strokeDasharray={tick === 0 ? undefined : "3 4"}
            strokeWidth={tick === 0 ? 1.2 : 1}
          />
          <text x={MARGIN.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
            {tick >= 1000 ? `${(tick / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} k` : fmtNum(tick)}
          </text>
        </g>
      ))}
      <text x={14} y={MARGIN.top + 4} fontSize={9} fill="#94a3b8" fontStyle="italic">kWh</text>

      {/* barres par mois */}
      {rows.map((m, i) => {
        const cx = MARGIN.left + step * (i + 0.5);
        const xLoss = cx - barW - 1.5;
        const xGain = cx + 1.5;
        const hT = (m.Q_T / yMax) * PLOT_H;
        const hV = (m.Q_V / yMax) * PLOT_H;
        const hS = (m.Q_S / yMax) * PLOT_H;
        const hI = (m.Q_I / yMax) * PLOT_H;
        const base = MARGIN.top + PLOT_H;
        return (
          <g key={m.month}>
            {/* pertes : Transmission (bas) + Lüftung (dessus) */}
            {hT > 0.4 && (
              <rect x={xLoss} y={base - hT} width={barW} height={hT} fill="#fda4af">
                <title>{m.month} · Transmission: {fmtNum(m.Q_T)} kWh</title>
              </rect>
            )}
            {hV > 0.4 && (
              <rect x={xLoss} y={base - hT - hV} width={barW} height={hV} fill="#f43f5e">
                <title>{m.month} · Lüftung: {fmtNum(m.Q_V)} kWh</title>
              </rect>
            )}
            {/* gains : Solaire (bas) + Internes (dessus) */}
            {hS > 0.4 && (
              <rect x={xGain} y={base - hS} width={barW} height={hS} fill="#fbbf24">
                <title>{m.month} · Solar: {fmtNum(m.Q_S)} kWh</title>
              </rect>
            )}
            {hI > 0.4 && (
              <rect x={xGain} y={base - hS - hI} width={barW} height={hI} fill="#34d399">
                <title>{m.month} · Intern: {fmtNum(m.Q_I)} kWh</title>
              </rect>
            )}
            <text x={cx} y={CHART_H - 10} textAnchor="middle" fontSize={10} fill={m.active ? "#64748b" : "#cbd5e1"}>
              {MONTHS[i]}
            </text>
          </g>
        );
      })}

      {/* zone légère + courbe Heizwärmebedarf */}
      <polygon
        points={`${MARGIN.left},${MARGIN.top + PLOT_H} ${linePoints} ${MARGIN.left + PLOT_W},${MARGIN.top + PLOT_H}`}
        fill={statusColor}
        opacity={0.08}
      />
      <polyline points={linePoints} fill="none" stroke={statusColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((m, i) => (
        <circle key={m.month} cx={MARGIN.left + step * (i + 0.5)} cy={y(m.Q_h)} r={3} fill="#ffffff" stroke={statusColor} strokeWidth={2}>
          <title>{m.month} · Heizwärmebedarf: {fmtNum(m.Q_h)} kWh</title>
        </circle>
      ))}
    </svg>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-slate-50 pb-2.5 last:border-0"><span className="text-slate-500">{label}</span><span className="font-display font-bold text-slate-900">{value}</span></div>;
}
void BAUTEILE; void Toggle; void fmtEUR;
