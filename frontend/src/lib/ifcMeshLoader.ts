/**
 * IFC MESH LOADER — géométrie RÉELLE sans Web Worker (NARCHI)
 * ------------------------------------------------------------
 * Extrait les maillages triangulés d'un fichier IFC via web-ifc exécuté sur
 * le THREAD PRINCIPAL (import dynamique + WASM local /ifc/web-ifc.wasm),
 * puis les fusionne par couleur en grands tampons prêts pour three.js.
 *
 * Pourquoi ce module existe : la visionneuse « premium » (That Open
 * Fragments) et le worker de parsing exigent des Web Workers, bloqués dans
 * certains environnements (web-shield, extensions, navigateurs anciens).
 * Ce moteur intermédiaire rend les VRAIES formes du modèle (murs avec
 * ouvertures, dalles, mobilier) avec : aucun Worker, aucun CDN, aucune
 * dépendance serveur — uniquement le WASM copié au build dans l'image.
 *
 * Sécurité/robustesse :
 *  - Budgets stricts (sommets/meshes) : un IFC de plateau infographique ne
 *    peut pas figer l'onglet — au-delà, l'appelant bascule sur le repli
 *    analytique (boîtes).
 *  - Cession périodique au navigateur (requestAnimationFrame) entre les
 *    meshes : l'UI reste vivante pendant la conversion.
 *  - Toute la mémoire WASM est libérée (delete()/CloseModel) en finally.
 */

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

import { resolveStoreyZeroAnchor } from "./ifcStoreyZero";
import { parseIfcBytes } from "./ifcParser";

/// Plage de triangles d'UN élément IFC à l'intérieur d'un groupe fusionné.
/// Sert au FOCUS QC : re-teinter en pleine matière (rouge/bleu) uniquement
/// les deux Bauteile en collision, sans toucher au reste de la maquette.
export interface IfcElementRange {
  /** Express ID IFC de l'élément source de ces triangles. */
  expressId: number;
  /** Début (inclus) dans le tampon d'indices du groupe. */
  start: number;
  /** Fin (exclue) dans le tampon d'indices du groupe. */
  end: number;
}

export interface IfcMeshGroup {
  /** Couleur linéaire 0..1 (r, g, b) issue du modèle IFC. */
  color: [number, number, number];
  /** 1 = opaque ; < 1 = matériau transparent (verre…). */
  opacity: number;
  /** xyz consécutifs, transformés (matrices de placement déjà appliquées). */
  positions: Float32Array;
  /** Normales unitaires alignées sur positions. */
  normals: Float32Array;
  /** Indices de triangles (non soudés, tels que fournis par web-ifc). */
  indices: Uint32Array;
  /** Registre « quel triangle appartient à quel élément » (plages dans le
      tampon d'indices ci-dessus). Vide sur les anciens objets de test. */
  elementRanges?: IfcElementRange[];
}

/** Référence du ±0,00 appliquée à la scène (affichage + tests). */
export interface IfcMeshOrigin {
  /** "storey" : ancé sur le niveau le plus bas de l'IFC (chaine de placement) ;
   *  "bbox"   : repli sur le point le plus bas de la géométrie. */
  basis: "storey" | "bbox";
  /** Nom du niveau d'ancrage (basis "storey"). */
  storeyName: string | null;
  /** Décalage Z effectivement retiré de la géométrie brute. */
  shiftZ: number;
  /** Vecteur EXACT soustrait aux sommets bruts web-ifc (repère Y-up :
      x = IFC x, y = IFC z, z = −IFC y) — ancre commune avec les boîtes
      takeoff pour la réconciliation du focus QC sans heuristique. */
  shift: [number, number, number];
}

export interface IfcMeshResult {
  groups: IfcMeshGroup[];
  /** Boîte englobante du modèle (coordonnées projet, origine recentrée). */
  bbox: { min: [number, number, number]; max: [number, number, number] };
  origin: IfcMeshOrigin;
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  schema: string | null;
  durationMs: number;
  /** Note d'affichage quand le budget adaptatif gros-fichier a réduit le détail. */
  budgetNote: string | null;
}

export interface IfcMeshLoadOptions {
  /** Base des assets WASM (défaut : "/ifc/" résolu sur l'origine). */
  wasmBase?: string;
  /** Budget sommets (défaut 3 000 000). Dépassement = exception → repli. */
  maxVertices?: number;
  /** Budget meshes IFC (défaut 60 000). */
  maxMeshes?: number;
  /** Progression 0..1 (téléchargement exclu — conversion WASM uniquement). */
  onProgress?: (ratio: number, stage: string) => void;
  /** Point de rendu UI périodique (défaut : rAF si dispo, sinon microtask). */
  yieldControl?: () => Promise<void>;
}

class IfcMeshBudgetError extends Error {}

// ---------------------------------------------------------------------------
// Résolution WASM + singleton IfcAPI (thread principal)
// ---------------------------------------------------------------------------

function defaultWasmBase(): string {
  const assetBase = (import.meta.env.VITE_ASSET_BASE || "").replace(/\/$/, "");
  const configured = import.meta.env.VITE_IFC_WASM_BASE || `${assetBase}/ifc/`;
  const withSlash = configured.endsWith("/") ? configured : `${configured}/`;
  if (withSlash.startsWith("http")) return withSlash;
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : typeof self !== "undefined" && self.location
        ? self.location.origin
        : "http://localhost";
  return new URL(withSlash, origin).href;
}

type WebIfcModule = typeof import("web-ifc");
type IfcApiInstance = InstanceType<WebIfcModule["IfcAPI"]>;

let apiSingleton: Promise<IfcApiInstance> | null = null;

async function getIfcApi(wasmBase?: string): Promise<IfcApiInstance> {
  if (!apiSingleton) {
    apiSingleton = (async () => {
      const resolvedWasmBase = wasmBase ?? defaultWasmBase();
      // Le module ESM est chargé DIRECTEMENT depuis l'asset statique
      // (/ifc/web-ifc-api.js, copié au build dans l'image Nginx) et NON
      // bundlé : Rollup ne parse jamais les 2,2 Mo UMD d'Emscripten dans le
      // graphe principal — pic mémoire de build supprimé, build nettement
      // plus rapide. Mêmes types via `import type` (effacés au runtime).
      // Navigateur → build web ESM ; Node (tests) → build node CJS du même
      // package (la web refuse de s'initialiser hors navigateur).
      const isNodeRuntime =
        typeof process !== "undefined" &&
        Boolean(process.versions?.node) &&
        typeof window === "undefined";
      const moduleFile = isNodeRuntime ? "web-ifc-api-node.js" : "web-ifc-api.js";
      const webIfc = (await import(
        /* @vite-ignore */ `${resolvedWasmBase}${moduleFile}`
      )) as WebIfcModule;
      const api = new webIfc.IfcAPI();
      // Chemin absolu du répertoire (web-ifc ajoute lui-même le fichier).
      api.SetWasmPath(resolvedWasmBase, true);
      // Mono-thread forcé : la variante MT se fige sur certains
      // Chromium/WSL2 (constat identique côté Worker, voir ifcParser.worker).
      await api.Init(undefined, true);
      return api as IfcApiInstance;
    })();
    // Un échec d'Init ne doit pas empoisonner les tentatives suivantes.
    apiSingleton.catch(() => {
      apiSingleton = null;
    });
  }
  return apiSingleton;
}

// ---------------------------------------------------------------------------
// Matrices (web-ifc flatTransformation : 16 flottants, column-major)
// ---------------------------------------------------------------------------

/** Applique une matrice 4×4 column-major à un point. */
function transformPoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Matrice normale = transposée(inverse(3×3 supérieur)). Exacte même sous
 * mise à l'échelle non uniforme (MappedItem fréquents dans les IFC Revit).
 * Déterminant nul → rotation telle quelle (dégradé visuel acceptable).
 */
function normalMatrix3(m: ArrayLike<number>): Float32Array {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return new Float32Array([a, b, c, d, e, f, g, h, i]);
  }
  const inv = 1 / det;
  // inverse(3x3) : adjugé / det, puis transposition pour la matrice normale.
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  // transposée de l'inverse : coefficients rangés en column-vector opérant
  // sur (nx, ny, nz) comme n' = N · n avec colonnes issues de l'adjugé.
  return new Float32Array([
    A * inv, D * inv, G * inv,
    B * inv, E * inv, H * inv,
    C * inv, F * inv, I * inv,
  ]);
}

function transformNormal(
  n3: Float32Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const nx = n3[0] * x + n3[3] * y + n3[6] * z;
  const ny = n3[1] * x + n3[4] * y + n3[7] * z;
  const nz = n3[2] * x + n3[5] * y + n3[8] * z;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

// ---------------------------------------------------------------------------
// Extraction principale
// ---------------------------------------------------------------------------

const defaultYield = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

/// Budgets de rendu adaptés à la taille du fichier (protection du navigateur
/// sur les gros IFC — un onglet qui explose en mémoire n'affiche RIEN).
export interface MeshBudgets {
  maxVertices: number;
  maxMeshes: number;
  /** Fichier jugé « gros » : le badge du viewer affiche une note. */
  degraded: boolean;
  note: string | null;
}

export const IFC_HARD_LIMIT_BYTES = 60_000_000; // 60 Mo — au-delà : boîtes analytiques
export const IFC_TOO_LARGE_ERROR = "IFC_TOO_LARGE";

export function meshBudgetsForSize(bytes: number): MeshBudgets {
  if (bytes > 20_000_000) {
    return {
      maxVertices: 900_000,
      maxMeshes: 18_000,
      degraded: true,
      note: "Sehr großes Modell (> 20 MB): Detailbudget stark reduziert — Schutz vor Browser-Absturz.",
    };
  }
  if (bytes > 8_000_000) {
    return {
      maxVertices: 1_600_000,
      maxMeshes: 32_000,
      degraded: true,
      note: "Großes Modell (> 8 MB): Detailbudget reduziert — Schutz vor Browser-Absturz.",
    };
  }
  return { maxVertices: 3_000_000, maxMeshes: 60_000, degraded: false, note: null };
}

export async function loadIfcMeshes(
  bytes: Uint8Array,
  options: IfcMeshLoadOptions = {},
): Promise<IfcMeshResult> {
  const startedAt = performance.now();
  const budgets = meshBudgetsForSize(bytes.length);
  // Garde-fou absolu : au-delà de 60 Mo, le chargement WASM principal risque
  // de tuer l'onglet (allocation mémoire). Repli propre vers les boîtes.
  if (bytes.length > IFC_HARD_LIMIT_BYTES) {
    throw new Error(
      `${IFC_TOO_LARGE_ERROR}: fichier ${Math.round(bytes.length / 1_000_000)} Mo > 60 Mo — ` +
        `affichage analytique (boîtes) utilisé pour protéger le navigateur.`,
    );
  }
  const maxVertices = options.maxVertices ?? budgets.maxVertices;
  const maxMeshes = options.maxMeshes ?? budgets.maxMeshes;
  const onProgress = options.onProgress ?? (() => undefined);
  const yieldControl = options.yieldControl ?? defaultYield;

  const api = await getIfcApi(options.wasmBase);

  let modelID = -1;
  try {
    modelID = api.OpenModel(bytes, {
      // PAS de COORDINATE_TO_ORIGIN : il re-centre selon ses règles propres
      // et casse le ±0,00 du projet (niveau 5 du projet affiché au niveau 0).
      // Le recentrage est piloté par NOUS : XY = centre de la bbox, Z = ancre
      // du niveau le plus bas (chaîne de placement IFC — voir ifcStoreyZero).
      COORDINATE_TO_ORIGIN: false,
      USE_FAST_BOOLS: true,
    } as never);
  } catch {
    // Second essai sans optimisations (certains IFC 2x3 exotiques de Revit).
    modelID = api.OpenModel(bytes);
  }
  if (typeof modelID !== "number" || modelID < 0) {
    throw new Error("web-ifc n'a pas pu ouvrir le modèle (identifiant invalide).");
  }

  try {
    onProgress(0.02, "Extraction des maillages…");
    const geometryCollection = api.LoadAllGeometry(modelID);
    const meshTotal = geometryCollection.size();
    if (meshTotal === 0) {
      throw new Error("Le modèle ne contient aucune géométrie triangulable.");
    }
    if (meshTotal > maxMeshes) {
      throw new IfcMeshBudgetError(
        `Modèle trop dense pour le moteur sans Worker (${meshTotal} meshes > ${maxMeshes}).`,
      );
    }

    // Accumulateurs par couleur (clé arrondie pour fusionner les variantes).
    interface Bucket {
      r: number; g: number; b: number; a: number;
      positions: number[]; normals: number[]; indices: number[];
      vertexCount: number;
      /** Registre élément → plage d'indices (focus QC pleine matière). */
      elements: IfcElementRange[];
    }
    const buckets = new Map<string, Bucket>();
    const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } as {
      min: [number, number, number]; max: [number, number, number];
    };
    let vertexTotal = 0;
    let triangleTotal = 0;

    for (let meshIndex = 0; meshIndex < meshTotal; meshIndex++) {
      const flatMesh = geometryCollection.get(meshIndex);
      const placedList = flatMesh.geometries;
      const placedCount = placedList.size();

      for (let placedIndex = 0; placedIndex < placedCount; placedIndex++) {
        const placed = placedList.get(placedIndex);
        const color = placed.color;
        const alpha = Math.max(0, Math.min(1, color.w));
        if (alpha <= 0.02) continue; // géométrie invisible (voids, repères)

        const geometry = api.GetGeometry(modelID, placed.geometryExpressID);
        let verts: Float32Array;
        let indices: Uint32Array;
        try {
          verts = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        } finally {
          // Les structures Emscripten doivent être libérées côté WASM.
          (geometry as { delete?: () => void }).delete?.();
        }

        const vertexCount = Math.floor(verts.length / 6);
        if (vertexCount === 0 || indices.length === 0) continue;
        if (vertexTotal + vertexCount > maxVertices) {
          throw new IfcMeshBudgetError(
            `Budget sommets dépassé (>${maxVertices.toLocaleString("fr-FR")}) — modèle trop lourd pour le moteur sans Worker.`,
          );
        }

        const key = `${color.x.toFixed(3)}|${color.y.toFixed(3)}|${color.z.toFixed(3)}|${alpha < 0.98 ? alpha.toFixed(2) : "1"}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            r: color.x, g: color.y, b: color.z, a: alpha,
            positions: [], normals: [], indices: [], vertexCount: 0,
            elements: [],
          };
          buckets.set(key, bucket);
        }

        const matrix = placed.flatTransformation;
        const n3 = normalMatrix3(matrix);
        const baseIndex = bucket.vertexCount;
        const { positions, normals } = bucket;

        for (let v = 0; v < verts.length; v += 6) {
          const [px, py, pz] = transformPoint(matrix, verts[v], verts[v + 1], verts[v + 2]);
          const [nx, ny, nz] = transformNormal(n3, verts[v + 3], verts[v + 4], verts[v + 5]);
          positions.push(px, py, pz);
          normals.push(nx, ny, nz);
          if (px < bbox.min[0]) bbox.min[0] = px; else if (px > bbox.max[0]) bbox.max[0] = px;
          if (py < bbox.min[1]) bbox.min[1] = py; else if (py > bbox.max[1]) bbox.max[1] = py;
          if (pz < bbox.min[2]) bbox.min[2] = pz; else if (pz > bbox.max[2]) bbox.max[2] = pz;
        }
        // Plage d'indices de CET élément dans le bucket — mémorisée AVANT
        // la poussée pour le registre élément → triangles (focus QC).
        const rangeStart = bucket.indices.length;
        for (let t = 0; t < indices.length; t++) {
          bucket.indices.push(indices[t] + baseIndex);
        }
        bucket.elements.push({
          expressId: flatMesh.expressID,
          start: rangeStart,
          end: bucket.indices.length,
        });
        bucket.vertexCount += vertexCount;
        vertexTotal += vertexCount;
        triangleTotal += Math.floor(indices.length / 3);
      }
      (placedList as { delete?: () => void }).delete?.();

      if (meshIndex % 200 === 199) {
        onProgress(0.02 + 0.9 * ((meshIndex + 1) / meshTotal), "Conversion des maillages…");
        await yieldControl();
      }
    }
    (geometryCollection as { delete?: () => void }).delete?.();

    // ---- Recentrage déterministe — CONVENTION Y-up de web-ifc ------------
    // web-ifc livre les sommets en repère three.js : x = IFC x (plan),
    // y = IFC z (HAUTEUR du bâtiment), z = −IFC y (plan). Vérifié sur
    // matrices réelles : la dalle à IFC z=3 sort avec translation y≈3,12.
    // Donc : plan = x/z (recentre), hauteur = y (ancre ±0,00 projet).
    onProgress(0.93, "Alignement du ±0,00 projet…");
    let anchor: ReturnType<typeof resolveStoreyZeroAnchor> = null;
    try {
      anchor = resolveStoreyZeroAnchor(parseIfcBytes(bytes, "mesh.ifc").entities);
    } catch {
      anchor = null; // le repli bbox prend le relais
    }
    const basis: IfcMeshOrigin["basis"] = anchor ? "storey" : "bbox";
    const shiftX = (bbox.min[0] + bbox.max[0]) / 2;
    const shiftZ = (bbox.min[2] + bbox.max[2]) / 2;
    const shiftY = anchor ? anchor.z : bbox.min[1];
    const origin: IfcMeshOrigin = {
      basis,
      storeyName: anchor?.storeyName ?? null,
      shiftZ: shiftY, // décalage appliqué sur l'axe HAUTEUR (y monde)
      shift: [shiftX, shiftY, shiftZ],
    };

    // Matérialisation finale des tampons (décalage appliqué en f64 → f32).
    onProgress(0.95, "Assemblage des tampons…");
    const groups: IfcMeshGroup[] = [];
    for (const bucket of buckets.values()) {
      if (bucket.vertexCount === 0 || bucket.indices.length === 0) continue;
      const raw = bucket.positions;
      const positions = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) {
        positions[i] = raw[i] - shiftX;
        positions[i + 1] = raw[i + 1] - shiftY;
        positions[i + 2] = raw[i + 2] - shiftZ;
      }
      const normals = new Float32Array(bucket.normals);
      // IFC : indices toujours 32 bits (fournis Uint32 par web-ifc).
      const indices = new Uint32Array(bucket.indices);
      groups.push({
        color: [bucket.r, bucket.g, bucket.b],
        opacity: bucket.a,
        positions,
        normals,
        indices,
        elementRanges: bucket.elements,
      });
    }

    if (groups.length === 0 || !Number.isFinite(bbox.min[0])) {
      throw new Error("Géométrie vide après conversion (aucun matériau visible).");
    }
    // Bbox cohérente avec les tampons décalés.
    bbox.min = [bbox.min[0] - shiftX, bbox.min[1] - shiftY, bbox.min[2] - shiftZ];
    bbox.max = [bbox.max[0] - shiftX, bbox.max[1] - shiftY, bbox.max[2] - shiftZ];

    onProgress(1, "Géométrie prête");
    let schema: string | null = null;
    try {
      schema = api.GetModelSchema(modelID) ?? null;
    } catch {
      /* métadonnée facultative */
    }

    return {
      groups,
      bbox,
      origin,
      meshCount: meshTotal,
      vertexCount: vertexTotal,
      triangleCount: triangleTotal,
      schema,
      durationMs: Math.round(performance.now() - startedAt),
      budgetNote: budgets.note,
    };
  } finally {
    if (modelID >= 0) {
      try {
        api.CloseModel(modelID);
      } catch {
        /* runtime possiblement déjà libéré */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sous-maillage d'UN élément — FOCUS QC « murs solides » (2026-08-06)
// Retour utilisateur : « vaut mieux voir les clashs en mur solide et pas
// juste des reflets ». Les triangles des deux Bauteile en collision sont
// RECOPIÉS dans des tampons neufs (disposition autonome, aucun aliasing
// avec la scène) pour être re-teintés en rouge/bleu pleine matière.
// ---------------------------------------------------------------------------

export interface IfcSubMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/// Extrait les triangles d'UN élément (expressId) d'un groupe fusionné et
/// les compacte dans un sous-maillage autonome. Null si l'élément n'a pas
/// de triangle dans CE groupe (un élément peut en couvrir plusieurs —
/// appeler sur chaque groupe et empiler les meshes).
export function extractElementSubMesh(
  group: IfcMeshGroup,
  expressId: number,
): IfcSubMesh | null {
  const ranges = group.elementRanges;
  if (!ranges || ranges.length === 0) return null;
  const src = group.indices;
  const remap = new Map<number, number>();
  const local: number[] = [];
  for (const r of ranges) {
    if (r.expressId !== expressId) continue;
    const end = Math.min(r.end, src.length);
    for (let i = Math.max(r.start, 0); i < end; i++) {
      const old = src[i];
      let nu = remap.get(old);
      if (nu === undefined) {
        nu = remap.size;
        remap.set(old, nu);
      }
      local.push(nu);
    }
  }
  if (local.length === 0) return null;
  const positions = new Float32Array(remap.size * 3);
  const normals = new Float32Array(remap.size * 3);
  for (const [old, nu] of remap) {
    const o3 = old * 3;
    const n3 = nu * 3;
    positions[n3] = group.positions[o3];
    positions[n3 + 1] = group.positions[o3 + 1];
    positions[n3 + 2] = group.positions[o3 + 2];
    normals[n3] = group.normals[o3];
    normals[n3 + 1] = group.normals[o3 + 1];
    normals[n3 + 2] = group.normals[o3 + 2];
  }
  return { positions, normals, indices: new Uint32Array(local) };
}

/// Bbox d'un sous-maillage (diagnostic + tests de régression).
export function subMeshBBox(sub: IfcSubMesh): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < sub.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = sub.positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
