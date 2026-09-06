/** §152 — « Beispielprojekt » : un projet de DÉMONSTRATION réaliste, créé en
 * un clic, pour que le premier contact montre tout le flux (Projekt →
 * Kostenschätzung → Rechnung) sans rien importer.
 *
 * HONNÊTETÉ gravée ici :
 *  - c'est de la donnée de DÉMO, étiquetée « Beispielprojekt · … » dans le
 *    nom — jamais présentée comme un vrai projet client ;
 *  - id DÉTERMINISTE (`prj-demo-efh`) : le bouton est IDEMPOTENT (deux clics
 *    ne créent pas deux projets) ;
 *  - c'est un projet CLIENT (store Zustand + miroir §118), cohérent avec
 *    « addProject » : rien n'est simulé côté serveur, le moteur d'estimation
 *    (costEngine) tourne dessus comme sur un projet réel.
 */
import type { BuildingElement, Project } from "@/data/types";
import { categoryOf } from "@/lib/materialMatch";

export const DEMO_PROJECT_ID = "prj-demo-efh";

/** Projet de démonstration : maison individuelle plausible, région Hannover. */
export function makeDemoProject(now: Date = new Date()): Project {
  return {
    id: DEMO_PROJECT_ID,
    code: "DEMO-EFH-01",
    name: "Beispielprojekt · Einfamilienhaus Muster",
    type: "Wohnen (EFH)",
    location: "Hannover, DE",
    client: "Musterfamilie Schmidt",
    status: "design",
    progress: 35,
    budget: 480000,
    spent: 0,
    grossFloorArea: 180,
    floors: 2,
    startDate: now.toISOString().slice(0, 10),
    endDate: "2027-06-30",
    team: ["AM", "LK"],
    classificationCode: "DIN-276",
    carbonBudgetKg: 108000, // ~600 kg CO₂e/m², ordre de grandeur dit
    health: 100,
    riskScore: 10,
    accent: "#f59e0b",
    updatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// §157 — le « waouh » au PREMIER contact : le Beispielprojekt embarque une
// vraie petite maquette (takeoff réaliste d'une maison individuelle ~180 m²
// NGF, 2 niveaux), pour que TOUT le produit s'allume en un clic : LCA
// (Ökobaudat), ⚡ VE-Studio (substitutions réelles : Stahlbeton → CLT,
// Ziegel → Kalksandstein, EPS → Mineralwolle…), éléments, Baustelle.
//
// HONNÊTETÉ gravée : c'est de la donnée de DÉMO (comme le projet lui-même),
// les masses/coûts/carbone sont des RICHTWERTE calculés depuis le catalogue
// public déjà embarqué (MATERIAL_CATALOG, Ökobaudat/BKI) — jamais un devis.
// ---------------------------------------------------------------------------

interface DemoElSpec {
  name: string;
  type: string;
  level: "EG" | "OG";
  unit: "m³" | "m²";
  qty: number;
  /** Masse en kg (déduite volume × densité catalogue, ou masse m²). */
  weightKg: number;
  /** € Richtwert (BKI, ordre de grandeur). */
  cost: number;
  /** Id catégorie MATERIAL_CATALOG (pour carbone + densité cohérents). */
  categoryId: string;
}

const DEMO_SPECS: DemoElSpec[] = [
  // Structure béton — la masse carbone classique (KG 310/330)
  { name: "Bodenplatte Stahlbeton C25/30", type: "IFCSLAB", level: "EG", unit: "m³", qty: 22.5, weightKg: 54000, cost: 7425, categoryId: "stahlbeton" },
  { name: "Geschossdecke Stahlbeton C25/30", type: "IFCSLAB", level: "OG", unit: "m³", qty: 19.8, weightKg: 47520, cost: 7920, categoryId: "stahlbeton" },
  { name: "Stütze Stahlbeton C25/30", type: "IFCCOLUMN", level: "EG", unit: "m³", qty: 0.8, weightKg: 1920, cost: 448, categoryId: "stahlbeton" },
  // Murs extérieurs — maçonnerie (KG 320) : le cas VE le plus parlant
  { name: "Außenwand Hochlochziegel (Nord, EG)", type: "IFCWALLSTANDARDCASE", level: "EG", unit: "m³", qty: 15, weightKg: 18000, cost: 4200, categoryId: "ziegel" },
  { name: "Außenwand Hochlochziegel (Süd, EG)", type: "IFCWALLSTANDARDCASE", level: "EG", unit: "m³", qty: 15, weightKg: 18000, cost: 4200, categoryId: "ziegel" },
  { name: "Außenwand Hochlochziegel (Nord, OG)", type: "IFCWALLSTANDARDCASE", level: "OG", unit: "m³", qty: 15, weightKg: 18000, cost: 4200, categoryId: "ziegel" },
  { name: "Außenwand Hochlochziegel (Süd, OG)", type: "IFCWALLSTANDARDCASE", level: "OG", unit: "m³", qty: 15, weightKg: 18000, cost: 4200, categoryId: "ziegel" },
  // Cloisons — béton cellulaire (KG 330) : 2e cas VE (Porenbeton → KS)
  { name: "Innenwand Porenbeton (EG)", type: "IFCWALLSTANDARDCASE", level: "EG", unit: "m³", qty: 12, weightKg: 7200, cost: 3600, categoryId: "porenbeton" },
  { name: "Innenwand Porenbeton (OG)", type: "IFCWALLSTANDARDCASE", level: "OG", unit: "m³", qty: 12, weightKg: 7200, cost: 3600, categoryId: "porenbeton" },
  // Toiture — isolation (KG 340) : 3e cas VE (EPS → Mineralwolle/Holzfaser)
  { name: "Dachdämmung EPS WLG 035", type: "IFCROOF", level: "OG", unit: "m³", qty: 22, weightKg: 550, cost: 2640, categoryId: "eps" },
  // Menuiseries (KG 340) — masses m², non substituables (honnêteté VE)
  { name: "Fenster Isolierverglasung", type: "IFCWINDOW", level: "EG", unit: "m²", qty: 9, weightKg: 225, cost: 4320, categoryId: "isolierglas" },
  { name: "Fenster Isolierverglasung", type: "IFCWINDOW", level: "OG", unit: "m²", qty: 9, weightKg: 225, cost: 4320, categoryId: "isolierglas" },
  { name: "Tür Holzrahmen", type: "IFCDOOR", level: "EG", unit: "m²", qty: 8, weightKg: 176, cost: 4480, categoryId: "schnittholz" },
  { name: "Tür Holzrahmen", type: "IFCDOOR", level: "OG", unit: "m²", qty: 8, weightKg: 176, cost: 4480, categoryId: "schnittholz" },
];

/** Éléments IFC-indexés du Beispielprojekt (takeoff démo, id déterministe). */
export function makeDemoElements(now: Date = new Date()): BuildingElement[] {
  const iso = now.toISOString();
  return DEMO_SPECS.map((s, i) => {
    const cat = categoryOf(s.categoryId);
    const carbonKg = cat ? Math.round(s.weightKg * cat.factorKgCo2PerKg) : 0;
    return {
      id: `el-demo-${String(i + 1).padStart(3, "0")}`,
      guid: `DEMO-GUID-${String(i + 1).padStart(4, "0")}`,
      code: s.type === "IFCSLAB" && s.level === "EG" ? "310" : s.type === "IFCROOF" || s.type === "IFCWINDOW" || s.type === "IFCDOOR" ? "340" : s.type === "IFCWALLSTANDARDCASE" && s.name.startsWith("Außenwand") ? "320" : "330",
      classificationLabel:
        s.name.startsWith("Außenwand")
          ? "Außenwände"
          : s.name.startsWith("Innenwand")
            ? "Tragkonstruktion, Innenwände"
            : s.type === "IFCROOF"
              ? "Dach, Bauwerksabschluss"
              : s.type === "IFCWINDOW" || s.type === "IFCDOOR"
                ? "Fenster / Türen"
                : "Gründung, Geschossdecken",
      name: s.name,
      type: s.type,
      materialId: `mat-${s.categoryId}`,
      level: s.level,
      projectId: DEMO_PROJECT_ID,
      status: "modeled" as const,
      qty: s.qty,
      unit: s.unit,
      weightKg: s.weightKg,
      cost: s.cost,
      carbonKg,
      properties: [
        { key: "Herkunft", value: "Beispieldaten (Demo)", source: "Narchi" },
        { key: "IFC Class", value: s.type, source: "IFC Parser" },
      ],
      lastUpdated: iso,
      conflicts: 0,
    };
  });
}
