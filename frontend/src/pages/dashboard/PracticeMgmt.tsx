import { useEffect, useState } from "react";
import { useApp } from "@/store/AppStore";
import { useAuth } from "@/store/AuthStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, SegmentedControl } from "@/components/ui";
import {
  addTimeEntry,
  deleteTimeEntry,
  generateFeeProposal,
  listTimeEntries,
  utilizationStats,
  type FeeProposalInput,
  type TimeEntry,
} from "@/lib/practiceMgmt";
import {
  addChangeOrder,
  addVertragspunkt,
  allScopeLines,
  listScope,
  openChangeHonorar,
  removeScopeLine,
  replaceAllFromRemote,
  setChangeStatus,
  type ChangeStatus,
} from "@/lib/scopeGuard";
import { pullOfficeBlob, pushOfficeBlob } from "@/lib/officeBlobSync";
import { fmtMoney, fmtNumber } from "@/lib/costEngine";
import { downloadFeeProposalPdf } from "@/lib/feeProposalPdf";
import { cn } from "@/utils/cn";
import type { NachtragGrund } from "@/lib/nachtragEngine";
import { StundenBruecke } from "@/components/StundenBruecke";

type Tab = "time" | "fee" | "scope";

const PHASES = [
  { nr: 1, name: "Grundlagen" }, { nr: 2, name: "Vorplanung" }, { nr: 3, name: "Entwurf" },
  { nr: 4, name: "Genehmigung" }, { nr: 5, name: "Ausführung" }, { nr: 6, name: "Vergabe-Vorb." },
  { nr: 7, name: "Vergabe" }, { nr: 8, name: "Bauüberw." },
];

const HEALTH = {
  healthy: { tone: "emerald" as const, color: "#34d399", label: "Gesund" },
  warning: { tone: "amber" as const, color: "#f59e0b", label: "Warnung" },
  critical: { tone: "rose" as const, color: "#f43f5e", label: "Kritisch" },
};

export default function PracticeMgmt() {
  const [tab, setTab] = useState<Tab>("time");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Büro-Management"
        subtitle="Zweites Stundenbuch (lokal) — nicht dasselbe wie HOAI-Projektstunden. Ohne Projekt keine Buchung."
      />

      <SegmentedControl value={tab} onChange={(v) => setTab(v as Tab)} options={[
        { value: "time", label: "⏱️ Zeiterfassung" },
        { value: "fee", label: "📄 Honorarvorschlag" },
        { value: "scope", label: "🛡️ Scope-Guard" },
      ]} />

      {tab === "time" && <TimeTracker />}
      {tab === "fee" && <FeeProposal />}
      {tab === "scope" && <ScopeGuard />}
    </div>
  );
}

/* ===================== TIME TRACKER ===================== */
function TimeTracker() {
  const { activeProject } = useApp();
  const { user } = useAuth();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);

  const [hours, setHours] = useState(0);
  const [phase, setPhase] = useState(3);
  const [billable, setBillable] = useState(true);
  const [desc, setDesc] = useState("");
  const projektId = (activeProject?.id || "").trim();

  const entries = listTimeEntries();
  const hier = entries.filter((e) => !projektId || e.projectId === projektId);
  const stats = utilizationStats(user?.id, 30);
  const health = HEALTH[stats.healthStatus];

  const log = () => {
    if (!user || hours <= 0) return;
    if (!projektId) return;
    addTimeEntry({
      projectId: projektId,
      projectName: activeProject.name,
      userId: user.id,
      userName: user.name,
      phase: `LP ${phase}`,
      description: desc || `LP ${phase} ${activeProject.name}`,
      hours,
      billable,
      date: new Date().toISOString().slice(0, 10),
    });
    setDesc("");
    setHours(0);
    refresh();
  };

  const recent = hier.slice(-8).reverse();

  return (
    <div className="space-y-6">
      {/* Utilization KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className={cn("p-5", health === HEALTH.healthy && "border-emerald-200", health === HEALTH.critical && "border-rose-200")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Fakturierbar (Utilization)</span>
            <Badge tone={health.tone} dot>{health.label}</Badge>
          </div>
          <div className="mt-2 font-display text-4xl font-bold" style={{ color: health.color }}>{stats.utilizationRate.toFixed(0)}%</div>
          <ProgressBar value={stats.utilizationRate} color={health.color} className="mt-2" />
          <p className="mt-1 text-[10px] text-slate-400">75 % = interne Orientierung, keine Messung</p>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500">Fakturierbare Std (30T)</div>
          <div className="mt-2 font-display text-3xl font-bold text-emerald-600">{fmtNumber(stats.billableHours, 1)} h</div>
          <p className="mt-1 text-[10px] text-slate-400">{stats.billableHours > 0 ? "ohne Stundensatz — nur Stunden" : "keine Buchung"}</p>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500">Nicht fakturierbar</div>
          <div className="mt-2 font-display text-3xl font-bold text-rose-500">{fmtNumber(stats.nonBillableHours, 1)} h</div>
          <p className="mt-1 text-[10px] text-slate-400">Admin, Meetings, Akquise</p>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-slate-500">Gesamt (30T)</div>
          <div className="mt-2 font-display text-3xl font-bold text-slate-900">{fmtNumber(stats.totalHours, 1)} h</div>
          <p className="mt-1 text-[10px] text-slate-400">{fmtNumber(stats.totalHours / 30, 1)} h/Tag Ø</p>
        </Card>
      </div>

      {/* Health message */}
      <div className={cn("rounded-xl border p-4 text-sm", health === HEALTH.healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : health === HEALTH.warning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
        <Icon name="pulse" size={16} className="mr-2 inline" />
        <strong>{stats.message}</strong>
      </div>

      {/* Quick log form */}
      <Card className="p-5">
        <h3 className="mb-3 font-display font-semibold text-slate-900">
          Zeit erfassen{projektId ? ` — ${activeProject.name}` : " — kein Projekt"}
        </h3>
        {!projektId && (
          <p className="mb-3 text-xs text-amber-800">Ohne gewähltes Projekt wird nichts gespeichert.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Beschreibung (z.B. Grundriss EG überarbeitet)"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus:border-brand-400 focus:outline-none"
          />
          <select value={phase} onChange={(e) => setPhase(Number(e.target.value))} className="h-10 rounded-xl border border-slate-200 px-2 text-sm">
            {PHASES.map((p) => <option key={p.nr} value={p.nr}>LP {p.nr} {p.name}</option>)}
          </select>
          <input type="number" value={hours} step={0.5} min={0.5} max={12} onChange={(e) => setHours(Number(e.target.value) || 0)} className="h-10 w-20 rounded-xl border border-slate-200 px-2 text-center text-sm font-bold" />
          <div className="flex gap-2">
            <button onClick={() => setBillable(!billable)} className={cn("rounded-xl px-3 py-2 text-xs font-bold transition-colors", billable ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500")}>
              {billable ? "💰 Fakt." : "🚫 Nicht fakt."}
            </button>
            <Button size="sm" icon="check" onClick={log}>Log</Button>
          </div>
        </div>
      </Card>

      {/* Recent entries */}
      <Card>
        <CardHeader title="Letzte Buchungen" subtitle={projektId ? `${hier.length} in diesem Projekt` : `${entries.length} gesamt — kein Projektfilter`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left">Datum</th>
                <th className="px-4 py-2 text-left">Beschreibung</th>
                <th className="px-4 py-2 text-left">Phase</th>
                <th className="px-4 py-2 text-right">Std</th>
                <th className="px-4 py-2 text-right">Typ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map((e: TimeEntry) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(e.date).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}</td>
                  <td className="px-4 py-2 text-slate-700">{e.description}</td>
                  <td className="px-4 py-2 text-slate-500">{e.phase}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{e.hours}h</td>
                  <td className="px-4 py-2 text-right">{e.billable ? <span className="text-emerald-600">💰</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => { deleteTimeEntry(e.id); refresh(); }} className="text-slate-300 hover:text-rose-500"><Icon name="x" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Phase distribution */}
      {Object.keys(stats.byPhase).length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 font-display font-semibold text-slate-900">Verteilung nach Leistungsphase</h3>
          <div className="space-y-2">
            {Object.entries(stats.byPhase).sort((a, b) => b[1] - a[1]).map(([phase, hrs]) => (
              <div key={phase}>
                <div className="mb-0.5 flex justify-between text-xs">
                  <span className="text-slate-600">{phase}</span>
                  <span className="font-semibold text-slate-800">{hrs.toFixed(1)} h</span>
                </div>
                <ProgressBar value={(hrs / stats.totalHours) * 100} color="#f59e0b" />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ===================== FEE PROPOSAL ===================== */
function FeeProposal() {
  const { activeProject, costConfig, costResult } = useApp();
  const [input, setInput] = useState<FeeProposalInput>(() => ({
    projectName: activeProject.name && activeProject.id ? activeProject.name : "",
    projectType: "neubau",
    buildingType: "",
    ngf: activeProject.grossFloorArea > 0 ? Math.round(activeProject.grossFloorArea) : (costConfig.ngf || 0),
    costPerM2: costConfig.ngf > 0 && costResult.netTotal > 0 ? Math.round(costResult.perM2NgfNet) : 0,
    honorarzone: 3,
    phases: [2, 3, 4, 5],
    hourlyRate: 0,
    deadline: "",
  }));
  const result = generateFeeProposal(input);
  const upd = (patch: Partial<FeeProposalInput>) => setInput({ ...input, ...patch });

  const togglePhase = (nr: number) => {
    upd({ phases: input.phases.includes(nr) ? input.phases.filter((p) => p !== nr) : [...input.phases, nr] });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Projektname"><input value={input.projectName} onChange={(e) => upd({ projectName: e.target.value })} className={inputCls} /></Field>
          <Field label="Stundensatz (€/h)">
            <input type="number" value={input.hourlyRate} onChange={(e) => upd({ hourlyRate: Number(e.target.value) })} className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NGF (m²)"><input type="number" value={input.ngf} onChange={(e) => upd({ ngf: Number(e.target.value) })} className={inputCls} /></Field>
          <Field label="Kosten/m² (aus DIN 276)"><input type="number" value={input.costPerM2} onChange={(e) => upd({ costPerM2: Number(e.target.value) })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Projekttyp">
            <select value={input.projectType} onChange={(e) => upd({ projectType: e.target.value as FeeProposalInput["projectType"] })} className={inputCls}>
              <option value="neubau">Neubau</option>
              <option value="bestand">Bestand / Umbau</option>
              <option value="denkmal">Denkmalpflege</option>
            </select>
          </Field>
          <Field label="Honorarzone (1–5)">
            <select value={input.honorarzone} onChange={(e) => upd({ honorarzone: Number(e.target.value) })} className={inputCls}>
              {[1, 2, 3, 4, 5].map((z) => <option key={z} value={z}>Zone {z}</option>)}
            </select>
          </Field>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500">Leistungsphasen (anklicken)</label>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {PHASES.map((p) => (
              <button key={p.nr} onClick={() => togglePhase(p.nr)} className={cn("rounded-lg border p-2 text-center text-xs transition-all", input.phases.includes(p.nr) ? "border-brand-400 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-400")}>
                <div className="font-bold">LP {p.nr}</div>
                <div>{p.name}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="overflow-hidden bg-ink-950 text-white">
          <div className="p-5">
            <p className="text-xs text-slate-400">Anrechenbare Kosten</p>
            <p className="font-display text-xl font-bold">{fmtMoney(result.anrechenbareKosten)}</p>
            <div className="my-3 h-px bg-white/10" />
            <p className="text-xs text-slate-400">Honorar (geschätzt)</p>
            <p className="font-display text-3xl font-bold text-brand-300">{fmtMoney(result.honorarTotal)}</p>
            <p className="mt-1 text-xs text-slate-400">
              {input.hourlyRate > 0
                ? `~${Math.round(result.hourlyBudget)} h bei ${input.hourlyRate} €/h`
                : "Stundensatz 0 — keine Stunden ableitbar"}
            </p>
            <div className="my-3 h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">+ 10% Contingency</span>
              <span className="font-semibold text-emerald-400">+{fmtMoney(result.contingency)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-display font-bold">Gesamt (brutto)</span>
              <span className="font-display text-xl font-bold text-brand-300">{fmtMoney(result.totalWithContingency * 1.19)}</span>
            </div>
          </div>
        </Card>

        {result.warnings.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50 p-4">
            {result.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-2 text-xs text-amber-700">
                <Icon name="alert" size={13} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-2 text-xs font-semibold text-slate-500">Phasen-Verteilung</p>
          {result.honorarPerPhase.map((p) => (
            <div key={p.phase} className="flex items-center justify-between py-1 text-sm">
              <span className="text-slate-600">LP {p.phase} {p.name}</span>
              <span className="font-semibold tabular-nums text-slate-800">{fmtMoney(p.amount)}</span>
            </div>
          ))}
        </Card>

        <Button className="w-full" icon="download" variant="secondary" onClick={() => downloadFeeProposalPdf(input, result)}>
          Als PDF exportieren
        </Button>
      </div>
    </div>
  );
}

/* ===================== SCOPE GUARD ===================== */
function ScopeGuard() {
  const { activeProject, hoaiConfig } = useApp();
  const projektId = (activeProject?.id || "").trim();
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const [vText, setVText] = useState("");
  const [cText, setCText] = useState("");
  const [delta, setDelta] = useState(0);
  const [grund, setGrund] = useState<NachtragGrund>("aenderungswunsch");

  useEffect(() => {
    void pullOfficeBlob("scope").then((r) => {
      if (!r || r.empty) return;
      const lines = (r.payload as { lines?: unknown }).lines;
      if (Array.isArray(lines)) replaceAllFromRemote(lines as Parameters<typeof replaceAllFromRemote>[0]);
      refresh();
    });
  }, []);

  const persist = () => {
    void pushOfficeBlob("scope", { lines: allScopeLines() });
  };

  const lines = listScope(projektId);
  const vertrag = lines.filter((l) => l.kind === "vertrag");
  const changes = lines.filter((l) => l.kind === "change");
  const openEur = openChangeHonorar(projektId);

  return (
    <div className="space-y-4">
      <Card className="border-brand-200 bg-brand-50/40 p-5">
        <h3 className="font-display text-lg font-bold text-slate-900">Scope-Guard</h3>
        <p className="mt-1 text-sm text-slate-600">
          Vertrag links. «Noch schnell…» rechts wird ein Nachtrag mit HOAI-Delta. Entwurf, rechtlich zu prüfen.
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-800">
          Offenes Zusatzhonorar: {fmtMoney(openEur)}
          {!projektId ? " — kein Projekt gewählt." : ""}
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Im Vertrag" subtitle="Schon vereinbart" />
          <div className="mt-3 flex gap-2">
            <input value={vText} onChange={(e) => setVText(e.target.value)} placeholder="z. B. LP 1–4, keine TGA" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm" disabled={!projektId} />
            <Button size="sm" disabled={!projektId} onClick={() => { addVertragspunkt(projektId, vText); setVText(""); persist(); refresh(); }}>+</Button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {vertrag.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span>{l.text}</span>
                <button type="button" className="text-rose-500" onClick={() => { removeScopeLine(l.id); persist(); refresh(); }}>×</button>
              </li>
            ))}
            {vertrag.length === 0 && <li className="text-xs text-slate-400">Noch leer.</li>}
          </ul>
        </Card>
        <Card className="p-5">
          <CardHeader title="Noch schnell… → Nachtrag" subtitle="Zusätzliche anrechenbare Kosten" />
          <div className="mt-3 space-y-2">
            <input value={cText} onChange={(e) => setCText(e.target.value)} placeholder="Dachausbau…" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" disabled={!projektId} />
            <div className="flex flex-wrap gap-2">
              <input type="number" value={delta} min={0} onChange={(e) => setDelta(Number(e.target.value) || 0)} className="h-10 w-36 rounded-xl border border-slate-200 px-3 text-sm" disabled={!projektId} />
              <select value={grund} onChange={(e) => setGrund(e.target.value as NachtragGrund)} className="h-10 rounded-xl border border-slate-200 px-2 text-sm">
                <option value="aenderungswunsch">Änderungswunsch</option>
                <option value="zusatzleistung">Zusatzleistung</option>
                <option value="planungsaenderung">Planungsänderung</option>
                <option value="stoerung">Störung</option>
              </select>
              <Button size="sm" disabled={!projektId} onClick={() => {
                addChangeOrder({ projectId: projektId, text: cText, deltaKosten: delta, baseKosten: hoaiConfig.anrechenbareKosten, honorarzone: hoaiConfig.honorarzone, lps: [3, 5], grund });
                setCText(""); persist(); refresh();
              }}>Nachtrag anlegen</Button>
            </div>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {changes.map((l) => (
              <li key={l.id} className="rounded-lg border border-slate-100 px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{l.text}</span>
                  <span className="tabular-nums text-brand-700">{fmtMoney(l.deltaHonorarNetto ?? 0)}</span>
                </div>
                <select value={l.status ?? "offen"} onChange={(e) => { setChangeStatus(l.id, e.target.value as ChangeStatus); persist(); refresh(); }} className="mt-1 rounded border border-slate-200 px-1 py-0.5 text-xs">
                  <option value="offen">offen</option>
                  <option value="beauftragt">beauftragt</option>
                  <option value="abgelehnt">abgelehnt</option>
                </select>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ===================== HELPERS ===================== */
const inputCls = "mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-brand-400 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-semibold text-slate-500">{label}</label>{children}</div>;
}
