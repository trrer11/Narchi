import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/store/AuthStore";
import { useApp } from "@/store/AppStore";
import { Badge, Button, Card, Icon, PageHeader } from "@/components/ui";
import { befundTopics, clashesTopics, downloadBcf } from "@/lib/bcfExport";
import { downloadBcf21Zip } from "@/lib/bcf21Zip";
import { matchTopics, parseBcfFile, type MatchedBcfTopic } from "@/lib/bcfImport";
import { runIdsAudit, type IdsRuleStat } from "@/lib/idsEngine";
import { downloadIdsCsv, openIdsPrintView, type IdsReportMeta } from "@/lib/idsReport";
import { downloadIdsBcf21Zip } from "@/lib/idsBcf21Zip";
import type { Clash } from "@/lib/planpruefung";
import type { ClashGroup } from "@/lib/clashGroups";
import { createRadarRunner, RadarCancelled } from "@/lib/qcRadarClient";
import type { RadarAnalysisResult, RadarProgress } from "@/lib/qcRadarAnalysis";
import { cn } from "@/utils/cn";
import { AuditEngine } from "@/lib/AuditEngine";
import { expressIdKey, resolveAuditInput } from "@/lib/qcSources";
import { buildCorrectionPlan } from "@/lib/qcCorrections";
import { applyClashFixes, buildClashFix, shiftedBox, type ClashFix } from "@/lib/qcSimulation";
import { buildPlan2D, clashesOnLevel, levelsOf, planColorOf } from "@/lib/qcPlan2d";
import { readQcXrayPreference } from "@/lib/qcFocus3d";
import type { QcFocusElement } from "@/store/slices/systemSlice";

/// Cartes de clash affichées au maximum (le reste est aggregé : le DOM de
/// centaines de cartes ralentissait l'ouverture de la page).
const MAX_VISIBLE_CLASHES = 48;
/// Cartes de Befundgruppen affichées (constats) — même garde-fou DOM.
const MAX_VISIBLE_GROUPS = 48;
/// Membres dépliés au maximum dans une carte de constat.
const MAX_VISIBLE_MEMBERS = 6;

type RadarState =
  | { status: "idle" }
  | { status: "running"; progress: RadarProgress | null; elementCount: number; startedAt: number }
  | { status: "done"; result: RadarAnalysisResult; mode: "worker" | "sync"; elapsedMs: number; elementCount: number }
  | { status: "error"; message: string };

const EMPTY_RADAR: Pick<RadarAnalysisResult, "clashes" | "realClashes" | "connections" | "connectionCount" | "groups"> = {
  clashes: [], realClashes: [], connections: [], connectionCount: 0, groups: [],
};

export default function Planpruefung() {
  const { user } = useAuth();
  const { elements, activeProjectId, activeProject, takeoff, navigate, setQcFocus } = useApp();
  const [showCorrections, setShowCorrections] = useState(false);
  /// Gestes « Correction IA » appliqués EN SIMULATION (mémoire vive, jamais
  /// persistés) : les Bauteiles simulés sont déplacés, le radar re-tourne.
  const [simFixes, setSimFixes] = useState<ClashFix[]>([]);
  /// Étage sélectionné du plan 2D de localisation (défaut : le plus peuplé).
  const [planLevel, setPlanLevel] = useState<string | null>(null);
  /// Vue du radar : « groupes » (Befundgruppen — constats exploitables,
  /// méthode Solibri/clashero, §37) ou « toutes » (paires brutes, l'ancien
  /// mur de cartes). Défaut : groupes — c'est la vue bureau.
  const [radarView, setRadarView] = useState<"gruppen" | "alle">("gruppen");
  /// Whitelist « Anschluss » visible (défaut masquée mais comptée).
  const [showConnections, setShowConnections] = useState(false);
  /// Constat déplié (détail des paires fondues dans le groupe).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  /// Exigence IDS dépliée (§41 — éléments fautifs cliquables vers la 3D).
  const [openIdsRules, setOpenIdsRules] = useState<Set<string>>(new Set());
  /// §44 — BCF IMPORTÉ (round-trip) : topics relus du fichier et remis en
  /// face du modèle (Express IDs + hotspot + Befundgruppe). null = aucun.
  const [bcfImport, setBcfImport] = useState<MatchedBcfTopic[] | null>(null);
  /// Erreur honnête d'import (zip Solibri, XML mal formé, fichier vide…).
  const [bcfImportError, setBcfImportError] = useState<string | null>(null);
  const bcfFileRef = useRef<HTMLInputElement | null>(null);

  if (!user) return null;

  // ============================================================================
  // BIM-IQ CORE ANALYSIS (Sovereign Domain Logic)
  // Source d'entrée résolue : éléments du projet actif → takeoff de la
  // maquette importée (vraie géométrie IFC) → aucune donnée (état vide).
  // ============================================================================
  const { auditReport, auditInput } = useMemo(() => {
    const projectElements = elements.filter((e) => e.projectId === activeProjectId);
    const auditInput = resolveAuditInput(projectElements, takeoff);
    // Simulation « Correction IA » : les gestes appliqués DÉPLACENT les
    // Bauteile (copie pure) — le détecteur et l'audit re-tournent aussitôt,
    // la collision corrigée disparaît du radar. Preuve par l'acte.
    const simElements = simFixes.length > 0 ? applyClashFixes(auditInput.elements, simFixes) : auditInput.elements;
    const auditReport = AuditEngine.runFullAudit(simElements);
    return { auditReport, auditInput: { ...auditInput, elements: simElements } };
  }, [elements, activeProjectId, takeoff, simFixes]);

  // ============================================================================
  // §43 — RADAR EN WEB WORKER (fond = UI fluide)
  // La boucle O(n²) de 2 M de paires s'exécute HORS du thread principal (le
  // bouton/page reste réactif, progression en direct « xx % »). Secours
  // synCRONE si Worker indisponible — MÊME pipeline (qcRadarAnalysis) donc
  // mêmes chiffres. Relance = annulation propre (jamais de résultat obsolète).
  // ============================================================================
  const [radar, setRadar] = useState<RadarState>({ status: "idle" });
  const radarRunnerRef = useRef<ReturnType<typeof createRadarRunner> | null>(null);
  const elementsFingerprint = useMemo(
    () => `${auditInput.elements.length}:${auditInput.elements[0]?.id ?? "none"}:${auditInput.elements[auditInput.elements.length - 1]?.id ?? "none"}:${simFixes.length}`,
    [auditInput.elements, simFixes.length],
  );

  useEffect(() => {
    if (auditInput.source === "none" || auditInput.elements.length === 0) {
      setRadar({ status: "idle" });
      return;
    }
    if (!radarRunnerRef.current) radarRunnerRef.current = createRadarRunner();
    const runner = radarRunnerRef.current;
    const startedAt = Date.now();
    const elementCount = auditInput.elements.length;
    setRadar({ status: "running", progress: null, elementCount, startedAt });
    const run = runner.run(auditInput.elements, (p) => {
      setRadar((prev) => (prev.status === "running" ? { ...prev, progress: p } : prev));
    });
    let disposed = false;
    run.promise
      .then((result) => {
        if (disposed) return;
        const mode: "worker" | "sync" = typeof Worker !== "undefined" ? "worker" : "sync";
        setRadar({ status: "done", result, mode, elapsedMs: Date.now() - startedAt, elementCount });
      })
      .catch((err) => {
        if (disposed) return;
        if (err instanceof RadarCancelled) return; // relance plus récente : ignorer
        setRadar({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementsFingerprint]);

  useEffect(() => {
    return () => radarRunnerRef.current?.dispose();
  }, []);

  /// Résultat du radar (vide tant qu'il tourne — la page SIGNALE le calcul).
  const radarResult: Pick<RadarAnalysisResult, "clashes" | "realClashes" | "connections" | "connectionCount" | "groups"> =
    radar.status === "done" ? radar.result : EMPTY_RADAR;
  const clashes = radarResult.clashes;
  const realClashes = radarResult.realClashes;
  const connections = radarResult.connections;
  const clashGroups = radarResult.groups;

  /// Collisions définitivement bannies par les gestes appliqués (preuve WAWE).
  const solvedFixes = useMemo(
    () => simFixes.filter((f) => !clashes.some((c) => c.id === f.clashId)),
    [simFixes, clashes],
  );

  // ============================================================================
  // §37 — BEFUNDGRUPPEN + WHITELIST « Anschluss » : calculés PAR LE WORKER
  // (§43, pipeline partagée qcRadarAnalysis — mêmes chiffres au fil et à la
  // réserve). `realClashes` / `connections` / `clashGroups` proviennent de
  // `radarResult` ci-dessus.
  // ============================================================================
  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ============================================================================
  // §41 — IDS-ABNAHME (DIN EN 17412 · buildingSMART IDS · COBie-Basisfelder)
  // La maquette livrée est-elle « abnahme-fähig » ? Exigences mesurables avec
  // pass/fail/n.a. honnêtes (un U-Wert absent n'est jamais « conforme »),
  // éléments fautifs cliquables vers le focus 3D.
  // ============================================================================
  const idsReport = useMemo(() => runIdsAudit(auditInput.elements), [auditInput]);
  /// §45 — méta traçable du rapport IDS livrable (projet + source QC réelle).
  const idsMeta = useMemo<IdsReportMeta>(
    () => ({ projectName: activeProject?.name ?? "—", sourceLabel: auditInput.sourceLabel, generatedAt: new Date() }),
    [activeProject, auditInput],
  );

  const toggleIdsRule = (id: string) => {
    setOpenIdsRules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /// Applique le geste correcteur calculé pour cette collision (simulation).
  const applyFix = (clash: Clash) => {
    const fix = buildClashFix(clash, auditInput.elements);
    if (!fix) return;
    setSimFixes((prev) => [...prev.filter((f) => f.clashId !== fix.clashId), fix]);
    setShowCorrections(true);
  };

  /// Bbox parsée d'un élément de la source d'audit (centre + taille).
  const bboxOf = (elementId: string): { center: [number, number, number]; size: [number, number, number] } | null => {
    const element = auditInput.elements.find((e) => e.id === elementId);
    const bboxProp = element?.properties.find((p) => p.key === "bbox");
    if (!bboxProp) return null;
    try {
      const b = JSON.parse(bboxProp.value) as number[];
      return {
        center: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2],
        size: [Math.max(b[3] - b[0], 0.15), Math.max(b[4] - b[1], 0.15), Math.max(b[5] - b[2], 0.15)],
      };
    } catch {
      return null;
    }
  };

  /// Clic sur un clash → localisation 3D : la Maquette 3D centre la caméra
  /// sur la ZONE EXACTE à corriger (hotspot rouge pulsant + diamant),
  /// re-teinte les deux fautifs EN PLEINE MATIÈRE (A rouge · B bleu) et
  /// encadre le tout de cages ; murs SOLIDES par défaut (bascule Röntgen
  /// possible dans le bandeau de la maquette). Plus rien à chercher.
  const jumpToClash = (clash: Clash) => {
    const boxA = bboxOf(clash.elementA);
    const boxB = bboxOf(clash.elementB);
    const focusElements: QcFocusElement[] = [];
    if (boxA) focusElements.push({ ...boxA, expressId: clash.expressIdA, role: "A" });
    if (boxB) focusElements.push({ ...boxB, expressId: clash.expressIdB, role: "B" });
    setQcFocus({
      center: clash.center,
      size: clash.size,
      elements: focusElements,
      hotspot: clash.hotspot,
      xray: readQcXrayPreference(),
      label: `${clash.nameA} ⇄ ${clash.nameB}`,
      at: Date.now(),
    });
    navigate("/app/import");
  };

  /// « Vorschau » Correction IA : la 3D montre le geste — le hotspot rouge,
  /// les fautifs en orange ET le fantôme VERT qui glisse de la position
  /// actuelle vers la position corrigée (avant/après animé).
  const previewFix = (clash: Clash) => {
    const fix = buildClashFix(clash, auditInput.elements);
    const fromBox = fix ? bboxOf(fix.elementId) : null;
    if (!fix || !fromBox) {
      jumpToClash(clash);
      return;
    }
    const boxA = bboxOf(clash.elementA);
    const boxB = bboxOf(clash.elementB);
    const focusElements: QcFocusElement[] = [];
    if (boxA) focusElements.push({ ...boxA, expressId: clash.expressIdA, role: "A" });
    if (boxB) focusElements.push({ ...boxB, expressId: clash.expressIdB, role: "B" });
    setQcFocus({
      center: clash.center,
      size: clash.size,
      elements: focusElements,
      hotspot: clash.hotspot,
      after: { from: fromBox, to: shiftedBox(fromBox, fix.offset) },
      xray: readQcXrayPreference(),
      label: `Korrektur-Vorschau : ${fix.label}`,
      at: Date.now(),
    });
    navigate("/app/import");
  };

  /// Clic sur une violation de règle → même localisation si l'élément a une
  /// bbox, sinon simple navigation vers la maquette.
  const jumpToViolation = (elementId: string) => {
    const box = bboxOf(elementId);
    const element = auditInput.elements.find((e) => e.id === elementId);
    if (box) {
      const focusElement: QcFocusElement = {
        ...box,
        expressId: element ? expressIdKey(element) : null,
        role: "A", // rouge plein (élément unique)
      };
      setQcFocus({
        center: box.center,
        size: box.size,
        elements: [focusElement],
        hotspot: box, // pour une règle, la « place à corriger » = l'élément
        xray: readQcXrayPreference(),
        label: element?.name || elementId,
        at: Date.now(),
      });
    }
    navigate("/app/import");
  };

  /// §44 — ROUND-TRIP BCF : ouvrir un .bcf exporté (NARCHI ou autre outil —
  /// Markup XML) et remettre chaque topic en face du modèle actuel. Les
  /// Express IDs des fautifs re-pointent vers la 3D ; un topic d'une maquette
  /// étrangère est affiché honnêtement « kein Bauteil gematcht ».
  const onBcfFile = async (file: File) => {
    try {
      const topics = await parseBcfFile(file);
      setBcfImport(matchTopics(topics, auditInput.elements, clashGroups));
      setBcfImportError(null);
    } catch (err) {
      setBcfImport(null);
      setBcfImportError(err instanceof Error ? err.message : String(err));
    }
  };

  /// Clic sur un constat importé → localiser la zone : on privilégie la
  /// collision représentante du groupe retrouvé (même rendu que §37), sinon
  /// le premier élément matché, sinon juste la maquette.
  const jumpToImported = (topic: MatchedBcfTopic) => {
    if (topic.group) {
      jumpToClash(topic.group.representative);
      return;
    }
    const first = topic.elements[0];
    if (first) {
      jumpToViolation(first.id);
      return;
    }
    if (topic.hotspot) {
      const center = topic.hotspot;
      const size: [number, number, number] = [0.6, 0.6, 0.6];
      setQcFocus({
        center,
        size,
        hotspot: { center, size },
        xray: readQcXrayPreference(),
        label: topic.title,
        at: Date.now(),
      });
    }
    navigate("/app/import");
  };

  /// Plan d'actions « Suggérer Correction IA » — moteur local déterministe.
  const correctionPlan = useMemo(
    () => buildCorrectionPlan(clashes, auditReport.issues),
    [clashes, auditReport],
  );

  /// Geste réellement calculé par le moteur de simulation pour chaque
  /// collision visible — affiché tel quel (zéro contradiction avec l'aperçu).
  const fixLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const clash of clashes.slice(0, 14)) {
      const fix = buildClashFix(clash, auditInput.elements);
      if (fix) map.set(clash.id, fix.label);
    }
    return map;
  }, [clashes, auditInput]);

  /// Plan 2D de localisation — calculé de la VRAIE géométrie (bboxes IFC).
  const planLevels = useMemo(() => levelsOf(auditInput.elements), [auditInput]);
  const activePlanLevel = planLevel ?? planLevels[0] ?? null;
  const plan2d = useMemo(
    () => (activePlanLevel ? buildPlan2D(auditInput.elements, activePlanLevel) : null),
    [auditInput, activePlanLevel],
  );
  const planClashes = useMemo(
    () => (activePlanLevel ? clashesOnLevel(clashes, auditInput.elements, activePlanLevel) : []),
    [clashes, auditInput, activePlanLevel],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planprüfung"
        subtitle="Kollisionsradar, IDS-Eingangskontrolle und Norm-Audit — Hüllkörper (AABB), kein Dreiecks-Mesh"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={auditInput.source === "none" ? "slate" : "emerald"} dot>
              {auditInput.sourceLabel} · Geometrie {Math.round(auditInput.geometryCoverage * 100)} %
              {auditInput.duplicatesSkipped > 0 && ` · ${auditInput.duplicatesSkipped} Duplikate ignoriert`}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              icon="download"
              title="Echtes BCF 2.1 ZIP (markup + viewpoint). AABB, kein Mesh."
              onClick={() => void downloadBcf21Zip(clashGroups, auditInput.elements)}
            >
              BCF 2.1 ZIP
            </Button>
            <Button size="sm" variant="ghost" icon="download" title="Altes Einzel-XML (kein ZIP) — nur Archiv" onClick={() => downloadBcf(clashesTopics(clashes))}>XML-Markup</Button>
            {clashGroups.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon="download"
                title="Altes Einzel-XML nach Befund (kein Solibri-ZIP)"
                onClick={() => downloadBcf(befundTopics(clashGroups))}
              >
                XML Befunde
              </Button>
            )}
            {/* §44 — ROUND-TRIP : rouvrir un .bcf (export §39 ou autre outil)
                et remettre les constats EN FACE du modèle. Entrée cachée. */}
            <input
              ref={bcfFileRef}
              type="file"
              accept=".bcfzip,.bcf,.xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onBcfFile(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="upload"
              title="BCF 2.1 ZIP oder XML-Markup: IfcGuid 22 Zeichen + Express-ID, kein Zufalls-Match"
              onClick={() => bcfFileRef.current?.click()}
            >
              BCF importieren
            </Button>
            {radar.status === "running" ? (
              <Badge tone="sky" dot>Radar läuft… {Math.round((radar.progress?.fraction ?? 0) * 100)} %</Badge>
            ) : (
              <>
                <Badge tone="rose" dot>{clashGroups.length} Befundgruppen</Badge>
                <Badge tone="rose" dot>{realClashes.length} Kollisionen</Badge>
                {connections.length > 0 && (
                  <Badge tone="slate" dot>{connections.length} Anschlüsse</Badge>
                )}
                {radar.status === "done" && (
                  <span className="text-[10px] text-slate-400" title="Drive de calcul du radar (§43 — thread principal libre)">
                    ⏱ {radar.elapsedMs >= 1000 ? `${(radar.elapsedMs / 1000).toFixed(1)} s` : `${radar.elapsedMs} ms`}
                    {radar.mode === "worker" ? " · Hintergrund" : " · sync"}
                  </span>
                )}
              </>
            )}
          </div>
        }
      />

      {/* §44 — BCF IMPORTÉ : buzzer honnête si le fichier n'est pas lisible,
          sinon la liste des constats remise en face du modèle (clic → 3D). */}
      {bcfImportError && (
        <Card className="border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-rose-700">
              <strong>BCF-Import fehlgeschlagen.</strong> {bcfImportError}
            </p>
            <button className="text-xs text-rose-500 hover:underline" onClick={() => setBcfImportError(null)}>schließen</button>
          </div>
        </Card>
      )}
      {bcfImport && (
        <BcfImportCard
          topics={bcfImport}
          onClose={() => setBcfImport(null)}
          onFocus={jumpToImported}
        />
      )}

      {/* SIMULATION « Correction IA » — les gestes appliqués ont réellement
          déplacé les Bauteile en mémoire : le radar a re-tourné et les
          collisions résolues ont disparu. Preuve par l'acte, pas promesse. */}
      {auditInput.source !== "none" && simFixes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Icon name="check" size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 font-semibold">
            Simulation aktiv : {solvedFixes.length}/{simFixes.length} Kollision(en) beseitigt
            — {clashes.length} verbleibend.
            <span className="block truncate text-xs font-normal text-emerald-600/90 dark:text-emerald-400/80">
              {solvedFixes[solvedFixes.length - 1]?.label ?? simFixes[simFixes.length - 1]?.label}
              {" "}· Nur Vorschau — Korrektur im Autorenwerkzeug (Revit) nachziehen.
            </span>
          </span>
          <button
            onClick={() => setSimFixes([])}
            className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/40 dark:ring-emerald-500/30"
          >
            <Icon name="x" size={12} />
            Zurücksetzen
          </button>
        </div>
      )}

      {auditInput.source === "none" && (
        <Card className="p-12 text-center">
          <Icon name="gauge" size={36} className="mx-auto text-brand-500" />
          <h3 className="mt-4 font-display text-lg font-bold text-slate-900">Keine Bauteil-Daten für das Audit</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Der BIM-IQ analysiert die Bauteile des aktiven Projekts — oder direkt die importierte
            IFC-Maquette, wenn noch nichts gespeichert ist. Importiere eine Maquette oder öffne ein
            Projekt mit Bauteilen, dann erscheinen Kollisionen und Normen-Verletzungen hier sofort.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button icon="cube" onClick={() => navigate("/app/import")}>Zum 3D-Modell (IFC importieren)</Button>
            <Button variant="secondary" icon="building" onClick={() => navigate("/app/projects")}>Projekt öffnen</Button>
          </div>
        </Card>
      )}

      {auditInput.source !== "none" && (
      <>

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100">
        <p className="font-semibold text-amber-200">Verfahren: achsenausgerichtete Hüllkörper (AABB)</p>
        <p className="mt-1 text-amber-100/90">
          Jede Kollision ist eine Überschneidung zweier Quader aus der IFC-Geometrie — kein Dreiecks-Mesh,
          kein Soft-Clash, kein Manifold. Anschlüsse (Öffnung im Trägerbauteil, flaches Auflager ≤ 30 cm)
          werden gezählt und dokumentiert, nie still gelöscht. Mesh-Clash steht auf der 2027-Liste, nicht in dieser Beta.
        </p>
        <p className="mt-1 text-amber-100/80">
          {auditInput.source === "takeoff"
            ? "Quelle: geladene IFC-Maquette — Marker und 3D zeigen dieselbe Geometrie."
            : "Keine Maquette geladen — Audit am aktiven Projekt. 3D-Fokus bleibt leer, bis eine IFC importiert ist."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* CLASH DETECTION PANEL */}
        <Card className="p-6 lg:col-span-2 space-y-4 bg-zinc-950 border-zinc-800 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500">
                <Icon name="alert" size={20} />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-white">Clash Detection Radar</h3>
                <p className="text-xs text-zinc-500">AABB-Überschneidungen · Worker im Hintergrund</p>
              </div>
            </div>
            {/* §37 — Bascule de vue : constats regroupés (méthode bureau
                Solibri/clashero) ⇄ paires brutes. Compte des « Anschlüsse »
                filtrés affiché — la whitelist ne supprime rien en silence. */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setRadarView("gruppen")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold ring-1 transition-colors",
                  radarView === "gruppen"
                    ? "bg-rose-500/15 text-rose-300 ring-rose-500/40"
                    : "bg-zinc-900 text-zinc-500 ring-zinc-800 hover:text-zinc-300",
                )}
                title="Constats regroupés par type de Bauteile × foyer spatial (une ligne par problème réel)"
              >
                Befundgruppen · {clashGroups.length}
              </button>
              <button
                onClick={() => setRadarView("alle")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold ring-1 transition-colors",
                  radarView === "alle"
                    ? "bg-rose-500/15 text-rose-300 ring-rose-500/40"
                    : "bg-zinc-900 text-zinc-500 ring-zinc-800 hover:text-zinc-300",
                )}
                title="Toutes les paires de collision brutes (vue détaillée)"
              >
                Alle Treffer · {realClashes.length}
              </button>
              {connections.length > 0 && (
                <button
                  onClick={() => setShowConnections((v) => !v)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-bold ring-1 transition-colors",
                    showConnections
                      ? "bg-amber-500/15 text-amber-300 ring-amber-500/40"
                      : "bg-zinc-900 text-zinc-500 ring-zinc-800 hover:text-zinc-300",
                  )}
                  title="Recouvrements intentionnels (fenêtre dans son mur, appuis ≤ 30 cm) — documentés, jamais supprimés"
                >
                  ⚓ Anschlüsse · {connections.length}
                </button>
              )}
            </div>
          </div>

          {/* §43 — ÉTAT DE CALCUL : le radar tourne EN FOND (thread libre).
              Barre de progression EN DIRECT (fraction réelle), phase, mode —
              puis résultat avec temps + mode (honnêteté machine). */}
          {radar.status === "running" && (
            <div className="col-span-full rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-2 shadow-lg shadow-sky-500/10">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-semibold text-sky-300">
                  <Icon name="pulse" size={14} />
                  Clash-Radar analysiert {radar.elementCount.toLocaleString("de-DE")} Bauteile…
                </span>
                <span className="font-mono text-[11px] text-sky-400">
                  {radar.progress ? `${Math.round(radar.progress.fraction * 100)} % · ${radar.progress.phase}` : "…"}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-brand-500 transition-[width] duration-150"
                  style={{ width: `${Math.max(2, (radar.progress?.fraction ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-sky-400/80">
                Hintergrund (Web Worker) — die Oberfläche bleibt bedienbar. Große Modelle frieren die Seite nicht ein. Fallback synchron, falls kein Worker.
              </p>
            </div>
          )}
          {radar.status === "error" && (
            <div className="col-span-full rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
              <strong>Radar-Fehler</strong> — {radar.message}. Konsole (F12) öffnen und die Meldung notieren.
              Norm-Audit und Lageplan bleiben nutzbar.
            </div>
          )}

          {/* VUE « Befundgruppen » — un constat = des dizaines de paires
              fondues (signature Wand×Decke + même foyer de 4 m). Clic sur la
              carte → 3D sur le constat porte-parole ; « Details » déplie les
              paires membres, chacune cliquable en 3D. */}
          {radarView === "gruppen" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {clashGroups.length > 0 ? clashGroups.slice(0, MAX_VISIBLE_GROUPS).map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  open={openGroups.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                  onPick={jumpToClash}
                />
              )) : (
                <div className="col-span-2 p-12 text-center border border-dashed border-zinc-800 rounded-2xl">
                  <Icon name="check" size={32} className="mx-auto text-emerald-500 mb-3" />
                  <p className="text-sm text-zinc-500">
                    {connections.length > 0
                      ? `Keine echte Kollision — ${connections.length} Überlappungen sind dokumentierte Anschlüsse (⚓ oben).`
                      : "Keine geometrische Kollision im Modell."}
                  </p>
                </div>
              )}
            </div>
          )}
          {radarView === "gruppen" && clashGroups.length > MAX_VISIBLE_GROUPS && (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-center text-[11px] text-zinc-500">
              +{clashGroups.length - MAX_VISIBLE_GROUPS} weitere Befundgruppen
              — die {MAX_VISIBLE_GROUPS} schwersten (Tragwerk zuerst, dann Größe) sind sichtbar.
            </p>
          )}

          {/* VUE « Alle Treffer » — paires brutes (après whitelist). */}
          {radarView === "alle" && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {realClashes.length > 0 ? realClashes.slice(0, MAX_VISIBLE_CLASHES).map((clash) => (
              <div
                key={clash.id}
                className="group p-3 rounded-xl border border-zinc-800 bg-zinc-900/50 hover:border-rose-500/50 hover:bg-zinc-900 transition-all cursor-pointer"
                onClick={() => jumpToClash(clash)}
                title="In der 3D-Maquette lokalisieren"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-rose-500">Hard Clash</span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-600 group-hover:text-brand-400 transition-colors">
                    <Icon name="cube" size={12} />
                    In 3D zeigen
                    <Icon name="arrowRight" size={12} />
                  </span>
                </div>
                <p className="text-xs text-zinc-300 font-medium">{clash.description}</p>
                <p className="mt-1.5 font-mono text-[10px] text-rose-300/80">
                  Eindringtiefe {Math.round(clash.overlap[0] * 1000)} × {Math.round(clash.overlap[1] * 1000)} × {Math.round(clash.overlap[2] * 1000)} mm
                  — 🔴 exakt die markierte Stelle
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone="slate">{clash.elementA}</Badge>
                  <span className="text-zinc-600 text-xs">⇄</span>
                  <Badge tone="slate">{clash.elementB}</Badge>
                </div>
              </div>
            )) : (
              <div className="col-span-2 p-12 text-center border border-dashed border-zinc-800 rounded-2xl">
                <Icon name="check" size={32} className="mx-auto text-emerald-500 mb-3" />
                <p className="text-sm text-zinc-500">
                  {connections.length > 0
                    ? `Keine echte Kollision — nur ${connections.length} dokumentierte Anschlüsse (⚓).`
                    : "Keine geometrische Kollision im Modell."}
                </p>
              </div>
            )}
          </div>
          {realClashes.length > MAX_VISIBLE_CLASHES && (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-center text-[11px] text-zinc-500">
              +{realClashes.length - MAX_VISIBLE_CLASHES} weitere Kollisionen (vollständige Liste im BCF-Export)
              — die {MAX_VISIBLE_CLASHES} schwersten (Tragwerk zuerst) sind sichtbar.
            </p>
          )}
          </>
          )}

          {/* SECTION « Anschlüsse » — la whitelist documentée, CONSULTABLE :
              chaque ligne indict la règle appliquée (Öffnung ou flacher
              Anschluss ≤ 30 cm). Rien ne disparaît sans pouvoir être revu. */}
          {showConnections && connections.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                ⚓ {connections.length} ausgeblendete Anschlüsse — vorgesehene Öffnungen & flache Tragverbindungen (≤ 30 cm)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 scroll-thin">
                {connections.map(({ clash, verdict }) => (
                  <button
                    key={clash.id}
                    onClick={() => jumpToClash(clash)}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-left transition-colors hover:border-amber-500/40"
                    title="In der 3D-Maquette lokalisieren — zur Kontrolle"
                  >
                    <p className="text-[11px] font-semibold text-zinc-200">{clash.description}</p>
                    <p className="mt-1 text-[10px] italic text-amber-300/80">⚓ {verdict.reason}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* RULE VIOLATIONS PANEL (Sovereign Intelligence) */}
        <Card className="p-6 space-y-4 bg-zinc-950 border-zinc-800 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Icon name="shield" size={20} />
              </div>
              <h3 className="font-display text-sm font-bold text-white">Norm-Regeln</h3>
            </div>
            <Badge tone="amber">{auditReport.totalIssues} Violations</Badge>
          </div>

          {/* Couverture réelle de l'audit — distingue « tout conforme » de
              « rien de mesurable » (l'ancien écran « 0 Violations » muet). */}
          <div className="flex flex-wrap gap-1.5">
            {auditReport.ruleStats.map((stat) => (
              <span
                key={stat.ruleId}
                title={`${stat.name} (${stat.lawReference}) — ${stat.checked} geprüft, ${stat.measurable} messbar, ${stat.violations} Verstöße`}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                  stat.violations > 0
                    ? "bg-rose-500/15 text-rose-400 ring-rose-500/30"
                    : stat.measurable > 0
                      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                      : "bg-zinc-800 text-zinc-500 ring-zinc-700"
                )}
              >
                {stat.name.split("(")[0].trim()} · {stat.measurable}/{stat.checked} gepr.
                {stat.violations > 0 && ` · ${stat.violations} ✗`}
              </span>
            ))}
          </div>
          {auditReport.ruleStats.every((s) => s.measurable === 0) && auditReport.ruleStats.reduce((n, s) => n + s.checked, 0) === 0 && (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
              Keine prüfbaren Bauteile gefunden — die Regeln prüfen Türen, Wände und Fenster
              („Door / Wall / Window“ im IFC). Eine Baustelle ohne diese Bauteile kann nicht
              normativ auditiert werden.
            </p>
          )}
          {!auditReport.ruleStats.every((s) => s.measurable === 0) && auditReport.issues.length === 0 && (
            <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-400/90">
              {auditReport.ruleStats.reduce((n, s) => n + s.measurable, 0)} messbare Bauteile geprüft — alle innerhalb der Norm-Grenzwerte.
            </p>
          )}

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scroll-thin">
            {auditReport.issues.length > 0 ? auditReport.issues.map((issue) => (
              <div
                key={issue.id}
                className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900 hover:border-amber-500/40 transition-all cursor-pointer group"
                onClick={() => jumpToViolation(issue.elementId)}
                title="In der 3D-Maquette lokalisieren"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-bold uppercase text-amber-500">{issue.type}</span>
                  <Badge tone={issue.severity as any}>{issue.severity}</Badge>
                </div>
                <p className="text-xs text-zinc-200 font-medium mb-2">{issue.description}</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="p-1.5 rounded bg-black/40 border border-zinc-800">
                    <p className="text-[9px] uppercase text-zinc-500">Gemessen</p>
                    <p className="text-[11px] text-white font-mono">{issue.measuredValue}</p>
                  </div>
                  <div className="p-1.5 rounded bg-black/40 border border-zinc-800">
                    <p className="text-[9px] uppercase text-zinc-500">Cible</p>
                    <p className="text-[11px] text-white font-mono">{issue.requiredValue}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 italic">
                  <Icon name="link" size={10} />
                  {issue.lawReference}
                </div>
              </div>
            )) : (
              <div className="text-center py-12">
                <Icon name="check" size={32} className="mx-auto text-emerald-500 mb-3" />
                <p className="text-xs text-zinc-500">Alle geprüften Regeln sind eingehalten.</p>
              </div>
            )}
          </div>
          
          <Button
            className="w-full mt-4"
            variant="outline"
            icon="spark"
            onClick={() => setShowCorrections((v) => !v)}
          >
            {showCorrections ? "Maßnahmenplan schließen" : "Korrekturvorschläge (Simulation)"}
          </Button>

          {/* PLAN DE CORRECTION — moteur local déterministe : pour chaque
              collision, la plus petite translation qui sépare les éléments
              (axe de pénétration minimale, chiffrée en mm) ; pour chaque
              violation, la suggestion normative. Plus d'alert() factice. */}
          {showCorrections && (
            <div className="space-y-2.5 rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand-300">
                  Maßnahmenplan ({correctionPlan.totalClashes} Kollisionen · {correctionPlan.totalIssues} Regel-Verstöße)
                </p>
                <Icon name="spark" size={14} className="text-brand-400" />
              </div>
              {correctionPlan.items.length > 0 ? (
                <>
                  {correctionPlan.items.map((item) => (
                    <div
                      key={item.id}
                      className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 transition-colors hover:border-brand-500/40"
                      onClick={() => (item.clash ? jumpToClash(item.clash) : item.issue ? jumpToViolation(item.issue.elementId) : undefined)}
                      title="In der 3D-Maquette lokalisieren"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone={item.severity as any}>{item.severity}</Badge>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                          {item.kind === "clash" ? "Kollision" : "Norm"}
                        </span>
                        {item.clash && simFixes.some((f) => f.clashId === item.clash!.id) && (
                          <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                            angewendet ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-semibold text-zinc-100">{item.title}</p>
                      {item.clash && fixLabels.get(item.clash.id) && (
                        <p className="mt-1 rounded-md bg-emerald-500/10 px-1.5 py-1 text-[11px] font-semibold text-emerald-300">
                          🛠 {fixLabels.get(item.clash.id)}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{item.detail}</p>
                      {item.clash && (
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); previewFix(item.clash!); }}
                            className="flex-1 rounded-md bg-brand-500/15 px-2 py-1 text-[10px] font-bold text-brand-300 ring-1 ring-brand-500/30 transition-colors hover:bg-brand-500/30"
                            title="Vorher/Nachher in der 3D-Ansicht (grünes Ghost)"
                          >
                            👁 Vorschau
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); applyFix(item.clash!); }}
                            className="flex-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/30 transition-colors hover:bg-emerald-500/30"
                            title="Simulation : déplace le Bauteil et relance le radar — la collision disparaît"
                          >
                            ✓ Anwenden
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {correctionPlan.moreClashes > 0 && (
                    <p className="text-center text-[11px] text-zinc-500">
                      +{correctionPlan.moreClashes} weitere — Export BCF für die vollständige Liste.
                    </p>
                  )}
                  <p className="border-t border-zinc-800 pt-2 text-[10px] italic leading-relaxed text-zinc-500">
                    Vorschlag ohne Gewähr: das BIM-IQ rechnet mit den Bauteil-Quadern (bbox).
                    Korrektur im Autorenwerkzeug (Revit) vornehmen, IFC neu exportieren,
                    Audit erneut laufen lassen.
                  </p>
                </>
              ) : (
                <p className="py-4 text-center text-xs text-zinc-500">
                  Kein Korrekturbedarf — weder Kollisionen noch Regel-Verstöße.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* §41 — IDS-ABNAHME : exigences d'information de la maquette (DIN EN
          17412 · buildingSMART IDS · COBie). pass/fail/n.a. HONNÊTES — un
          U-Wert absent n'est jamais « conforme » ; les éléments fautifs sont
          cliquables vers le focus 3D. */}
      <Card className="p-6 space-y-4 bg-zinc-950 border-zinc-800 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-500">
              <Icon name="shield" size={20} />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-white">IDS-Abnahme (Maquette-Eingangskontrolle)</h3>
              <p className="text-xs text-zinc-500">DIN EN 17412 · buildingSMART IDS · COBie-Basisfelder</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={idsReport.overallPassRate === null ? "slate" : idsReport.overallPassRate >= 0.9 ? "emerald" : idsReport.overallPassRate >= 0.75 ? "amber" : "rose"} dot>
              {idsReport.overallPassRate === null
                ? "nicht prüfbar"
                : `${Math.round(idsReport.overallPassRate * 100)} %`}
            </Badge>
            <Badge tone="slate">{idsReport.overallLabel}</Badge>
            {/* §45 — Rapport LIVRABLE : CSV allemand (audit) + document
                imprimable → PDF. Chiffres repris 1:1 du moteur §41. */}
            <button
              className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:bg-zinc-800"
              title="IDS-Eingangskontrolle → document imprimable (bouton « Als PDF speichern » intégré)"
              onClick={() => openIdsPrintView(idsReport, idsMeta)}
            >
              🖨️ Bericht PDF
            </button>
            <button
              className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition hover:bg-zinc-800"
              title="IDS-Eingangskontrolle → CSV allemand (Excel DE), demandes + éléments fautifs"
              onClick={() => downloadIdsCsv(idsReport, idsMeta)}
            >
              ⬇ CSV
            </button>
          </div>
        </div>

        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
          {idsReport.measurableElements.toLocaleString("de-DE")} von {idsReport.totalElements.toLocaleString("de-DE")} Bauteilen messbar geprüft
          — « n.a. » = donnée absente de la maquette (jamais un « conforme » silencieux). Référence profil NARCHI :
          GUID, Geschoss, Geometrie, Material ÖKOBAUDAT, DIN 18101 Türen, GEG U-Wert, COBie-Namensführung, KG DIN 276, Mengen.
        </p>

        <div className="space-y-2">
          {idsReport.requirements.map((rule) => (
            <IdsRuleRow
              key={rule.id}
              rule={rule}
              open={openIdsRules.has(rule.id)}
              onToggle={() => toggleIdsRule(rule.id)}
              onPick={jumpToViolation}
            />
          ))}
        </div>
      </Card>

      {/* PLAN 2D DE LOCALISATION — calculé de la VRAIE géométrie IFC
          (remplace la section « Plans de Révision » factice : feuille semée,
          toile pointée vide, « Aucune issue » à vie — supprimée car l'utili-
          sateur refuse les écrans décoratifs). Chaque point rouge = zone
          exacte d'un clash ; clic → focus 3D chirurgical. */}
      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Lageplan — Geschosse</p>
          {planLevels.length > 0 ? planLevels.map((lv) => (
            <button
              key={lv}
              onClick={() => setPlanLevel(lv)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                lv === activePlanLevel ? "border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white">
                <Icon name="layers" size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{lv}</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {clashesOnLevel(clashes, auditInput.elements, lv, 10000).length} Kollisionen
                </p>
              </div>
            </button>
          )) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500">
              Keine Bauteile mit Geometrie (bbox) für den Lageplan.
            </p>
          )}
        </div>

        <Card className="overflow-hidden bg-ink-950 border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3 bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <Icon name="layers" size={16} className="text-brand-500" />
              <span className="font-display text-sm font-semibold text-white">
                Lageplan {activePlanLevel ?? "—"}
              </span>
            </div>
            {plan2d && (
              <span className="text-[11px] text-zinc-500">
                {plan2d.totalElements} Bauteile{plan2d.capped ? ` (${plan2d.rects.length} gezeichnet)` : ""}
                {" · "}{planClashes.length} Kollisionen — roter Punkt anklicken → 3D-Fokus
              </span>
            )}
          </div>
          <div className="relative w-full bg-ink-950">
            {plan2d ? (
              <PlanSvg plan={plan2d} clashes={planClashes} onPick={jumpToClash} />
            ) : (
              <div className="flex h-56 items-center justify-center text-sm italic text-zinc-600">
                Keine Geometrie auf dieser Ebene — anderes Geschoss wählen.
              </div>
            )}
          </div>
        </Card>
      </div>
      </>
      )}
    </div>
  );
}

/// Sévérité de constat → tonalité d'insigne (le pire membre pilote, règle Solibri).
const GROUP_SEV_TONE: Record<ClashGroup["severity"], "rose" | "amber" | "slate"> = {
  critical: "rose",
  major: "amber",
  minor: "slate",
};
const GROUP_SEV_LABEL: Record<ClashGroup["severity"], string> = {
  critical: "Kritisch",
  major: "Major",
  minor: "Minor",
};

/// Carte d'un BEFUND (constat regroupé, §37) : une ligne par problème réel
/// au lieu de dizaines de paires. Clic carte → focus 3D sur le porte-parole
/// (la pire collision du foyer) ; « Trefferliste » déplie les membres —
/// chacun cliquable vers son propre focus 3D chirurgical.
function GroupCard({
  group,
  open,
  onToggle,
  onPick,
}: {
  group: ClashGroup;
  open: boolean;
  onToggle: () => void;
  onPick: (clash: Clash) => void;
}) {
  const rep = group.representative;
  const members = group.clashes.slice(0, MAX_VISIBLE_MEMBERS);
  return (
    <div
      className={cn(
        "group rounded-xl border bg-zinc-900/50 transition-all",
        open ? "border-brand-500/50" : "border-zinc-800 hover:border-rose-500/50 hover:bg-zinc-900",
      )}
    >
      <div
        className="cursor-pointer p-3"
        onClick={() => onPick(rep)}
        title="3D-Fokus sur le constat porte-parole (la pire collision du foyer)"
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold text-zinc-500">{group.id}</span>
            <Badge tone={GROUP_SEV_TONE[group.severity]}>{GROUP_SEV_LABEL[group.severity]}</Badge>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-600 group-hover:text-brand-400 transition-colors">
            <Icon name="cube" size={12} />
            In 3D zeigen
            <Icon name="arrowRight" size={12} />
          </span>
        </div>
        <p className="text-xs font-semibold text-zinc-200">
          {group.title}{" "}
          <span className="font-bold text-rose-400">×{group.count}</span>
        </p>
        <p className="mt-1 font-mono text-[10px] text-rose-300/80">
          Ø Eindringtiefe {Math.round(group.typicalOverlap[0] * 1000)} × {Math.round(group.typicalOverlap[1] * 1000)} × {Math.round(group.typicalOverlap[2] * 1000)} mm
          {" "}— 🔴 {group.count} {group.count === 1 ? "Stelle" : "Stellen"}
        </p>
        {group.levels.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {group.levels.slice(0, 4).map((lv) => (
              <span key={lv} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-semibold text-zinc-400 ring-1 ring-zinc-700">
                {lv}
              </span>
            ))}
            {group.levels.length > 4 && (
              <span className="text-[9px] font-semibold text-zinc-600">+{group.levels.length - 4} Ebenen</span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onToggle}
        className="w-full border-t border-zinc-800 px-3 py-1.5 text-left text-[10px] font-bold text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {open ? "▾ Trefferliste schließen" : `▸ Trefferliste (${group.count}) — Sprecher: ${rep.nameA} ⇄ ${rep.nameB}`}
      </button>
      {open && (
        <div className="max-h-56 space-y-1.5 overflow-y-auto border-t border-zinc-800 p-2.5 scroll-thin">
          {members.map((c) => (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-left transition-colors hover:border-rose-500/40"
              title="In der 3D-Maquette lokalisieren"
            >
              <p className="text-[10px] font-medium text-zinc-300">{c.nameA} ⇄ {c.nameB}</p>
              <p className="font-mono text-[9px] text-rose-300/70">
                {Math.round(c.overlap[0] * 1000)} × {Math.round(c.overlap[1] * 1000)} × {Math.round(c.overlap[2] * 1000)} mm
                {" "}· {GROUP_SEV_LABEL[c.severity]}
              </p>
            </button>
          ))}
          {group.count > MAX_VISIBLE_MEMBERS && (
            <p className="pt-1 text-center text-[9px] italic text-zinc-600">
              +{group.count - MAX_VISIBLE_MEMBERS} weitere Stellen — vollständige Liste im BCF-Export.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/// SVG du plan d'étage : rectangles projetés de la VRAIE géométrie (bboxes
/// IFC, zéro donnée semée) + points rouges des zones exactes de clash —
/// cliquables (→ focus 3D chirurgical). Pas d'image factice, pas de toile vide.
function PlanSvg({
  plan,
  clashes,
  onPick,
}: {
  plan: import("@/lib/qcPlan2d").Plan2D;
  clashes: Clash[];
  onPick: (clash: Clash) => void;
}) {
  const spanX = Math.max(plan.maxX - plan.minX, 1);
  const spanY = Math.max(plan.maxY - plan.minY, 1);
  const pad = Math.max(spanX, spanY) * 0.05;
  const dotR = Math.min(Math.max(spanX * 0.006, 0.15), 0.8);
  const thin = Math.max(spanX, spanY) * 0.002;
  return (
    <svg
      viewBox={`${plan.minX - pad} ${-(plan.maxY + pad)} ${spanX + pad * 2} ${spanY + pad * 2}`}
      className="block h-auto max-h-[520px] w-full"
      role="img"
      aria-label={`Lageplan ${plan.level}`}
    >
      {plan.rects.map((r) => (
        <rect
          key={r.id}
          x={r.minX}
          y={-r.maxY}
          width={r.maxX - r.minX}
          height={r.maxY - r.minY}
          fill={planColorOf(r.type)}
          fillOpacity={0.28}
          stroke={planColorOf(r.type)}
          strokeOpacity={0.85}
          strokeWidth={thin}
        >
          <title>{`${r.type} · ${r.id}`}</title>
        </rect>
      ))}
      {clashes.map((c) => {
        const cx = c.hotspot.center[0];
        const cy = -c.hotspot.center[1];
        return (
          <g key={c.id} onClick={() => onPick(c)} className="cursor-pointer">
            <circle cx={cx} cy={cy} r={dotR * 2.2} fill="#f43f5e" opacity={0.25} className="animate-pulse" />
            <circle cx={cx} cy={cy} r={dotR} fill="#f43f5e" stroke="#ffffff" strokeWidth={dotR * 0.35} />
            <title>{`${c.nameA} ⇄ ${c.nameB} — Eindringtiefe ${Math.round(c.overlap[2] * 1000)} mm · Klicken für 3D-Fokus`}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================================
// §41 — Ligne d'exigence IDS (une règle = un contrat d'entrée de maquette)
// ============================================================================

const IDS_CATEGORY_TONE: Record<string, string> = {
  ALLGEMEIN: "bg-zinc-800 text-zinc-400 ring-zinc-700",
  ARCH: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  TRAG: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  TGA: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",
  COBIE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

/// Une ligne IDS : titre + référence normative, compteurs pass/fail/n.a.,
/// % honnête (n.a. exclus) ; dépliable → éléments fautifs cliquables vers
/// leur focus 3D chirurgical (§33) — exactement l'entrée de chantier d'une
/// Eingangskontrolle de bureau allemand.
function IdsRuleRow({
  rule,
  open,
  onToggle,
  onPick,
}: {
  rule: IdsRuleStat;
  open: boolean;
  onToggle: () => void;
  onPick: (elementId: string) => void;
}) {
  const pct = rule.passRate === null ? null : Math.round(rule.passRate * 100);
  const tone =
    rule.failed > 0
      ? "bg-rose-500/15 text-rose-400 ring-rose-500/30"
      : pct === null
        ? "bg-zinc-800 text-zinc-500 ring-zinc-700"
        : pct >= 90
          ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
          : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  return (
    <div className={cn("overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40", open && "border-sky-500/40")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/70">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", rule.failed > 0 ? "bg-rose-500 animate-pulse" : pct === null ? "bg-zinc-600" : "bg-emerald-500")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-bold text-zinc-500">{rule.id}</span>
            <span className="truncate text-xs font-semibold text-zinc-200">{rule.title}</span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-bold ring-1", IDS_CATEGORY_TONE[rule.category] ?? IDS_CATEGORY_TONE.ALLGEMEIN)}>
              {rule.category}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-zinc-500" title={rule.suggestion}>{rule.basis}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500">
            {rule.passed.toLocaleString("de-DE")}✓ {rule.failed.toLocaleString("de-DE")}✗ {rule.na.toLocaleString("de-DE")}n.a.
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold ring-1", tone)}>
            {pct === null ? "n.a." : `${pct} %`}
          </span>
          <Icon name={open ? "x" : "arrowRight"} size={12} className="text-zinc-600" />
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-800 p-2.5">
          {rule.failing.length > 0 ? (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Fehlerhafte Bauteile ({rule.failed.toLocaleString("de-DE")})
                {rule.failed > rule.failing.length ? ` — erste ${rule.failing.length}` : ""}
              </p>
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1 scroll-thin">
                {rule.failing.map((f) => (
                  <button
                    key={f.elementId}
                    onClick={() => onPick(f.elementId)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-left transition-colors hover:border-rose-500/40"
                    title="In der 3D-Maquette lokalisieren"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-zinc-200">{f.name}</span>
                      <span className="block truncate text-[10px] italic text-rose-300/80">{f.detail}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-zinc-500">
                      {f.level}{f.expressId !== null ? ` · #${f.expressId}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="px-1 py-2 text-[11px] text-emerald-400/90">
              {pct === null ? "Kein messbares Bauteil für diese Anforderung (Daten fehlen im Modell)." : "Alle messbaren Bauteile erfüllen diese Anforderung. ✅"}
            </p>
          )}
          <p className="border-t border-zinc-800 pt-2 text-[10px] italic text-zinc-600">
            💡 {rule.suggestion}
          </p>
        </div>
      )}
    </div>
  );
}

/// §44 — Liste des constats BCF importés (round-trip). Chaque carte montre
/// le statut HONNÊTE du recroisement : éléments retrouvés dans la maquette
/// (clic → focus 3D) ou « kein Bauteil gematcht » (maquette étrangère).
function BcfImportCard({
  topics,
  onClose,
  onFocus,
}: {
  topics: MatchedBcfTopic[];
  onClose: () => void;
  onFocus: (topic: MatchedBcfTopic) => void;
}) {
  const matched = topics.filter((t) => t.elements.length > 0).length;
  const closedCount = topics.filter((t) => t.closed).length;
  return (
    <Card className="space-y-4 p-6 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-500">
            <Icon name="upload" size={20} />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-foreground">BCF importiert — {topics.length} {topics.length === 1 ? "Thema" : "Themen"}</h3>
            <p className="text-xs text-muted-foreground">
              Round-trip §44 : Express IDs & Hotspots relus du Markup — {matched} avec Bauteilen gematcht
              {topics.length - matched > 0 && ` · ${topics.length - matched} fremd (kein Match)`}
              {closedCount > 0 && ` · ${closedCount} geschlossen`}
            </p>
          </div>
        </div>
        <button className="text-xs text-muted-foreground hover:underline" onClick={onClose}>schließen</button>
      </div>

      <div className="space-y-2">
        {topics.slice(0, 40).map((t) => (
          <button
            key={t.guid}
            onClick={() => onFocus(t)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition",
              t.elements.length > 0
                ? "border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50"
                : "border-border bg-muted/30 hover:bg-muted/50",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{t.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {t.befundId && <span className="mr-2 rounded bg-indigo-100 px-1 font-mono text-indigo-700">{t.befundId}</span>}
                {t.elements.length > 0 ? (
                  <>
                    {t.elements.length} Bauteil{t.elements.length > 1 ? "e" : ""} gematcht
                    {t.expressIds.length > 0 && ` · ${t.expressIds.map((x) => `#${x}`).join(" / ")}`}
                    {t.group && ` · ${t.group.count} aktuelle Treffer`}
                  </>
                ) : (
                  "kein Bauteil im geladenen Modell gematcht (fremdes Modell)"
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={t.closed ? "emerald" : "amber"} dot>{t.status}</Badge>
              <Icon name="arrowRight" size={14} className="text-muted-foreground" />
            </div>
          </button>
        ))}
        {topics.length > 40 && (
          <p className="text-[11px] text-muted-foreground">+{topics.length - 40} weitere Themen (Anzeige auf 40 begrenzt).</p>
        )}
      </div>
    </Card>
  );
}
lassName="flex shrink-0 items-center gap-2">
              <Badge tone={t.closed ? "emerald" : "amber"} dot>{t.status}</Badge>
              <Icon name="arrowRight" size={14} className="text-muted-foreground" />
            </div>
          </button>
        ))}
        {topics.length > 40 && (
          <p className="text-[11px] text-muted-foreground">+{topics.length - 40} weitere Themen (Anzeige auf 40 begrenzt).</p>
        )}
      </div>
    </Card>
  );
}
