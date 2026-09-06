import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MeshBox } from '@/lib/ifcGeometry';
import type { QcFocusRequest } from '@/store/slices/systemSlice';
import { clashSectionPlanes, sectionHalfExtent } from '@/lib/qcFocus3d';
import { cn } from '@/utils/cn';

/// Repère MeshBox (IFC Z-up) → repère three.js Y-up de ce viewer.
function toThree(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], v[1]);
}

/// Marquage CHIRURGICAL V2 (méthode Solibri / Navisworks) :
///   - HOTSPOT : la zone d'intersection EXACTE à corriger — cage rouge +
///     remplissage pulsant + DIAMANT flashy ;
///   - fautifs : fines cages ORANGE filaires (contexte, zéro remplissage) ;
///   - aperçu Correction IA : cage VERTE pointillée glissant from → to.
function buildFocusMarkers(input: {
  elements: { position: THREE.Vector3; size: THREE.Vector3 }[];
  hotspot: { position: THREE.Vector3; size: THREE.Vector3 } | null;
  after: {
    from: { position: THREE.Vector3; size: THREE.Vector3 };
    to: { position: THREE.Vector3; size: THREE.Vector3 };
  } | null;
}): THREE.Group {
  const group = new THREE.Group();
  const halos: THREE.MeshBasicMaterial[] = [];
  const sparks: THREE.Mesh[] = [];

  const cageEdges = (
    size: THREE.Vector3,
    color: number,
    pad: number,
    dashed = false,
  ): THREE.LineSegments => {
    const geo = new THREE.BoxGeometry(
      Math.max(size.x, 0.1) + pad,
      Math.max(size.y, 0.1) + pad,
      Math.max(size.z, 0.1) + pad,
    );
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.28, gapSize: 0.16, transparent: true, opacity: 0.95 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
    if (dashed) edges.computeLineDistances();
    return edges;
  };

  // 1) Fautifs : fines cages ORANGE filaires — contexte sans masquage.
  for (const el of input.elements) {
    const edges = cageEdges(el.size, 0xffb020, 0.1);
    edges.position.copy(el.position);
    group.add(edges);
  }

  // 2) ZONE EXACTE À CORRIGER : rouge pulsant + diamant rotatif.
  if (input.hotspot) {
    const hs = input.hotspot;
    const cage = new THREE.Group();
    cage.position.copy(hs.position);
    cage.add(cageEdges(hs.size, 0xff3b30, 0.16));
    const fillGeo = new THREE.BoxGeometry(
      Math.max(hs.size.x, 0.1) + 0.16,
      Math.max(hs.size.y, 0.1) + 0.16,
      Math.max(hs.size.z, 0.1) + 0.16,
    );
    const fill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    halos.push(fill.material as THREE.MeshBasicMaterial);
    cage.add(fill);
    const r = Math.min(Math.max(Math.min(hs.size.x, hs.size.y, hs.size.z), 0.16), 0.7);
    const spark = new THREE.Mesh(
      new THREE.OctahedronGeometry(r, 0),
      new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    cage.add(spark);
    sparks.push(spark);
    group.add(cage);
  } else {
    // Ancien format (violation de règle) : remplissage pulsant orange-rouge.
    for (const el of input.elements) {
      const fillGeo = new THREE.BoxGeometry(
        Math.max(el.size.x, 0.1) + 0.1,
        Math.max(el.size.y, 0.1) + 0.1,
        Math.max(el.size.z, 0.1) + 0.1,
      );
      const fill = new THREE.Mesh(
        fillGeo,
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      fill.position.copy(el.position);
      halos.push(fill.material as THREE.MeshBasicMaterial);
      group.add(fill);
    }
  }

  // 3) Aperçu AVANT/APRÈS : cage verte glissant de la faute vers le corrigé.
  if (input.after) {
    const afterGroup = new THREE.Group();
    const cage = new THREE.Group();
    cage.add(cageEdges(input.after.to.size, 0x34d399, 0.14, true));
    const fillGeo = new THREE.BoxGeometry(
      Math.max(input.after.to.size.x, 0.1) + 0.14,
      Math.max(input.after.to.size.y, 0.1) + 0.14,
      Math.max(input.after.to.size.z, 0.1) + 0.14,
    );
    cage.add(new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.16, depthWrite: false }),
    ));
    afterGroup.add(cage);
    afterGroup.position.copy(input.after.from.position);
    group.add(afterGroup);
    group.userData.afterAnim = {
      group: afterGroup,
      from: input.after.from.position.clone(),
      to: input.after.to.position.clone(),
    };
  }

  group.userData.halos = halos;
  group.userData.sparks = sparks;
  return group;
}

const KG_COLORS: Record<string, string> = {
  '310': '#3b82f6',
  '320': '#10b981',
  '330': '#6366f1',
  '340': '#ec4899',
  '360': '#eab308',
  '400': '#f97316',
  'unknown': '#94a3b8',
};

function getElementKg(type: string): string {
  const t = type.toUpperCase();
  if (t.includes('FOOT') || t.includes('FOUND') || t.includes('PILE')) return '310';
  if (t.includes('WALL') || t.includes('CURTAIN')) return '320';
  if (t.includes('SLAB') || t.includes('COLUMN') || t.includes('BEAM') || t.includes('STAIR') || t.includes('MEMBER') || t.includes('PLATE')) return '330';
  if (t.includes('ROOF') || t.includes('WINDOW') || t.includes('DOOR')) return '340';
  if (t.includes('COVER') || t.includes('FURNISH')) return '360';
  if (t.includes('FLOW') || t.includes('TERMINAL')) return '400';
  return '330';
}

function isWebGL2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch (e) {
    return false;
  }
}

// Marqueur pour le nettoyage déterministe des canevas zombies
const CANVAS_MARKER = 'data-narchi-modelviewer-canvas';

export function ModelViewer({
  boxes,
  levelFilter,
  onSelect,
  focus,
}: {
  boxes: MeshBox[];
  levelFilter?: string | null;
  onSelect?: (id: number | null) => void;
  /** Localisation 3D demandée depuis QC & Conformité (clic sur un clash). */
  focus?: QcFocusRequest | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  /** Dernière demande de focus (prop → ref, lisible depuis l'effet scène). */
  const focusRef = useRef<QcFocusRequest | null>(focus ?? null);
  focusRef.current = focus ?? null;
  /** Pont vers l'application du focus interne à l'effet scène. */
  const applyFocusRef = useRef<(request: QcFocusRequest | null) => void>(() => {});
  const [layer, setLayer] = useState<string>('all');
  const [selectedBox, setSelectedBox] = useState<any | null>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    setWebglAvailable(isWebGL2Available());
  }, []);

  const baseVisible = useMemo(
    () => (levelFilter ? boxes.filter((b) => b.level === levelFilter || b.level === '—') : boxes),
    [boxes, levelFilter]
  );

  const visible = useMemo(() => {
    if (layer === 'all') return baseVisible;
    return baseVisible.filter((b) => {
      const t = b.type.toUpperCase();
      if (layer === 'walls') return t.includes('WALL');
      if (layer === 'slabs') return t.includes('SLAB') || t.includes('ROOF') || t.includes('FOOT') || t.includes('FOUND');
      if (layer === 'struct') return t.includes('COLUMN') || t.includes('BEAM') || t.includes('PILE') || t.includes('MEMBER');
      if (layer === 'openings') return t.includes('WINDOW') || t.includes('DOOR');
      return true;
    });
  }, [baseVisible, layer]);

  // UNIFICATION COMPLÈTE DU CYCLE DE VIE THREE.JS EN UN SEUL EFFET
  useEffect(() => {
    const container = mountRef.current;
    if (!container || !isWebGL2Available()) return;

    // --- 1. Nettoyage déterministe des canevas zombies ---
    const existing = container.querySelectorAll(`[${CANVAS_MARKER}]`);
    existing.forEach((c) => {
      const oldRenderer = (c as any).__narchi_renderer as THREE.WebGLRenderer | undefined;
      if (oldRenderer) {
        oldRenderer.dispose();
        oldRenderer.forceContextLoss();
      }
      c.remove();
    });

    // --- 2. Scène, caméra, renderer ---
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.008);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      console.error('[ModelViewer] Failed to create WebGL context:', e);
      setWebglAvailable(false);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute(CANVAS_MARKER, 'true');
    (renderer.domElement as any).__narchi_renderer = renderer;
    container.appendChild(renderer.domElement);

    // Lumières
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.0);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.0);
    dirLight.position.set(50, 80, 40);
    scene.add(dirLight);

    const raycaster = new THREE.Raycaster();

    // --- 3. Population de la scène ---
    let instancedMesh: THREE.InstancedMesh | null = null;
    let edgesMesh: THREE.LineSegments | null = null;
    let grid: THREE.GridHelper | null = null;
    let focusMarker: THREE.Group | null = null; // marqueur de clash (QC)
    const target = new THREE.Vector3(0, 0, 0);

    if (visible.length > 0) {
      // Calcul de la bounding box monde
      const bbox = new THREE.Box3();
      for (const b of visible) {
        if (!b?.center || !b?.size) continue;
        const c = new THREE.Vector3(b.center.x, b.center.z, b.center.y);
        const h = new THREE.Vector3(b.size.x, b.size.z, b.size.y);
        bbox.expandByPoint(c.clone().add(h));
        bbox.expandByPoint(c.clone().sub(h));
      }

      const size = new THREE.Vector3();
      bbox.getSize(size);
      
      // Les boîtes sont recentrées par ifcGeometry. La caméra adaptative gère
      // directement mètres comme millimètres sans mettre la scène et la caméra
      // dans des repères différents.
      const maxD = Math.max(size.x, size.y, size.z, 15);

      grid = new THREE.GridHelper(maxD * 4, 40, 0x334155, 0x1e293b);
      grid.position.set(0, -maxD * 0.5, 0);
      scene.add(grid);

      const baseGeom = new THREE.BoxGeometry(1, 1, 1);
      // CORRECTION : PAS de vertexColors: true. Les couleurs par instance
      // sont gérées automatiquement via setColorAt / instanceColor.
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.8,
        metalness: 0.1,
        transparent: true,
        opacity: 0.88,
      });

      instancedMesh = new THREE.InstancedMesh(baseGeom, material, visible.length);
      instancedMesh.frustumCulled = false;

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const edgeVertices: number[] = [];
      const baseEdges = new THREE.EdgesGeometry(baseGeom);
      const baseEdgePositions = baseEdges.attributes.position.array as Float32Array;

      for (let i = 0; i < visible.length; i++) {
        const b = visible[i];
        if (!b || !b.size || !b.center) continue;
        if (Number.isNaN(b.center.x) || Number.isNaN(b.center.y) || Number.isNaN(b.center.z)) continue;

        const sx = Math.max((b.size.x || 0.1) * 2, 0.08);
        const sy = Math.max((b.size.z || 0.1) * 2, 0.08);
        const sz = Math.max((b.size.y || 0.1) * 2, 0.08);

        // Espace monde : Y est la hauteur (z IFC)
        dummy.position.set((b.center.x || 0), (b.center.z || 0), (b.center.y || 0));
        dummy.rotation.set(0, -(b.rotationY || 0), 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();

        instancedMesh.setMatrixAt(i, dummy.matrix);

        const kg = getElementKg(b.type);
        color.set(KG_COLORS[kg] ?? KG_COLORS['unknown']);
        instancedMesh.setColorAt(i, color);

        // Arêtes
        for (let j = 0; j < baseEdgePositions.length; j += 3) {
          const v = new THREE.Vector3(baseEdgePositions[j], baseEdgePositions[j + 1], baseEdgePositions[j + 2]);
          v.applyMatrix4(dummy.matrix);
          edgeVertices.push(v.x, v.y, v.z);
        }
      }

      baseEdges.dispose();
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      instancedMesh.userData = { boxes: visible };
      scene.add(instancedMesh);

      const edgesGeom = new THREE.BufferGeometry();
      edgesGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3));
      const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1.5 });
      edgesMesh = new THREE.LineSegments(edgesGeom, edgesMat);
      edgesMesh.frustumCulled = false;
      scene.add(edgesMesh);

      // --- 4. Caméra adaptative ---
      const center = bbox.getCenter(new THREE.Vector3());
      target.copy(center);
      const camDiagonal = size.length();
      camera.near = Math.max(camDiagonal * 0.0001, 0.1);
      camera.far = Math.max(camDiagonal * 10, 1000);

      const distance = Math.max(maxD / (2 * Math.tan((camera.fov * Math.PI) / 360)), camDiagonal * 1.2);
      camera.position.set(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance * 0.8);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
    } else {
      // Pas de modèle : vue par défaut
      camera.position.set(30, 25, 30);
      camera.lookAt(target);
    }

    // --- 5. Animation ---
    let rafId = 0;
    const animStart = performance.now();
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (focusMarker) {
        const t = performance.now() - animStart;
        // Pulsation du remplissage rouge de la ZONE EXACTE (0,16 ↔ 0,42).
        const halos = focusMarker.userData.halos as THREE.MeshBasicMaterial[] | undefined;
        if (halos) {
          const pulse = 0.28 + 0.14 * Math.sin(t / 200);
          for (const halo of halos) halo.opacity = pulse;
        }
        // Diamant flashy : rotation + respiration.
        const sparks = focusMarker.userData.sparks as THREE.Mesh[] | undefined;
        if (sparks) {
          const s = 1 + 0.4 * Math.sin(t / 160);
          for (const spark of sparks) {
            spark.rotation.y = t / 300;
            spark.scale.setScalar(s);
          }
        }
        // Aperçu Correction IA : la cage verte GLISSE from → to (ping-pong).
        const afterAnim = focusMarker.userData.afterAnim as
          | { group: THREE.Group; from: THREE.Vector3; to: THREE.Vector3 }
          | undefined;
        if (afterAnim) {
          const k = (Math.sin(t / 900) + 1) / 2;
          const smooth = k * k * (3 - 2 * k);
          afterAnim.group.position.lerpVectors(afterAnim.from, afterAnim.to, smooth);
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    // --- 6. Contrôles & interactions ---
    const handleResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    let isDragging = false;
    let prevX = 0, prevY = 0;
    let camDist = camera.position.distanceTo(target);
    let theta = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
    let phi = Math.acos(Math.max(-1, Math.min(1, (camera.position.y - target.y) / camDist)));

    const dom = renderer.domElement;

    // --- Focus QC & Conformité : marqueur chirurgical + orbite ------------
    // Radiographie (X-Ray) OPTIONNELLE (bascule du bandeau) : les boîtes
    // deviennent fantômes — la zone exacte ressort à travers tout le reste.
    // DÉFAUT = SOLIDE depuis le retour utilisateur 2026-08-06 (« vaut mieux
    // voir les clashs en mur solide et pas juste des reflets »).
    let ghosted = false;
    const setGhost = (on: boolean) => {
      if (!instancedMesh) return;
      const mat = instancedMesh.material as THREE.MeshStandardMaterial;
      if (on === ghosted) return;
      ghosted = on;
      mat.opacity = on ? 0.13 : 0.88;
      mat.needsUpdate = true;
      if (edgesMesh) {
        const em = edgesMesh.material as THREE.LineBasicMaterial;
        em.transparent = true;
        em.opacity = on ? 0.12 : 1;
        em.needsUpdate = true;
      }
    };

    const applyFocus = (request: QcFocusRequest | null) => {
      setGhost(false);
      renderer.localClippingEnabled = true;
      renderer.clippingPlanes = []; // lever l'éventuel cube de section
      // Restaure toujours les couleurs de famille d'origine (le re-teintage
      // rouge/bleu d'un focus précédent ne doit pas survivre).
      if (instancedMesh) {
        const base = new THREE.Color();
        for (let i = 0; i < visible.length; i++) {
          base.set(KG_COLORS[getElementKg(visible[i].type)] ?? KG_COLORS['unknown']);
          instancedMesh.setColorAt(i, base);
        }
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      }
      if (focusMarker) {
        scene.remove(focusMarker);
        focusMarker.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | undefined;
          if (mat) mat.dispose();
        });
        focusMarker = null;
      }
      if (!request) return;

      // Marquage chirurgical (ce viewer rend les mêmes boîtes → conversion
      // naïve suffit, Δ = 0) : cages orange + HOTSPOT rouge pulsant.
      const convert = (el: { center: [number, number, number]; size: [number, number, number] }) => ({
        position: toThree(el.center),
        size: toThree(el.size),
      });
      const sources = request.elements && request.elements.length > 0
        ? request.elements
        : [{ center: request.center, size: request.size }];
      // SOLIDE par défaut (murs opaques) ; Röntgen seulement sur demande.
      setGhost(request.xray === true);
      const convHotspot = request.hotspot ? convert(request.hotspot) : null;
      // Cube de section autour du hotspot (coordonnées de CE viewer — pas de
      // Δ ici, les mêmes boîtes sont rendues).
      if (convHotspot) {
        const c: [number, number, number] = [convHotspot.position.x, convHotspot.position.y, convHotspot.position.z];
        renderer.clippingPlanes = clashSectionPlanes(c, [convHotspot.size.x, convHotspot.size.y, convHotspot.size.z]).map(
          (p) => new THREE.Plane(new THREE.Vector3(...p.normal), p.constant),
        );
      }
      focusMarker = buildFocusMarkers({
        elements: sources.map(convert),
        hotspot: convHotspot,
        after: request.after
          ? { from: convert(request.after.from), to: convert(request.after.to) }
          : null,
      });
      scene.add(focusMarker);

      // FAUTIFS EN PLEINE MATIÈRE : les boîtes-instanches des deux Bauteile
      // en collision passent en rouge plein (A) / bleu plein (B) — la faute
      // se lit dans la matière, pas dans un simple reflet filaire.
      if (instancedMesh && request.elements) {
        request.elements.slice(0, 2).forEach((el, index) => {
          if (el.expressId == null) return;
          const instanceIndex = visible.findIndex((b) => b.id === el.expressId);
          if (instanceIndex < 0) return; // filtré hors du niveau affiché
          const role = el.role ?? (index === 0 ? 'A' : 'B');
          instancedMesh!.setColorAt(
            instanceIndex,
            new THREE.Color(role === 'B' ? 0x2f7df6 : 0xf02d2d),
          );
        });
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      }

      // Orbite re-pointée sur la ZONE EXACTE à corriger, assez près pour que
      // le cube de section remplisse l'écran (jamais plus loin que ·2,4 union).
      const targetThree = request.hotspot ? toThree(request.hotspot.center) : toThree(request.center);
      const sizeThree = toThree(request.size);
      const radius = Math.max(sizeThree.length() / 2, 0.9);
      const cubeE = request.hotspot ? sectionHalfExtent(toThree(request.hotspot.size).toArray() as [number, number, number]) : 0;
      camDist = request.hotspot
        ? Math.min(radius * 2.4, Math.max(cubeE * 4, 2.6))
        : Math.max(radius * 3.4, 0.8);
      theta = Math.PI / 4;
      phi = Math.PI / 3;
      target.copy(targetThree);
      camera.near = Math.max(camDist / 500, 0.05);
      camera.far = Math.max(camDist * 30, 500);
      camera.position.set(
        target.x + camDist * Math.sin(phi) * Math.sin(theta),
        target.y + camDist * Math.cos(phi),
        target.z + camDist * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    applyFocusRef.current = applyFocus;

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; };
    const onMouseUp = () => { isDragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      theta -= (e.clientX - prevX) * 0.008;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - (e.clientY - prevY) * 0.008));
      prevX = e.clientX; prevY = e.clientY;

      camera.position.x = target.x + camDist * Math.sin(phi) * Math.sin(theta);
      camera.position.y = target.y + camDist * Math.cos(phi);
      camera.position.z = target.z + camDist * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(target);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      camDist = Math.max(0.5, camDist * (1 + e.deltaY * 0.001));
      camera.position.x = target.x + camDist * Math.sin(phi) * Math.sin(theta);
      camera.position.y = target.y + camDist * Math.cos(phi);
      camera.position.z = target.z + camDist * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(target);
    };

    const onClick = (e: MouseEvent) => {
      if (!instancedMesh) return;
      const rect = dom.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(instancedMesh, false);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const instanceId = intersects[0].instanceId;
        const hitData = visible[instanceId];
        setSelectedBox({ ...hitData, kg: getElementKg(hitData.type) });
        onSelect?.(hitData.id);

        // Mise en surbrillance
        for (let i = 0; i < visible.length; i++) {
          const hex = KG_COLORS[getElementKg(visible[i].type)] ?? KG_COLORS['unknown'];
          const col = new THREE.Color(hex);
          if (i !== instanceId) col.lerp(new THREE.Color(0x05070f), 0.6);
          instancedMesh.setColorAt(i, col);
        }
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      } else {
        setSelectedBox(null);
        onSelect?.(null);
        for (let i = 0; i < visible.length; i++) {
          const hex = KG_COLORS[getElementKg(visible[i].type)] ?? KG_COLORS['unknown'];
          instancedMesh.setColorAt(i, new THREE.Color(hex));
        }
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      }
    };

    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('click', onClick);

    // Focus demandé avant/juste après le montage (navigation QC & Conformité).
    if (focusRef.current) applyFocus(focusRef.current);

    const resetCamera = () => {
      camDist = camera.position.distanceTo(target);
      theta = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
      phi = Math.acos(Math.max(-1, Math.min(1, (camera.position.y - target.y) / camDist)));
    };
    (window as any)._narchi_modelviewer_reset = () => {
      if (visible.length > 0) {
        const bbox = new THREE.Box3();
        for (const b of visible) {
          if (!b?.center || !b?.size) continue;
          const c = new THREE.Vector3(b.center.x, b.center.z, b.center.y);
          const h = new THREE.Vector3(b.size.x, b.size.z, b.size.y);
          bbox.expandByPoint(c.clone().add(h));
          bbox.expandByPoint(c.clone().sub(h));
        }
        const center = bbox.getCenter(new THREE.Vector3());
        const size = new THREE.Vector3();
        bbox.getSize(size);
        target.copy(center);
        camDist = Math.max(size.length() * 1.2, 15);
      } else {
        target.set(0, 0, 0);
        camDist = 40;
      }
      theta = Math.PI / 4;
      phi = Math.PI / 3;
      camera.position.set(
        target.x + camDist * Math.sin(phi) * Math.sin(theta),
        target.y + camDist * Math.cos(phi),
        target.z + camDist * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
      resetCamera();
    };

    // --- 7. Cleanup déterministe ---
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('click', onClick);
      delete (window as any)._narchi_modelviewer_reset;

      if (instancedMesh) {
        instancedMesh.geometry.dispose();
        const mat = instancedMesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
      if (edgesMesh) {
        edgesMesh.geometry.dispose();
        (edgesMesh.material as THREE.Material).dispose();
      }
      if (grid) {
        grid.geometry.dispose();
        const gm = grid.material;
        if (Array.isArray(gm)) gm.forEach((m) => m.dispose());
        else gm.dispose();
      }

      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      applyFocusRef.current = () => {};
    };
  }, [visible, onSelect]);

  // Application des demandes de focus successives (clics QC & Conformité)
  // SANS reconstruire la scène — l'horodatage `at` force un nouveau focus
  // même sur le même clash.
  useEffect(() => {
    applyFocusRef.current(focus ?? null);
  }, [focus]);

  if (!webglAvailable) {
    return (
      <div className="flex h-full min-h-[520px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#05070f] p-6 text-center text-white shadow-2xl">
        <div className="text-5xl">📊</div>
        <h3 className="mt-4 font-display text-lg font-bold text-brand-300">Visualisation 3D en mode plan</h3>
        <p className="mt-2 max-w-md text-xs text-slate-400">
          WebGL ist in diesem Browser nicht verfügbar oder deaktiviert.
          DIN-276-Schätzung und Mengentabelle bleiben nutzbar.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full flex flex-col bg-[#05070f] overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-ink-900/95 border-b border-white/10 backdrop-blur z-10">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', l: '🏢 Tous les calques' },
            { id: 'walls', l: '🧱 Murs (KG 320)' },
            { id: 'slabs', l: '▬ Dalles (KG 330)' },
            { id: 'struct', l: '🏗️ Structure' },
            { id: 'openings', l: '🪟 Ouvertures' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setLayer(f.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
                layer === f.id
                  ? 'bg-brand-500 text-ink-950 shadow-md shadow-brand-500/30 scale-105'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white'
              )}
            >
              {f.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (typeof (window as any)._narchi_modelviewer_reset === 'function') {
                (window as any)._narchi_modelviewer_reset();
              }
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white cursor-pointer transition-colors"
          >
            🔄 Recadrer la vue
          </button>
          <span className="text-[11px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
            WebGL V2 (InstancedMesh) · {visible.length} Bauteile
          </span>
        </div>
      </div>

      <div ref={mountRef} className="flex-1 w-full cursor-grab active:cursor-grabbing min-h-[420px]" />

      {selectedBox && (
        <div className="absolute bottom-4 left-4 z-20 w-80 rounded-2xl border border-brand-400 bg-ink-900/95 p-4 text-xs text-white shadow-2xl backdrop-blur animate-in fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-display font-bold text-brand-400">{selectedBox.type}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px]">KG {selectedBox.kg}</span>
          </div>
          <div className="mt-2.5 space-y-1.5 text-slate-300">
            <p><strong className="text-white">Name:</strong> {selectedBox.name || "Bauteil"}</p>
            <p><strong className="text-white">Geschoss:</strong> {selectedBox.level || "—"}</p>
            <p className="truncate font-mono text-[10px] text-slate-400">GUID: {selectedBox.globalId || '—'}</p>
          </div>
          <button onClick={() => setSelectedBox(null)} className="mt-3 w-full rounded-lg bg-white/10 py-1 text-center font-semibold hover:bg-white/20">
            Inspektion schließen
          </button>
        </div>
      )}
    </div>
  );
}
