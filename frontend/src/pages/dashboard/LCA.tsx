import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/store/AppStore";
import { Button, Card, CardHeader, Icon, PageHeader, ProgressBar, SegmentedControl, Toggle } from "@/components/ui";
import { calculateLCA, type LCAResult } from "@/lib/lcaEngine";
import { matchMaterials, materialMatchCsv, MATCH_SOURCE, type MatchSummary } from "@/lib/materialMatch";
import { generateVEPdfReport } from "@/lib/veReport";
import { loadImageDims, type PdfBranding } from "@/lib/reportEngine";
import { fetchBranding } from "@/lib/branding";
import { buildCarbonArgument } from "@/lib/carbonArgument";
import { buildVECostImpact } from "@/lib/veCostImpact";
import { computeEquivalences, recordCo2Saved, reachedMilestones } from "@/lib/klimaErfolg";
import { unlock } from "@/lib/gamification";
import { useToast } from "@/components/Toaster";
import {
  compareVEVariants,
  loadVEVariants,
  removeVEVariant,
  saveVEVariant,
  snapshotFromWhatIf,
  type VEVariant,
} from "@/lib/veVariants";
import {
  deleteVEVariantRemote,
  pullVEVariants,
  pushVEVariant,
  reconcileVEVariants,
} from "@/lib/veVariantSync";
import {
  buildVEOpportunities,
  takeoffVolumeM3BySubstitution,
  computeVEWhatIf,
  substitutionKey,
  type VEOpportunity,
  type VEWhatIf,
} from "@/lib/veEngine";
import { OEKOBAUDAT_EPDS, BNB_BENCHMARKS } from "@/data/precisionData";
import { formatCarbon, formatNumber } from "@/lib/format";
import { Disclaimer } from "@/components/Disclaimer";
import { cn } from "@/utils/cn";
import { EmptyProjectState } from "@/components/EmptyProjectState";

const PHASE_COLORS: Record<string, string> = {
  "A1-A3": "#f59e0b",
  "A4-A5": "#fb923c",
  "B1-B7": "#22d3ee",
  "C1-C4": "#a78bfa",
  "D": "#34d399",
};

const PHASE_DESC: Record<string, string> = {
  "A1-A3": "Rohstoffgewinnung, Transport, Herstellung",
  "A4-A5": "Transport zur Baustelle, Montage",
  "B1-B7": "Instandhaltung, Reparatur, Ersatz (50 J.)",
  "C1-C4": "Rückbau, Transport, Entsorgung",
  "D": "Recyclingpotenzial (Gutschrift)",
};

export default function LCA() {
  const { activeElements, materials, activeProject, costConfig, costResult } = useApp();
  const toast = useToast();

  // AXE 1 : le bilan carbone exige des elements reels — etat vide + CTA sinon.
  if (activeElements.length === 0) {
    return (
      <EmptyProjectState
        title="Keine Bauteile für die Ökobilanz"
        subtitle="CO₂ A1–A3 kommt aus Mengen und Stoffen des IFC — ohne Modell gibt es nichts zu rechnen."
      />
    );
  }
  // §161 — lien profond : « …/lca?mode=ve » ouvre directement l'onglet VE
  // (CTA du cockpit carbone). Le mode inconnu retombe sur « result ».
  const [mode, setMode] = useState<"result" | "materials" | "match" | "benchmark" | "ve">(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const m = q.get("mode");
    return m === "ve" || m === "match" || m === "benchmark" || m === "materials" ? m : "result";
  });

  // §38 — Material-Match IFC → ÖKOBAUDAT (inspiration veille GitHub §36,
  // moteur DÉTERMINISTE et auditable : chaque catégorie affiche si elle est
  // rapprochée par NOM de matériau (0,90) ou par NÄHERUNG de classe IFC
  // (0,55) ; masse réelle = weightKg du takeoff ; bande min–max honnête).
  const match: MatchSummary = useMemo(() => matchMaterials(activeElements, costConfig.ngf), [activeElements, costConfig.ngf]);

  // §155 — VE-Studio branché sur la maquette : chaque substitution est
  // appliquée aux VRAIS m³ extraits du takeoff (masse ÷ densité), et rend les
  // deltas TOTAUX projet (ΔCO₂ kg + Δ€ + % du bilan A1–A3). Pur, déterministe.
  const veOpportunities: VEOpportunity[] = useMemo(() => {
    const volumesM3 = takeoffVolumeM3BySubstitution(match);
    return buildVEOpportunities(volumesM3, match.co2Kg);
  }, [match]);

  // §156 — what-if cumulatif : sélection de plusieurs substitutions → le
  // nouveau total A1–A3 + Δ€ se recalculent en direct (aucune écriture projet).
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };
  const whatIf: VEWhatIf = useMemo(
    () => computeVEWhatIf(veOpportunities, selectedKeys, match.co2Kg, costConfig.ngf),
    [veOpportunities, selectedKeys, match.co2Kg, costConfig.ngf],
  );

  // §165 — pont VE ↔ coût : la sélection agit sur le devis DIN 276 (netto).
  const costImpact = useMemo(
    () =>
      buildVECostImpact({
        whatIf,
        estimateNet: costResult?.netTotal,
        budget: activeProject.budget,
      }),
    [whatIf, costResult, activeProject.budget],
  );

  // §159 — argumentaire client bas-carbone : généré à partir des chiffres
  // réels du what-if (jamais de texte marketing creux), copiable en 1 clic.
  const carbonArgument = useMemo(
    () =>
      buildCarbonArgument({
        projectName: activeProject.name,
        whatIf,
        totalCo2Kg: match.co2Kg,
        perM2Before: match.perM2Ngf,
      }),
    [activeProject.name, whatIf, match.co2Kg, match.perM2Ngf],
  );

  // §160 — VE-Varianten : figer la sélection what-if et comparer (localStorage).
  const [veVariants, setVeVariants] = useState<VEVariant[]>(() => loadVEVariants());
  const [variantLabel, setVariantLabel] = useState("");
  const saveVariant = () => {
    const v = snapshotFromWhatIf(whatIf, variantLabel, activeProject.name);
    setVeVariants(saveVEVariant(v));
    void pushVEVariant(v); // §163 — best-effort, hors-ligne = localStorage seul
    setVariantLabel("");
  };
  const deleteVariant = (id: string) => {
    setVeVariants(removeVEVariant(id));
    void deleteVEVariantRemote(id); // §163 — best-effort
  };
  const loadVariant = (v: VEVariant) => setSelectedKeys(v.selectedKeys);
  // §163 — au montage, fusion serveur ↔ localStorage (LWW par id) : les
  // variantes « de bureau » suivent l'architecte d'un poste à l'autre.
  useEffect(() => {
    let live = true;
    void pullVEVariants().then((remote) => {
      if (!live || remote.length === 0) return;
      const merged = reconcileVEVariants(loadVEVariants(), remote);
      // Ré-écrit la fusion en localStorage et met à jour l'affichage.
      for (const v of merged) saveVEVariant(v);
      setVeVariants(loadVEVariants());
    });
    return () => {
      live = false;
    };
  }, []);
  // Instantané « courant » pour la comparaison (sans l'enregistrer).
  const currentVariant = useMemo(
    () => snapshotFromWhatIf(whatIf, "Aktuell", activeProject.name),
    [whatIf, activeProject.name],
  );

  const copyArgument = async () => {
    const text = [
      carbonArgument.headline,
      "",
      carbonArgument.intro,
      "",
      ...carbonArgument.bullets.map((b) => `• ${b}`),
      "",
      carbonArgument.closing,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Presse-papiers refusé (iframe sandbox) → rien, pas de panne.
    }
  };

  // §158 — export PDF « CO2- und Kosten-Optimierung » : le plan VE + la
  // sélection what-if deviennent un livrable client (logo du bureau §77).
  const exportVEPdf = async () => {
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
            branding.logo = null; // logo illisible → nom seul, jamais de panne
          }
        }
      }
    } catch {
      // Serveur injoignable → PDF standard sans branding (dégradation honnête).
    }
    generateVEPdfReport(
      {
        projectName: activeProject.name,
        projectLocation: activeProject.location,
        ngf: costConfig.ngf,
        totalCo2Kg: match.co2Kg,
        perM2Before: match.perM2Ngf,
        estimateNet: costResult?.netTotal,
        budget: activeProject.budget,
        opportunities: veOpportunities,
        whatIf,
      },
      branding,
    );
  };

  const downloadMatchCsv = () => {
    const blob = new Blob([`﻿${materialMatchCsv(match)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `narchi-material-match-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculate LCA from real elements + materials
  const lcaResult: LCAResult | null = useMemo(() => {
    if (!activeElements.length || !materials.length) return null;
    const mats = materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, massPerUnit: m.massPerUnit }));
    return calculateLCA(activeElements, costConfig.ngf, mats);
  }, [activeElements, materials, costConfig.ngf]);

  // Fallback: estimate from cost structure if no elements
  const estimatedLca = useMemo<LCAResult | null>(() => {
    if (lcaResult) return null;
    // Rough estimate: 1 m³ concrete per 1.2 m² NGF + steel 50 kg/m³
    const concreteVol = costConfig.ngf * 0.8;
    const steelTons = concreteVol * 0.05;
    const co2Concrete = concreteVol * 211.1;
    const co2Steel = steelTons * 985;
    const a1a3 = co2Concrete + co2Steel;
    return {
      totalCo2Kg: a1a3 * 1.17,
      perM2Ngf: (a1a3 * 1.17) / costConfig.ngf,
      perM2Year: (a1a3 * 1.17) / costConfig.ngf / 50,
      phases: [
        { code: "A1-A3", label: "Herstellung", co2Kg: a1a3, share: a1a3 / (a1a3 * 1.17) },
        { code: "A4-A5", label: "Transport & Errichtung", co2Kg: a1a3 * 0.08, share: 0.068 },
        { code: "B1-B7", label: "Nutzung", co2Kg: a1a3 * 0.05, share: 0.043 },
        { code: "C1-C4", label: "Entsorgung", co2Kg: a1a3 * 0.06, share: 0.051 },
        { code: "D", label: "Recycling", co2Kg: -a1a3 * 0.02, share: -0.017 },
      ],
      topContributors: [
        { element: "Stahlbeton (geschätzt)", material: "Beton C25/30", co2Kg: co2Concrete },
        { element: "Bewehrungsstahl (geschätzt)", material: "Betonstahl B500B", co2Kg: co2Steel },
      ],
    };
  }, [lcaResult, costConfig.ngf]);

  const result = lcaResult ?? estimatedLca;

  if (!result) {
    return (
      <div className="space-y-6">
        <PageHeader title="CO₂-Bilanz (LCA)" subtitle="Lebenszyklusanalyse nach DIN EN 15978" />
        <Card className="p-12 text-center text-slate-500">Keine Daten verfügbar.</Card>
      </div>
    );
  }

  // BNB benchmark
  const bnb = BNB_BENCHMARKS.residential; // simplified
  const bnbStatus = result.perM2Ngf <= bnb.best ? { label: "Gold (Bestwert)", tone: "emerald" as const, color: "#fbbf24" }
    : result.perM2Ngf <= bnb.target ? { label: "Silber (Zielwert)", tone: "emerald" as const, color: "#34d399" }
    : result.perM2Ngf <= bnb.limit ? { label: "Bronze (Grenzwert)", tone: "amber" as const, color: "#f59e0b" }
    : { label: "Über Grenzwert", tone: "rose" as const, color: "#f43f5e" };

  return (
    <div className="space-y-6">
      <PageHeader
        title="CO₂-Bilanz (LCA)"
        subtitle="Lebenszyklusanalyse nach DIN EN 15978 · Ökobaudat EPDs · 6 Phasen"
        actions={
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="font-display text-2xl font-bold" style={{ color: bnbStatus.color }}>{formatNumber(result.perM2Ngf)}</div>
              <div className="text-[10px] text-slate-400">kg CO₂e/m² NGF</div>
            </div>
          </div>
        }
      />

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name="leaf" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{formatCarbon(result.totalCo2Kg)}</div>
          <div className="text-sm text-slate-500">CO₂e Gesamt</div>
          <div className="text-xs text-slate-400">{!lcaResult && "(geschätzt)"}</div>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="scale" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{formatNumber(result.perM2Ngf)}</div>
          <div className="text-sm text-slate-500">kg CO₂e/m² NGF</div>
          <div className="text-xs text-slate-400">Flächenbezogen</div>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Icon name="clock" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{formatNumber(result.perM2Year, 1)}</div>
          <div className="text-sm text-slate-500">kg CO₂e/(m²·a)</div>
          <div className="text-xs text-slate-400">50-Jahre-Bezug</div>
        </Card>
        <Card className={cn("p-5", bnbStatus.tone === "emerald" && "border-emerald-200", bnbStatus.tone === "rose" && "border-rose-200")}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: bnbStatus.color + "22", color: bnbStatus.color }}>
            <Icon name="shield" size={20} />
          </span>
          <div className="mt-3 font-display text-lg font-bold" style={{ color: bnbStatus.color }}>{bnbStatus.label}</div>
          <div className="text-sm text-slate-500">BNB Bewertung</div>
        </Card>
      </div>

      <SegmentedControl value={mode} onChange={(v) => setMode(v as typeof mode)} options={[
        { value: "result", label: "Phasen-Bilanz" },
        { value: "materials", label: "Baustoff-Beiträge" },
        { value: "match", label: `Material-Match · ${Math.round(match.coveragePct)} %` },
        { value: "benchmark", label: "BNB Benchmark" },
        { value: "ve", label: "⚡ VE-Studio" },
      ]} />

      {mode === "match" && <MatchPanel match={match} onCsv={downloadMatchCsv} />}

      {mode === "result" && (
        <Card>
          <CardHeader title="Phasen-Bilanz nach DIN EN 15978" subtitle="A1-A3 bis D · 50 Jahre Referenzzeitraum" />
          <div className="p-5 space-y-4">
            {/* Stacked bar */}
            <div className="flex h-8 w-full overflow-hidden rounded-lg">
              {result.phases.map((p) => {
                const positive = Math.max(0, p.co2Kg);
                const totalPositive = result.phases.reduce((s, x) => s + Math.max(0, x.co2Kg), 0);
                const width = (positive / totalPositive) * 100;
                if (width < 0.5) return null;
                return (
                  <div
                    key={p.code}
                    className="flex items-center justify-center text-[10px] font-bold text-white transition-all"
                    style={{ width: `${width}%`, background: PHASE_COLORS[p.code] }}
                    title={`${p.code}: ${formatCarbon(p.co2Kg)}`}
                  >
                    {width > 8 ? p.code.split("-")[0] : ""}
                  </div>
                );
              })}
            </div>

            {/* Phase details */}
            <div className="space-y-2">
              {result.phases.map((p) => (
                <div key={p.code} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: PHASE_COLORS[p.code] }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-700">{p.code}</span>
                      <span className="text-sm text-slate-600">{p.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{PHASE_DESC[p.code]}</p>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-display text-sm font-bold", p.co2Kg < 0 ? "text-emerald-600" : "text-slate-900")}>
                      {p.co2Kg < 0 ? "−" : ""}{formatCarbon(Math.abs(p.co2Kg))}
                    </div>
                    <div className="text-[10px] text-slate-400">{(p.share * 100).toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {mode === "materials" && (
        <Card>
          <CardHeader title="Baustoff-Beiträge (Hotspots)" subtitle="Größte CO₂-Verursacher im Gebäude" />
          <div className="p-5 space-y-3">
            {result.topContributors.map((c, i) => {
              const max = result.topContributors[0]?.co2Kg || 1;
              return (
                <div key={i}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">#{i + 1}</span>
                      <span className="text-slate-700">{c.element}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">{formatCarbon(c.co2Kg)}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{c.material}</div>
                  <ProgressBar value={(c.co2Kg / max) * 100} color={c.co2Kg < 0 ? "#34d399" : "#f59e0b"} className="mt-1" />
                </div>
              );
            })}
            {!lcaResult && (
              <div className="rounded-lg bg-cyan-50 p-3 text-xs text-cyan-700">
                <Icon name="pulse" size={13} className="mr-1 inline" />
                Geschätzte Werte basierend auf NGF. Für exakte Bauteil-Bilanz: Modell importieren (IFC) oder Bauteile erfassen.
              </div>
            )}

            {/* EPD reference table */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Verwendete EPDs (Ökobaudat)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {OEKOBAUDAT_EPDS.slice(0, 6).map((epd) => (
                  <div key={epd.uuid} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                    <span className="text-slate-600">{epd.material}</span>
                    <span className={cn("font-mono font-bold", epd.co2PerUnit < 0 ? "text-emerald-600" : "text-slate-700")}>
                      {epd.co2PerUnit < 0 ? "−" : ""}{Math.abs(epd.co2PerUnit)} {epd.unit === "t" ? "kg/t" : epd.unit === "m³" ? "kg/m³" : "kg/m²"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {mode === "benchmark" && (
        <Card>
          <CardHeader title="BNB Benchmark (Wohngebäude)" subtitle="Bewertungssystem Nachhaltiges Bauen — BBSR" />
          <div className="p-5 space-y-5">
            {/* Benchmark scale */}
            <div className="relative h-20">
              <div className="absolute inset-x-0 top-8 flex">
                <div className="h-4 flex-1 rounded-l-full bg-emerald-300" style={{ flex: `${bnb.best}` }} />
                <div className="h-4 flex-[150] bg-emerald-400" style={{ flex: `${bnb.target - bnb.best}` }} />
                <div className="h-4 flex-[200] bg-brand-400" style={{ flex: `${bnb.limit - bnb.target}` }} />
                <div className="h-4 flex-1 rounded-r-full bg-rose-400" />
              </div>
              {/* Marker */}
              <div
                className="absolute top-2 -translate-x-1/2 flex flex-col items-center"
                style={{ left: `${Math.min(95, Math.max(2, (result.perM2Ngf / 1200) * 100))}%` }}
              >
                <div className="whitespace-nowrap text-[10px] font-bold text-slate-700">{formatNumber(result.perM2Ngf)}</div>
                <div className="h-8 w-1 rounded-full bg-ink-950" />
              </div>
              {/* Labels */}
              <div className="absolute inset-x-0 top-16 flex justify-between text-[10px] text-slate-400">
                <span>0</span><span>{bnb.best}</span><span>{bnb.target}</span><span>{bnb.limit}</span><span>1200+</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Gold", val: bnb.best, color: "#fbbf24", desc: "Bestwert" },
                { label: "Silber", val: bnb.target, color: "#34d399", desc: "Zielwert" },
                { label: "Bronze", val: bnb.limit, color: "#f59e0b", desc: "Grenzwert" },
                { label: "Über Grenzwert", val: 1200, color: "#f43f5e", desc: "Verbesserungsbedarf" },
              ].map((b) => (
                <div key={b.label} className="rounded-xl border border-slate-100 p-3 text-center">
                  <div className="mx-auto h-3 w-3 rounded-full" style={{ background: b.color }} />
                  <div className="mt-1 text-xs font-bold text-slate-800">{b.label}</div>
                  <div className="text-[10px] text-slate-500">≤ {b.val} kg/m²</div>
                  <div className="text-[10px] text-slate-400">{b.desc}</div>
                </div>
              ))}
            </div>

            {/* Carbon budget from project */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="text-sm font-semibold text-slate-800">Projekt-CO₂-Budget vs. Berechnung</h4>
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Budget (Projekt)</p>
                  <p className="font-display text-lg font-bold text-slate-900">{formatCarbon(activeProject.carbonBudgetKg)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Berechnet (A1-D)</p>
                  <p className={cn("font-display text-lg font-bold", result.totalCo2Kg > activeProject.carbonBudgetKg ? "text-rose-600" : "text-emerald-600")}>
                    {formatCarbon(result.totalCo2Kg)}
                  </p>
                </div>
              </div>
              {result.totalCo2Kg > activeProject.carbonBudgetKg && (
                <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                  <Icon name="alert" size={13} className="mr-1 inline" />
                  CO₂-Budget um {formatCarbon(result.totalCo2Kg - activeProject.carbonBudgetKg)} überschritten!
                  Maßnahmen: Holzbau (CLT = −110 kg/m³), geringerer Zementgehalt (CEM III), Recyclingbeton.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {mode === "ve" && (
        <Card>
          <CardHeader
            title="⚡ VE-Studio — Materialsubstitution (CO₂ + Kosten)"
            subtitle="Value Engineering in einem Klick : jede Substitution zeigt das ΔCO₂ UND das Δ€ — jetzt auf die VRAIES Mengen Ihrer Maquette (m³ aus dem Takeoff) angewendet."
            action={
              <Button icon="download" variant="outline" size="sm" onClick={() => void exportVEPdf()}>
                PDF (CO₂-Optimierung)
              </Button>
            }
          />
          <div className="p-5 space-y-3">
            <div className="rounded-xl bg-brand-50/60 px-4 py-3 text-sm text-brand-900">
              <span className="font-display font-bold">{veOpportunities.filter((o) => o.inProject).length}</span>{" "}
              Substitutionen treffen auf Ihre Maquette
              {veOpportunities.filter((o) => o.inProject).length > 0
                ? " — wählen Sie mehrere Zeilen aus (Schalter rechts) : das neue Gesamt-CO₂ und das Δ€ werden unten LIVE neu berechnet."
                : " — importieren Sie ein IFC-Modell, um die realen Mengen (m³) zu sehen."}
            </div>

            {whatIf.selected.length > 0 && (
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
                  <Icon name="spark" size={15} />
                  What-if : {whatIf.selected.length} Substitution{whatIf.selected.length > 1 ? "en" : ""} angewendet
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-emerald-700">ΔCO₂ gesamt (A1–A3)</p>
                    <p className="font-display text-lg font-bold text-emerald-700">−{formatCarbon(whatIf.totalCo2SavedKg)}</p>
                    {whatIf.co2SavedPct !== null && (
                      <p className="text-[11px] text-emerald-600">−{formatNumber(whatIf.co2SavedPct, 1)} % vom A1–A3</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">ΔKosten gesamt</p>
                    <p className={cn("font-display text-lg font-bold", whatIf.totalEurDelta <= 0 ? "text-emerald-700" : "text-slate-900")}>
                      {whatIf.totalEurDelta <= 0
                        ? `−${Math.abs(Math.round(whatIf.totalEurDelta)).toLocaleString("de-DE")} €`
                        : `+${Math.round(whatIf.totalEurDelta).toLocaleString("de-DE")} €`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">A1–A3 kg/m² (vorher → nachher)</p>
                    <p className="font-display text-lg font-bold text-slate-900">
                      {match.perM2Ngf != null ? `${formatNumber(match.perM2Ngf, 0)} → ` : ""}
                      {whatIf.newPerM2Kg != null ? formatNumber(whatIf.newPerM2Kg, 0) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Neues A1–A3 gesamt</p>
                    <p className="font-display text-lg font-bold text-slate-900">
                      {whatIf.newTotalCo2Kg != null ? formatCarbon(whatIf.newTotalCo2Kg) : "—"}
                    </p>
                  </div>
                </div>
                {costImpact.hasEstimate && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">Wirkung auf die Kostenschätzung</span>
                      <span className="font-display font-bold text-slate-900">
                        {costImpact.estimateNetBefore?.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €
                        <span className="mx-1 text-slate-400">→</span>
                        {costImpact.estimateNetAfter?.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €
                      </span>
                      <span className={cn("font-display font-bold", costImpact.deltaEur <= 0 ? "text-emerald-600" : "text-slate-900")}>
                        {costImpact.deltaEur <= 0 ? "−" : "+"}{Math.abs(Math.round(costImpact.deltaEur)).toLocaleString("de-DE")} €
                      </span>
                      {costImpact.deltaPctOfEstimate !== null && (
                        <span className="text-[11px] text-slate-500">
                          {costImpact.deltaEur <= 0 ? "−" : "+"}{formatNumber(Math.abs(costImpact.deltaPctOfEstimate), 1)} % vom Devis
                        </span>
                      )}
                      {costImpact.deltaPctOfBudget !== null && (
                        <span className="text-[11px] text-slate-500">
                          · {costImpact.deltaEur <= 0 ? "−" : "+"}{formatNumber(Math.abs(costImpact.deltaPctOfBudget), 1)} % vom Budget
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedKeys([])}
                  className="mt-3 text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  Auswahl zurücksetzen
                </button>
              </div>
            )}

            {/* §172 — Klima-Erfolg : le carbone économisé devient un succès
                cumulatif (dopamine honnête + équivalences pour le client). */}
            {whatIf.selected.length > 0 && whatIf.totalCo2SavedKg > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <Icon name="leaf" size={15} />
                    Klima-Erfolg : {formatCarbon(whatIf.totalCo2SavedKg)} CO₂e gespart
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const totals = recordCo2Saved(whatIf.totalCo2SavedKg);
                      const eq = computeEquivalences(whatIf.totalCo2SavedKg);
                      const newMilestones = reachedMilestones(totals.totalKg);
                      void unlock("ve_saved");
                      if (totals.totalKg >= 10_000) void unlock("ve_champion");
                      toast.push({
                        kind: "success",
                        title: `🌱 CO₂-Ersparnis festgehalten`,
                        detail: `Gesamt: ${formatCarbon(totals.totalKg)} · ≈ ${Math.round(eq.trees)} Bäume/Jahr · ${Math.round(eq.flights)} Flüge Berlin–Paris${newMilestones.length ? ` · 🏆 ${newMilestones[newMilestones.length - 1].title}` : ""}.`,
                      });
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    🌱 Ersparnis festhalten
                  </button>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-emerald-700">
                  ≈ {Math.round(computeEquivalences(whatIf.totalCo2SavedKg).trees)} Bäume (1 Jahr) ·{" "}
                  {Math.round(computeEquivalences(whatIf.totalCo2SavedKg).carKm).toLocaleString("de-DE")} Pkw-km ·{" "}
                  {Math.round(computeEquivalences(whatIf.totalCo2SavedKg).flights)} Flüge Berlin–Paris.
                  Richtwerte — für die Argumentation beim Bauherrn.
                </p>
              </div>
            )}

            {whatIf.selected.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Icon name="leaf" size={15} className="text-emerald-600" />
                    Argumentation für den Bauherrn
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyArgument()}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Kopieren
                  </button>
                </div>
                <p className="mt-2 text-sm font-semibold text-emerald-700">{carbonArgument.headline}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{carbonArgument.intro}</p>
                <ul className="mt-2 space-y-1.5">
                  {carbonArgument.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
                      <span className="text-emerald-600">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] italic leading-snug text-slate-400">{carbonArgument.closing}</p>
              </div>
            )}

            {(whatIf.selected.length > 0 || veVariants.length > 0) && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Icon name="layers" size={15} className="text-brand-600" />
                  Varianten
                </div>
                {whatIf.selected.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={variantLabel}
                      onChange={(e) => setVariantLabel(e.target.value)}
                      placeholder="Name der Variante (z. B. « Holzbau »)"
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand-400"
                    />
                    <button
                      type="button"
                      onClick={saveVariant}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
                    >
                      Speichern
                    </button>
                  </div>
                )}
                {veVariants.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {veVariants.map((v) => {
                      const d = compareVEVariants(v, currentVariant);
                      return (
                        <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{v.label}</p>
                            <p className="text-[11px] text-slate-400">
                              {v.count} Substitutionen · −{formatCarbon(v.totalCo2SavedKg)} ·{" "}
                              {v.totalEurDelta <= 0 ? "−" : "+"}{Math.abs(Math.round(v.totalEurDelta)).toLocaleString("de-DE")} €
                              {v.newPerM2Kg != null ? ` · ${formatNumber(v.newPerM2Kg, 0)} kg/m²` : ""}
                              {d.co2Delta !== 0 && (
                                <span className="text-slate-500">
                                  {" "}· aktuell {d.co2Delta > 0 ? "+" : "−"}{formatCarbon(Math.abs(d.co2Delta))}
                                </span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => loadVariant(v)}
                            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Laden
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteVariant(v.id)}
                            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-50"
                          >
                            Löschen
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {veOpportunities.map((o, i) => {
              const r = o.rec;
              const win = r.eurDeltaPerUnit <= 0;
              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl border p-4 transition-opacity",
                    o.inProject ? "border-slate-100" : "border-slate-100 opacity-55",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-800">{r.from.label}</span>
                        <Icon name="arrowRight" size={14} className="text-slate-400" />
                        <span className="font-semibold text-emerald-700">{r.to.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{r.note}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {!o.inProject ? (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">nicht im Projekt</span>
                      ) : win ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">WIN-WIN</span>
                      ) : (
                        <span className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700">Premium</span>
                      )}
                      {o.inProject && (
                        <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                          Anwenden
                          <Toggle
                            checked={selectedKeys.includes(substitutionKey(o.rec))}
                            onChange={() => toggleSelection(substitutionKey(o.rec))}
                            label={`Substitution ${r.from.label} → ${r.to.label} anwenden`}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">ΔCO₂ / m³</p>
                      <p className="font-display text-base font-bold text-emerald-600">−{Math.round(r.co2SavedPerUnit)} kg</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">ΔKosten / m³</p>
                      <p className={cn("font-display text-base font-bold", win ? "text-emerald-600" : "text-slate-900")}>
                        {win ? `−${Math.abs(Math.round(r.eurDeltaPerUnit))} €` : `+${Math.round(r.eurDeltaPerUnit)} €`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">€ / t CO₂e</p>
                      <p className={cn("font-display text-base font-bold", win ? "text-emerald-600" : "text-slate-900")}>
                        {win ? "gewinnbringend" : `${Math.round(r.eurPerTonneCo2).toLocaleString("de-DE")} €`}
                      </p>
                    </div>
                  </div>
                  {o.inProject && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">In Ihrem Modell</span>
                          <p className="font-display text-sm font-bold text-slate-900">{formatNumber(o.availableM3, 1)} m³</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">ΔCO₂ gesamt</span>
                          <p className="font-display text-sm font-bold text-emerald-600">−{formatCarbon(o.co2SavedKgTotal)}</p>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide text-slate-400">ΔKosten gesamt</span>
                          <p className={cn("font-display text-sm font-bold", win ? "text-emerald-600" : "text-slate-900")}>
                            {o.eurDeltaTotal <= 0
                              ? `−${Math.abs(Math.round(o.eurDeltaTotal)).toLocaleString("de-DE")} €`
                              : `+${Math.round(o.eurDeltaTotal).toLocaleString("de-DE")} €`}
                          </p>
                        </div>
                        {o.co2SavedPct !== null && (
                          <div>
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">vom A1–A3</span>
                            <p className="font-display text-sm font-bold text-emerald-600">−{formatNumber(o.co2SavedPct, 1)} %</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] leading-snug text-slate-400">
              Richtwerte : CO₂ aus Ökobaudat (BMWSB), Kosten als Markt-Richtwert 2026.
              Die m³ sind aus Ihrem Takeoff abgeleitet (Masse ÷ Dichte des Katalogs) — ein Richtwert,
              kein Aufmaß. « WIN-WIN » = weniger CO₂ UND günstiger. « Premium » = weniger CO₂, teurer —
              der €/tCO₂e-Wert ist Ihr Verhandlungsargument (« günstiger als CO₂-Zertifikate »).
              Äquivalenzfunktion (z. B. Beton ≠ CLT in der Statik) ist je Zeile genannt — Orientierung, kein Statiknachweis.
            </p>
          </div>
        </Card>
      )}

      <Disclaimer level="orientation" domain="LCA nach DIN EN 15978 (Ökobaudat EPDs)" />
    </div>
  );
}

// ============================================================================
// §38 — Panneau « Material-Match » (IFC → ÖKOBAUDAT, moteur déterministe)
// ============================================================================

function MatchPanel({ match, onCsv }: { match: MatchSummary; onCsv: () => void }) {
  const maxCo2 = match.byCategory[0]?.co2Kg || 1;
  return (
    <>
      {/* Bandeau de synthèse : couverture réelle + bilan + bande honnête. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name="check" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{formatNumber(match.coveragePct, 0)} %</div>
          <div className="text-sm text-slate-500">Abdeckung (Masse rapprochée)</div>
          <div className="text-xs text-slate-400">{formatNumber(match.matchedMassKg / 1000, 0)} t / {formatNumber(match.totalMassKg / 1000, 0)} t</div>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name="leaf" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{formatCarbon(match.co2Kg)}</div>
          <div className="text-sm text-slate-500">GWP A1–A3 (Herstellung)</div>
          <div className="text-xs text-slate-400">Bande : {formatCarbon(match.lowKg)} – {formatCarbon(match.highKg)}</div>
        </Card>
        <Card className="p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Icon name="scale" size={20} /></span>
          <div className="mt-3 font-display text-2xl font-bold text-slate-900">{match.perM2Ngf !== null ? formatNumber(match.perM2Ngf, 0) : "—"}</div>
          <div className="text-sm text-slate-500">kg CO₂e/m² NGF (A1–A3)</div>
          <div className="text-xs text-slate-400">{MATCH_SOURCE}</div>
        </Card>
        <Card className="flex flex-col justify-center gap-2 p-5">
          <button
            onClick={onCsv}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            <Icon name="download" size={16} />
            Material-Match CSV
          </button>
          <p className="text-center text-[10px] leading-relaxed text-slate-400">
            Tabellenkalkulation bereit (Trenner ; ) — für die Ökobilanz-Akte.
          </p>
        </Card>
      </div>

      {/* Légende des confiances — l'honnêteté d'abord (charte §36). */}
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <strong className="text-emerald-700">Materialname</strong> = erkannter Stoffname im Bauteil (Vertrauen 0,90)
        {" · "}
        <strong className="text-amber-700">IFC-Klasse (Näherung)</strong> = Zuordnung über IFC-Klasse, Vertrauen 0,55
        {" · "}
        <strong className="text-rose-700">Nicht zugeordnet</strong> = nichts Plausibles — extra gezählt, nie still zugewiesen.
        {" "}Facteurs : {MATCH_SOURCE}.
      </p>

      {/* Catégories — hotspots d'abord (règle bureau §36), barre de part. */}
      <Card>
        <CardHeader title="Material-Match pro Kategorie" subtitle="CO₂e absteigend — Hotspots zuerst" />
        <div className="space-y-3 p-5">
          {match.byCategory.map((c, i) => (
            <div key={c.categoryId}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-slate-400">#{i + 1}</span>
                  <span className="truncate text-slate-700">{c.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold ring-1",
                      c.basis === "materialname"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-700 ring-amber-200",
                    )}
                    title={`Mittleres Vertrauen ${formatNumber(c.confidenceAvg, 2)} — ${c.basis === "materialname" ? "erkannte Stoffnamen" : "Näherung über IFC-Klasse"}`}
                  >
                    {c.basis === "materialname" ? "Materialname" : "IFC-Klasse ~"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="font-semibold tabular-nums text-slate-900">{formatCarbon(c.co2Kg)}</span>
                  <span className="ml-2 text-[10px] tabular-nums text-slate-400">
                    {formatNumber(c.massKg / 1000, 1)} t · {c.count} Bauteile · {formatNumber(c.share * 100, 1)} %
                  </span>
                </span>
              </div>
              <ProgressBar value={(c.co2Kg / maxCo2) * 100} color={c.basis === "materialname" ? "#f59e0b" : "#fbbf24"} />
              <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                Band: {formatCarbon(c.lowKg)} – {formatCarbon(c.highKg)}
              </div>
            </div>
          ))}
          {match.byCategory.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">Keine zugeordnete Masse — siehe « Nicht zugeordnet » unten.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Par étage — règle bureau : cave → EG → OG → Dach. */}
        <Card>
          <CardHeader title="Je Geschoss" subtitle="Reihenfolge Keller → Dach (Büroregel)" />
          <div className="divide-y divide-slate-100 px-2 pb-2">
            {match.byLevel.map((l) => (
              <div key={l.level} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span className="font-semibold text-slate-700">{l.label}</span>
                <span className="text-right">
                  <span className="font-semibold tabular-nums text-slate-900">{formatCarbon(l.co2Kg)}</span>
                  <span className="ml-2 text-[10px] tabular-nums text-slate-400">{formatNumber(l.massKg / 1000, 1)} t</span>
                </span>
              </div>
            ))}
            {match.byLevel.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Keine Ebene mit Masse gefunden.</p>
            )}
          </div>
        </Card>

        {/* Non rapprochés — comptés, listés, JAMAIS cachés. */}
        <Card className={cn(match.unmatched.length > 0 && "border-rose-200")}>
          <CardHeader
            title={`Nicht zugeordnet · ${match.unmatched.length}`}
            subtitle="Extra gezählt — Stoffnamen im IFC nachziehen"
          />
          <div className="space-y-1.5 p-5">
            {match.unmatched.slice(0, 8).map((u) => (
              <div key={u.elementId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-slate-600">{u.name}</span>
                <span className="ml-2 shrink-0 font-mono text-[10px] text-slate-400">
                  {u.type.replace(/^IFC/i, "")} · {formatNumber(u.massKg / 1000, 1)} t
                </span>
              </div>
            ))}
            {match.unmatched.length > 8 && (
              <p className="text-center text-[10px] italic text-slate-400">+{match.unmatched.length - 8} weitere — siehe CSV-Export (Kategorien + Abdeckung).</p>
            )}
            {match.unmatched.length === 0 && (
              <p className="py-4 text-center text-sm text-emerald-600">100 % der Masse zugeordnet — saubere Modellierung.</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
