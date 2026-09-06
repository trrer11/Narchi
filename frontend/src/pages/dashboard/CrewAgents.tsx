import { useState } from "react";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, Icon, PageHeader } from "@/components/ui";
import { FINDING_SOURCE_META, runCrew, type AgentReport, type AgentFinding, type QcSignals } from "@/lib/crewAgents";
import { resolveAuditInput } from "@/lib/qcSources";
import { ClashDetector } from "@/lib/planpruefung";
import { AuditEngine } from "@/lib/AuditEngine";
import { unlock } from "@/lib/gamification";
import { audit } from "@/lib/auditTrail";
import { cn } from "@/utils/cn";

const SEV_META: Record<AgentFinding["severity"], { label: string; tone: string; color: string }> = {
  critical: { label: "Kritisch", tone: "rose", color: "#f43f5e" },
  warning: { label: "Warnung", tone: "amber", color: "#f59e0b" },
  opportunity: { label: "Chance", tone: "emerald", color: "#34d399" },
  info: { label: "Info", tone: "sky", color: "#0ea5e9" },
};

/// Tones des badges de provenance — la fiabilité rendue visible.
const SOURCE_TONE: Record<AgentFinding["source"], string> = {
  messung: "bg-emerald-50 text-emerald-700 ring-emerald-600/30",
  richtwert: "bg-amber-50 text-amber-700 ring-amber-600/30",
  regel: "bg-sky-50 text-sky-700 ring-sky-600/30",
};

export default function CrewAgents() {
  const { elements, takeoff, activeProjectId, activeProject, costResult, energyResult, costConfig } = useApp();
  const [result, setResult] = useState<ReturnType<typeof runCrew> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [animStep, setAnimStep] = useState(0);
  const [qcNote, setQcNote] = useState<string | null>(null);

  /// Signaux QC RÉELS du modèle (mêmes moteurs que la page QC & Conformité —
  /// donc mêmes chiffres, donc fiables). Null = pas de modèle analysable.
  const computeQcSignals = (): QcSignals | null => {
    try {
      const projectElements = elements.filter((e) => e.projectId === activeProjectId);
      const auditInput = resolveAuditInput(projectElements, takeoff);
      if (auditInput.elements.length === 0) return null;
      const clashes = ClashDetector.detectClashes(auditInput.elements);
      const report = AuditEngine.runFullAudit(auditInput.elements);
      // Couverture de mesure : borne inférieure honnête (max par règle — un
      // élément peut être mesuré par plusieurs règles, on ne surestime pas).
      const measured = report.ruleStats
        ? report.ruleStats.reduce((max, r) => Math.max(max, r.measurable ?? 0), 0)
        : 0;
      return {
        clashCount: clashes.length,
        hardCount: clashes.filter((c) => c.severity === "critical").length,
        ruleIssues: report.totalIssues,
        ruleCritical: report.criticalCount,
        measuredElements: measured,
        totalElements: auditInput.elements.length,
      };
    } catch {
      return null; // jamais de crash de la page Agents à cause du QC
    }
  };

  const run = async () => {
    setAnalyzing(true);
    setResult(null);
    setAnimStep(0);
    // animate the agents lighting up
    for (let i = 0; i <= 6; i++) {
      await new Promise((r) => setTimeout(r, 350));
      setAnimStep(i);
    }
    const qc = computeQcSignals();
    setQcNote(
      qc
        ? `Modell live vermessen: ${qc.totalElements.toLocaleString("de-DE")} Bauteile, ${qc.clashCount.toLocaleString("de-DE")} Kollisionen, ${qc.ruleIssues.toLocaleString("de-DE")} Norm-Verstöße.`
        : "Ohne geladenes Modell nur Checklisten — Modul „Modell-Import“ öffnen für Messungen.",
    );
    const r = runCrew({
      projectName: activeProject.name,
      typology: costConfig.typologyId,
      typologyName: activeProject.type,
      ngf: costConfig.ngf,
      cost: costResult,
      energy: energyResult,
      qc,
      region: "Deutschland",
      year: costConfig.year,
    });
    setResult(r);
    setAnalyzing(false);
    void unlock("first_crew");
    void audit("crew_run", activeProject.id, `Crew-Analyse: ${activeProject.name}, Score ${r.overallScore}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prüf-Crew"
        subtitle="Sechs Checklisten-Agenten, lokal und deterministisch. Kollisionen = AABB, kein Mesh. Ohne Modell nur Checkliste."
        actions={
          <Button icon="spark" onClick={run} disabled={analyzing}>
            {analyzing ? "Agenten arbeiten…" : result ? "Neu analysieren" : "Crew starten"}
          </Button>
        }
      />

      {/* Légende de provenance — LA réponse au « chiffres non fiables » : un
          chiffre sans source est interdit, tout est étiqueté. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-semibold">
        <span className="text-slate-400">Quelle je Zahl:</span>
        {(Object.keys(FINDING_SOURCE_META) as AgentFinding["source"][]).map((s) => (
          <span key={s} title={FINDING_SOURCE_META[s].hint} className={cn("rounded-full px-2.5 py-1 ring-1", SOURCE_TONE[s])}>
            {FINDING_SOURCE_META[s].label}
          </span>
        ))}
        <span className="ml-auto text-slate-400">Scores nur aus gemessenen Daten gemittelt</span>
      </div>
      {qcNote && !analyzing && (
        <p className={cn("rounded-xl px-4 py-2 text-xs font-semibold", result ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500")}>
          {qcNote}
        </p>
      )}

      {/* hero banner when no analysis */}
      {!result && !analyzing && (
        <Card className="overflow-hidden border-brand-200 bg-gradient-to-br from-brand-50 to-white p-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-ink-950">
              <Icon name="spark" size={32} />
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">Multi-Agenten-Analyse für {activeProject.name}</h2>
            <p className="mt-2 text-sm text-slate-600">
              Sechs spezialisierte Agenten (Kosten, Nachhaltigkeit, Risiko, Markt, Förderung, Architektur) analysieren dein Projekt
              aus je eigener Perspektive — <strong>100% deterministisch, 0% Cloud</strong>. Und vor allem: <strong>jede Zahl trägt ihre
              Quelle</strong> — <em className="text-emerald-700">Messung</em> (aus deinem Modell berechnet),
              {" "}<em className="text-amber-700">Richtwert</em> (Markt-Orientierung, zu prüfen) oder
              {" "}<em className="text-sky-700">Regel</em> (Norm/Checkliste). Schluss mit unzuverlässigen Zahlen.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                { e: "💰", n: "Kosten" },
                { e: "🌿", n: "Nachhaltig" },
                { e: "⚠️", n: "Risiko" },
                { e: "📈", n: "Markt" },
                { e: "💶", n: "Förderung" },
                { e: "🏛️", n: "Architektur" },
              ].map((a, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span className="text-2xl">{a.e}</span>
                  <span className="text-[10px] font-semibold text-slate-500">{a.n}</span>
                </div>
              ))}
            </div>
            <Button size="lg" className="mt-6" icon="spark" onClick={run}>Crew-Agenten starten</Button>
          </div>
        </Card>
      )}

      {/* analyzing animation */}
      {analyzing && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["💰 Kosten", "🌿 Nachhaltigkeit", "⚠️ Risiko", "📈 Markt", "💶 Förderung", "🏛️ Architektur"].map((a, i) => (
            <Card key={i} className={cn("flex items-center gap-3 p-5 transition-all", i < animStep ? "border-emerald-300 bg-emerald-50/50" : "opacity-40")}>
              <span className="text-2xl">{a.split(" ")[0]}</span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{a.split(" ")[1]}</p>
                <p className="text-xs text-slate-500">{i < animStep ? "✓ Analyse fertig" : i === animStep ? "Analysiere…" : "Wartet"}</p>
              </div>
              {i === animStep && <Icon name="refresh" size={16} className="ml-auto animate-spin text-brand-500" />}
              {i < animStep && <Icon name="check" size={16} className="ml-auto text-emerald-500" />}
            </Card>
          ))}
        </div>
      )}

      {/* results */}
      {result && !analyzing && (
        <>
          {/* synthesis banner */}
          <Card className="overflow-hidden bg-ink-950 text-white">
            <div className="bp-grid-fine relative p-6">
              <div className="relative grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center">
                <div className="flex flex-col items-center">
                  <div className="font-display text-5xl font-bold text-brand-300">{result.overallScore}</div>
                  <div className="text-xs text-slate-400">/ 100</div>
                  <div className="mt-2 h-2 w-24 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${result.overallScore}%` }} />
                  </div>
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold">Synthese der Multi-Agenten-Analyse</h3>
                  <div className="mt-2 flex gap-4">
                    {result.criticalCount > 0 && <Badge tone="rose">{result.criticalCount} kritisch</Badge>}
                    {result.opportunityCount > 0 && <Badge tone="emerald">{result.opportunityCount} Chancen</Badge>}
                    <Badge tone="cyan">6 Agenten · {result.reports.reduce((s, r) => s + r.findings.length, 0)} Befunde</Badge>
                  </div>
                  {result.topPriorities.length > 0 && (
                    <ol className="mt-3 space-y-1">
                      {result.topPriorities.map((p, i) => (
                        <li key={i} className="text-sm text-slate-300">{i + 1}. {p}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* agent cards */}
          <div className="grid gap-4 lg:grid-cols-2">
            {result.reports.map((report) => (
              <AgentCard key={report.role} report={report} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard({ report }: { report: AgentReport }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{report.emoji}</span>
          <div>
            <h4 className="font-display text-sm font-bold text-slate-900">{report.name}</h4>
            <p className="text-[11px] text-slate-400">{report.summary}</p>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("font-display text-lg font-bold", report.score >= 85 ? "text-emerald-600" : report.score >= 70 ? "text-brand-600" : "text-rose-600")}>{report.score}</div>
          <div className="text-[10px] text-slate-400">
            {report.scoredFromData ? (
              <span className="rounded bg-emerald-50 px-1 font-bold text-emerald-600">gemessen</span>
            ) : (
              <span className="rounded bg-amber-50 px-1 font-bold text-amber-600" title="Kein Projekt-Datensignal — neutraler Score">neutral</span>
            )}
          </div>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {report.findings.map((f, i) => {
          const meta = SEV_META[f.severity];
          const sm = FINDING_SOURCE_META[f.source];
          return (
            <div key={i} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{f.title}</span>
                  {f.metric && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{f.metric}</span>}
                  <span title={sm.hint} className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1", SOURCE_TONE[f.source])}>
                    {sm.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{f.detail}</p>
                <p className="mt-1 flex items-start gap-1 text-xs text-brand-700"><Icon name="arrowRight" size={11} className="mt-0.5 shrink-0" />{f.recommendation}</p>
              </div>
              <span className="shrink-0 text-[10px] text-slate-400" title="Regel-Konfidenz (deterministisch)">{Math.round(f.confidence * 100)}%</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
