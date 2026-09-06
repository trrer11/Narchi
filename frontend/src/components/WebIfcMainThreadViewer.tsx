/**
 * WebIfcMainThreadViewer — GÉOMÉTRIE RÉELLE SANS WORKER
 * ------------------------------------------------------
 * Visionneuse IFC intermédiaire : vraies formes du modèle (via web-ifc sur
 * le thread principal, voir lib/ifcMeshLoader.ts), destinée aux
 * environnements où les Web Workers sont bloqués. Aucun Worker, aucun CDN,
 * aucune API serveur — seulement le WASM copié dans l'image Nginx.
 *
 * Chaîne de repli (pilotée par ModelImport) :
 *   RealIfcViewer (Fragments, Workers) → CE COMPOSANT → ModelViewer (boîtes).
 * Toute erreur (WASM injoignable, budget mémoire, WebGL) appelle
 * onFallback() : l'utilisateur retombe sur la vue analytique, jamais sur un
 * écran vide.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { extractElementSubMesh, loadIfcMeshes, type IfcMeshResult } from "@/lib/ifcMeshLoader";
import { captureOperationalError } from "@/core/telemetry";
import type { MeshBox } from "@/lib/ifcGeometry";
import type { QcFocusRequest } from "@/store/slices/systemSlice";
import { clashSectionPlanes, reconcileFocusBoxes, sectionHalfExtent, type FocusCorners } from "@/lib/qcFocus3d";

const CANVAS_MARKER = "data-narchi-webifc-mainthread-canvas";

/// Marquage CHIRURGICAL V2 (méthode Solibri / Navisworks) :
///   - HOTSPOT : la zone d'intersection EXACTE à corriger — cage rouge +
///     remplissage pulsant + DIAMANT flashy → le regard la trouve de suite ;
///   - fautifs : fines cages ORANGE filaires (contexte, zéro remplissage) ;
///   - aperçu Correction IA : cage VERTE pointillée qui GLISSE de la
///     position actuelle vers la position corrigée (avant/après animé).
function buildFocusMarkers(corrected: FocusCorners): THREE.Group {
  const group = new THREE.Group();
  const halos: THREE.MeshBasicMaterial[] = [];
  const sparks: THREE.Mesh[] = [];

  const addCage = (
    parent: THREE.Group,
    box: { position: [number, number, number]; size: [number, number, number] },
    color: number,
    pad: number,
    dashed = false,
  ): THREE.BoxGeometry => {
    const geo = new THREE.BoxGeometry(
      Math.max(box.size[0], 0.1) + pad,
      Math.max(box.size[1], 0.1) + pad,
      Math.max(box.size[2], 0.1) + pad,
    );
    const edgeMat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.28, gapSize: 0.16, transparent: true, opacity: 0.95 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    if (dashed) edges.computeLineDistances();
    edges.position.set(box.position[0], box.position[1], box.position[2]);
    parent.add(edges);
    return geo;
  };

  // 1) Fautifs : contexte orange, filaire uniquement (ne masque pas l'œil).
  for (const box of corrected.boxes) addCage(group, box, 0xffb020, 0.1);

  // 2) ZONE EXACTE À CORRIGER : rouge pulsant + diamant rotatif.
  if (corrected.hotspot) {
    const hs = corrected.hotspot;
    const cage = new THREE.Group();
    cage.position.set(hs.position[0], hs.position[1], hs.position[2]);
    const geo = new THREE.BoxGeometry(
      Math.max(hs.size[0], 0.1) + 0.16,
      Math.max(hs.size[1], 0.1) + 0.16,
      Math.max(hs.size[2], 0.1) + 0.16,
    );
    cage.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xff3b30 }),
    ));
    const fill = new THREE.Mesh(
      geo.clone(),
      new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    halos.push(fill.material as THREE.MeshBasicMaterial);
    cage.add(fill);
    // Diamant flashy : attire l'œil pile sur la place à corriger.
    const r = Math.min(Math.max(Math.min(hs.size[0], hs.size[1], hs.size[2]), 0.16), 0.7);
    const spark = new THREE.Mesh(
      new THREE.OctahedronGeometry(r, 0),
      new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    cage.add(spark);
    sparks.push(spark);
    group.add(cage);
  } else {
    // Pas d'intersection (violation de règle, ancien format) : remplissage
    // pulsant rouge sur les cages d'éléments — comportement historique.
    for (const box of corrected.boxes) {
      const geo = new THREE.BoxGeometry(
        Math.max(box.size[0], 0.1) + 0.1,
        Math.max(box.size[1], 0.1) + 0.1,
        Math.max(box.size[2], 0.1) + 0.1,
      );
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      fill.position.set(box.position[0], box.position[1], box.position[2]);
      halos.push(fill.material as THREE.MeshBasicMaterial);
      group.add(fill);
    }
  }

  // 3) Aperçu AVANT/APRÈS : la cage verte glisse from → to (ping-pong).
  if (corrected.after) {
    const afterGroup = new THREE.Group();
    const { from, to } = corrected.after;
    const cage = new THREE.Group();
    addCage(cage, { position: [0, 0, 0], size: to.size }, 0x34d399, 0.14, true);
    const fillGeo = new THREE.BoxGeometry(
      Math.max(to.size[0], 0.1) + 0.14,
      Math.max(to.size[1], 0.1) + 0.14,
      Math.max(to.size[2], 0.1) + 0.14,
    );
    cage.add(new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.16, depthWrite: false }),
    ));
    afterGroup.add(cage);
    afterGroup.position.set(from.position[0], from.position[1], from.position[2]);
    group.add(afterGroup);
    group.userData.afterAnim = {
      group: afterGroup,
      from: new THREE.Vector3(from.position[0], from.position[1], from.position[2]),
      to: new THREE.Vector3(to.position[0], to.position[1], to.position[2]),
    };
  }

  group.userData.halos = halos;
  group.userData.sparks = sparks;
  return group;
}

function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(window.WebGL2RenderingContext && canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

export function WebIfcMainThreadViewer({
  file,
  fileName,
  focus,
  boxes,
  boxesAnchor,
  onFallback,
}: {
  file: File;
  fileName: string;
  /** Localisation 3D demandée depuis QC & Conformité (clic sur un clash). */
  focus?: QcFocusRequest | null;
  /** Boîtes takeoff — référence de frame pour la réconciliation du focus. */
  boxes?: MeshBox[];
  /** Ancre exacte soustraite par le takeoff (repli empirique si absente). */
  boxesAnchor?: [number, number, number] | null;
  onFallback?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  /** Runtime 3D exposé à l'effet [focus] (zéro reconstruction du viewer). */
  const runtimeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    marker: THREE.Group | null;
  } | null>(null);
  /** Dernière demande de focus (prop → ref, lisible depuis l'effet scène). */
  const focusRef = useRef<QcFocusRequest | null>(focus ?? null);
  focusRef.current = focus ?? null;
  /** Boîtes takeoff + ancre exacte (réconciliation du repère du focus). */
  const boxesRef = useRef<MeshBox[]>(boxes ?? []);
  boxesRef.current = boxes ?? [];
  const boxesAnchorRef = useRef<[number, number, number] | null>(boxesAnchor ?? null);
  boxesAnchorRef.current = boxesAnchor ?? null;
  /** Bbox du modèle dans la scène (coordonnées Y-up, fournie par le loader). */
  const sceneBBoxRef = useRef<{ min: [number, number, number]; max: [number, number, number] } | null>(null);
  /** Vecteur de décalage exact soustrait par le loader (ancre scène). */
  const sceneShiftRef = useRef<[number, number, number] | null>(null);
  /** Pont vers l'application du focus interne à l'effet scène. */
  const applyFocusRef = useRef<(request: QcFocusRequest | null) => void>(() => {});
  const [loading, setLoading] = useState(true);
  const [progressPct, setProgressPct] = useState(3);
  const [loadingMessage, setLoadingMessage] = useState("Ouverture du moteur web-ifc…");
  const [stats, setStats] = useState<{
    meshes: number;
    triangles: number;
    durationMs: number;
    /** Référence du ±0,00 (niveau IFC d'ancrage ou point bas). */
    zeroLabel: string;
    /** Note affichée si le budget gros-fichier a réduit le détail. */
    budgetNote: string | null;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    if (!isWebGL2Available()) {
      onFallback?.();
      return;
    }

    let disposed = false;
    const abort = new AbortController();

    // --- Scène three.js ----------------------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Plans de coupe globaux : le cube chirurgical du focus QC les utilise.
    renderer.localClippingEnabled = true;
    renderer.domElement.setAttribute(CANVAS_MARKER, "true");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070f);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.05);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 1.4, 0.8);
    scene.add(sun);
    const back = new THREE.DirectionalLight(0x93c5fd, 0.45);
    back.position.set(-1, -0.6, -1);
    scene.add(back);

    const handleResize = () => {
      if (disposed) return;
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight || 520, false);
      camera.aspect = (clientWidth || 1) / (clientHeight || 520);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) onFallback?.();
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

    let frameId = 0;
    const startedAt = performance.now();
    const renderLoop = () => {
      if (disposed) return;
      const marker = runtimeRef.current?.marker;
      if (marker) {
        const t = performance.now() - startedAt;
        // Pulsation du remplissage rouge de la ZONE EXACTE (opacité 0,16↔0,42).
        const halos = marker.userData.halos as THREE.MeshBasicMaterial[] | undefined;
        if (halos) {
          const pulse = 0.28 + 0.14 * Math.sin(t / 200);
          for (const halo of halos) halo.opacity = pulse;
        }
        // Diamant flashy : rotation + respiration — l'œil ne peut pas le rater.
        const sparks = marker.userData.sparks as THREE.Mesh[] | undefined;
        if (sparks) {
          const s = 1 + 0.4 * Math.sin(t / 160);
          for (const spark of sparks) {
            spark.rotation.y = t / 300;
            spark.scale.setScalar(s);
          }
        }
        // Aperçu Correction IA : la cage verte GLISSE from → to (ping-pong).
        const afterAnim = marker.userData.afterAnim as
          | { group: THREE.Group; from: THREE.Vector3; to: THREE.Vector3 }
          | undefined;
        if (afterAnim) {
          const k = (Math.sin(t / 900) + 1) / 2;
          const smooth = k * k * (3 - 2 * k);
          afterAnim.group.position.lerpVectors(afterAnim.from, afterAnim.to, smooth);
        }
      }
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderLoop);
    };

    // --- Radiographie (X-Ray) OPTIONNELLE : la maquette entière devient
    //     fantôme transparent — la collision est visible À TRAVERS les murs
    //     (méthode Solibri / xeokit). DÉSACTIVÉE PAR DÉFAUT depuis le retour
    //     utilisateur 2026-08-06 : « vaut mieux voir les clashs en mur solide
    //     et pas juste des reflets ». Le bandeau de focus offre la bascule ;
    //     le cube de section garde le contexte net dans les deux modes. ----
    const ghostOriginals = new Map<
      THREE.Material,
      { opacity: number; transparent: boolean; depthWrite: boolean }
    >();
    const setGhost = (on: boolean) => {
      if (!on) {
        for (const [mat, orig] of ghostOriginals) {
          mat.transparent = orig.transparent;
          (mat as THREE.MeshLambertMaterial).opacity = orig.opacity;
          mat.depthWrite = orig.depthWrite;
          mat.needsUpdate = true;
        }
        ghostOriginals.clear();
        return;
      }
      for (const mat of materials) {
        if (!ghostOriginals.has(mat)) {
          ghostOriginals.set(mat, {
            opacity: (mat as THREE.MeshLambertMaterial).opacity ?? 1,
            transparent: mat.transparent,
            depthWrite: mat.depthWrite,
          });
        }
        mat.transparent = true;
        (mat as THREE.MeshLambertMaterial).opacity = 0.07;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    };

    // --- Focus QC & Conformité : marqueur chirurgical + recadrage caméra ---
    const applyFocus = (request: QcFocusRequest | null) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      setGhost(false);
      renderer.clippingPlanes = []; // lever l'éventuel cube de section
      // Purge de l'éventuel marqueur précédent.
      if (runtime.marker) {
        scene.remove(runtime.marker);
        runtime.marker.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | undefined;
          if (mat) mat.dispose();
        });
        runtime.marker = null;
      }
      if (!request) return;

      // Réconciliation des repères : ancres EXACTES si disponibles (ancre
      // takeoff − ancres du loader), sinon repli empirique miroir-conscient.
      // Sans correction, le marqueur tombait SOUS le bâtiment ou reflété.
      const anchors =
        boxesAnchorRef.current && sceneShiftRef.current
          ? { boxesAnchor: boxesAnchorRef.current, sceneShift: sceneShiftRef.current }
          : null;
      const corrected = reconcileFocusBoxes(request, boxesRef.current, sceneBBoxRef.current, anchors);
      // SOLIDE par défaut (murs opaques = la collision se lit dans la matière)
      // ; Röntgen seulement si l'utilisateur l'a demandé via la bascule.
      setGhost(request.xray === true);

      // CUBE DE SECTION (méthode Solibri) : la maquette est DÉCOUPÉE autour
      // du hotspot — tout le reste disparaît réellement, pas en fantôme.
      // C'est ce qui rend la faute NETTE quel que soit le gabarit du clash.
      if (corrected.hotspot) {
        const c = corrected.hotspot.position;
        renderer.clippingPlanes = clashSectionPlanes(c, corrected.hotspot.size).map(
          (p) => new THREE.Plane(new THREE.Vector3(...p.normal), p.constant),
        );
      } else {
        renderer.clippingPlanes = [];
      }

      const marker = buildFocusMarkers(corrected);

      // FAUTIFS EN PLEINE MATIÈRE — le « WAWE » demandé : la vraie géométrie
      // des deux Bauteile en collision est re-teintée (A = rouge plein,
      // B = bleu plein). Plus de simples reflets : on VOIT le mur, la dalle,
      // la fenêtre fautive. polygonOffset évite le z-fighting avec la
      // copie d'origine restée dans la scène (mêmes triangles).
      const meshData = meshesResult; // capture locale (narrowing TS sûr)
      if (meshData && request.elements && request.elements.length > 0) {
        request.elements.slice(0, 2).forEach((el, index) => {
          if (el.expressId == null || !Number.isFinite(el.expressId)) return;
          const role = el.role ?? (index === 0 ? "A" : "B");
          const color = role === "B" ? 0x2f7df6 : 0xf02d2d;
          for (const group of meshData.groups) {
            const sub = extractElementSubMesh(group, el.expressId);
            if (!sub) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(sub.positions, 3));
            geo.setAttribute("normal", new THREE.BufferAttribute(sub.normals, 3));
            geo.setIndex(new THREE.BufferAttribute(sub.indices, 1));
            const mat = new THREE.MeshLambertMaterial({
              color,
              emissive: new THREE.Color(color).multiplyScalar(0.18),
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
              side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.frustumCulled = false;
            marker.add(mesh);
          }
        });
      }

      scene.add(marker);
      runtime.marker = marker;

      // Caméra : centrée sur la ZONE EXACTE, suffisamment près pour que le
      // cube de section remplisse l'écran (jamais plus loin que ·2,4 union).
      const targetArr = corrected.hotspot ? corrected.hotspot.position : corrected.cameraTarget;
      const camTarget = new THREE.Vector3(...targetArr);
      const unionRadius = Math.max(Math.hypot(...corrected.cameraSize) / 2, 0.9);
      const cubeE = corrected.hotspot ? sectionHalfExtent(corrected.hotspot.size) : 0;
      const distance = corrected.hotspot
        ? Math.min(unionRadius * 2.4, Math.max(cubeE * 4, 2.6))
        : Math.max(unionRadius * 3.4, 0.8);
      camera.near = Math.max(distance / 500, 0.02);
      camera.far = Math.max(distance * 60, 600);
      camera.position.set(
        camTarget.x + distance * 0.62,
        camTarget.y + distance * 0.48,
        camTarget.z + distance * 0.62,
      );
      camera.updateProjectionMatrix();
      controls.target.copy(camTarget);
      controls.update();
    };

    runtimeRef.current = { scene, camera, controls, marker: null };
    applyFocusRef.current = applyFocus;

    // --- Conversion IFC → meshes --------------------------------------------
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    let meshesResult: IfcMeshResult | null = null;

    const addResultToScene = (result: IfcMeshResult) => {
      meshesResult = result;
      for (const group of result.groups) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(group.positions, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(group.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(group.indices, 1));
        const opacity = Math.min(1, Math.max(0.05, group.opacity));
        const material = new THREE.MeshLambertMaterial({
          color: new THREE.Color(group.color[0], group.color[1], group.color[2]),
          transparent: opacity < 0.98,
          opacity,
          depthWrite: opacity >= 0.5,
          side: THREE.DoubleSide, // les IFC Revit ont souvent des faces orientées librement
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = true;
        geometries.push(geometry);
        materials.push(material);
        scene.add(mesh);
      }

      // Cadrage sur la boîte englobante.
      const { min, max } = result.bbox;
      const center = new THREE.Vector3(
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      );
      const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      const radius = Math.max(size.length() / 2, 1);
      // web-ifc livre Y-up : la hauteur du bâtiment est l'axe Y.
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 8, radius * 8),
        new THREE.MeshLambertMaterial({ color: 0x0b1220, transparent: true, opacity: 0.85 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(center.x, min[1] - radius * 0.02, center.z);
      scene.add(ground);
      materials.push(ground.material as THREE.Material);
      geometries.push(ground.geometry);

      // Caméra en prise d'élévation (~30°) sur axe Y, azimut sud-est.
      const distance = radius * 2.4;
      camera.position.set(
        center.x + distance * 0.62,
        center.y + distance * 0.45,
        center.z - distance * 0.62,
      );
      camera.near = Math.max(radius / 500, 0.01);
      camera.far = radius * 50 + 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();

      // Bbox du modèle en coordonnées SCÈNE (le loader l'a déjà décalée de
      // son propre recentrage) — référence pour la réconciliation du focus.
      sceneBBoxRef.current = { min: [...min] as [number, number, number], max: [...max] as [number, number, number] };
      // Ancre exacte du loader (vecteur soustrait aux sommets bruts web-ifc).
      sceneShiftRef.current = result.origin.shift;

      // Focus demandé avant la fin du chargement (navigation depuis QC &
      // Conformité) : appliqué maintenant que la scène est peuplée.
      applyFocusRef.current(focusRef.current);
    };

    const run = async () => {
      try {
        setLoading(true);
        setProgressPct(3);
        setLoadingMessage("Lecture du fichier…");
        const buffer = await file.arrayBuffer();
        if (disposed) return;

        const result = await loadIfcMeshes(new Uint8Array(buffer), {
          onProgress: (ratio, stage) => {
            if (disposed) return;
            setProgressPct(Math.max(3, Math.min(99, Math.round(ratio * 100))));
            setLoadingMessage(stage);
          },
        });
        if (disposed) return;
        if (abort.signal.aborted) return;

        addResultToScene(result);
        setStats({
          meshes: result.meshCount,
          triangles: result.triangleCount,
          durationMs: result.durationMs,
          zeroLabel:
            result.origin.basis === "storey"
              ? `±0,00 ↔ ${result.origin.storeyName ?? "tiefstes Geschoss"} (IFC-Projektdatum)`
              : "±0,00 ↔ tiefster Bauteilpunkt (kein Geschoss gefunden)",
          budgetNote: result.budgetNote,
        });
        setProgressPct(100);
        setLoading(false);
        frameId = requestAnimationFrame(renderLoop);
      } catch (error) {
        console.error("[WebIfcMainThreadViewer] Échec de la géométrie sans Worker :", error);
        captureOperationalError(error, { context: "WebIfcMainThreadViewer.Load", fileName });
        if (!disposed) onFallback?.();
      }
    };
    void run();

    // --- Nettoyage déterministe ---------------------------------------------
    return () => {
      disposed = true;
      abort.abort();
      runtimeRef.current = null;
      applyFocusRef.current = () => {};
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      controls.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      if (meshesResult) meshesResult.groups.length = 0;
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [file, fileName, onFallback]);

  // Application des demandes de focus successives (clics QC & Conformité)
  // SANS reconstruire le viewer — l'horodatage `at` force un nouveau focus
  // même sur le même clash.
  useEffect(() => {
    applyFocusRef.current(focus ?? null);
  }, [focus]);

  return (
    <div className="relative h-full min-h-[520px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#05070f] shadow-2xl">
      <div ref={mountRef} className="h-full min-h-[520px] w-full" />

      <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-2rem)] rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 text-xs text-white backdrop-blur">
        <div className="font-display font-bold text-brand-300">
          web-ifc · géométrie réelle — thread principal (kein Worker nötig)
        </div>
        <div className="truncate text-slate-300">
          {fileName}
          {stats
            ? ` · ${stats.meshes.toLocaleString("fr-FR")} meshes · ${stats.triangles.toLocaleString("fr-FR")} Dreiecke · ${stats.durationMs} ms`
            : ""}
        </div>
        {stats && (
          <div className="mt-0.5 text-[10px] text-emerald-300">{stats.zeroLabel}</div>
        )}
        {stats?.budgetNote && (
          <div className="mt-0.5 text-[10px] text-amber-300">{stats.budgetNote}</div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#05070f]/85 text-white backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-400 border-t-transparent" />
          <p className="mt-4 text-sm font-semibold">{loadingMessage}</p>
          <div className="mt-3 w-64 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-2 rounded-full bg-brand-400 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Rendu direct GPU — aucun Worker requis
          </p>
        </div>
      )}
    </div>
  );
}
