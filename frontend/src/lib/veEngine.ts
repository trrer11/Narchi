/** §154 — VE-Studio : moteur de VALUE ENGINEERING (substitution matériaux).
 *
 * LE « waouh » qui répond au point de douleur n°1 des architectes : le
 * processus VE (value engineering) est un cauchemar — « le coût explose quand
 * les hypothèses initiales s'avèrent fausses », l'inflation, et chaque
 * substitution de matériau se piste à la main dans Excel.
 *
 * Ce moteur relie, pour la PREMIÈRE fois dans Narchi, les DEUX faces de la
 * même décision : le CARBONE (Ökobaudat, kg CO₂e/unité) ET le COÛT (BKI/Berlin,
 * €/unité). Pour chaque substitution, il rend :
 *   - ΔCO₂ par unité (négatif = économise),
 *   - Δ€ par unité (positif = coûte plus cher),
 *   - le coût-efficacité **€/tCO₂e économisée** — la métrique qui permet à
 *     l'architecte de NÉGOCIER avec le client (« 220 €/tCO₂e, mieux qu'un
 *     crédit carbone »).
 *
 * PROVENANCE (doctrine §114 — zéro ligne AGPL copiée) : réécrit en salle
 * blanche à partir des DONNÉES PUBLIQUES déjà sourcées dans Narchi
 * (Ökobaudat BMWSB, BKI/Berlin, benchmark BNB) — l'inspiration fonctionnelle
 * est la veille open source (IfcLCA, AGPL), mais ici TOUT le code et la
 * méthodologie sont propres : on étudie l'ARCHITECTURE, on n'importe rien.
 *
 * HONNÊTETÉ (charta §36) :
 *   - chaque matériau porte sa source et sa confiance ;
 *   - les prix en €/m³ sont des RICHTWERT (ordre de grandeur marché allemand
 *     2026, marqués « Richtwert ») — jamais des devis ;
 *   - l'« équivalence fonctionnelle » (un m³ de béton ↔ un m³ de CLT ne porte
 *     PAS les mêmes charges) est DITE dans chaque recommandation, jamais
 *     masquée : c'est un outil d'ORIENTATION, pas un calcul statique.
 */

import { categoryOf, type MatchSummary } from "@/lib/materialMatch";

/** Unité fonctionnelle rigoureuse : les substitutions ne se font qu'entre
 * matériaux de MÊME unité (m³ ↔ m³). Les m²/Stk ont leurs propres règles. */
export type MaterialUnit = "m³" | "m²" | "t" | "Stk";

export interface MaterialOption {
  key: string;
  label: string;
  unit: MaterialUnit;
  /** kg CO₂e par unité (GWP A1–A3, Ökobaudat). */
  co2PerUnit: number;
  /** € par unité (BKI/Berlin, Richtwert marché 2026). */
  pricePerUnit: number;
  /** Confiance de la donnée CO₂. */
  co2Confidence: "Messung" | "Richtwert";
}

/** Catalogue des matériaux substituables (KG 300–400, la masse du carbone). */
export const SUBSTITUTION_MATERIALS: MaterialOption[] = [
  // Structure — béton (Ökobaudat : kg CO₂e/m³, BKI : €/m³ Richtwert)
  { key: "stahlbeton_c25_30", label: "Stahlbeton C25/30 (inkl. Bewehrung)", unit: "m³", co2PerUnit: 280, pricePerUnit: 300, co2Confidence: "Richtwert" },
  { key: "stahlbeton_c30_37", label: "Stahlbeton C30/37", unit: "m³", co2PerUnit: 340, pricePerUnit: 330, co2Confidence: "Richtwert" },
  { key: "beton_c20_25", label: "Beton C20/25", unit: "m³", co2PerUnit: 178, pricePerUnit: 260, co2Confidence: "Richtwert" },
  { key: "beton_c25_30", label: "Beton C25/30", unit: "m³", co2PerUnit: 197, pricePerUnit: 275, co2Confidence: "Richtwert" },
  // Structure — bois (alternative bas-carbone, le « Holzbau »)
  { key: "clt", label: "Brettsperrholz (CLT/X-Lam)", unit: "m³", co2PerUnit: 100, pricePerUnit: 520, co2Confidence: "Richtwert" },
  { key: "bsh", label: "Brettschichtholz (BSH)", unit: "m³", co2PerUnit: 90, pricePerUnit: 470, co2Confidence: "Richtwert" },
  { key: "kvh", label: "Konstruktionsvollholz (KVH)", unit: "m³", co2PerUnit: 55, pricePerUnit: 430, co2Confidence: "Richtwert" },
  // Maçonnerie
  { key: "kalksandstein", label: "Kalksandstein KS-R", unit: "m³", co2PerUnit: 195, pricePerUnit: 220, co2Confidence: "Richtwert" },
  { key: "hochlochziegel", label: "Hochlochziegel Mauerwerk", unit: "m³", co2PerUnit: 290, pricePerUnit: 280, co2Confidence: "Richtwert" },
  { key: "porenbeton", label: "Porenbeton (Ytong)", unit: "m³", co2PerUnit: 305, pricePerUnit: 300, co2Confidence: "Richtwert" },
  // Isolation
  { key: "eps", label: "EPS-Dämmung", unit: "m³", co2PerUnit: 105, pricePerUnit: 120, co2Confidence: "Richtwert" },
  { key: "mineralwolle", label: "Mineralwolle (Glas/Stein)", unit: "m³", co2PerUnit: 60, pricePerUnit: 95, co2Confidence: "Richtwert" },
  { key: "holzfaser", label: "Holzfaserdämmplatte", unit: "m³", co2PerUnit: 45, pricePerUnit: 200, co2Confidence: "Richtwert" },
];

/** Paire de substitution (même unité). La « note » dit l'équivalence
 * fonctionnelle honnête (béton ≠ CLT en portance : c'est une orientation). */
export interface SubstitutionPair {
  fromKey: string;
  toKey: string;
  note: string;
}

export const SUBSTITUTION_PAIRS: SubstitutionPair[] = [
  { fromKey: "stahlbeton_c25_30", toKey: "beton_c20_25", note: "Beton C20/25 suffit souvent (Fundamente, Sockel) — portance à vérifier." },
  { fromKey: "stahlbeton_c25_30", toKey: "clt", note: "Holzbau statt Stahlbeton : équivalence fonctionnelle NON directe (charges/Statik à vérifier)." },
  { fromKey: "stahlbeton_c30_37", toKey: "beton_c25_30", note: "C25/30 suffit pour de nombreuses Bauteile — classe de résistance à vérifier." },
  { fromKey: "hochlochziegel", toKey: "kalksandstein", note: "KS au lieu de Ziegel : même usage Mauerwerk, isolation à comparer." },
  { fromKey: "porenbeton", toKey: "kalksandstein", note: "KS au lieu de Porenbeton : perte d'isolation intrinsèque à compenser." },
  { fromKey: "eps", toKey: "mineralwolle", note: "Mineralwolle au lieu d'EPS : incombustible (A1) + moins de CO₂, coût proche." },
  { fromKey: "eps", toKey: "holzfaser", note: "Holzfaser au lieu d'EPS : plus écologique, plus cher — isolation équivalente à épaisseur adaptée." },
];

/** Une recommandation : la substitution, ses deltas, et sa rentabilité carbone. */
export interface Recommendation {
  from: MaterialOption;
  to: MaterialOption;
  /** kg CO₂e économisés PAR UNITÉ (positif = on économise). */
  co2SavedPerUnit: number;
  /** € de surcoût PAR UNITÉ (positif = plus cher, négatif = moins cher). */
  eurDeltaPerUnit: number;
  /** Coût-efficacité : € dépensés (ou gagnés) par tonne de CO₂e économisée.
   *  Négatif = « win-win » (moins cher ET moins de CO₂). */
  eurPerTonneCo2: number;
  note: string;
}

export function findMaterial(key: string): MaterialOption | undefined {
  return SUBSTITUTION_MATERIALS.find((m) => m.key === key);
}

/** Construit le plan VE : pour chaque paire valide, calcule les deltas et la
 * rentabilité carbone. Trier : (1) les « win-win » d'abord (moins cher ET
 * plus vert), puis (2) par €/tCO₂e croissant (le moins cher par tonne). */
export function buildVEPlan(pairs: SubstitutionPair[] = SUBSTITUTION_PAIRS): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const pair of pairs) {
    const from = findMaterial(pair.fromKey);
    const to = findMaterial(pair.toKey);
    if (!from || !to) continue;
    if (from.unit !== to.unit) continue; // jamais de comparaison inter-unité (charta)
    const co2SavedPerUnit = from.co2PerUnit - to.co2PerUnit;
    const eurDeltaPerUnit = to.pricePerUnit - from.pricePerUnit;
    if (co2SavedPerUnit <= 0) continue; // ne pas recommander une aggravation CO₂
    const eurPerTonneCo2 = (eurDeltaPerUnit / co2SavedPerUnit) * 1000; // €/tCO₂e
    recs.push({ from, to, co2SavedPerUnit, eurDeltaPerUnit, eurPerTonneCo2, note: pair.note });
  }
  return recs.sort((a, b) => {
    const aWin = a.eurDeltaPerUnit <= 0 ? 0 : 1;
    const bWin = b.eurDeltaPerUnit <= 0 ? 0 : 1;
    if (aWin !== bWin) return aWin - bWin; // win-win d'abord
    return a.eurPerTonneCo2 - b.eurPerTonneCo2;
  });
}

/** Application d'une recommandation à une QUANTITÉ réelle (m³). */
export interface AppliedSubstitution {
  rec: Recommendation;
  quantity: number;
  co2SavedKg: number;
  eurDelta: number;
}

export function applySubstitution(
  rec: Recommendation,
  quantity: number,
): AppliedSubstitution {
  return {
    rec,
    quantity,
    co2SavedKg: rec.co2SavedPerUnit * quantity,
    eurDelta: rec.eurDeltaPerUnit * quantity,
  };
}

// ---------------------------------------------------------------------------
// §155 — Pont MAQUETTE RÉELLE → VE-Studio (le « waouh » branché sur le takeoff)
// ---------------------------------------------------------------------------
// Jusqu'ici le VE-Studio affichait des Δ par m³ ABSTRAITS. Désormais chaque
// substitution est appliquée aux VRAIS m³ extraits de la maquette IFC : on
// répond à la question que l'architecte se pose réellement — « si je passe
// mes murs béton en CLT, combien de tonnes de CO₂ et combien d'euros sur CE
// projet ? ». Le pont est 100 % déterministe et auditables : masse takeoff ÷
// densité de référence = volume, jamais de volume inventé.

/** Pont catégorie Material-Match → matériau substituable du VE-Studio.
 * Le takeoff rapproche des CATÉGORIES (stahlbeton, ziegel…) ; le VE-Studio
 * raisonne en MATÉRIAUX SUBSTITUABLES (stahlbeton_c25_30…). Ce pont DOCUMENTE
 * l'hypothèse de lecture : « stahlbeton » est lu comme « C25/30 » (le cas
 * courant), « ziegel » comme « Hochlochziegel », etc. — jamais silencieux. */
export const CATEGORY_TO_VE: Record<string, string> = {
  stahlbeton: "stahlbeton_c25_30",
  beton: "beton_c25_30",
  kalksandstein: "kalksandstein",
  ziegel: "hochlochziegel",
  porenbeton: "porenbeton",
  eps: "eps",
  mineralwolle: "mineralwolle",
  holzfaser: "holzfaser",
  clt: "clt",
  bsh: "bsh",
  schnittholz: "kvh",
};

/** Volume m³ réellement présent dans la maquette, PAR matériau substituable.
 * Le takeoff donne des MASSES par catégorie (matchMaterials) ; on repasse au
 * VOLUME via la densité de référence du catalogue pour comparer aux €/m³ du
 * VE-Studio. Les catégories non substituables sont ignorées (elles ne peuvent
 * pas être le point de départ d'une substitution). */
export function takeoffVolumeM3BySubstitution(
  summary: Pick<MatchSummary, "byCategory">,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const agg of summary.byCategory) {
    const key = CATEGORY_TO_VE[agg.categoryId];
    if (!key) continue;
    const density = categoryOf(agg.categoryId)?.densityKgM3 ?? 0;
    if (density <= 0) continue;
    out[key] = (out[key] ?? 0) + agg.massKg / density;
  }
  return out;
}

/** Une OPPORTUNITÉ VE branchée sur la maquette : la substitution, le volume
 * réel concerné, et les deltas TOTAUX projet (CO₂ + €) si on la fait à 100 %. */
export interface VEOpportunity {
  rec: Recommendation;
  /** m³ du matériau « from » réellement présents dans la maquette. */
  availableM3: number;
  /** La substitution est-elle applicable à ce projet (volume > 0) ? */
  inProject: boolean;
  /** ΔCO₂ total si TOUT le volume est substitué (kg CO₂e). */
  co2SavedKgTotal: number;
  /** Δ€ total si TOUT le volume est substitué. */
  eurDeltaTotal: number;
  /** ΔCO₂ en % du bilan A1–A3 du projet (null si bilan non fourni). */
  co2SavedPct: number | null;
}

/** Construit les opportunités VE sur la maquette réelle. Tri : (1) les
 * substitutions APPLICABLES (volume présent) d'abord, puis (2) win-win avant
 * premium, puis (3) €/tCO₂e croissant. `totalCo2Kg` = bilan A1–A3 du projet
 * (pour exprimer le gain en % — optionnel). */
export function buildVEOpportunities(
  volumesM3: Record<string, number>,
  totalCo2Kg?: number,
  pairs: SubstitutionPair[] = SUBSTITUTION_PAIRS,
): VEOpportunity[] {
  return buildVEPlan(pairs)
    .map((rec) => {
      const availableM3 = volumesM3[rec.from.key] ?? 0;
      // `availableM3` peut être 0 : on évite le −0 (Object.is) en gardant
      // des zéros propres — sinon un `0 * (−40)` afficherait « −0 € ».
      const co2SavedKgTotal = availableM3 > 0 ? rec.co2SavedPerUnit * availableM3 : 0;
      const eurDeltaTotal = availableM3 > 0 ? rec.eurDeltaPerUnit * availableM3 : 0;
      return {
        rec,
        availableM3,
        inProject: availableM3 > 0,
        co2SavedKgTotal,
        eurDeltaTotal,
        co2SavedPct:
          totalCo2Kg && totalCo2Kg > 0
            ? (co2SavedKgTotal / totalCo2Kg) * 100
            : null,
      };
    })
    .sort((a, b) => {
      if (a.inProject !== b.inProject) return a.inProject ? -1 : 1;
      const aWin = a.rec.eurDeltaPerUnit <= 0 ? 0 : 1;
      const bWin = b.rec.eurDeltaPerUnit <= 0 ? 0 : 1;
      if (aWin !== bWin) return aWin - bWin;
      return a.rec.eurPerTonneCo2 - b.rec.eurPerTonneCo2;
    });
}

// ---------------------------------------------------------------------------
// §156 — « What-if » CUMULATIF : sélectionner plusieurs substitutions et voir
// le NOUVEAU total CO₂ + budget + verdict BNB se recalculer en direct.
// ---------------------------------------------------------------------------

/** Clé STABLE d'une substitution (pour la sélection multi / le what-if). */
export function substitutionKey(rec: Recommendation): string {
  return `${rec.from.key}->${rec.to.key}`;
}

/** Le résultat d'un what-if : la somme des substitutions sélectionnées, le
 * nouveau total projet, et — si la NGF est fournie — le nouveau kg/m². */
export interface VEWhatIf {
  selected: VEOpportunity[];
  /** Σ ΔCO₂ des substitutions cochées (kg CO₂e, positif = économisé). */
  totalCo2SavedKg: number;
  /** Σ Δ€ (positif = surcoût, négatif = économie). */
  totalEurDelta: number;
  /** Nouveau bilan A1–A3 projet si on applique tout (null si inconnu). */
  newTotalCo2Kg: number | null;
  /** Économie en % du bilan A1–A3 d'origine. */
  co2SavedPct: number | null;
  /** Nouveau kg CO₂e/m² NGF (null si NGF absente). */
  newPerM2Kg: number | null;
}

/** Calcule le what-if cumulatif. Les clés inconnues sont ignorées (jamais
 * d'erreur : on ne retient que les substitutions réellement proposées). */
export function computeVEWhatIf(
  opportunities: VEOpportunity[],
  selectedKeys: readonly string[],
  totalCo2Kg?: number,
  ngf?: number,
): VEWhatIf {
  const keys = new Set(selectedKeys);
  const selected = opportunities.filter((o) =>
    keys.has(substitutionKey(o.rec)),
  );
  const totalCo2SavedKg = selected.reduce(
    (s, o) => s + o.co2SavedKgTotal,
    0,
  );
  const totalEurDelta = selected.reduce((s, o) => s + o.eurDeltaTotal, 0);
  const newTotalCo2Kg =
    totalCo2Kg != null ? totalCo2Kg - totalCo2SavedKg : null;
  const co2SavedPct =
    totalCo2Kg != null && totalCo2Kg > 0
      ? (totalCo2SavedKg / totalCo2Kg) * 100
      : null;
  const newPerM2Kg =
    newTotalCo2Kg != null && ngf && ngf > 0 ? newTotalCo2Kg / ngf : null;
  return {
    selected,
    totalCo2SavedKg,
    totalEurDelta,
    newTotalCo2Kg,
    co2SavedPct,
    newPerM2Kg,
  };
}

// --- Verdict carbone vs benchmark BNB (kg CO₂e/m² NGF, A1–A3) ----------------

export type VerdictLevel = "best" | "target" | "limit" | "over";

export interface CarbonVerdict {
  level: VerdictLevel;
  label: string;
  perM2: number;
  target: number;
  limit: number;
  best: number;
}

export function carbonVerdict(perM2: number, typology: "residential" | "office" | "school" = "residential"): CarbonVerdict {
  const b: Record<string, { target: number; limit: number; best: number }> = {
    residential: { target: 600, limit: 800, best: 350 },
    office: { target: 500, limit: 700, best: 300 },
    school: { target: 550, limit: 750, best: 320 },
  };
  const bench = b[typology] ?? b.residential;
  let level: VerdictLevel;
  let label: string;
  if (perM2 <= bench.best) {
    level = "best";
    label = "BNB Bestwert (Gold)";
  } else if (perM2 <= bench.target) {
    level = "target";
    label = "BNB Zielwert (Silber)";
  } else if (perM2 <= bench.limit) {
    level = "limit";
    label = "BNB Grenzwert (Bronze)";
  } else {
    level = "over";
    label = "über Grenzwert";
  }
  return { level, label, perM2, target: bench.target, limit: bench.limit, best: bench.best };
}

/** Typologie BNB déduite du libellé libre du projet (champ `type`) —
 * déterministe, retombe sur « residential » (le cas le plus courant des
 * petits bureaux). */
export function typologyOfProjectType(type?: string | null): "residential" | "office" | "school" {
  const t = (type ?? "").toLowerCase();
  if (/b[uü]ro|office|gewerbe|verwaltung|admin|praxis|klinik|hotel/.test(t)) return "office";
  if (/schule|bildung|kindergarten|kita|hochschule|uni/.test(t)) return "school";
  return "residential";
}

/** Couleur d'affichage par niveau de verdict (Ampel carbone §166). */
export const VERDICT_META: Record<VerdictLevel, { short: string; color: string; badge: string }> = {
  best: { short: "Gold", color: "#fbbf24", badge: "bg-amber-100 text-amber-800" },
  target: { short: "Silber", color: "#94a3b8", badge: "bg-slate-200 text-slate-700" },
  limit: { short: "Bronze", color: "#d97706", badge: "bg-orange-100 text-orange-800" },
  over: { short: "über Grenzwert", color: "#f43f5e", badge: "bg-rose-100 text-rose-700" },
};

