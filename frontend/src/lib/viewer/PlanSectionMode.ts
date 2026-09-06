/**
 * NARCHI — Modes d'affichage 2D/3D du viewer IFC (Planschnitt VOB).
 *
 * Le mode « plan 2D » est une coupe horizontale du modèle à hauteur
 * réglable (au-dessus du niveau fini), rendue en projection
 * orthographique plafond — l'équivalent numérique du Grundriss 1:100
 * utilisé pour le métré DIN 276.
 *
 * Le mapping IFC → Kostengruppe fournit le lien direct entre l'objet
 * BIM sélectionné et le poste de coût correspondant en base NARCHI.
 */
import type * as OBC from "@thatopen/components";
import type { FragmentsModel } from "@thatopen/fragments";
import * as THREE from "three";

export type ViewMode = "3d" | "plan";

export interface KostengruppeSuggestion {
  kg: string;
  label: string;
}

/** Mapping classe IFC → Kostengruppe DIN 276 (niveau d'estimation NARCHI). */
const IFC_TO_KG: Array<{ pattern: RegExp; kg: string; label: string }> = [
  { pattern: /^IFCFOOTING|^IFCPILE/, kg: "KG 310", label: "Gründung" },
  { pattern: /^IFCWALLSTANDARDCASE|^IFCWALL$/, kg: "KG 320", label: "Tragende Außenwände" },
  { pattern: /^IFCCOLUMN/, kg: "KG 320", label: "Stützen" },
  { pattern: /^IFCSLAB$/, kg: "KG 340", label: "Decken" },
  { pattern: /^IFCBEAM|^IFCMEMBER/, kg: "KG 340", label: "Deckenunterzüge" },
  { pattern: /^IFCROOF/, kg: "KG 360", label: "Dach" },
  { pattern: /^IFCWINDOW/, kg: "KG 361", label: "Fenster, Außentüren" },
  { pattern: /^IFCDOOR/, kg: "KG 362", label: "Innentüren" },
  { pattern: /^IFCCOVERING/, kg: "KG 363", label: "Wand-/Deckenbeläge" },
  { pattern: /^IFCSTAIR|^IFCRAMP|^IFCRAILING/, kg: "KG 366", label: "Treppen, Geländer" },
  { pattern: /^IFCSANITARYTERMINAL|^IFCFLOWSEGMENT|^IFCPIPE/, kg: "KG 410", label: "Abwasser, Wasser" },
  { pattern: /^IFCBOILER|^IFCHEATEXCHANGER|^IFCUNITARY/, kg: "KG 420", label: "Heizung" },
  { pattern: /^IFCAIRTERMINAL|^IFCDUCT/, kg: "KG 430", label: "Lüftung" },
  { pattern: /^IFCELECTRIC|^IFCCABLE|^IFCSWITCHING|^IFCLIGHT/, kg: "KG 440", label: "Elektroanlagen" },
  { pattern: /^IFCSPACE/, kg: "NGF", label: "Netto-Grundfläche (DIN 277)" },
];

export function suggestKostengruppe(categoryNames: string[]): KostengruppeSuggestion | null {
  for (const name of categoryNames) {
    const normalized = name.toUpperCase();
    for (const rule of IFC_TO_KG) {
      if (rule.pattern.test(normalized)) {
        return { kg: rule.kg, label: rule.label };
      }
    }
  }
  return null;
}

/** Plan de coupe horizontal au niveau `cutHeight` (Y), conserve y ≤ cut. */
export function buildSectionPlane(cutHeight: number): THREE.Plane {
  return new THREE.Plane(new THREE.Vector3(0, -1, 0), cutHeight);
}

/**
 * Applique le mode d'affichage. Le plan est injecté via l'événement
 * clipping du model Fragments (évalué dans le worker, pas de mutation
 * de matériau partagé côté thread).
 */
export async function applyViewMode(options: {
  camera: OBC.OrthoPerspectiveCamera;
  model: FragmentsModel;
  fragments: OBC.FragmentsManager;
  sectionPlanes: THREE.Plane[];
  mode: ViewMode;
  cutHeight: number;
}): Promise<void> {
  const { camera, model, fragments, sectionPlanes, mode, cutHeight } = options;

  if (mode === "plan") {
    sectionPlanes.length = 0;
    sectionPlanes.push(buildSectionPlane(cutHeight));
    camera.projection.current = "Orthographic";
    const center = model.box.getCenter(new THREE.Vector3());
    const size = model.box.getSize(new THREE.Vector3());
    const distance = Math.max(size.x, size.z, 10) * 2;
    // Vue plafond (Grundriss) : caméra au-dessus du plan de coupe.
    camera.controls.setLookAt(
      center.x,
      cutHeight + distance,
      center.z,
      center.x,
      center.y,
      center.z,
      false,
    );
  } else {
    sectionPlanes.length = 0;
    camera.projection.current = "Perspective";
    const center = model.box.getCenter(new THREE.Vector3());
    const size = model.box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 10);
    camera.controls.setLookAt(
      center.x + radius,
      center.y + radius * 0.7,
      center.z + radius,
      center.x,
      center.y,
      center.z,
      false,
    );
  }

  // La projection a changé : le modèle doit suivre la caméra active.
  model.useCamera(camera.three);
  await fragments.core.update(true);
}

/** Bornes du curseur de Schnitthöhe à partir de la boîte englobante. */
export function sectionHeightBounds(box: THREE.Box3): { min: number; max: number; initial: number } {
  const min = Math.floor(box.min.y * 10) / 10;
  const max = Math.ceil(box.max.y * 10) / 10;
  // Coupe par défaut 1,40 m au-dessus du niveau le plus bas (convention
  // de plan d'exécution : fenêtres et portes visibles dans le Grundriss).
  const initial = Math.min(max, min + 1.4);
  return { min, max, initial };
}

/** Extraction best-effort des données d'un élément pour le panneau BIM↔KG. */
export async function fetchElementSummary(
  model: FragmentsModel,
  localId: number,
): Promise<{ name: string; categories: string[] } | null> {
  try {
    const data = await model.getItemsData([localId]);
    const item = data?.[0] as Record<string, unknown> | undefined;
    if (!item) return null;
    const pick = (key: string): string | undefined => {
      const value = item[key] as { value?: unknown } | string | undefined;
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "value" in value) {
        return String((value as { value: unknown }).value ?? "") || undefined;
      }
      return undefined;
    };
    const categories = [
      pick("_category"),
      pick("Category"),
      pick("type"),
      pick("ObjectType"),
    ].filter((entry): entry is string => Boolean(entry));
    return { name: pick("Name") ?? `Élément #${localId}`, categories };
  } catch {
    return null;
  }
}
