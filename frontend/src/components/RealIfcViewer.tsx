import { useCallback, useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import type { FragmentsModel } from "@thatopen/fragments";
import * as THREE from "three";
import { cn } from "@/utils/cn";
import { eventBus } from "@/store/AppStore";
import { captureOperationalError } from "@/core/telemetry";
import { markWorkersBlocked } from "@/bim/workerEnv";
import {
  applyViewMode,
  fetchElementSummary,
  sectionHeightBounds,
  suggestKostengruppe,
  type KostengruppeSuggestion,
  type ViewMode,
} from "@/lib/viewer/PlanSectionMode";

interface IfcLayerDefinition {
  id: string;
  label: string;
  color: string;
  categories: RegExp[];
}

const IFC_LAYERS: IfcLayerDefinition[] = [
  { id: "walls", label: "🧱 Murs", color: "#94a3b8", categories: [/^IFCWALL/, /^IFCCURTAINWALL$/] },
  { id: "slabs", label: "▬ Dalles / toitures", color: "#64748b", categories: [/^IFCSLAB$/, /^IFCROOF$/, /^IFCFOOTING$/] },
  { id: "openings", label: "🪟 Fenêtres / portes", color: "#38bdf8", categories: [/^IFCWINDOW/, /^IFCDOOR/] },
  { id: "struct", label: "🏗️ Structure", color: "#f59e0b", categories: [/^IFCCOLUMN$/, /^IFCBEAM$/, /^IFCMEMBER$/, /^IFCPILE$/] },
  { id: "stairs", label: "↕ Escaliers", color: "#10b981", categories: [/^IFCSTAIR/, /^IFCRAMP/] },
  { id: "spaces", label: "□ Espaces", color: "#06b6d4", categories: [/^IFCSPACE$/] },
  { id: "other", label: "◇ Autres", color: "#a3a3a3", categories: [] },
];

const CANVAS_MARKER = "data-narchi-realifc-canvas";
const LOAD_BUDGET_MS = 90_000;
function normalizeEnvPath(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? "";
  // Vite peut injecter la chaîne littérale "undefined" lorsqu'une variable
  // est déclarée vide dans l'environnement Docker. Cette valeur ne doit
  // jamais devenir une URL de Worker : Nginx la transforme en index.html.
  if (!normalized || normalized === "undefined" || normalized === "null") {
    return fallback;
  }
  return normalized;
}

const ASSET_BASE = normalizeEnvPath(import.meta.env.VITE_ASSET_BASE, "").replace(/\/$/, "");
// Le Worker Fragments est un asset livré dans la même image Nginx.
// Ne pas dépendre d'une variable Vite optionnelle : une valeur Docker
// "undefined" provoquait des requêtes /undefined servies comme index.html.
const FRAGMENTS_WORKER_URL = "/ifc/fragments-worker.mjs";
type LayerIds = Record<string, number[]>;

interface ViewerRuntime {
  components: OBC.Components;
  fragments: OBC.FragmentsManager;
  model: FragmentsModel | null;
  camera: OBC.OrthoPerspectiveCamera | null;
}

function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGL2RenderingContext && canvas.getContext("webgl2"));
  } catch (error) {
    captureOperationalError(error, { context: "RealIfcViewer.WebGLProbe" });
    return false;
  }
}

function normalizeWasmBase(): string {
  const configured =
    import.meta.env.VITE_IFC_WASM_BASE?.trim() || `${ASSET_BASE}/ifc/`;
  const withSlash = configured.endsWith("/") ? configured : `${configured}/`;
  return withSlash.startsWith("http")
    ? withSlash
    : new URL(withSlash, window.location.href).href;
}

function runtimeMemory(): Record<string, number> | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  if (!memory) return undefined;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
  };
}

function traceViewer(stage: string, details: Record<string, unknown> = {}): void {
  console.info("[RealIfcViewer.Trace]", {
    stage,
    at: new Date().toISOString(),
    perfMs: Math.round(performance.now()),
    memory: runtimeMemory(),
    ...details,
  });
}

async function probeFragmentsWorker(url: string, signal: AbortSignal): Promise<void> {
  traceViewer("worker_probe_start", { url });
  await fetch(url, { method: "GET", signal, credentials: "same-origin", cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`Fragments Worker inaccessible (HTTP ${response.status}).`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("javascript")) {
      throw new Error(`Fragments Worker MIME invalide: ${contentType || "absent"}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(url, { type: "module" });
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      traceViewer("worker_ready", { url });
      resolve();
    }, 250);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      traceViewer("worker_error", { url, error: String(error) });
      reject(error instanceof Error ? error : new Error("Fragments Worker module error."));
    };
    worker.onerror = (event) => fail(new Error(`Worker module error: ${event.message || "unknown"}`));
    worker.onmessageerror = (event) => fail(new Error(`Worker messageerror: ${String(event.data || "unknown")}`));
  });
}

async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`IFC-Download fehlgeschlagen (HTTP ${response.status}).`);

  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let fixedBuffer = total > 0 && !response.headers.get("content-encoding")
    ? new Uint8Array(total)
    : null;
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (fixedBuffer && loaded + value.byteLength <= fixedBuffer.byteLength) {
      fixedBuffer.set(value, loaded);
    } else {
      if (fixedBuffer) {
        chunks.push(fixedBuffer.subarray(0, loaded));
        fixedBuffer = null;
      }
      chunks.push(value);
    }
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  if (fixedBuffer) {
    return loaded === fixedBuffer.byteLength
      ? fixedBuffer
      : fixedBuffer.slice(0, loaded);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function classifyLayers(model: FragmentsModel): Promise<LayerIds> {
  const result: LayerIds = {};
  const assigned = new Set<number>();

  for (const layer of IFC_LAYERS.filter((item) => item.id !== "other")) {
    const categories = await model.getItemsOfCategories(layer.categories);
    const ids = [...new Set(Object.values(categories).flat())];
    result[layer.id] = ids;
    ids.forEach((id) => assigned.add(id));
  }

  const allIds = await model.getLocalIds();
  result.other = allIds.filter((id) => !assigned.has(id));
  return result;
}

export function RealIfcViewer({
  ifcUrl,
  fileName,
  onSelect,
  onFallback,
}: {
  ifcUrl: string;
  fileName: string;
  onSelect?: (id: number | null) => void;
  onFallback?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const generationRef = useRef(0);
  const sectionPlanesRef = useRef<THREE.Plane[]>([]);

  const [loading, setLoading] = useState(true);
  const [progressPct, setProgressPct] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("Initialisation du moteur BIM…");
  const [error, setError] = useState<string | null>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<{ name: string; suggestion: KostengruppeSuggestion | null } | null>(null);
  const [layerIds, setLayerIds] = useState<LayerIds>({});
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(IFC_LAYERS.map((layer) => [layer.id, true])),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [cutHeight, setCutHeight] = useState(0);
  const [cutBounds, setCutBounds] = useState<{ min: number; max: number }>({ min: 0, max: 0 });
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    const available = isWebGL2Available();
    setWebglAvailable(available);
    if (!available) onFallback?.();
  }, [onFallback]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !isWebGL2Available()) return;

    const generation = ++generationRef.current;
    const isStale = () => generationRef.current !== generation;
    const abortController = new AbortController();
    let disposed = false;
    let loadFinished = false;
    const onWindowError = (event: ErrorEvent) => {
      traceViewer("window_error", {
        generation,
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      traceViewer("unhandled_rejection", { generation, reason: String(event.reason) });
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    container.querySelectorAll(`[${CANVAS_MARKER}]`).forEach((canvas) => canvas.remove());

    traceViewer("init_start", { generation, fileName, ifcUrl });
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.OrthoPerspectiveCamera,
      OBC.SimpleRenderer
    >();

    const scene = new OBC.SimpleScene(components);
    scene.setup();
    scene.three.background = new THREE.Color(0x05070f);
    world.scene = scene;

    const renderer = new OBC.SimpleRenderer(components, container);
    renderer.three.domElement.setAttribute(CANVAS_MARKER, "true");
    renderer.three.outputColorSpace = THREE.SRGBColorSpace;
    renderer.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    world.renderer = renderer;

    const camera = new OBC.OrthoPerspectiveCamera(components);
    // Les contrôles d'OrthoPerspectiveCamera exigent que la caméra soit
    // rattachée à un World avant tout appel à setLookAt(). Sinon That Open
    // lève : "This camera needs a world to work!".
    world.camera = camera;
    camera.controls.setLookAt(30, 25, 30, 0, 0, 0, false);

    components.init();
    traceViewer("components_initialized", { generation });
    components.get(OBC.Grids).create(world);

    const fragments = components.get(OBC.FragmentsManager);
    const ifcLoader = components.get(OBC.IfcLoader);
    // The Fragments worker must be initialized only after IfcLoader.setup().
    // That Open's IFC conversion pipeline creates/configures the importer
    // runtime during setup; initializing the manager first can leave the
    // worker with an incomplete protocol and only surface "worker sent an
    // error! undefined" in the browser.
    const runtime: ViewerRuntime = { components, fragments, model: null, camera };
    runtimeRef.current = runtime;

    const updateFragments = () => {
      if (!disposed) void fragments.core.update();
    };
    camera.controls.addEventListener("update", updateFragments);

    const onModelAdded = async ({ value: model }: { value: FragmentsModel }) => {
      if (isStale() || disposed) {
        await fragments.core.disposeModel(model.modelId);
        return;
      }
      runtime.model = model;
      traceViewer("scene_integration_start", { generation, modelId: model.modelId });
      model.useCamera(camera.three);
      // Source unique des plans de coupe (mode Planschnitt) : lue par le
      // worker Fragments, jamais de mutation de matériau côté UI.
      model.getClippingPlanesEvent = () => sectionPlanesRef.current;
      scene.three.add(model.object);
      await fragments.core.update(true);
      await camera.controls.fitToBox(model.box, true, { paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 });
      const bounds = sectionHeightBounds(model.box);
      setCutBounds({ min: bounds.min, max: bounds.max });
      setCutHeight(bounds.initial);
      traceViewer("scene_integration_done", { generation, modelId: model.modelId });
    };
    fragments.list.onItemSet.add(onModelAdded);

    const handleResize = () => {
      if (disposed) return;
      renderer.resize();
      camera.updateAspect();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    const handleClick = async (event: MouseEvent) => {
      if (loading || disposed) return;
      try {
        const hit = await fragments.raycast({
          camera: camera.three,
          mouse: new THREE.Vector2(event.clientX, event.clientY),
          dom: renderer.three.domElement,
        });
        const id = hit?.localId ?? null;
        setSelectedId(id);
        onSelect?.(id);

        // Lien BIM ↔ estimation : l'objet IFC sélectionné est enrichi de sa
        // Kostengruppe DIN 276 probable et republié vers le store NARCHI.
        if (id !== null && runtime.model) {
          const summary = await fetchElementSummary(runtime.model, id);
          if (disposed || isStale()) return;
          if (summary) {
            const suggestion = suggestKostengruppe(summary.categories);
            setSelectedSummary({ name: summary.name, suggestion });
            eventBus.publish("ELEMENT_SELECTED", {
              expressID: id,
              elementName: summary.name,
              categories: summary.categories,
              kostengruppe: suggestion?.kg ?? null,
            });
          } else {
            setSelectedSummary(null);
            eventBus.publish("ELEMENT_SELECTED", { expressID: id });
          }
        } else {
          setSelectedSummary(null);
          eventBus.publish("ELEMENT_SELECTED", { expressID: id });
        }
      } catch (clickError) {
        console.error("[RealIfcViewer.Selection]", clickError);
        captureOperationalError(clickError, { context: "RealIfcViewer.Selection", fileName });
      }
    };
    renderer.three.domElement.addEventListener("click", handleClick);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.error("[RealIfcViewer.WebGL] Contexte GPU perdu", { fileName, generation });
      setError("Contexte GPU perdu. Le rendu a été arrêté proprement.");
      setLoading(false);
      captureOperationalError(new Error("WebGL context lost"), { context: "RealIfcViewer", fileName });
      onFallback?.();
    };
    renderer.three.domElement.addEventListener("webglcontextlost", handleContextLost);

    const watchdog = window.setTimeout(() => {
      if (loadFinished || isStale()) return;
      abortController.abort();
      setLoading(false);
      setError("Ladezeit 90 s überschritten.");
      captureOperationalError(new Error("IFC load watchdog timeout"), { context: "RealIfcViewer", fileName });
      // Le moteur Fragments (Worker) n'a rien produit dans le budget : très
      // probablement un environnement sans Workers — mémorisé pour la session.
      markWorkersBlocked(new Error("Fragments viewer watchdog timeout"));
      onFallback?.();
    }, LOAD_BUDGET_MS);

    const load = async () => {
      try {
        traceViewer("ifc_download_start", { generation, ifcUrl });
        setLoading(true);
        setProgressPct(2);
        setLoadingMessage("IFC-Datei wird geladen…");
        setError(null);

        const bytes = await fetchWithProgress(ifcUrl, abortController.signal, (loaded, total) => {
          if (isStale()) return;
          if (total > 0) {
            const pct = Math.min(45, Math.round((loaded / total) * 45));
            setProgressPct(pct);
            setLoadingMessage(`IFC-Download: ${Math.round((loaded / total) * 100)}%`);
          } else {
            setLoadingMessage(`IFC-Download: ${(loaded / 1024 / 1024).toFixed(1)} Mo`);
          }
        });
        if (isStale()) return;
        traceViewer("ifc_download_done", { generation, bytes: bytes.byteLength });

        traceViewer("ifc_loader_setup_start", { generation });
        await ifcLoader.setup({
          autoSetWasm: false,
          wasm: { path: normalizeWasmBase(), absolute: true },
          webIfc: { COORDINATE_TO_ORIGIN: true },
        });
        if (isStale()) return;
        traceViewer("ifc_loader_setup_done", { generation });

        // Confirm the exact module served by Nginx can start before giving it
        // to That Open. This makes silent Worker failures observable.
        await probeFragmentsWorker(FRAGMENTS_WORKER_URL, abortController.signal);
        if (isStale()) return;

        // Official That Open lifecycle: setup the IFC importer first, then
        // initialize FragmentsManager with the matching worker asset.
        traceViewer("fragments_init_start", { generation, workerUrl: FRAGMENTS_WORKER_URL });
        fragments.init(FRAGMENTS_WORKER_URL);
        traceViewer("fragments_init_done", { generation });

        traceViewer("ifc_conversion_start", { generation, bytes: bytes.byteLength });
        setProgressPct(50);
        setLoadingMessage("Conversion IFC → Fragments (worker)…");
        const model = await ifcLoader.load(bytes, true, fileName, {
          processData: {
            progressCallback: (progress: number) => {
              if (isStale()) return;
              const normalized = progress <= 1 ? progress * 100 : progress;
              setProgressPct(Math.min(98, 50 + Math.round(normalized * 0.48)));
            },
          },
        });
        if (isStale()) {
          await fragments.core.disposeModel(model.modelId);
          return;
        }

        traceViewer("ifc_conversion_done", { generation, modelId: model.modelId });
        const ids = await model.getLocalIds();
        traceViewer("model_ids_loaded", { generation, count: ids.length });
        const layers = await classifyLayers(model);
        if (isStale()) return;

        loadFinished = true;
        window.clearTimeout(watchdog);
        setLayerIds(layers);
        setItemCount(ids.length);
        setProgressPct(100);
        setLoading(false);
        setLoadingMessage("Modèle prêt");
      } catch (loadError) {
        if (isStale() || (loadError instanceof DOMException && loadError.name === "AbortError")) return;
        loadFinished = true;
        window.clearTimeout(watchdog);
        const message = loadError instanceof Error ? loadError.message : "Erreur inconnue du moteur IFC.";
        console.error("[RealIfcViewer.Load] Échec du chargement IFC réel", loadError);
        setError(message);
        setLoading(false);
        captureOperationalError(loadError, { context: "RealIfcViewer.Load", fileName });
        // Un échec de ce moteur = Workers/Fragments bloqués dans cet
        // environnement : la session basculera directement sur l'étage WASM.
        markWorkersBlocked(loadError);
        onFallback?.();
      }
    };
    void load();

    return () => {
      disposed = true;
      ++generationRef.current;
      abortController.abort();
      window.clearTimeout(watchdog);
      resizeObserver.disconnect();
      fragments.list.onItemSet.remove(onModelAdded);
      camera.controls.removeEventListener("update", updateFragments);
      renderer.three.domElement.removeEventListener("click", handleClick);
      renderer.three.domElement.removeEventListener("webglcontextlost", handleContextLost);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      traceViewer("cleanup_start", { generation, loadFinished });

      const webglRenderer = renderer.three;
      // Components.dispose() cascade vers FragmentsManager et tous les modèles.
      components.dispose();
      webglRenderer.dispose();
      webglRenderer.forceContextLoss();
      runtimeRef.current = null;
      if (container.contains(webglRenderer.domElement)) container.removeChild(webglRenderer.domElement);
    };
  }, [fileName, ifcUrl, onFallback, onSelect]);

  const applyLayerVisibility = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime?.model) return;
    try {
      for (const layer of IFC_LAYERS) {
        const ids = layerIds[layer.id] ?? [];
        if (ids.length > 0) await runtime.model.setVisible(ids, visibleLayers[layer.id] !== false);
      }
      await runtime.fragments.core.update(true);
    } catch (visibilityError) {
      captureOperationalError(visibilityError, { context: "RealIfcViewer.LayerVisibility", fileName });
    }
  }, [fileName, layerIds, visibleLayers]);

  useEffect(() => {
    void applyLayerVisibility();
  }, [applyLayerVisibility]);

  // Bascule 3D ↔ Planschnitt 2D + hauteur de coupe (Grundriss).
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.model || !runtime.camera || loading) return;
    let cancelled = false;
    applyViewMode({
      camera: runtime.camera,
      model: runtime.model,
      fragments: runtime.fragments,
      sectionPlanes: sectionPlanesRef.current,
      mode: viewMode,
      cutHeight,
    }).catch((modeError) => {
      if (!cancelled) {
        captureOperationalError(modeError, { context: "RealIfcViewer.ViewMode", fileName });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewMode, cutHeight, fileName, loading]);

  if (!webglAvailable) {
    return (
      <div className="flex h-full min-h-[520px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#05070f] p-6 text-center text-white">
        <div className="text-5xl">📊</div>
        <h3 className="mt-4 font-display text-lg font-bold text-brand-300">Visualisation analytique activée</h3>
        <p className="mt-2 text-xs text-slate-400">WebGL2 fehlt. Mengen bleiben nutzbar.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[520px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#05070f] shadow-2xl">
      <div ref={mountRef} className="h-full min-h-[520px] w-full" />

      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-20rem)] rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 text-xs text-white backdrop-blur">
        <div className="font-display font-bold text-brand-300">That Open Engine · IFC Fragments streaming</div>
        <div className="truncate text-slate-300">{fileName} · {itemCount.toLocaleString("fr-FR")} Bauteile</div>
      </div>

      <div className="absolute right-3 top-3 z-10 w-72 rounded-xl border border-white/10 bg-ink-900/95 p-3 text-xs text-white shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display font-bold uppercase tracking-wide text-slate-200">Couches IFC</h3>
          <button className="rounded bg-white/10 px-2 py-1 text-[10px] hover:bg-white/20" onClick={() => setVisibleLayers(Object.fromEntries(IFC_LAYERS.map((layer) => [layer.id, true])))}>Tout</button>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
          {([["3d", "Vue 3D"], ["plan", "Plan 2D"]] as Array<[ViewMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              disabled={loading}
              className={cn(
                "rounded px-2 py-1.5 text-[11px] font-semibold transition disabled:opacity-40",
                viewMode === mode ? "bg-brand-400 text-ink-900" : "text-slate-400 hover:bg-white/10",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {viewMode === "plan" && (
          <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
              <span>Schnitthöhe (coupe)</span>
              <span className="font-mono text-brand-300">{cutHeight.toFixed(2)} m</span>
            </div>
            <input
              type="range"
              min={cutBounds.min}
              max={cutBounds.max}
              step={0.1}
              value={cutHeight}
              onChange={(event) => setCutHeight(Number(event.target.value))}
              className="w-full accent-brand-400"
              aria-label="Hauteur de coupe du plan 2D"
            />
          </div>
        )}
        <div className="space-y-1.5">
          {IFC_LAYERS.map((layer) => {
            const active = visibleLayers[layer.id] !== false;
            return (
              <button
                key={layer.id}
                onClick={() => setVisibleLayers((previous) => ({ ...previous, [layer.id]: !active }))}
                className={cn("flex w-full items-center gap-2 rounded-lg border px-2 py-1.5", active ? "border-slate-600 bg-slate-800" : "border-slate-800 bg-slate-950 text-slate-500")}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: active ? layer.color : "#334155" }} />
                <span className="flex-1 text-left">{layer.label}</span>
                <span className="font-mono text-[10px]">{layerIds[layer.id]?.length ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedId !== null && (
        <div className="absolute bottom-4 left-4 z-20 rounded-xl border border-brand-400 bg-ink-900/95 p-3 text-xs text-white">
          <div>
            IFC-Bauteil · lokale ID <strong className="font-mono text-brand-300">#{selectedId}</strong>
          </div>
          {selectedSummary && (
            <div className="mt-1 max-w-64 truncate text-slate-300" title={selectedSummary.name}>
              {selectedSummary.name}
            </div>
          )}
          {selectedSummary?.suggestion && (
            <div className="mt-1 inline-flex items-center gap-1 rounded border border-brand-400/40 bg-brand-400/10 px-2 py-0.5 font-mono text-[10px] text-brand-200">
              {selectedSummary.suggestion.kg} · {selectedSummary.suggestion.label}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#05070f]/85 text-white backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-400 border-t-transparent" />
          <p className="mt-4 text-sm font-semibold">{loadingMessage}</p>
          <div className="mt-3 w-64 overflow-hidden rounded-full bg-white/10">
            <div className="h-2 rounded-full bg-brand-400 transition-all" style={{ width: `${Math.max(3, Math.min(100, progressPct))}%` }} />
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Traitement hors thread · budget 90 s</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-4 bottom-4 z-30 rounded-xl border border-rose-500 bg-rose-950/90 p-3 text-sm text-white">⚠️ {error}</div>
      )}
    </div>
  );
}
