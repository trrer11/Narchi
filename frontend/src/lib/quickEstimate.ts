// NARCHI — Estimation éclair « pivot → Kostengruppen » (DIN 276).
// Transforme le takeoff produit localement par le Worker IFC en devis BOQ
// calculé par le backend (prix régionalisés 2026, USt 19 %, fourchette,
// score de plausibilité). Le frontend reste « présentationnel » : toute la
// logique tarifaire vit côté moteur, jamais en double ici.

import { secureFetch } from "@/auth/SecuritySanitizer";
import { getApiBase } from "@/lib/apiClient";
import type { ModelTakeoff } from "@/lib/modelTakeoff";

/* ------------------------------ types réponse ----------------------------- */

export interface BoqLine {
  kostengruppe: string;
  titel: string;
  menge: number;
  einheit: string;
  einheitspreis_netto: number;
  gesamt_netto: number;
  anzahl_elemente: number;
  beispiele: string[];
  /** §50 — provenance du prix (§36) : « büro » = bibliothèque du bureau. */
  preis_quelle: "büro" | "richtwert";
  /**
   * §99 — provenance disjointe selon la règle de sélection :
   * - « einzelpreis » (n = 1) : OZ + millésime + facteur Destatis (§50) ;
   * - « median » (n ≥ 2, même Einheit) : médiane des prix CHACUN indexé —
   *   aucune OZ seule n'existe, le détail sert le nombre de prix, leurs
   *   millésimes et les positions d'une autre Einheit JAMAIS mélangées.
   */
  preis_quelle_detail?:
    | {
        auswahl: "einzelpreis";
        oz: string;
        kurztext: string;
        preisstand_jahr: number;
        index_faktor: number;
      }
    | {
        auswahl: "median";
        n_quellen: number;
        einheit: string | null;
        median_steht_auf: number;
        jahr_von: number;
        jahr_bis: number;
        nicht_vermischt: number;
      };
}

export interface OfficeQuote {
  kgs_mit_bueropreis: number;
  /** part du netto chiffrée avec les prix du bureau (0-1) */
  eigenpreis_quote: number;
}

export interface QuickEstimateResponse {
  region: string;
  lines: BoqLine[];
  totals: {
    netto: number;
    ust_satz: number;
    ust: number;
    brutto: number;
    kosten_pro_m2: number | null;
  };
  range: { low: number; high: number; assumption: string };
  score: {
    value: number;
    grade: "A" | "B" | "C" | "D";
    mapping_coverage: number;
    quantity_coverage: number;
    avg_confidence: number;
  };
  element_count: number;
  office_quote: OfficeQuote;
  warnings: string[];
}

/* ------------------------------ régions (20) ------------------------------ */

export interface EstimateRegion {
  code: string;
  label: string;
}

export const ESTIMATE_REGIONS: EstimateRegion[] = [
  { code: "de_by_muenchen", label: "München" },
  { code: "de_bw_stuttgart", label: "Stuttgart" },
  { code: "de_he_frankfurt", label: "Frankfurt am Main" },
  { code: "de_hh_hamburg", label: "Hamburg" },
  { code: "de_be_berlin", label: "Berlin" },
  { code: "de_nw_koeln", label: "Köln" },
  { code: "de_nw_duesseldorf", label: "Düsseldorf" },
  { code: "de_bw", label: "Baden-Württemberg" },
  { code: "de_by", label: "Bayern" },
  { code: "de_he", label: "Hessen" },
  { code: "de_nw", label: "Nordrhein-Westfalen" },
  { code: "de_sh", label: "Schleswig-Holstein" },
  { code: "de_rp", label: "Rheinland-Pfalz" },
  { code: "de_ni", label: "Niedersachsen" },
  { code: "de_bb", label: "Brandenburg" },
  { code: "de_sl", label: "Saarland" },
  { code: "de_sn", label: "Sachsen" },
  { code: "de_mv", label: "Mecklenburg-Vorpommern" },
  { code: "de_th", label: "Thüringen" },
  { code: "de_st", label: "Sachsen-Anhalt" },
];

export const DEFAULT_REGION = "de_ni";

/* --------------------------- takeoff → requête ---------------------------- */

interface RawQty {
  length?: number;
  width?: number;
  height?: number;
  area?: number;
  volume?: number;
  count?: number;
  weight?: number;
}

export interface QuickEstimateElementIn {
  ifc_type: string;
  name: string;
  level: string;
  material_hint: string;
  area_m2: number | null;
  volume_m3: number | null;
  length_m: number | null;
  count: number;
  confidence: number;
}

export function buildQuickEstimateInput(takeoff: ModelTakeoff): QuickEstimateElementIn[] {
  return takeoff.elements.map((element) => {
    const raw = (element.rawQty ?? {}) as RawQty;
    const area = raw.area ?? (element.unit === "m²" ? element.qty : null);
    const volume = raw.volume ?? (element.unit === "m³" ? element.qty : null);
    const length = raw.length ?? (element.unit === "m" ? element.qty : null);
    const count =
      raw.count ?? (element.unit === "St" ? Math.max(1, Math.round(element.qty)) : 1);
    return {
      ifc_type: element.ifcType,
      name: element.name,
      level: element.level,
      // Le nom d'élément porte les indices matériau (Stahlbeton, Holz…) :
      // c'est ce texte que le moteur analyse pour affiner la Kostengruppe.
      material_hint: element.name,
      area_m2: area && area > 0 ? area : null,
      volume_m3: volume && volume > 0 ? volume : null,
      length_m: length && length > 0 ? length : null,
      count,
      confidence: takeoff.precision === "exact" ? 0.95 : takeoff.precision === "approx" ? 0.8 : 0.6,
    };
  });
}

/* --------------------------------- appel ---------------------------------- */

export async function requestQuickEstimate(
  takeoff: ModelTakeoff,
  region: string = DEFAULT_REGION,
  timeoutMs = 30_000,
): Promise<QuickEstimateResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await secureFetch(`${getApiBase()}/api/v5/estimation/quick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: buildQuickEstimateInput(takeoff),
        region,
        bgf_m2: takeoff.ngf > 0 ? takeoff.ngf : null,
      }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      throw new Error(`Estimation API ${response.status}`);
    }
    return (await response.json()) as QuickEstimateResponse;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ export GAEB X31 ---------------------------- */

function slugify(text: string): string {
  const slug = text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "narchi";
}

/// Demande au backend le devis DIN 276 au format d'échange allemand
/// GAEB X31 et déclenche le téléchargement du fichier .x31 (lisible par les
/// logiciels AVA : calcul de prix, offres, avenants).
export async function downloadGaebX31(
  takeoff: ModelTakeoff,
  region: string = DEFAULT_REGION,
  timeoutMs = 30_000,
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await secureFetch(`${getApiBase()}/api/v5/estimation/gaeb-x31`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: buildQuickEstimateInput(takeoff),
        region,
        project_name: takeoff.projectName || takeoff.fileName,
      }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      throw new Error(`GAEB API ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(takeoff.projectName || takeoff.fileName)}-lv.x31`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } finally {
    clearTimeout(timer);
  }
}
