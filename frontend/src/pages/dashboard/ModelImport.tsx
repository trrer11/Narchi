import { lazy, Suspense, useCallback, useRef, useState, useEffect } from "react";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, CardHeader, Icon, PageHeader, ProgressBar } from "@/components/ui";
import { DonutChart, Legend } from "@/components/charts";
const ModelViewer = lazy(() =>
  import("@/components/ModelViewer").then((module) => ({ default: module.ModelViewer })),
);
const RealIfcViewer = lazy(() =>
  import("@/components/RealIfcViewer").then((module) => ({ default: module.RealIfcViewer })),
);
const WebIfcMainThreadViewer = lazy(() =>
  import("@/components/WebIfcMainThreadViewer").then((module) => ({ default: module.WebIfcMainThreadViewer })),
);
import { loadDemoTakeoff, parseConstructionFile, type ModelTakeoff } from "@/lib/modelTakeoff";
import { IfcWorkerPool } from "@/bim/WorkerWatchdog";
import { importIfcResilient } from "@/bim/ifcImport";
import { areWorkersBlocked } from "@/bim/workerEnv";
import KostengruppenSchaetzung from "@/components/KostengruppenSchaetzung";
import KostenVergleich from "@/components/KostenVergleich";
import { clearIfcModel, loadIfcModel, saveIfcModel } from "@/lib/ifcPersistence";
import { bboxFromMeshBox } from "@/lib/qcSources";
import { writeQcXrayPreference } from "@/lib/qcFocus3d";
import { checkBackendHealth } from "@/lib/apiClient";
import {
  DEFAULT_REGION,
  ESTIMATE_REGIONS,
  downloadGaebX31,
  requestQuickEstimate,
  type QuickEstimateResponse,
} from "@/lib/quickEstimate";
import { secureFetch } from "@/auth/SecuritySanitizer";
import { useToast } from "@/components/Toaster";
import { estimateCost } from "@/lib/costEngine";
import { DE_REGIONS, QUALITY_STANDARDS, activeCountry } from "@/data/countries";
import { typologyById } from "@/data/typologies";
import { fmtMoney, fmtNumber } from "@/lib/costEngine";
import { formatCarbon } from "@/lib/format";
import { cn } from "@/utils/cn";
import { applyModellZumBuero } from "@/lib/applyModellZumBuero";

const PALETTE = ["#f59e0b", "#22d3ee", "#34d399", "#a78bfa", "#fb7185", "#38bdf8"];
const FORMAT_META: Record<string, { tone: "emerald" | "amber" | "rose"; note: string }> = {
  IFC: { tone: "emerald", note: "IFC (offener BIM-Standard) — vollständiger Mengenauszug" },
  DXF: { tone: "amber", note: "DXF (CAD-Austauschformat) — Mengen aus Ebenen (näherungsweise)" },
  DWG: { tone: "rose", note: "DWG — nicht ausgelesen: bitte als IFC exportieren (ehrlich statt Schätzung)" },
  RVT: { tone: "rose", note: "RVT — nicht ausgelesen: bitte als IFC exportieren (ehrlich statt Schätzung)" },
};

export default function ModelImport() {
  const { takeoff, setTakeoff, addProject, addElements, navigate, activeProject, setCostConfig, setEnergyConfig, updateProject } = useApp();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ifcWorkerPoolRef = useRef<IfcWorkerPool | null>(null);

  useEffect(() => () => {
    ifcWorkerPoolRef.current?.dispose();
    ifcWorkerPoolRef.current = null;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const extension = file.name.toLowerCase();
      let result: ModelTakeoff;
      if (extension.endsWith(".ifc") || extension.endsWith(".step")) {
        const pool = ifcWorkerPoolRef.current ?? new IfcWorkerPool();
        ifcWorkerPoolRef.current = pool;
        // Deux moteurs : Worker d'abord, thread principal en secours si le
        // Worker ne peut pas démarrer dans cet environnement.
        const { payload: parsed, engine } = await importIfcResilient(
          pool,
          () => file.arrayBuffer(),
          file.name,
          90_000,
        );
        if (engine === "main-thread") {
          console.info("[IFC] Import réalisé sur le thread principal (Worker indisponible).");
        }
        result = {
          ...parsed.takeoff,
          ifcObjectUrl: URL.createObjectURL(file),
          sourceFile: file,
        };
        // Persistance locale du dernier modèle : au prochain chargement de la
        // page, la maquette est restaurée sans ré-import (fire-and-forget).
        void saveIfcModel(file);
      } else {
        result = await parseConstructionFile(file);
      }
      setTakeoff(result);
    } catch (e) {
      setError("Datei konnte nicht gelesen werden: " + (e instanceof Error ? e.message : "unbekannt"));
      setTakeoff(null);
    } finally {
      setBusy(false);
    }
  }, [setTakeoff]);

  const handleDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await loadDemoTakeoff();
      setTakeoff(result);
    } catch {
      setError("Demo-Modell konnte nicht erzeugt werden.");
    } finally {
      setBusy(false);
    }
  }, [setTakeoff]);

  // Restauration du dernier modèle persisté (IndexedDB) : après un F5, la
  // maquette (takeoff + vraie géométrie 3D) ré-apparaît sans ré-import,
  // via la même chaîne résiliente qu'un import manuel.
  // Garde : seul un fichier source LIVE empêche la restauration — le takeoff
  // ramené par le store persisté n'a PAS de sourceFile (partialize le retire)
  // et n'affiche que ses boîtes analytiques : il DOIT être remplacé par le
  // vrai modèle reconstitué (sinon : « F5 → cubes bizarres »).
  useEffect(() => {
    if (takeoff?.sourceFile) return;
    let cancelled = false;
    void (async () => {
      const saved = await loadIfcModel();
      if (cancelled || !saved) return;
      const lower = saved.name.toLowerCase();
      if (!lower.endsWith(".ifc") && !lower.endsWith(".step")) return;
      const file = new File([saved.bytes], saved.name, { lastModified: Date.now() });
      await handleFile(file);
    })();
    return () => {
      cancelled = true;
    };
    // Montage uniquement — handleFile est stable (useCallback [setTakeoff]).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // « Annuler » : on ferme la maquette ET on oublie le modèle persisté.
  const handleClear = useCallback(() => {
    void clearIfcModel();
    setTakeoff(null);
  }, [setTakeoff]);

  const handleSaveToProject = useCallback(async () => {
    if (!takeoff) return;
    setBusy(true);
    try {
      // §221 — Zielprojekt nutzen wenn vorhanden. Sonst neues Projekt OHNE
      // erfundene Defaults (kein Berlin, kein « Import », kein Team AM).
      const reuse = Boolean(activeProject?.id);
      const pId = reuse ? activeProject!.id : "prj-" + Math.random().toString(36).slice(2, 8);
      if (!reuse) {
        const newP = {
          id: pId,
          code: "IMP-" + new Date().getFullYear(),
          name: takeoff.fileName,
          type: "",
          location: "",
          client: "",
          status: "design" as const,
          progress: 0,
          budget: takeoff.totals.cost > 0 ? takeoff.totals.cost : 0,
          spent: 0,
          grossFloorArea: takeoff.ngf > 0 ? takeoff.ngf : 0,
          floors: takeoff.storeys.length,
          startDate: new Date().toISOString().slice(0, 10),
          endDate: "",
          team: [] as string[],
          classificationCode: "DIN-276",
          carbonBudgetKg: takeoff.totals.carbonKg > 0 ? takeoff.totals.carbonKg : 0,
          health: 0,
          riskScore: 0,
          accent: "#3b82f6",
        };
        try {
          const res = await secureFetch("/api/v5/ifc/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newP),
          });
          if (!res.ok && res.status !== 401) {
            console.warn(`[ModelImport] Persistance backend refusee (${res.status}) — projet conserve en local.`);
          }
        } catch (e) {
          console.warn("[ModelImport] Backend injoignable — projet conserve en local:", e);
        }
        addProject(newP);
      }

      const boxesByExpressId = new Map((takeoff.boxes ?? []).map((box) => [box.id, box]));
      const stamp = Date.now().toString(36);
      const elementsToSave = takeoff.elements.map((el: any, i: number) => {
        const box = boxesByExpressId.get(el.expressId) ?? null;
        return {
        id: `el-${pId}-${stamp}-${el.expressId}-${i}`,
        guid: el.globalId || `${takeoff.fileName}-${el.expressId}`,
        code: el.kg,
        classificationLabel: el.kgLabel,
        name: el.name,
        type: el.ifcType,
        materialId: el.kg === "340" ? "mat-glass" : "mat-concrete",
        level: el.level || "—",
        projectId: pId,
        status: "modeled" as const,
        qty: el.qty,
        unit: el.unit,
        weightKg: el.weightKg,
        cost: el.cost,
        carbonKg: el.carbonKg,
        properties: [
          { key: "Express ID", value: String(el.expressId), source: takeoff.schema },
          { key: "IFC Class", value: el.ifcType, source: "IFC Parser" },
          { key: "Rohmenge", value: JSON.stringify(el.rawQty ?? {}), source: "BaseQuantities" },
          ...(box ? [{ key: "bbox", value: JSON.stringify(bboxFromMeshBox(box)), source: "IFC Geometrie" }] : []),
        ],
        lastUpdated: new Date().toISOString(),
        conflicts: 0
        };
      });

      addElements(elementsToSave);
      setTakeoff(null);
      navigate("/app/projects");
    } finally {
      setBusy(false);
    }
  }, [takeoff, addProject, addElements, navigate, setTakeoff, activeProject]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="3D-Modell & IFC-Import"
        subtitle="IFC → 3D und DIN-276-Schätzung — kein DWG/RVT"
        actions={takeoff && (
           <div className="flex gap-2">
             <Button size="sm" variant="ghost" icon="x" onClick={handleClear}>Abbrechen & Modell entfernen</Button>
             <Button size="sm" variant="primary" icon="check" onClick={handleSaveToProject} disabled={busy}>{busy ? "Wird gespeichert…" : (activeProject ? `In „${activeProject.name}“ speichern` : "Als neues Projekt speichern")}</Button>
           </div>
        )}
      />

      {!takeoff ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className={cn(
              "relative overflow-hidden rounded-3xl border-2 border-dashed p-10 text-center transition-colors sm:p-16",
              drag ? "border-brand-400 bg-brand-50/50" : "border-slate-300 bg-white"
            )}
          >
            {busy && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
                <Icon name="refresh" size={28} className="animate-spin text-brand-500" />
                <p className="text-sm font-medium text-slate-600">Modell wird ausgelesen…</p>
              </div>
            )}
            <div className="mx-auto flex max-w-md flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-lg shadow-brand-200">
                <Icon name="cube" size={30} />
              </div>
              <h3 className="mt-5 font-display text-xl font-bold text-slate-900">Bauwerksmodell hierher ziehen</h3>
              <p className="mt-1 text-sm text-slate-500">IFC wird vollständig ausgelesen · DXF (2D) aus Ebenen gemessen · DWG/RVT bitte als IFC exportieren</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button icon="download" onClick={() => inputRef.current?.click()}>Datei auswählen</Button>
                <Button variant="secondary" icon="spark" onClick={() => void handleDemo()}>Demo-Modell laden</Button>
              </div>
              {/* §57 — pastille ZIELPROJEKT noire (demande utilisateur : quand
                  j'importe un IFC je dois VOIR le projet cible, chic). Nom
                  réel du projet actif, tronqué proprement si long. */}
              {activeProject && (
                <p className="mt-5 flex flex-col items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Zielprojekt</span>
                  <span
                    className="inline-flex max-w-full items-center gap-2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-zinc-300/60"
                    title={activeProject.name}
                  >
                    <Icon name="building" size={13} className="shrink-0 text-brand-400" />
                    <span className="max-w-[220px] truncate">{activeProject.name}</span>
                  </span>
                </p>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".ifc,.step,.dxf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
              />
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {[".IFC", ".STEP", ".DXF"].map((f) => (
                  <span key={f} className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-500">{f}</span>
                ))}
              </div>
              {error && <p className="mt-4 flex items-center gap-2 text-sm text-rose-600"><Icon name="alert" size={15} /> {error}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: "cube" as const, title: "IFC = exakt", desc: "Mengen, Volumen, Flächen, Massen & CO₂ direkt aus dem Modell (Base Quantities).", tone: "emerald" },
              { icon: "layers" as const, title: "DXF = näherungsweise", desc: "Längen & Ebenen werden gelesen und in DIN 276-Kostengruppen übersetzt.", tone: "amber" },
              { icon: "lock" as const, title: "BIM / CAD erkannt", desc: "Binärformate werden erkannt; heuristische Schätzung, bis IFC-Export erfolgt.", tone: "slate" },
            ].map((c) => (
              <Card key={c.title} className="p-5">
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl",
                  c.tone === "emerald" ? "bg-emerald-50 text-emerald-600" : c.tone === "amber" ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500")}>
                  <Icon name={c.icon} size={20} />
                </span>
                <h4 className="mt-3 font-display font-semibold text-slate-900">{c.title}</h4>
                <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <TakeoffResult takeoff={takeoff} />
      )}
    </div>
  );
}

function TakeoffResult({ takeoff }: { takeoff: ModelTakeoff }) {
  const meta = FORMAT_META[takeoff.format] ?? FORMAT_META.IFC;
  const { setCostConfig, navigate, qcFocus, setQcFocus } = useApp();
  // Moteur 3D actif : Fragments (Workers) → web-ifc thread principal (vraie
  // géométrie sans Worker) → boîtes analytiques (dernier filet).
  const [viewerEngine, setViewerEngine] = useState<"fragments" | "wasm" | "boxes">(
    () => (areWorkersBlocked() ? "wasm" : "fragments"),
  );
  // Estimation éclair backend (pivot → Kostengruppen DIN 276), optionnelle :
  // l'affichage local reste la référence tant que le backend est injoignable.
  const [estimateRegion, setEstimateRegion] = useState<string>(DEFAULT_REGION);
  const [quickEstimate, setQuickEstimate] = useState<QuickEstimateResponse | null>(null);
  // Export GAEB X31 du devis DIN 276 (téléchargement .x31 pour logiciels AVA).
  const [gaebBusy, setGaebBusy] = useState(false);
  const toast = useToast();
  const handleExportGaeb = useCallback(() => {
    if (gaebBusy) return;
    setGaebBusy(true);
    void downloadGaebX31(takeoff, estimateRegion)
      .then(() =>
        toast.push({
          kind: "success",
          title: "GAEB X31 exportiert",
          detail:
            "Die Datei endet auf „.x31“ — X31 IST das XML-Austauschformat (GAEB DA XML 3.2, Phase 31), direkt importierbar in AVA-Software (California, ORCA …).",
        }),
      )
      .catch((error) => {
        console.warn("[ModelImport] GAEB-Export indisponible:", error);
        toast.push({
          kind: "error",
          title: "GAEB X31 konnte nicht exportiert werden",
          detail: error instanceof Error ? error.message : "Backend nicht erreichbar — Seite neu laden und erneut versuchen.",
        });
      })
      .finally(() => setGaebBusy(false));
  }, [takeoff, estimateRegion, gaebBusy, toast]);

  // Réinitialiser le moteur 3D à chaque nouvelle maquette : si
  // l'environnement a déjà prouvé qu'il bloque les Workers, on saute l'étage
  // Fragments — vraie géométrie immédiate, sans détour ni rechargement.
  useEffect(() => {
    setViewerEngine(areWorkersBlocked() ? "wasm" : "fragments");
  }, [takeoff]);

  useEffect(() => {
    let cancelled = false;
    setQuickEstimate(null);
    void (async () => {
      if (takeoff.elements.length === 0) return;
      const health = await checkBackendHealth();
      if (!health.ok) return;
      try {
        const result = await requestQuickEstimate(takeoff, estimateRegion);
        if (!cancelled) setQuickEstimate(result);
      } catch (error) {
        console.warn("[ModelImport] Schnellschätzung backend indisponible:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [takeoff, estimateRegion]);

  useEffect(() => {
    const objectUrl = takeoff.ifcObjectUrl;
    return () => {
      if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [takeoff.ifcObjectUrl]);

  const donut = takeoff.kgBuckets.map((b, i) => ({ label: `KG ${b.code}`, value: b.cost, color: PALETTE[i % PALETTE.length] }));
  const maxKg = Math.max(...takeoff.kgBuckets.map((b) => b.cost), 1);

  // benchmark comparison for the same NGF
  const country = activeCountry();
  const region = DE_REGIONS[0];
  const quality = QUALITY_STANDARDS[1];
  const bench = takeoff.ngf > 0 ? estimateCost({
    typology: typologyById("mfh"), ngf: takeoff.ngf, region, quality, country,
    year: 2026, includeVat: false, includeLand: false, landValue: 0,
    untergeschosse: 1, obergeschosse: 4, bauweiseId: "massiv", energiestandardId: "geg",
  }) : null;
  const modelPerM2 = takeoff.totals.perM2;
  const benchKg300PerM2 = bench ? bench.kg300 / takeoff.ngf : 0;

  const extendToFullCost = () => {
    if (takeoff.ngf > 0) setCostConfig({ ngf: takeoff.ngf });
    navigate("/app/cost");
  };

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["Narchi Modell-Mengenauszug", takeoff.fileName]);
    rows.push(["Format", takeoff.format, "Präzision", takeoff.precision]);
    rows.push(["Projekt", takeoff.projectName, "Schema", takeoff.schema]);
    rows.push(["NGF (m²)", fmtNumber(takeoff.ngf), "Bauteile", String(takeoff.totals.count)]);
    rows.push(["Kostengruppe", "Bezeichnung", "Menge", "Einheit", "Betrag (€)", "CO₂ (kg)"]);
    for (const e of takeoff.elements) {
      rows.push([`KG ${e.kg}`, e.kgLabel, fmtNumber(e.qty), e.unit, fmtNumber(e.cost), fmtNumber(e.carbonKg)]);
    }
    rows.push(["", "Summe", "", "", fmtNumber(takeoff.totals.cost), fmtNumber(takeoff.totals.carbonKg)]);
    const csv = "\ufeff" + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "narchi-mengenauszug.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* header */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon name="cube" size={24} /></span>
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">{takeoff.projectName}</h3>
              <p className="text-xs text-slate-400">{takeoff.fileName} · {fmtNumber(takeoff.fileSize / 1024)} KB · Schema {takeoff.schema || "—"} · {takeoff.organization}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone} dot>{takeoff.format}</Badge>
            <Button size="sm" variant="secondary" icon="download" onClick={exportCsv}>CSV-Export</Button>
          </div>
        </div>
        <div className="bg-slate-50 px-5 py-2.5 text-xs text-slate-500">
          <Icon name={takeoff.precision === "exact" ? "check" : "alert"} size={13} className="mr-1 inline" />
          {takeoff.precisionNote}
        </div>
      </Card>

      {takeoff.warnings.length > 0 && (
        <div className="space-y-1.5">
          {takeoff.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}

      {/* CLASH-FOKUS (QC & Conformité) : MURS SOLIDES par défaut — les deux
          fautifs sont re-teintés EN PLEINE MATIÈRE (A rouge · B bleu), la
          ZONE EXACTE pulse en rouge (diamant flashy), le cube de section
          découpe le contexte ; bascule RÖNTGEN (maquette fantôme) possible.
          (Moteurs WASM et boîtes ; Fragments n'a pas le même repère.) */}
      {qcFocus && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 shadow-sm dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300">
          <Icon name="target" size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            Clash-Fokus ({qcFocus.xray ? "Röntgen" : "Solide"}) : {qcFocus.label}
            <span className="ml-2 hidden font-normal text-rose-500/80 md:inline">
              — 🔴 Bauteil A · 🔵 Bauteil B (Vollmaterial) · ◇ genaue Stelle
              {qcFocus.after ? " · 🟢 korrigierte Lage (Korrektur-Vorschau)" : ""}
            </span>
            {viewerEngine === "fragments" && (
              <span className="ml-2 font-normal text-rose-500/80">
                — präziser Marker im „WebGL direkt“-Modus (Workers blockiert)
              </span>
            )}
          </span>
          {/* Bascule SOLIDE ⇄ RÖNTGEN — mémorisée (localStorage) et
              re-appliquée immédiatement à CE focus. */}
          <button
            onClick={() => {
              const next = qcFocus.xray !== true;
              writeQcXrayPreference(next);
              setQcFocus({ ...qcFocus, xray: next, at: Date.now() });
            }}
            title={qcFocus.xray
              ? "Zurück zu massiven Wänden — Kollisionen in der Materie lesen"
              : "Gebäude als Geist (Röntgen) — durch die Wände sehen"}
            className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition-colors hover:bg-rose-100 dark:bg-rose-900/40 dark:ring-rose-500/30"
          >
            {qcFocus.xray ? "🧱 Massive Wände" : "👻 Röntgen"}
          </button>
          <button
            onClick={() => setQcFocus(null)}
            className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition-colors hover:bg-rose-100 dark:bg-rose-900/40 dark:ring-rose-500/30"
          >
            <Icon name="x" size={12} />
            Fokus löschen
          </button>
        </div>
      )}

      {/* 3D VIEWER — trois moteurs en cascade : Fragments (Workers) → géométrie
          réelle web-ifc sans Worker → boîtes analytiques (dernier filet) */}
      {(takeoff.ifcObjectUrl || takeoff.sourceFile || (takeoff.boxes && takeoff.boxes.length > 0)) && (
        <Card className="overflow-hidden">
          <CardHeader
            title="3D-Modellansicht"
            subtitle={
              viewerEngine === "fragments" && takeoff.ifcObjectUrl
                ? "That Open Engine · IFC converti en Fragments streaming · fallback analytique"
                : viewerEngine === "wasm" && takeoff.sourceFile
                  ? "web-ifc · vraie géométrie sans Worker (thread principal)"
                  : `${takeoff.boxes?.length ?? 0} analytische Boxen aus IFC-Mengen`
            }
            action={
              <Badge
                tone={viewerEngine === "fragments" && takeoff.ifcObjectUrl ? "emerald" : viewerEngine === "wasm" && takeoff.sourceFile ? "sky" : "cyan"}
                dot
              >
                {viewerEngine === "fragments" && takeoff.ifcObjectUrl ? "IFC aktiv" : viewerEngine === "wasm" && takeoff.sourceFile ? "WebGL direkt" : "Fallback WebGL"}
              </Badge>
            }
          />
          <div className="h-[590px] w-full">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-[#05070f] text-sm text-slate-300">
                  BIM-Motor wird nachgeladen…
                </div>
              }
            >
              {viewerEngine === "fragments" && takeoff.ifcObjectUrl ? (
                <RealIfcViewer
                  ifcUrl={takeoff.ifcObjectUrl}
                  fileName={takeoff.fileName}
                  onFallback={() => setViewerEngine(takeoff.sourceFile ? "wasm" : "boxes")}
                />
              ) : viewerEngine === "wasm" && takeoff.sourceFile ? (
                <WebIfcMainThreadViewer
                  file={takeoff.sourceFile}
                  fileName={takeoff.fileName}
                  focus={qcFocus}
                  boxes={takeoff.boxes ?? []}
                  boxesAnchor={takeoff.geometryAnchor ?? null}
                  onFallback={() => setViewerEngine("boxes")}
                />
              ) : (
                <ModelViewer boxes={takeoff.boxes ?? []} focus={qcFocus} />
              )}
            </Suspense>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Geschätzte Baukosten" value={fmtMoney(takeoff.totals.cost)} sub="aus Modellmengen" tone="amber" icon="scale" />
        <Kpi label="€ / m² NGF" value={takeoff.ngf > 0 ? fmtNumber(modelPerM2) : "—"} sub={`NGF ${fmtNumber(takeoff.ngf)} m²`} tone="cyan" icon="gauge" />
        <Kpi label="CO₂ (inkarniert)" value={formatCarbon(takeoff.totals.carbonKg)} sub="aus Bauteilmassen" tone="emerald" icon="leaf" />
        <Kpi label="Bauteile ausgelesen" value={fmtNumber(takeoff.totals.count)} sub={`${takeoff.storeys.length} Geschosse`} tone="violet" icon="cube" />
      </div>

      {/* estimation éclair backend : pivot des métrés → positions BOQ DIN 276 */}
      {quickEstimate && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
            <label htmlFor="kg-estimate-region">Regionalfaktor</label>
            <select
              id="kg-estimate-region"
              value={estimateRegion}
              onChange={(event) => setEstimateRegion(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {ESTIMATE_REGIONS.map((region) => (
                <option key={region.code} value={region.code}>{region.label}</option>
              ))}
            </select>
          </div>
          <KostengruppenSchaetzung estimate={quickEstimate} onExportGaeb={handleExportGaeb} />
          <KostenVergleich current={quickEstimate} />
        </div>
      )}

      {/* construction shell vs reference */}
      {bench && takeoff.ngf > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <h3 className="font-display font-semibold text-slate-900">Konstruktionsschale aus dem Modell</h3>
              <p className="mt-1 text-xs text-slate-500">
                Das geometrische Modell liefert die erfassten Bauteile (KG 300 / KG 340).
                Narchi ergänzt Innenausbau (KG 350), TGA (KG 400), Außenanlagen (KG 500) und Nebenkosten (KG 700)
                über die Typologie, um die DIN-276-Vollkosten zu erhalten.
              </p>
              <div className="mt-3 grid gap-5 sm:grid-cols-2">
                <CompareBar label="Aus Modell (KG 300/340)" value={modelPerM2} max={Math.max(modelPerM2, benchKg300PerM2)} color="#f59e0b" />
                <CompareBar label="Referenz KG 300 (MFH)" value={benchKg300PerM2} max={Math.max(modelPerM2, benchKg300PerM2)} color="#94a3b8" />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Konstruktionsschale bestätigt. Ein geometrisches Modell enthält primär die Tragstruktur (Wände, Decken, Stützen, Fassadenöffnungen) — Innenausbau und TGA werden über die Typologie ergänzt.
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center sm:w-56">
              <div className="text-xs text-slate-400">Vollkosten (MFH, {fmtNumber(takeoff.ngf)} m²)</div>
              <div className="font-display text-xl font-bold text-slate-900">{fmtMoney(bench.netTotal)}</div>
              <div className="text-[11px] text-slate-400">{fmtNumber(bench.perM2Ngf)} €/m² NGF</div>
              <Button className="mt-3 w-full" size="sm" iconRight="arrowRight" onClick={extendToFullCost}>Auf Vollkosten erweitern</Button>
            </div>
          </div>
        </Card>
      )}

      {/* breakdown + table */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Kosten nach KG" subtitle="DIN 276 aus Modell" />
          <div className="flex flex-col items-center gap-4 p-5">
            <DonutChart segments={donut} centerLabel={fmtMoney(takeoff.totals.cost)} centerSub="netto" size={168} />
            <div className="w-full"><Legend items={donut.map((d, i) => ({ label: `${d.label} ${takeoff.kgBuckets[i]?.label ?? ""}`, value: fmtMoney(d.value), color: d.color }))} /></div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Kostengruppen" subtitle="Aggregiert aus Bauteilen" />
          <div className="p-5">
            {takeoff.kgBuckets.map((b, i) => (
              <div key={b.code} className="mb-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="font-mono text-xs font-bold text-slate-400">KG {b.code}</span> {b.label}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(b.cost)}</span>
                </div>
                <ProgressBar value={(b.cost / maxKg) * 100} color={PALETTE[i % PALETTE.length]} />
                <div className="mt-0.5 flex justify-between text-[11px] text-slate-400">
                  <span>{b.count} Bauteile · {formatCarbon(b.carbonKg)}</span>
                  <span>{takeoff.totals.cost ? ((b.cost / takeoff.totals.cost) * 100).toFixed(0) : 0} %</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* element table */}
      <Card>
        <CardHeader title="Bauteile-Mengenliste" subtitle={`${takeoff.elements.length} Positionen aus ${takeoff.format}-Modell`} />
        <div className="max-h-[460px] overflow-auto scroll-thin">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Bauteil</th>
                <th className="px-4 py-3 text-left">KG</th>
                <th className="px-4 py-3 text-left">Geschoss</th>
                <th className="px-4 py-3 text-right">Menge</th>
                <th className="px-4 py-3 text-right">Kosten</th>
                <th className="px-4 py-3 text-right">CO₂</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {takeoff.elements.map((e) => (
                <tr key={e.expressId + e.ifcType} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{e.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">#{e.expressId} · {e.ifcType}</div>
                  </td>
                  <td className="px-4 py-2.5"><span className="font-mono text-xs font-semibold text-slate-500">KG {e.kg}</span></td>
                  <td className="px-4 py-2.5 text-slate-500">{e.level}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtNumber(e.qty, e.qty < 10 ? 2 : 0)} <span className="text-slate-400">{e.unit}</span></td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtMoney(e.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{e.carbonKg > 0 ? formatCarbon(e.carbonKg) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub: string; tone: "amber" | "cyan" | "emerald" | "violet"; icon: Parameters<typeof Icon>[0]["name"] }) {
  const c = { amber: "bg-brand-50 text-brand-600", cyan: "bg-cyan-50 text-cyan-600", emerald: "bg-emerald-50 text-emerald-600", violet: "bg-violet-50 text-violet-600" }[tone];
  return (
    <Card className="p-5">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c)}><Icon name={icon} size={20} /></span>
      <div className="mt-3 font-display text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </Card>
  );
}
function CompareBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-display font-bold text-slate-900">{fmtNumber(value)} €/m²</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}
