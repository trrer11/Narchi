import { useMemo, useState } from "react";
import { useApp } from "@/store/AppStore";
import { generatePdfReport, exportExcel, loadImageDims, type PdfBranding, type CarbonReportData } from "@/lib/reportEngine";
import { matchMaterials } from "@/lib/materialMatch";
import { buildCarbonReportData } from "@/lib/carbonCockpit";
import { buildVEOpportunities, takeoffVolumeM3BySubstitution } from "@/lib/veEngine";
import { fetchBranding } from "@/lib/branding";
import { downloadGaebDin276 } from "@/lib/gaebClient";
import { createInvoice } from "@/lib/invoices";
import { estimationToInvoiceLines } from "@/lib/estimationToInvoice";
import { invoiceBuyerFromProject } from "@/lib/invoiceBuyer";
import { unlock } from "@/lib/gamification";

import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar, Toggle } from "@/components/ui";
import { indexStandLabel } from "@/data/destatisIndex";
import { DonutChart, Legend, LineChart } from "@/components/charts";
import { runMonteCarlo, type SimulationResult } from "@/lib/monteCarlo";
import {
  fmtMoney,
  fmtMoney2,
  fmtNumber,
  fmtPerM2,
  fmtPct,
  type KGLine,
  DIN276_GROUP_LABELS,
  type Din276Fassung,
} from "@/lib/costEngine";
import { BAUWEISEN, ENERGIESTANDARDS } from "@/data/countries";
import { Disclaimer } from "@/components/Disclaimer";
import { cn } from "@/utils/cn";

const PALETTE = ["#f59e0b", "#22d3ee", "#34d399", "#a78bfa", "#fb7185", "#38bdf8"];

const KG_GROUP_META = [
  { code: "200", label: "Erschließung", tone: "slate", color: "#94a3b8", icon: "layers" as const },
  { code: "300", label: "Baukonstruktionen", tone: "amber", color: "#f59e0b", icon: "building" as const },
  { code: "400", label: "Technische Anlagen", tone: "cyan", color: "#22d3ee", icon: "bolt" as const },
  { code: "500", label: "Außenanlagen", tone: "emerald", color: "#34d399", icon: "leaf" as const },
  { code: "700", label: "Nebenkosten", tone: "violet", color: "#a78bfa", icon: "scale" as const },
];

export default function CostEstimation() {
  const { country, costConfig, setCostConfig, costResult, typologies, regions, qualities, activeProjectId, projects, navigate, activeElements, takeoff, hoaiResult, energyResult } = useApp();
  const p = projects.find((x) => x.id === activeProjectId);
  const cur = country.currency;
  const r = costResult;

  const [exportOpen, setExportOpen] = useState(false);
  const [gaebErr, setGaebErr] = useState<string | null>(null); // §74 — pas de fallback silencieux : l'erreur s'affiche
  const [rechnungErr, setRechnungErr] = useState<string | null>(null); // §151 — pont estimation → facture

  // §151 — « → Rechnung » : les Kostengruppen deviennent un BROUILLON de
  // facture (lignes Pauschal à 19 %) ; l'utilisateur RELIT puis émet. La note
  // honnête « aus Schätzung erstellt — Beträge prüfen » accompagne le brouillon.
  async function creerRechnungDepuisEstimation() {
    const lignes = estimationToInvoiceLines(r);
    if (lignes.length === 0) {
      setRechnungErr("Keine Kostengruppen in der Schätzung — nichts zu fakturieren.");
      return;
    }
    try {
      const dest = invoiceBuyerFromProject(p ?? {});
      await createInvoice({
        buyer_name: dest.buyer_name,
        buyer_street: dest.buyer_street,
        buyer_zip: dest.buyer_zip,
        buyer_city: dest.buyer_city,
        buyer_reference: dest.buyer_reference,
        notes: [dest.note, "Aus der Kostenschätzung DIN 276 erstellt — Beträge prüfen."],
        project_id: p?.id ?? null,
        lines: lignes,
      });
      setExportOpen(false);
      navigate("/app/rechnungen");
    } catch (e) {
      setRechnungErr(e instanceof Error ? e.message : String(e));
    }
  }

  const [expanded, setExpanded] = useState<Set<string>>(new Set(["300", "400"]));

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  // §71 — V2.8 : KG 200 (Erschließung) affichée selon la Fassung choisie.
  const groupLabels = DIN276_GROUP_LABELS[r.din276 ?? "2018"];
  const groups = useMemo(
    () => [
      { meta: { ...KG_GROUP_META[0], label: groupLabels.kg200 }, total: r.kg200, lines: r.lines200 },
      { meta: KG_GROUP_META[1], total: r.kg300, lines: r.lines300 },
      { meta: KG_GROUP_META[2], total: r.kg400, lines: r.lines400 },
      { meta: { ...KG_GROUP_META[3], label: groupLabels.kg500 }, total: r.kg500 - r.kg200, lines: r.lines500 },
      { meta: KG_GROUP_META[4], total: r.kg700, lines: r.lines700 },
    ],
    [r, groupLabels]
  );

  const donutSegments = groups.map((g, i) => ({ label: `KG ${g.meta.code}`, value: g.total, color: PALETTE[i] }));

  // (legacy CSV export removed — use exportOpen menu with PDF/Excel/GAEB)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kostenschätzung nach DIN 276"
        subtitle={`Baukosten für « ${p?.name ?? "kein Projekt"} » · ${country.flag} ${country.name} · ${country.docsRef}`}
        actions={
          <div className="relative">
            <Button size="sm" variant="secondary" icon="download" onClick={() => setExportOpen(o => !o)}>Export</Button>
            {exportOpen && (
              <div className="absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                <button onClick={() => void creerRechnungDepuisEstimation()} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50">
                  <Icon name="scale" size={14} /> → Rechnung (Entwurf)
                </button>
                <div className="mx-4 my-1 border-t border-slate-100" />
                <button onClick={async () => {
                  // §77 — « waw » livré : le PDF DIN 276 porte le logo du bureau.
                  // TOUJOURS le moteur client (le pitch serveur historique
                  // affiche un nom de code interne — pas un livrable client).
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
                  // §168 — le rapport financier embarque aussi le carbone (section 6)
                  // quand une maquette est présente — UN seul rapport complet.
                  let carbon: CarbonReportData | undefined;
                  if (activeElements.length > 0) {
                    const m = matchMaterials(activeElements, costConfig.ngf);
                    carbon = buildCarbonReportData({
                      match: m,
                      carbonBudgetKg: p?.carbonBudgetKg,
                      projectType: p?.type,
                      opportunities: buildVEOpportunities(takeoffVolumeM3BySubstitution(m), m.co2Kg),
                    });
                  }
                  generatePdfReport({ projectName: p?.name || "Ohne Projekt", cost: r, hoai: hoaiResult.orientierungGueltig ? hoaiResult : undefined, energy: energyResult.input.tfa > 0 ? energyResult : undefined, carbon }, branding);
                  setExportOpen(false);
                }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">
                  <Icon name="download" size={14} /> PDF
                </button>
                <button onClick={() => { exportExcel(r, energyResult.input.tfa > 0 ? energyResult : undefined, hoaiResult.orientierungGueltig ? hoaiResult : undefined, p?.name || "Ohne Projekt"); setExportOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">
                  <Icon name="download" size={14} /> Excel (XLSX)
                </button>
                <button onClick={async () => {
                  try {
                    await downloadGaebDin276(p?.name || "Narchi Projekt", r);
                    setGaebErr(null);
                  } catch (e) {
                    setGaebErr(e instanceof Error ? e.message : String(e));
                  }
                  setExportOpen(false);
                }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50">
                  <Icon name="download" size={14} /> GAEB X31 (DA XML 3.2)
                </button>
              </div>
            )}
            {gaebErr && <p className="mt-2 max-w-xs text-right text-[11px] text-red-600">{gaebErr}</p>}
            {rechnungErr && <p className="mt-2 max-w-xs text-right text-[11px] text-red-600">{rechnungErr}</p>}
          </div>
        }
      />

      <Disclaimer level="orientation" domain="DIN 276 Kostenschätzung (Leistungsphase 2–3)" />

      {costConfig.ngf <= 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Keine NGF — alle Beträge sind 0,00 €. Es wird keine Fläche von 30 m² erfunden und keine Größendegression gerechnet. Fläche tippen oder aus Projekt / IFC übernehmen.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {/* ============ INPUT PANEL ============ */}
        <div className="space-y-6">
          {/* country banner */}
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between bg-ink-950 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{country.flag}</span>
                <div>
                  <p className="font-display font-semibold">{country.name}</p>
                  <p className="text-xs text-slate-400">{country.framework} · USt. {fmtPct(country.vatRate)}</p>
                </div>
              </div>
              <Badge tone="emerald" dot>Aktiv</Badge>
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
              <Mini label="Währung" value={country.currency} />
              <Mini label="Flächenbasis" value={country.areaBasis} />
              <Mini label="Norm" value={country.framework.split(" ")[0]} />
            </div>
          </Card>

          {/* typology */}
          <Card className="p-5">
            <Label icon="building">Bauaufgabe (Typologie)</Label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {typologies.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setCostConfig({ typologyId: t.id })}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    costConfig.typologyId === t.id ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <div className="text-sm font-semibold text-slate-800">{t.name.split("(")[0].trim()}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{fmtMoney(t.benchmark)} / m²</div>
                </button>
              ))}
            </div>
          </Card>

          {/* area + region */}
          <Card className="p-5">
            <Label icon="scale">Nettogrundfläche (NGF)</Label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={costConfig.ngf}
                onChange={(e) => setCostConfig({ ngf: Number(e.target.value) || 0, ngfQuelle: "eingabe" })}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-lg font-bold text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
              <span className="shrink-0 text-sm font-semibold text-slate-400">m²</span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Daraus BGF (DIN 277): <span className="font-semibold text-slate-600">{fmtNumber(r.bgf)} m²</span>
              {costConfig.ngfQuelle === "messung" && costConfig.ngf > 0 && (
                <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Messung · IfcSpace</span>
              )}
            </p>

            <Label icon="pin" className="mt-5">Region (Bundesland / Stadt)</Label>
            <select
              value={costConfig.regionId}
              onChange={(e) => setCostConfig({ regionId: e.target.value })}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            >
              {regions.map((reg) => <option key={reg.id} value={reg.id}>{reg.name} (Faktor ×{reg.factor})</option>)}
            </select>

            <Label icon="gauge" className="mt-5">Ausstattungsstandard</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {qualities.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setCostConfig({ qualityId: q.id })}
                  className={cn(
                    "rounded-xl border p-2.5 text-left transition-all",
                    costConfig.qualityId === q.id ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  <div className="text-sm font-semibold text-slate-800">{q.name}</div>
                  <div className="text-[11px] text-slate-400">×{q.factor}</div>
                </button>
              ))}
            </div>

            <Label icon="calendar" className="mt-5">Bezugsjahr (Baukostenindex)</Label>
            <select
              value={costConfig.year}
              onChange={(e) => setCostConfig({ year: Number(e.target.value) })}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            >
              {[2022, 2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <Label icon="layers" className="mt-5">DIN 276 Fassung</Label>
            <div className="mt-2 flex gap-2">
              {(["2018", "2008"] as Din276Fassung[]).map((f) => (
                <button key={f} onClick={() => setCostConfig({ din276: f })} className={cn("h-9 flex-1 rounded-lg text-xs font-bold transition-colors", (costConfig.din276 ?? "2018") === f ? "bg-brand-500 text-ink-950" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                  {f === "2018" ? "2018-12 (aktuell)" : "2008-12 (HOAI)"}
                </button>
              ))}
            </div>
            {(costConfig.din276 ?? "2018") === "2008" && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                <Icon name="scale" size={13} className="mr-1" />
                HOAI 2021 referenziert DIN 276-1:2008-12. Anrechenbare Kosten i. d. R. = KG 300 + 400. Beträge unverändert — nur Zuordnung und Bezeichnung.
              </div>
            )}
          </Card>

          {/* building parameters — realism */}
          <Card className="p-5">
            <Label icon="layers">Gebäudeparameter</Label>
            <p className="mt-1 text-[11px] text-slate-400">Bestimmen Größendegression, Unter-/Obergeschosse</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Untergeschosse">
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((n) => (
                    <button key={n} onClick={() => setCostConfig({ untergeschosse: n })} className={cn("h-9 flex-1 rounded-lg text-sm font-bold transition-colors", costConfig.untergeschosse === n ? "bg-brand-500 text-ink-950" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>{n}</button>
                  ))}
                </div>
              </Field>
              <Field label="Obergeschosse">
                <input type="number" min={1} max={40} value={costConfig.obergeschosse} onChange={(e) => setCostConfig({ obergeschosse: Math.max(1, Number(e.target.value) || 1) })} className="h-9 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-900 focus:border-brand-400 focus:outline-none" />
              </Field>
            </div>
            <Field label="Bauweise" className="mt-3">
              <select value={costConfig.bauweiseId} onChange={(e) => setCostConfig({ bauweiseId: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none">
                {BAUWEISEN.map((b) => <option key={b.id} value={b.id}>{b.name} (×{b.factor})</option>)}
              </select>
            </Field>
            <Field label="Energiestandard" className="mt-3">
              <select value={costConfig.energiestandardId} onChange={(e) => setCostConfig({ energiestandardId: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-brand-400 focus:outline-none">
                {ENERGIESTANDARDS.map((e) => <option key={e.id} value={e.id}>{e.name} (×{e.factor})</option>)}
              </select>
            </Field>
            {r.sizeFactor !== 1 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-2 text-[11px] text-cyan-700">
                <Icon name="target" size={13} />
                Größendegression ×{r.sizeFactor.toFixed(2)} {r.sizeFactor > 1 ? "(kleines Gebäude → teurer/m²)" : "(großes Gebäude → günstiger/m²)"}
              </div>
            )}
          </Card>

          {/* options */}
          <Card className="p-5">
            <Label icon="sliders">Optionen</Label>
            <div className="mt-3 space-y-3">
              <OptionRow label="Umsatzsteuer einbeziehen" desc={`USt. ${fmtPct(country.vatRate)} aufaddieren`}>
                <Toggle checked={costConfig.includeVat} onChange={(v) => setCostConfig({ includeVat: v })} />
              </OptionRow>
              <OptionRow label="Baugrund (KG 710)" desc="Grundstückswert berücksichtigen">
                <Toggle checked={costConfig.includeLand} onChange={(v) => setCostConfig({ includeLand: v })} />
              </OptionRow>
              {costConfig.includeLand && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={costConfig.landValue}
                    onChange={(e) => setCostConfig({ landValue: Number(e.target.value) || 0 })}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                  />
                  <span className="shrink-0 text-xs font-semibold text-slate-400">{cur}</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ============ RESULTS ============ */}
        <div className="space-y-6">
          {/* headline */}
          <Card className="overflow-hidden">
            <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
              <Headline label="Baukosten (netto)" value={fmtMoney(r.netTotal, cur)} sub={fmtPerM2(r.perM2Ngf, cur) + " NGF"} tone="amber" />
              <Headline label="Gesamtsumme" value={fmtMoney(r.grossTotal, cur)} sub={r.vatAmount ? `inkl. ${fmtMoney(r.vatAmount, cur)} USt.` : "ohne USt."} tone="cyan" />
              <Headline label="€ / m² NGF" value={fmtNumber(r.perM2Ngf)} sub={`Benchmark ${fmtNumber(r.benchmarkAdj)}`} tone="emerald" />
              <Headline label="€ / m² BGF" value={fmtNumber(r.perM2Bgf)} sub={`Bruttogrundfläche ${fmtNumber(r.bgf)} m²`} tone="violet" />
            </div>
          </Card>

          {/* §49 — Badge de crédibilité OBLIGATOIRE (charte §36) : la nature
              RICHTWERT du chiffre et le Stand de l'index officiel uniques —
              fini tout prix sans provenance visible. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5">
            <Badge tone="amber" dot>Richtwert</Badge>
            <p className="text-[11px] leading-relaxed text-amber-900">
              Marktkennwert (keine Angebotsbindung) · {indexStandLabel()}
              {" · "}Kostenspanne ±{Math.round(r.uncertaintyPct * 100)} % —{" "}
              Werte je m² <strong>NGF</strong> (DIN 277); BGF-Umrechnung: Spalte « € / m² BGF »
              (BKI-Vergleiche nutzen meist BGF/NF-Konventionen).
            </p>
          </div>

          {/* Kostenspanne (confidence interval) */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="target" size={18} className="text-brand-500" />
                <h3 className="font-display font-semibold text-slate-900">Kostenspanne (Konfidenzintervall)</h3>
              </div>
              <Badge tone="amber">±{fmtPct(r.uncertaintyPct, 0)}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-400">DIN 276 Kostenschätzung LP 2–3 · realistische Preisspanne für die Baueingabe</p>
            <div className="mt-4">
              {/* range bar */}
              <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="absolute h-full rounded-full bg-gradient-to-r from-emerald-400 via-brand-400 to-rose-400" style={{ left: "8%", right: "8%" }} />
                <div className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-ink-950" style={{ left: "50%" }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <div className="text-[11px] text-emerald-600">Günstig (Untergrenze)</div>
                  <div className="font-display text-base font-bold text-slate-900">{fmtMoney(r.low, cur)}</div>
                  <div className="text-[11px] text-slate-400">{fmtNumber(r.lowPerM2)} €/m²</div>
                </div>
                <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
                  <div className="text-[11px] text-brand-600">Planwert (realistisch)</div>
                  <div className="font-display text-base font-bold text-slate-900">{fmtMoney(r.netTotal, cur)}</div>
                  <div className="text-[11px] text-slate-400">{fmtNumber(r.perM2NgfNet)} €/m²</div>
                </div>
                <div className="rounded-xl bg-rose-50 p-3">
                  <div className="text-[11px] text-rose-600">Teuer (Obergrenze)</div>
                  <div className="font-display text-base font-bold text-slate-900">{fmtMoney(r.high, cur)}</div>
                  <div className="text-[11px] text-slate-400">{fmtNumber(r.highPerM2)} €/m²</div>
                </div>
              </div>
            </div>
          </Card>

          {/* benchmark trace */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-slate-900">Kalkulationsweg</h3>
              <Badge tone="slate">transparent</Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <Chip>{fmtMoney(r.benchmarkBase)} / m²</Chip>
              <Op>×</Op>
              <Chip>Region ×{r.regionFactor}</Chip>
              <Op>×</Op>
              <Chip>Standard ×{r.qualityFactor}</Chip>
              <Op>×</Op>
              <Chip>Index {r.input.year} ×{r.yearFactorValue.toFixed(2)}</Chip>
              <Chip>Quelle: Katalog 2024 · {indexStandLabel()}</Chip>
              <Op>×</Op>
              <Chip>Größe ×{r.sizeFactor.toFixed(2)}</Chip>
              <Op>×</Op>
              <Chip>Geschosse ×{r.floorsFactor.toFixed(2)}</Chip>
              <Op>=</Op>
              <Chip strong>{fmtMoney(r.benchmarkAdj)} / m²</Chip>
              <Op>×</Op>
              <Chip>{fmtNumber(r.input.ngf)} m²</Chip>
              <Op>×</Op>
              <Chip>Bauweise ×{r.bauweiseFactor}</Chip>
              <Op>+</Op>
              {r.basementCost > 0 && <><Chip strong>{fmtMoney(r.basementCost, cur)}</Chip><span className="text-xs text-slate-400">UG-Zuschlag</span><Op>+</Op></>}
              <Op>=</Op>
              <Chip strong>{fmtMoney(r.kg300 + r.kg400, cur)}</Chip>
              <span className="text-xs text-slate-400">(KG 300 + KG 400)</span>
            </div>
          </Card>

          {/* breakdown */}
          <Card>
            <CardHeader title="Kostengliederung nach DIN 276" subtitle="KG 300 – KG 700 mit Detailpositionen" />
            <div className="divide-y divide-slate-100">
              {groups.map((g) => {
                const open = expanded.has(g.meta.code);
                return (
                  <div key={g.meta.code}>
                    <button onClick={() => toggle(g.meta.code)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: g.meta.color + "22", color: g.meta.color }}>
                        <Icon name={g.meta.icon} size={18} />
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400">KG {g.meta.code}</span>
                          <span className="font-semibold text-slate-800">{g.meta.label}</span>
                        </div>
                        <div className="mt-1 max-w-md"><ProgressBar value={g.total ? (g.total / r.netTotal) * 100 : 0} color={g.meta.color} /></div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-base font-bold text-slate-900">{fmtMoney(g.total, cur)}</div>
                        <div className="text-xs text-slate-400">{r.netTotal > 0 ? fmtPct(g.total / r.netTotal) : "—"} · {r.input.ngf > 0 ? `${fmtNumber(g.total / r.input.ngf)} €/m²` : "—"}</div>
                      </div>
                      <Icon name="chevronDown" size={16} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
                    </button>
                    {open && g.lines.length > 0 && (
                      <div className="bg-slate-50/60 px-5 pb-3">
                        <table className="w-full text-sm">
                          <tbody>
                            {g.lines.map((l: KGLine) => (
                              <tr key={l.code} className="border-b border-slate-100 last:border-0">
                                <td className="py-2.5 pl-9 font-mono text-xs text-slate-400">{l.code}</td>
                                <td className="py-2.5 text-slate-600">{l.label}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-400">{fmtPct(l.share)}</td>
                                <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmtMoney2(l.amount, cur)}</td>
                                <td className="py-2.5 text-right tabular-nums text-slate-400">{fmtNumber(l.perM2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* totals */}
            <div className="space-y-1 border-t border-slate-200 bg-slate-50 px-5 py-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Summe KG 300–700 (netto)</span><span className="font-display font-bold text-slate-900">{fmtMoney(r.netTotal, cur)}</span></div>
              {r.landNet > 0 && <div className="flex justify-between"><span className="text-slate-500">+ Baugrund (netto)</span><span className="font-semibold text-slate-700">{fmtMoney(r.landNet, cur)}</span></div>}
              {r.vatAmount > 0 && <div className="flex justify-between"><span className="text-slate-500">+ Umsatzsteuer {fmtPct(country.vatRate)}</span><span className="font-semibold text-slate-700">{fmtMoney(r.vatAmount, cur)}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-display font-bold text-slate-900">Gesamtsumme</span><span className="font-display text-lg font-bold text-brand-600">{fmtMoney(r.grossTotal, cur)}</span></div>
            </div>
          </Card>

          {/* distribution */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Kostenverteilung" subtitle="Anteil der Kostengruppen" />
              <div className="flex flex-col items-center gap-4 p-5">
                <DonutChart segments={donutSegments} centerLabel={fmtMoney(r.netTotal, cur)} centerSub="netto" size={172} />
                <div className="w-full"><Legend items={donutSegments.map((s, i) => ({ label: `${s.label} ${KG_GROUP_META[i].label}`, value: fmtMoney(s.value, cur), color: s.color }))} /></div>
              </div>
            </Card>

            <MonteCarloCard netTotal={r.netTotal} kg300={r.kg300} kg400={r.kg400} kg500={r.kg500} kg700={r.kg700} erlaubt={r.schaetzungGueltig} />

            <Card>
              <CardHeader title="Benchmark-Vergleich" subtitle="€/m² NGF gegenüber Deutschland-Durchschnitt" />
              <div className="space-y-4 p-5">
                {typologies.filter((_, i) => i < 5).map((t) => {
                  const isActive = t.id === costConfig.typologyId;
                  const isCurrent = isActive;
                  return (
                    <div key={t.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className={cn("text-slate-600", isCurrent && "font-bold text-slate-900")}>{t.name.split("(")[0].trim()}</span>
                        <span className="font-semibold tabular-nums text-slate-800">{fmtMoney(t.benchmark)}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(t.benchmark / Math.max(...typologies.map((x) => x.benchmark), 1)) * 100}%`, background: isCurrent ? "#f59e0b" : "#cbd5e1" }} />
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-xl bg-brand-50 p-3 text-xs text-brand-700">
                  <Icon name="target" size={14} className="mr-1 inline" />
                  Aktueller Ansatz: <strong>{fmtNumber(r.benchmarkAdj)} €/m²</strong> bei Standard ×{r.qualityFactor}, Region ×{r.regionFactor}.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------- small building blocks -------- */
function Label({ icon, children, className }: { icon: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400", className)}>
      <Icon name={icon} size={14} /> {children}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-2 py-3">
      <div className="font-display text-sm font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
function OptionRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm font-semibold text-slate-800">{label}</p><p className="text-xs text-slate-400">{desc}</p></div>
      {children}
    </div>
  );
}
function Headline({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "amber" | "cyan" | "emerald" | "violet" }) {
  const c = { amber: "text-brand-600", cyan: "text-cyan-600", emerald: "text-emerald-600", violet: "text-violet-600" }[tone];
  return (
    <div className="bg-white p-5">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-bold", c)}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{sub}</div>
    </div>
  );
}
function Chip({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <span className={cn("rounded-lg px-2.5 py-1 text-sm", strong ? "bg-ink-900 font-bold text-white" : "bg-slate-100 text-slate-600")}>{children}</span>;
}
function Op({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400">{children}</span>;
}

/* Monte Carlo risk simulation card — real statistical sensitivity analysis. */
function MonteCarloCard({ netTotal, kg300, kg400, kg500, kg700, erlaubt = true }: { netTotal: number; kg300: number; kg400: number; kg500: number; kg700: number; erlaubt?: boolean }) {
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setSim(null);
    // simulate with the real cost structure
    const fakeCost = { netTotal, kg300, kg400, kg500, kg700 } as never;
    await new Promise((r) => setTimeout(r, 800)); // UI feedback
    setSim(runMonteCarlo(fakeCost, netTotal, 5000));
    setRunning(false);
    void unlock("first_montecarlo");
  };

  return (
    <Card>
      <CardHeader
        title="Monte-Carlo-Risikoanalyse"
        subtitle="5.000 simulierte Szenarien · P50/P90 · Triangularverteilung"
        action={sim ? <Badge tone="emerald" dot>5.000 Iterationen</Badge> : undefined}
      />
      <div className="p-5">
        {!sim && !running && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Icon name="pulse" size={24} /></span>
            <p className="text-sm text-slate-500">
              {erlaubt
                ? "Führe 5.000 randomisierte Kostensimulationen aus — mit realistischen Unsicherheiten je Kostengruppe."
                : "Ohne NGF keine Simulation — sonst wäre das Zufall auf 0 €."}
            </p>
            <Button size="sm" icon="spark" onClick={run} disabled={!erlaubt}>Simulation starten</Button>
          </div>
        )}
        {running && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Icon name="refresh" size={28} className="animate-spin text-brand-500" />
            <p className="text-sm text-slate-500">Simuliere 5.000 Szenarien…</p>
          </div>
        )}
        {sim && (
          <div className="space-y-4">
            {/* distribution chart */}
            <div>
              <LineChart data={sim.distribution.map((d) => d.y)} height={160} color="#f59e0b" />
              <p className="mt-1 text-center text-[11px] text-slate-400">Wahrscheinlichkeitsverteilung der Baukosten</p>
            </div>
            {/* percentiles */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <div className="text-[11px] text-emerald-600">P10 (optimistisch)</div>
                <div className="font-display text-sm font-bold text-slate-900">{fmtMoney(sim.p10)}</div>
              </div>
              <div className="rounded-xl bg-brand-50 p-3 text-center ring-1 ring-brand-200">
                <div className="text-[11px] text-brand-600">P50 (Median)</div>
                <div className="font-display text-sm font-bold text-slate-900">{fmtMoney(sim.median)}</div>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 text-center">
                <div className="text-[11px] text-rose-600">P90 (pessimistisch)</div>
                <div className="font-display text-sm font-bold text-slate-900">{fmtMoney(sim.p90)}</div>
              </div>
            </div>
            {/* drivers */}
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">Kostentreiber (Sensitivität)</p>
              <div className="space-y-2">
                {sim.drivers.map((d, i) => (
                  <div key={i}>
                    <div className="mb-0.5 flex justify-between text-xs">
                      <span className="text-slate-600">{d.factor}</span>
                      <span className="font-semibold text-slate-800">±{fmtMoney(d.sensitivity)}</span>
                    </div>
                    <ProgressBar value={(d.sensitivity / sim.drivers[0].sensitivity) * 100} color={["#f59e0b", "#22d3ee", "#34d399", "#a78bfa", "#94a3b8"][i]} />
                  </div>
                ))}
              </div>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <Icon name="shield" size={12} className="mr-1 inline" />
              Methodik: Triangularverteilung je KG-Gruppe (KG300 ±10%, KG400 ±15%, KG500 ±20%, KG700 ±5%), 5.000 Iterationen.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><label className="text-xs font-semibold text-slate-500">{label}</label>{children}</div>;
}
