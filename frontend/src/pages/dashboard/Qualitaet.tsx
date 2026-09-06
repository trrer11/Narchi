import { useMemo, useRef, useState } from "react";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, SegmentedControl } from "@/components/ui";
import { RadialGauge } from "@/components/charts";
import { qcSummary, runBauteilQC } from "@/lib/clashRadar";
import { runRadarAnalysis } from "@/lib/qcRadarAnalysis";
import { downloadClashProtocolPdf } from "@/lib/clashProtocolPdf";
import { downloadBcf21Zip } from "@/lib/bcf21Zip";
import { matchTopics, parseBcfFile, type MatchedBcfTopic } from "@/lib/bcfImport";
import { CLASH_CLASS_LABEL } from "@/lib/clashGroups";
import { cn } from "@/utils/cn";

const SEV_COLOR: Record<string, string> = { critical: "#f43f5e", major: "#f59e0b", minor: "#94a3b8" };
const SEV_TONE: Record<string, "rose" | "amber" | "slate"> = { critical: "rose", major: "amber", minor: "slate" };

export default function Qualitaet() {
  const { activeElements } = useApp();
  const [tab, setTab] = useState<"clash" | "qc">("clash");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Qualitätssicherung"
        subtitle="AABB-Hüllkörper aus der IFC — kein Dreiecks-Mesh, kein Demo-Luftkanal"
        actions={<SegmentedControl value={tab} onChange={(v) => setTab(v as "clash" | "qc")} options={[{ value: "clash", label: "Clash-Radar" }, { value: "qc", label: "Bauteil-QC" }]} />}
      />
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-950">
        <strong>Verfahren AABB.</strong> Kollisionen sind Überschneidungen achsenausgerichteter Quader.
        Kein Mesh, kein Soft-Clash, kein Manifold. Anschlüsse (Öffnung, flaches Auflager) werden gefiltert und gezählt.
      </p>
      {tab === "clash" ? <ClashRadar /> : <BauteilQC elements={activeElements} />}
    </div>
  );
}

function ClashRadar() {
  const { activeElements, setQcFocus, navigate, activeProject } = useApp();
  const analysis = useMemo(() => runRadarAnalysis(activeElements), [activeElements]);
  const withBbox = activeElements.filter((e) => e.properties.some((p) => p.key === "bbox")).length;
  const bcfRef = useRef<HTMLInputElement | null>(null);
  const [bcfTopics, setBcfTopics] = useState<MatchedBcfTopic[] | null>(null);
  const [bcfErr, setBcfErr] = useState<string | null>(null);

  const jumpImported = (t: MatchedBcfTopic) => {
    if (t.group) {
      const r = t.group.representative;
      setQcFocus({
        center: r.hotspot.center,
        size: r.hotspot.size,
        label: t.title,
        hotspot: r.hotspot,
        at: Date.now(),
      });
      navigate("/app/import");
      return;
    }
    if (t.hotspot) {
      const center = t.hotspot;
      const size: [number, number, number] = [0.6, 0.6, 0.6];
      setQcFocus({ center, size, hotspot: { center, size }, label: t.title, at: Date.now() });
    }
    navigate("/app/import");
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Befunde" value={String(analysis.groups.length)} icon="cube" tone="cyan" />
        <Stat label="Echte Paare" value={String(analysis.realClashes.length)} icon="alert" tone="rose" />
        <Stat label="Anschlüsse (gefiltert)" value={String(analysis.connectionCount)} icon="layers" tone="amber" />
        <Stat label="Bauteile mit BBox" value={String(withBbox)} icon="building" tone="emerald" />
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={bcfRef}
          type="file"
          accept=".bcfzip,.bcf,.xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void (async () => {
              try {
                const topics = await parseBcfFile(f);
                setBcfTopics(matchTopics(topics, activeElements, analysis.groups));
                setBcfErr(null);
              } catch (err) {
                setBcfTopics(null);
                setBcfErr(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        />
        <Button size="sm" variant="secondary" onClick={() => bcfRef.current?.click()}>
          BCF importieren
        </Button>
        {withBbox > 0 && (
          <>
            <Button size="sm" variant="secondary" onClick={() => void downloadBcf21Zip(analysis.groups, activeElements)}>
              BCF 2.1 ZIP
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadClashProtocolPdf(analysis, activeProject?.name || "")}>
              Protokoll PDF
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const rows = [["Befund", "A", "B", "Schwere", "Paare"]];
                for (const g of analysis.groups) {
                  rows.push([g.title, g.representative.nameA, g.representative.nameB, g.severity, String(g.count)]);
                }
                const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "narchi-clash-radar.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Clash-Liste CSV
            </Button>
          </>
        )}
      </div>

      {bcfErr && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>BCF-Import fehlgeschlagen.</strong> {bcfErr}
        </p>
      )}
      {bcfTopics && (
        <Card className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              BCF importiert — {bcfTopics.length} Thema
              {bcfTopics.length === 1 ? "" : "en"} · {bcfTopics.filter((t) => t.elements.length > 0).length} gematcht
            </p>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setBcfTopics(null)}>
              schliessen
            </button>
          </div>
          {bcfTopics.slice(0, 40).map((t) => (
            <button
              key={t.guid}
              type="button"
              onClick={() => jumpImported(t)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
            >
              <span className="min-w-0 truncate font-semibold text-slate-800">{t.title}</span>
              <span className="shrink-0 text-[11px] text-slate-500">
                {t.elements.length > 0
                  ? `${t.elements.length} Bauteil(e)`
                  : t.hotspot
                    ? "3D aus Viewpoint"
                    : "kein Match"}
              </span>
            </button>
          ))}
        </Card>
      )}

      {activeElements.length === 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Kein Modell im Projekt — Radar bleibt leer. IFC speichern, dann hier neu öffnen.
        </p>
      )}
      {activeElements.length > 0 && withBbox === 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {activeElements.length} Bauteile, aber keine Bounding-Box — Kollisionen sind nicht messbar.
        </p>
      )}

      <div className="space-y-3">
        {analysis.groups.map((g) => {
          const r = g.representative;
          return (
            <Card key={g.id} className="overflow-hidden">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: SEV_COLOR[g.severity] }}>
                  <Icon name="cube" size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV_TONE[g.severity]}>{g.severity}</Badge>
                    <span className="text-xs font-mono text-slate-400">{g.id}</span>
                    <span className="text-xs text-slate-400">{g.count} Paar(e)</span>
                  </div>
                  <p className="mt-2 font-display text-base font-bold text-slate-900">{g.title}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {r.nameA} × {r.nameB}
                    {g.levels.length > 0 ? ` · ${g.levels.join(", ")}` : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {CLASH_CLASS_LABEL[g.classes[0]]} × {CLASH_CLASS_LABEL[g.classes[1]]}
                    {" · Eindringung "}
                    {g.typicalOverlap.map((m) => `${Math.round(m * 1000)} mm`).join(" × ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setQcFocus({
                        center: r.hotspot.center,
                        size: r.hotspot.size,
                        label: g.title,
                        hotspot: r.hotspot,
                        at: Date.now(),
                      });
                      navigate("/app/import");
                    }}
                  >
                    In 3D zeigen
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
        {analysis.groups.length === 0 && withBbox > 0 && (
          <p className="px-2 py-6 text-center text-sm text-slate-500">Keine echten Kollisionen (Anschlüsse/Öffnungen ausgefiltert).</p>
        )}
      </div>
    </>
  );
}

function BauteilQC({ elements }: { elements: Parameters<typeof runBauteilQC>[0] }) {
  const rules = useMemo(() => runBauteilQC(elements.map((e) => ({ type: e.type, status: e.status, conflicts: e.conflicts, properties: e.properties }))), [elements]);
  const summary = qcSummary(rules);
  const failed = rules.filter((r) => !r.passed);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center gap-3 p-6">
          <RadialGauge value={summary.score} size={150} label={summary.total === 0 ? "n.a." : "konform"} color={summary.total === 0 ? "#94a3b8" : summary.score >= 80 ? "#34d399" : summary.score >= 50 ? "#f59e0b" : "#f43f5e"} />
          <p className="text-center text-sm text-slate-500">
            {summary.total === 0 ? "Keine messbare Regel — Score 0, nicht 100 %." : "Bauteil-QC nur auf gemessenen Eigenschaften."}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="Prüfregeln" value={String(summary.total)} icon="shield" tone="cyan" />
          <Stat label="Bestanden (messbar)" value={String(summary.passed)} icon="check" tone="emerald" />
          <Stat label="Verletzt" value={String(summary.failed)} icon="alert" tone="amber" />
          <Stat label="Kritisch" value={String(summary.critical)} icon="x" tone="rose" />
        </div>
      </div>

      <Card>
        <CardHeader title="Automatische Bauteil-Prüfung" subtitle="Nur was im Modell steht — kein 8 %-Raten" action={<Badge tone="slate">{rules.length} Regeln</Badge>} />
        <div className="divide-y divide-slate-100">
          {rules.map((r) => {
            const color = r.passed ? "#34d399" : SEV_COLOR[r.severity];
            return (
              <div key={r.id} className="flex items-start gap-4 p-5">
                <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", r.passed ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                  <Icon name={r.passed ? "check" : "alert"} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{r.name}</span>
                    <Badge tone={r.passed ? "emerald" : SEV_TONE[r.severity]}>{r.category}</Badge>
                    {!r.passed && r.affected > 0 && <Badge tone="rose">{r.affected} betroffen</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{r.rule}</p>
                </div>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: color }}>
                  {r.passed ? "OK / n.m." : r.severity.toUpperCase()}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {failed.length > 0 && (
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50/50 p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Icon name="alert" size={18} /></span>
          <div>
            <p className="font-semibold text-slate-800">{failed.length} Prüfregel(n) verletzt</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{elements.length} Bauteile geprüft — nur gemessene Eigenschaften.</p>
          </div>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "cyan" | "rose" | "amber" | "emerald" }) {
  const c = { cyan: "bg-cyan-50 text-cyan-600", rose: "bg-rose-50 text-rose-600", amber: "bg-brand-50 text-brand-600", emerald: "bg-emerald-50 text-emerald-600" }[tone];
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c)}><Icon name={icon} size={20} /></span>
      <div><div className="font-display text-lg font-bold text-slate-900">{value}</div><div className="text-xs text-slate-500">{label}</div></div>
    </Card>
  );
}
