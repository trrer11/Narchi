// NARCHI V6.8 — Material-Match IFC → ÖKOBAUDAT (§38, inspiration open
// source « llm-lca-material-match » de la veille §36, MAIS déterministe :
// aucun chiffre inventé, toutes les règles sont publiques et la CONFIANCE
// du rapprochement est affichée — un bureau doit pouvoir auditer chaque
// kg de CO₂).
//
//   1) Le nom du matériau (Bauteilkatalog, propriété IFC « Material »)
//      gagne : « Stahlbeton C30/37 », « Kalksandstein », « EPS WLG 035 »…
//      → confiance 0,90 (« Messung » du nom réel).
//   2) À défaut, la CLASSE IFC donne une NÄHERUNG honnête : IfcWall →
//      Stahlbeton (confiance 0,55), IfcWindow → Isolierglas…
//   3) Rien de plausible → reste NON RAPPROCHÉ et compté à part (jamais
//      d'affectation silencieuse à la catégorie « béton »).
//
// Facteurs GWP A1–A3 en kg CO₂e/kg, ordres de grandeur ÖKOBAUDAT 2024
// (BMWSB), avec une bande min–max affichée (l'honnêteté avant le point
// unique). Masse réelle = weightKg du takeoff (masses déjà calculées
// classe par classe depuis les vraies quantités IFC), à défaut qty ×
// densité si l'unité est le m³.

import type { BuildingElement } from "@/data/types";
import { levelKey } from "@/lib/levelSort";

export const MATCH_SOURCE = "ÖKOBAUDAT 2024 (BMWSB) — A1–A3, Richtwerte";

export interface MaterialCategory {
  id: string;
  label: string;
  /** kg CO₂e / kg (GWP A1–A3, Richtwert). */
  factorKgCo2PerKg: number;
  /** Bande d'honnêteté [min, max] en kg CO₂e/kg. */
  range: [number, number];
  /** Densité de référence (kg/m³) — utilisée si seule la quantité m³ existe. */
  densityKgM3: number;
}

/// Catalogue curé marché allemand (20 catégories couvrant KG 300–500 usuels).
export const MATERIAL_CATALOG: MaterialCategory[] = [
  { id: "stahlbeton", label: "Stahlbeton (≈C30/37, 3 % Armierung)", factorKgCo2PerKg: 0.101, range: [0.09, 0.14], densityKgM3: 2400 },
  { id: "beton", label: "Normalbeton C20/25–C25/30", factorKgCo2PerKg: 0.088, range: [0.07, 0.11], densityKgM3: 2400 },
  { id: "bewehrungsstahl", label: "Betonstahl B500B (Bewehrung)", factorKgCo2PerKg: 0.53, range: [0.22, 1.0], densityKgM3: 7850 },
  { id: "baustahl", label: "Baustahl S235/S355 (Profile)", factorKgCo2PerKg: 1.13, range: [0.6, 1.9], densityKgM3: 7850 },
  { id: "kalksandstein", label: "Kalksandstein Mauerwerk", factorKgCo2PerKg: 0.12, range: [0.1, 0.15], densityKgM3: 1800 },
  { id: "ziegel", label: "Hochlochziegel Mauerwerk", factorKgCo2PerKg: 0.22, range: [0.18, 0.28], densityKgM3: 1200 },
  { id: "porenbeton", label: "Porenbeton (Ytong)", factorKgCo2PerKg: 0.13, range: [0.11, 0.16], densityKgM3: 600 },
  { id: "eps", label: "EPS-Dämmung (WLG 035)", factorKgCo2PerKg: 3.3, range: [2.8, 3.8], densityKgM3: 25 },
  { id: "xps", label: "XPS-Dämmung", factorKgCo2PerKg: 3.9, range: [3.0, 4.8], densityKgM3: 35 },
  { id: "mineralwolle", label: "Mineralwolle-Dämmung", factorKgCo2PerKg: 1.08, range: [0.9, 1.3], densityKgM3: 80 },
  { id: "holzfaser", label: "Holzfaser-Dämmung", factorKgCo2PerKg: 0.25, range: [0.15, 0.4], densityKgM3: 160 },
  { id: "clt", label: "Brettsperrholz (CLT/BSP)", factorKgCo2PerKg: 0.3, range: [0.2, 0.5], densityKgM3: 470 },
  { id: "bsh", label: "Brettschichtholz (BSH, Leimholz)", factorKgCo2PerKg: 0.35, range: [0.25, 0.6], densityKgM3: 500 },
  { id: "schnittholz", label: "Konstruktionsvollholz (KVH/Schnittholz)", factorKgCo2PerKg: 0.22, range: [0.1, 0.4], densityKgM3: 480 },
  { id: "isolierglas", label: "Isolierverglasung (2/3-fach)", factorKgCo2PerKg: 0.9, range: [0.75, 1.1], densityKgM3: 2500 },
  { id: "aluminium", label: "Aluminium (Profile, Fassade)", factorKgCo2PerKg: 8.1, range: [5.5, 9.2], densityKgM3: 2700 },
  { id: "gipskarton", label: "Gipskarton / Gipsputz", factorKgCo2PerKg: 0.28, range: [0.24, 0.34], densityKgM3: 900 },
  { id: "putzmoertel", label: "Kalk-Zement-Putz / Mörtel", factorKgCo2PerKg: 0.15, range: [0.12, 0.2], densityKgM3: 1900 },
  { id: "estrich", label: "Zementestrich", factorKgCo2PerKg: 0.17, range: [0.14, 0.22], densityKgM3: 2000 },
  { id: "bitumen", label: "Bitumen-Abdichtung / -Bahn", factorKgCo2PerKg: 0.36, range: [0.28, 0.48], densityKgM3: 1050 },
  { id: "tga_misch", label: "TGA-Installation (Stahl/Kunststoff-Mix)", factorKgCo2PerKg: 1.6, range: [0.9, 2.9], densityKgM3: 2000 },
  { id: "sonstiges", label: "Bauteile allgemein (Misch-Richtwert)", factorKgCo2PerKg: 0.2, range: [0.1, 0.5], densityKgM3: 1500 },
];

const BY_ID = new Map(MATERIAL_CATALOG.map((c) => [c.id, c]));
export function categoryOf(id: string): MaterialCategory | undefined {
  return BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// RAPPROCHEMENT — règles publiques, ordre = priorité (le plus spécifique
// d'abord : « CLT » avant « Holz », « Bewehrung » avant « Stahl »…).
// ---------------------------------------------------------------------------

interface NameRule {
  id: string;
  re: RegExp;
}

const NAME_RULES: NameRule[] = [
  // « Beton m. Schalung+Bewehrung » = Stahlbeton (béton armé) : le mot
  // Bewehrung seul ne fait PAS un acier — la règle est testée en premier.
  { id: "stahlbeton", re: /stahlbeton|ferrobeton|sichtbeton|beton[^)]*bewehrung/ },
  { id: "bewehrungsstahl", re: /bewehrungsstahl|betonstahl|armier(stahl|ungseisen)|baustahlmatten|\bb500(b|e)?\b/ },
  { id: "baustahl", re: /baustahl|s235|s355|stahl(trag|profil|bau)|profilstahl|\(stahl\)|stahlbau/ },
  // « Porenbeton » doit passer AVANT « beton » : le mot contient « beton »,
  // mais c'est un béton cellulaire (densité 600, pas 2400) — sinon il est
  // reclassé silencieusement en béton normal (masse ×4, carbone faux). §157.
  { id: "porenbeton", re: /por(en)?beton|ytong|gasbeton|ppw/ },
  { id: "beton", re: /\bc[0-9]{2}\/[0-9]{2}\b|normalbeton|beton|\(beton/ },
  { id: "clt", re: /clt|bsp|brettsperr|kreuzlagen/ },
  { id: "bsh", re: /bsh|brettschicht|leimholz/ },
  { id: "schnittholz", re: /kvh|vollholz|schnittholz|holz(rahmen|ständer|massiv)|holzbau/ },
  { id: "kalksandstein", re: /kalksand|\bks\b|klimamauerstein/ },
  { id: "ziegel", re: /ziegel|hlz|mauerziegel|poroton/ },
  { id: "xps", re: /\bxps\b|extrudier/ },
  { id: "eps", re: /\beps\b|styropor|polystyrol/ },
  { id: "holzfaser", re: /holzfaser/ },
  { id: "mineralwolle", re: /mineralwolle|steinwolle|glaswolle|\bmw\b|wlg\s?0?3[25]|dämm/ },
  { id: "isolierglas", re: /isolierglas|verglas|glas|fenster/ },
  { id: "aluminium", re: /alu(minium)?|pfosten|riegel/ },
  { id: "gipskarton", re: /gips(karton|faser)?|rigips|trockenbau/ },
  { id: "putzmoertel", re: /putz|mörtel|moertel/ },
  { id: "estrich", re: /estrich/ },
  { id: "bitumen", re: /bitumen|abdichtung|dachbahn/ },
  { id: "tga_misch", re: /tga|kanal|leitung|rohr|installation|schacht/ },
];

/// Rapprochement par CLASSE IFC — NÄHERUNG honnête (confiance réduite).
const CLASS_RULES: NameRule[] = [
  { id: "stahlbeton", re: /WALL|SLAB|COLUMN|STAIR|RAMP|FOOTING|FOUNDATION|PILE|PLATE/ },
  { id: "baustahl", re: /BEAM|MEMBER/ },
  { id: "isolierglas", re: /WINDOW/ },
  { id: "schnittholz", re: /DOOR/ },
  { id: "mineralwolle", re: /ROOF/ },
  { id: "putzmoertel", re: /COVERING/ },
  { id: "tga_misch", re: /FLOW|DUCT|PIPE|DISTRIBUTION/ },
  { id: "sonstiges", re: /FURNISHING|RAILING|PROXY|CURTAINWALL/ },
];

export type MatchBasis = "materialname" | "ifc-klasse";

export interface CategoryMatch {
  category: MaterialCategory;
  /** 0,90 nom réel · 0,55 Näherung par classe — affichée dans l'UI. */
  confidence: number;
  basis: MatchBasis;
}

/// Rapproche nom (+ classe de secours) d'un Bauteil. `null` = honnêtement
/// non rapproché (compté à part dans la couverture).
export function matchCategory(name: string | null | undefined, type: string | null | undefined): CategoryMatch | null {
  const n = (name ?? "").toLowerCase();
  for (const rule of NAME_RULES) {
    if (rule.re.test(n)) {
      return { category: BY_ID.get(rule.id)!, confidence: 0.9, basis: "materialname" };
    }
  }
  // Le nom seul n'a pas suffi : la CLASSE vient au secours.
  const t = (type ?? "").toUpperCase();
  for (const rule of CLASS_RULES) {
    if (rule.re.test(t)) {
      return { category: BY_ID.get(rule.id)!, confidence: 0.55, basis: "ifc-klasse" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bilan par élément + agrégats (catégorie / étage) avec bande d'honnêteté
// ---------------------------------------------------------------------------

/// Masse du Bauteil : weightKg du takeoff (calculée depuis les vraies
/// quantités IFC, classe par classe) ; sinon qty × densité pour les m³.
export function massKgOf(el: Pick<BuildingElement, "qty" | "unit" | "weightKg" | "code">, densityKgM3: number): number {
  if (el.weightKg && el.weightKg > 0) return el.weightKg;
  if ((el.unit === "m³" || el.unit === "m3") && el.qty > 0) return el.qty * densityKgM3;
  return 0;
}

export interface ElementMatch {
  elementId: string;
  name: string;
  type: string;
  level: string;
  massKg: number;
  match: CategoryMatch | null;
  co2Kg: number;
  lowKg: number;
  highKg: number;
}

export interface CategoryAggregate {
  categoryId: string;
  label: string;
  count: number;
  massKg: number;
  co2Kg: number;
  lowKg: number;
  highKg: number;
  share: number;
  /** « gemessen » si ≥ 50 % de la masse rapprochée par nom réel. */
  confidenceAvg: number;
  basis: MatchBasis | "gemischt";
}

export interface LevelAggregate {
  level: string;
  label: string;
  massKg: number;
  co2Kg: number;
}

export interface MatchSummary {
  /** Éléments pris en compte (masse > 0 ; les espaces virtuels exclus). */
  considered: number;
  totalMassKg: number;
  matchedMassKg: number;
  /** Part de la masse réellement rapprochée — l'honnêteté d'abord. */
  coveragePct: number;
  co2Kg: number;
  lowKg: number;
  highKg: number;
  perM2Ngf: number | null;
  byCategory: CategoryAggregate[];
  byLevel: LevelAggregate[];
  unmatched: { elementId: string; name: string; type: string; massKg: number }[];
  results: ElementMatch[];
}

/**
 * Bilan matière-complet : rapproche chaque Bauteil, additionne la masse et
 * le CO₂ A1–A3, et rend la bande min–max. Aucune donnée semée : tout vient
 * du takeoff/projet ; les éléments sans masse (espaces virtuels, lignes
/// vides) sont ignorés des deux côtés de la couverture.
 */
export function matchMaterials(elements: BuildingElement[], ngf?: number): MatchSummary {
  const results: ElementMatch[] = [];

  for (const el of elements) {
    const match = matchCategory(el.name, el.type);
    const massKg = massKgOf(el, match?.category.densityKgM3 ?? 0);
    if (massKg <= 0) continue; // espace IFC, ligne vide : ni dedans ni dehors
    results.push({
      elementId: el.id,
      name: el.name,
      type: el.type,
      level: el.level && el.level !== "—" ? el.level : "Ohne Ebene",
      massKg,
      match,
      co2Kg: match ? massKg * match.category.factorKgCo2PerKg : 0,
      lowKg: match ? massKg * match.category.range[0] : 0,
      highKg: match ? massKg * match.category.range[1] : 0,
    });
  }

  const totalMassKg = results.reduce((s, r) => s + r.massKg, 0);
  const matched = results.filter((r) => r.match);
  const matchedMassKg = matched.reduce((s, r) => s + r.massKg, 0);
  const co2Kg = matched.reduce((s, r) => s + r.co2Kg, 0);
  const lowKg = matched.reduce((s, r) => s + r.lowKg, 0);
  const highKg = matched.reduce((s, r) => s + r.highKg, 0);

  // Agrégat par catégorie.
  const catMap = new Map<string, CategoryAggregate & { confSum: number; nameBasedMass: number }>();
  for (const r of matched) {
    const cat = r.match!.category;
    const agg =
      catMap.get(cat.id) ??
      {
        categoryId: cat.id,
        label: cat.label,
        count: 0,
        massKg: 0,
        co2Kg: 0,
        lowKg: 0,
        highKg: 0,
        share: 0,
        confidenceAvg: 0,
        basis: "gemischt" as CategoryAggregate["basis"],
        confSum: 0,
        nameBasedMass: 0,
      };
    agg.count += 1;
    agg.massKg += r.massKg;
    agg.co2Kg += r.co2Kg;
    agg.lowKg += r.lowKg;
    agg.highKg += r.highKg;
    agg.confSum += r.match!.confidence;
    if (r.match!.basis === "materialname") agg.nameBasedMass += r.massKg;
    catMap.set(cat.id, agg);
  }
  const byCategory: CategoryAggregate[] = [...catMap.values()]
    .map(({ confSum, nameBasedMass, ...agg }) => ({
      ...agg,
      share: co2Kg > 0 ? agg.co2Kg / co2Kg : 0,
      // Confiance MOYENNE réelle (0,90 nom / 0,55 classe), pas un drapeau.
      confidenceAvg: agg.count > 0 ? confSum / agg.count : 0,
      // ≥ 50 % de la masse rapprochée par nom réel → « par matériau ».
      basis: (aggBasis(nameBasedMass, agg.massKg) ? "materialname" : "ifc-klasse") as MatchBasis,
    }))
    // Règle bureau §36 : CO₂ décroissant (hotspots d'abord), puis alpha.
    .sort((a, b) => b.co2Kg - a.co2Kg || a.label.localeCompare(b.label, "de"));

  // Agrégat par étage (toutes masses, rapprochées ou non — tri bureau).
  const levelMap = new Map<string, LevelAggregate>();
  for (const r of results) {
    const agg = levelMap.get(r.level) ?? { level: r.level, label: r.level, massKg: 0, co2Kg: 0 };
    agg.massKg += r.massKg;
    agg.co2Kg += r.co2Kg;
    levelMap.set(r.level, agg);
  }
  const byLevel = [...levelMap.values()]
    .map((agg) => ({ ...agg, label: levelKey(agg.level).label }))
    .sort((a, b) => levelKey(a.level).rank - levelKey(b.level).rank || a.level.localeCompare(b.level, "de"));

  const unmatched = results
    .filter((r) => !r.match)
    .map((r) => ({ elementId: r.elementId, name: r.name, type: r.type, massKg: r.massKg }));

  return {
    considered: results.length,
    totalMassKg,
    matchedMassKg,
    coveragePct: totalMassKg > 0 ? (matchedMassKg / totalMassKg) * 100 : 0,
    co2Kg,
    lowKg,
    highKg,
    perM2Ngf: ngf && ngf > 0 ? co2Kg / ngf : null,
    byCategory,
    byLevel,
    unmatched,
    results: results.sort((a, b) => b.co2Kg - a.co2Kg || a.name.localeCompare(b.name, "de")),
  };
}

/// ≥ 50 % de la masse rapprochée par nom réel → la catégorie est dite
/// « par nom de matériau » (confiance pleine), sinon Näherung (classe).
function aggBasis(nameBasedMass: number, massKg: number): boolean {
  return massKg > 0 && nameBasedMass / massKg >= 0.5;
}

// ---------------------------------------------------------------------------
// Export CSV (bureau-friendly : point-virgule allemand, unités en en-tête)
// ---------------------------------------------------------------------------

const fmtDe = (n: number, digits = 1): string =>
  n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function materialMatchCsv(summary: MatchSummary): string {
  const lines: string[] = [
    "Kategorie;Anzahl Bauteile;Masse [kg];GWP A1-A3 [kg CO2e];Bandbreite min [kg];max [kg];Anteil [%];Basis",
    ...summary.byCategory.map((c) =>
      [
        c.label,
        String(c.count),
        fmtDe(c.massKg, 0),
        fmtDe(c.co2Kg, 0),
        fmtDe(c.lowKg, 0),
        fmtDe(c.highKg, 0),
        fmtDe(c.share * 100, 1),
        c.basis === "materialname" ? "Materialname" : "IFC-Klasse (Näherung)",
      ].join(";"),
    ),
    "",
    "SUMME;;;;;;",
    `Gesamt;${summary.considered};${fmtDe(summary.totalMassKg, 0)};${fmtDe(summary.co2Kg, 0)};${fmtDe(summary.lowKg, 0)};${fmtDe(summary.highKg, 0)};;Abdeckung ${fmtDe(summary.coveragePct, 0)} %`,
  ];
  return lines.join("\r\n");
}
