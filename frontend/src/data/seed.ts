import type {
  ActivityItem,
  BuildingElement,
  ComplianceRule,
  DataSource,
  ElementStatus,
  Issue,
  LevelInfo,
  Material,
  Milestone,
  NotificationItem,
  Project,
  RiskItem,
  ScheduleTask,
} from "./types";
import { flattenClassification } from "./classification";

/* Deterministic pseudo-random generator so the dataset is stable across renders. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260101);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));

export const MATERIALS: Material[] = [
  { id: "mat-concrete", name: "Reinforced Concrete", category: "Structure", unit: "m³", unitCost: 268, massPerUnit: 2500, carbonKgPerKg: 0.14, recycledContent: 12, origin: "Regional Batch Plant", fireRating: "REI120", supplier: "Rhône Ciments", durabilityYears: 80, description: "Cast in-situ structural concrete with steel reinforcement mesh, designed for a 50-year design life." },
  { id: "mat-steel", name: "Structural Steel", category: "Structure", unit: "t", unitCost: 985, massPerUnit: 1000, carbonKgPerKg: 1.85, recycledContent: 90, origin: "Recycled Electric Mill", fireRating: "R60", supplier: "Atlas Forge", durabilityYears: 75, description: "Hot-rolled steel sections produced from 90% recycled scrap in an electric-arc furnace." },
  { id: "mat-clt", name: "Cross-Laminated Timber", category: "Structure", unit: "m³", massPerUnit: 470, unitCost: 612, carbonKgPerKg: -0.62, recycledContent: 0, origin: "Certified Sustainable Forest", fireRating: "REI60", supplier: "Nordic Lam", durabilityYears: 60, description: "Engineered solid-timber panels from PEFC-certified forests acting as a carbon sink." },
  { id: "mat-brick", name: "Facing Brick", category: "Envelope", unit: "ea", unitCost: 0.95, massPerUnit: 2.5, carbonKgPerKg: 0.22, recycledContent: 8, origin: "Regional Kiln", fireRating: "REI90", supplier: "Terre Cuite SA", durabilityYears: 100, description: "Fired clay facing brick providing durable weathering and thermal mass." },
  { id: "mat-glass", name: "Double-Glazed Unit", category: "Envelope", unit: "m²", unitCost: 322, massPerUnit: 25, carbonKgPerKg: 1.25, recycledContent: 25, origin: "Float Glassworks", fireRating: "EW30", supplier: "Lumière Vitrage", durabilityYears: 40, description: "Argon-filled low-emissivity double-glazed units with warm-edge spacers." },
  { id: "mat-aluminium", name: "Aluminium Frame", category: "Envelope", unit: "lm", unitCost: 28, massPerUnit: 4, carbonKgPerKg: 8.3, recycledContent: 75, origin: "Extrusion Plant", fireRating: "E30", supplier: "Cadre Métal", durabilityYears: 45, description: "Polyamide thermal-break extruded frames with 75% recycled content." },
  { id: "mat-mineral", name: "Mineral Wool Insulation", category: "Services", unit: "m²", unitCost: 24, massPerUnit: 4, carbonKgPerKg: 1.28, recycledContent: 70, origin: "Recycled Mineral Plant", fireRating: "A1", supplier: "IsoLaine", durabilityYears: 50, description: "Non-combustible rockwool insulation manufactured from recycled minerals." },
  { id: "mat-gypsum", name: "Gypsum Board", category: "Interiors", unit: "m²", unitCost: 9.4, massPerUnit: 12, carbonKgPerKg: 0.39, recycledContent: 30, origin: "Drywall Plant", fireRating: "A2", supplier: "Plâtre Nord", durabilityYears: 40, description: "Fire-rated plasterboard with recycled gypsum core and paper facing." },
  { id: "mat-pipe", name: "Polymer Waste Pipe", category: "Services", unit: "lm", unitCost: 7.5, massPerUnit: 1.2, carbonKgPerKg: 3.1, recycledContent: 20, origin: "Polymer Pipeworks", fireRating: "B", supplier: "AquaFlow", durabilityYears: 50, description: "PVC-U soil and waste pipework with solvent-weld joints." },
  { id: "mat-mesh", name: "Reinforcement Mesh", category: "Structure", unit: "kg", unitCost: 1.62, massPerUnit: 1, carbonKgPerKg: 1.7, recycledContent: 92, origin: "Recycled Electric Mill", fireRating: "R60", supplier: "Atlas Forge", durabilityYears: 75, description: "Welded steel reinforcement mesh for suspended slabs and rafts." },
  { id: "mat-timber-joist", name: "Engineered Timber Joist", category: "Structure", unit: "lm", unitCost: 14.5, massPerUnit: 6, carbonKgPerKg: 0.42, recycledContent: 0, origin: "Certified Sustainable Forest", fireRating: "REI30", supplier: "Nordic Lam", durabilityYears: 60, description: "Glulam engineered joists from sustainably managed forests." },
  { id: "mat-ceramic", name: "Ceramic Tile", category: "Finishes", unit: "m²", unitCost: 38, massPerUnit: 18, carbonKgPerKg: 0.45, recycledContent: 12, origin: "Ceramics Plant", fireRating: "A1", supplier: "Terre Cuite SA", durabilityYears: 50, description: "Vitreous ceramic floor tiles with low porosity and high abrasion resistance." },
  { id: "mat-resin", name: "Resin Flooring", category: "Finishes", unit: "m²", unitCost: 42, massPerUnit: 2.5, carbonKgPerKg: 3.9, recycledContent: 35, origin: "Resin Compound Plant", fireRating: "Bfl-s1", supplier: "Sols Pro", durabilityYears: 25, description: "Seamless epoxy-resin flooring with recycled aggregate filler." },
  { id: "mat-pv", name: "Photovoltaic Module", category: "Services", unit: "m²", unitCost: 182, massPerUnit: 12, carbonKgPerKg: 1.4, recycledContent: 0, origin: "Renewables Assembly", fireRating: "—", supplier: "SolarPeak", durabilityYears: 30, description: "Monocrystalline rooftop photovoltaic modules with 25-year linear warranty." },
];

export const PROJECTS: Project[] = [
  { id: "prj-master", code: "PRJ-001", name: "Espace Vierge Projet BIM", type: "Residential", location: "Berlin, DE", client: "Cabinet Narchi", status: "planning", progress: 0, budget: 1850000, spent: 0, grossFloorArea: 750, floors: 3, startDate: "2026-01-01", endDate: "2026-12-31", team: ["AM", "LK"], classificationCode: "DIN-276", carbonBudgetKg: 450000, health: 100, riskScore: 10, accent: "#3b82f6" },
  { id: "prj-demo-muc", code: "PRJ-002", name: "Maquette Demo Munich", type: "Civic", location: "Munich, DE", client: "Stadt München", status: "design", progress: 15, budget: 3200000, spent: 480000, grossFloorArea: 1420, floors: 4, startDate: "2026-02-01", endDate: "2027-06-30", team: ["RT"], classificationCode: "DIN-276", carbonBudgetKg: 850000, health: 95, riskScore: 15, accent: "#10b981" }
];

const STATUS_BY_PROGRESS: ElementStatus[][] = [
  ["modeled", "modeled", "modeled", "validated"],
  ["modeled", "validated", "validated", "approved"],
  ["validated", "approved", "approved", "issued"],
];

interface Archetype {
  code: string;
  type: string;
  name: string;
  materialId: string;
  qtyMin: number;
  qtyMax: number;
}

const ARCHETYPES: Archetype[] = [
  { code: "NMC-20-10-10", type: "Raft Slab", name: "Foundation Raft", materialId: "mat-concrete", qtyMin: 180, qtyMax: 560 },
  { code: "NMC-20-10-20", type: "Piled Foundation", name: "Pile Cap Group", materialId: "mat-concrete", qtyMin: 70, qtyMax: 240 },
  { code: "NMC-20-20-10", type: "Basement Wall", name: "Tank Retaining Wall", materialId: "mat-concrete", qtyMin: 110, qtyMax: 380 },
  { code: "NMC-30-10-10", type: "RC Column", name: "Reinforced Column", materialId: "mat-concrete", qtyMin: 1.4, qtyMax: 5.2 },
  { code: "NMC-30-10-20", type: "Steel Column", name: "Steel Stanchion", materialId: "mat-steel", qtyMin: 0.5, qtyMax: 2.4 },
  { code: "NMC-30-20-10", type: "Steel Beam", name: "Primary Steel Beam", materialId: "mat-steel", qtyMin: 0.4, qtyMax: 1.9 },
  { code: "NMC-30-20-20", type: "Timber Beam", name: "Glulam Beam", materialId: "mat-timber-joist", qtyMin: 6, qtyMax: 26 },
  { code: "NMC-30-30-10", type: "Flat Slab", name: "Suspended Slab", materialId: "mat-concrete", qtyMin: 140, qtyMax: 920 },
  { code: "NMC-30-30-20", type: "Composite Slab", name: "Deck Reinforcement", materialId: "mat-mesh", qtyMin: 1200, qtyMax: 8400 },
  { code: "NMC-40-10-10", type: "Curtain Wall", name: "Glazed Facade", materialId: "mat-glass", qtyMin: 40, qtyMax: 280 },
  { code: "NMC-40-10-20", type: "Brick Cavity Wall", name: "Masonry Rainscreen", materialId: "mat-brick", qtyMin: 600, qtyMax: 3400 },
  { code: "NMC-40-20-10", type: "Window Assembly", name: "Fenestration Unit", materialId: "mat-glass", qtyMin: 2, qtyMax: 20 },
  { code: "NMC-40-20-20", type: "External Door", name: "Aluminium Door Frame", materialId: "mat-aluminium", qtyMin: 3, qtyMax: 14 },
  { code: "NMC-40-30-10", type: "Flat Roof", name: "Insulated Roof Build-up", materialId: "mat-mineral", qtyMin: 60, qtyMax: 420 },
  { code: "NMC-50-10-10", type: "Plasterboard Partition", name: "Stud Partition", materialId: "mat-gypsum", qtyMin: 80, qtyMax: 640 },
  { code: "NMC-50-20-10", type: "Resin Flooring", name: "Seamless Resin Floor", materialId: "mat-resin", qtyMin: 60, qtyMax: 520 },
  { code: "NMC-50-20-20", type: "Ceramic Tiling", name: "Ceramic Floor Finish", materialId: "mat-ceramic", qtyMin: 40, qtyMax: 360 },
  { code: "NMC-60-10-10", type: "Ductwork", name: "Air Distribution Duct", materialId: "mat-aluminium", qtyMin: 20, qtyMax: 180 },
  { code: "NMC-60-20-10", type: "Photovoltaic Array", name: "Rooftop PV Array", materialId: "mat-pv", qtyMin: 30, qtyMax: 220 },
  { code: "NMC-60-30-10", type: "Waste Pipework", name: "Soil & Waste Pipe", materialId: "mat-pipe", qtyMin: 40, qtyMax: 320 },
  { code: "NMC-10-20-10", type: "Vehicular Paving", name: "Heavy-Duty Slab", materialId: "mat-concrete", qtyMin: 60, qtyMax: 300 },
  { code: "NMC-10-20-20", type: "Pedestrian Paving", name: "External Paving", materialId: "mat-ceramic", qtyMin: 80, qtyMax: 460 },
];

const labelByCode: Record<string, string> = Object.fromEntries(
  flattenClassification().map((n) => [n.code, n.label])
);

const LEVEL_PREFIX = ["B-01", "L-00", "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "Roof"];
const LOAD_GROUPS = ["G-1", "G-2", "G-3", "G-4", "G-5"];
const MARKS = ["A", "B", "C", "D", "E", "F"];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(intBetween(7, 19), intBetween(0, 59), 0, 0);
  return d.toISOString();
}

function generateElements(): BuildingElement[] {
  const out: BuildingElement[] = [];
  let counter = 1;
  for (const project of PROJECTS) {
    const levelPool: string[] = [];
    for (let i = 0; i < Math.min(project.floors, 6); i++) levelPool.push(LEVEL_PREFIX[Math.min(i + 1, LEVEL_PREFIX.length - 1)]);
    levelPool.push("Roof");
    if (project.floors >= 4) levelPool.unshift("B-01");
    const statusPool = STATUS_BY_PROGRESS[Math.min(Math.floor(project.progress / 34), 2)];

    for (const arch of ARCHETYPES) {
      const count = intBetween(1, 4);
      for (let i = 0; i < count; i++) {
        const material = MATERIALS.find((m) => m.id === arch.materialId)!;
        const qty = Number(between(arch.qtyMin, arch.qtyMax).toFixed(arch.qtyMax < 10 ? 2 : 0));
        const weightKg = qty * material.massPerUnit;
        const carbonKg = weightKg * material.carbonKgPerKg;
        const cost = qty * material.unitCost;
        const status = pick(statusPool);
        const mark = pick(MARKS);
        const id = `EL-${String(counter).padStart(5, "0")}`;
        counter++;
        out.push({
          id,
          guid: `${id}-${Math.floor(rand() * 1e9).toString(16).toUpperCase().padStart(8, "0")}`,
          code: arch.code,
          classificationLabel: labelByCode[arch.code] ?? arch.type,
          name: `${arch.name} ${mark}${intBetween(1, 9)}`,
          type: arch.type,
          materialId: material.id,
          level: pick(levelPool),
          projectId: project.id,
          status,
          qty,
          unit: material.unit,
          weightKg,
          cost,
          carbonKg,
          properties: [
            { key: "Fire Rating", value: material.fireRating },
            { key: "Recycled Content", value: `${material.recycledContent}%` },
            { key: "Load Group", value: pick(LOAD_GROUPS) },
            { key: "Source Origin", value: material.origin },
          ],
          lastUpdated: isoDaysAgo(intBetween(0, 38)),
          conflicts: rand() < 0.16 ? intBetween(1, 3) : 0,
        });
      }
    }
  }
  return out;
}

export const ELEMENTS: BuildingElement[] = generateElements();

export const SOURCES: DataSource[] = [
  { id: "src-model", name: "3D Model Stream", kind: "Geometry exchange", status: "connected", lastSync: isoDaysAgo(0), records: 18_450, health: 98, delta: 320, latencyMs: 142 },
  { id: "src-schedule", name: "Quantity Schedule", kind: "Tabular feed", status: "connected", lastSync: isoDaysAgo(0), records: 6_200, health: 95, delta: 64, latencyMs: 88 },
  { id: "src-cost", name: "Cost Data Feed", kind: "Rate database", status: "connected", lastSync: isoDaysAgo(1), records: 980, health: 99, delta: 0, latencyMs: 56 },
  { id: "src-field", name: "Field Capture", kind: "Site reports", status: "idle", lastSync: isoDaysAgo(2), records: 2_310, health: 88, delta: 12, latencyMs: 210 },
  { id: "src-energy", name: "Energy Analysis", kind: "Simulation export", status: "connected", lastSync: isoDaysAgo(1), records: 540, health: 92, delta: 8, latencyMs: 174 },
  { id: "src-geo", name: "Geospatial Layer", kind: "Cadastral map", status: "error", lastSync: isoDaysAgo(5), records: 120, health: 41, delta: 0, latencyMs: 980 },
];

export const ACTIVITY: ActivityItem[] = [
  { id: "act-1", time: isoDaysAgo(0), kind: "sync", message: "3D Model Stream reconciled — 320 new elements indexed", user: "System" },
  { id: "act-2", time: isoDaysAgo(0), kind: "carbon", message: "Embodied carbon threshold exceeded on Substructure (Hélios)", user: "L. Kovač" },
  { id: "act-3", time: isoDaysAgo(1), kind: "validate", message: "Validated glazed facade assembly on L-12", user: "A. Moreau" },
  { id: "act-4", time: isoDaysAgo(1), kind: "create", message: "New photovoltaic array modelled on Roof level", user: "R. Tariq" },
  { id: "act-5", time: isoDaysAgo(2), kind: "export", message: "Exported quantity takeoff to the project ledger", user: "J. Diallo" },
  { id: "act-6", time: isoDaysAgo(3), kind: "alert", message: "Geospatial Layer connection degraded — retry queued", user: "System" },
  { id: "act-7", time: isoDaysAgo(4), kind: "validate", message: "Approved 48 structural columns against NMC-30", user: "S. Perrin" },
  { id: "act-8", time: isoDaysAgo(5), kind: "create", message: "Imported revised floor finishes schedule (Aurora)", user: "C. Vidal" },
];

export const COMPLIANCE: ComplianceRule[] = [
  { id: "cmp-1", name: "Exit enclosure fire rating", domain: "Fire Safety", severity: "critical", status: "fail", target: "≥ REI120", actual: "REI90", affected: 14, description: "Protected stair enclosures must achieve a minimum 120-minute integrity and insulation rating.", remediation: "Upgrade stair enclosure boards to a 2-hour fire-rated shaftwall system and re-issue the affected levels." },
  { id: "cmp-2", name: "Substructure embodied carbon", domain: "Carbon", severity: "major", status: "fail", target: "≤ 380 kgCO₂e/m²", actual: "412 kgCO₂e/m²", affected: 26, description: "Foundation system exceeds the upfront carbon budget allocated at concept stage.", remediation: "Substitute 35% of cement with ground granulated blast-furnace slag to reduce upfront emissions." },
  { id: "cmp-3", name: "Maximum escape travel distance", domain: "Fire Safety", severity: "major", status: "fail", target: "≤ 18 m", actual: "21 m", affected: 6, description: "Two storeys exceed the single-direction travel distance to the nearest protected exit.", remediation: "Introduce an intermediate protected lobby on the affected storeys to reset the travel path." },
  { id: "cmp-4", name: "Step-free principal entrance", domain: "Accessibility", severity: "minor", status: "pass", target: "Level access", actual: "Compliant", affected: 0, description: "All primary entrances provide continuous step-free accessible routes.", remediation: "No action required — entrances are compliant." },
  { id: "cmp-5", name: "Party wall acoustic performance", domain: "Acoustics", severity: "major", status: "pass", target: "DnT,w ≥ 53 dB", actual: "55 dB", affected: 0, description: "Separating wall and floor assemblies meet airborne sound insulation targets.", remediation: "No action required — assemblies exceed the target." },
  { id: "cmp-6", name: "Thermal envelope U-value", domain: "Energy", severity: "major", status: "pass", target: "U ≤ 0.18 W/m²K", actual: "0.16 W/m²K", affected: 0, description: "Opaque envelope elements satisfy the maximum heat-transfer coefficient.", remediation: "No action required — envelope outperforms the target." },
  { id: "cmp-7", name: "Structural steel recycled content", domain: "Carbon", severity: "minor", status: "pass", target: "≥ 30%", actual: "90%", affected: 0, description: "All structural steel sections exceed the minimum recycled content requirement.", remediation: "No action required — sections far exceed the requirement." },
  { id: "cmp-8", name: "Average daylight factor", domain: "Wellbeing", severity: "minor", status: "warn", target: "DF ≥ 2.0%", actual: "1.7%", affected: 9, description: "Several regularly occupied rooms fall marginally below the daylight target.", remediation: "Increase glazed area or specify higher-reflectance internal finishes in the underperforming rooms." },
  { id: "cmp-9", name: "Seismic inter-storey drift", domain: "Structural", severity: "critical", status: "pass", target: "≤ 0.5%", actual: "0.4%", affected: 0, description: "Lateral drift under the design earthquake remains within permissible limits.", remediation: "No action required — drift is within limits." },
];

/* ===================== Digital twin — levels ===================== */
const LEVEL_TYPES: LevelInfo["type"][] = ["mechanical", "typical", "typical", "typical", "typical", "typical", "ground", "basement", "basement"];

export function levelsForProject(project?: Project): LevelInfo[] {
  if (!project || !project.id || !project.floors) return [];
  const count = Math.min(Math.max(project.floors, 6), 9);
  const elements = ELEMENTS.filter((e) => e.projectId === project.id);
  const byLevel = new Map<string, BuildingElement[]>();
  for (const e of elements) {
    const arr = byLevel.get(e.level) ?? [];
    arr.push(e);
    byLevel.set(e.level, arr);
  }
  const levels: LevelInfo[] = [];
  for (let i = 0; i < count; i++) {
    const name = count === 9 ? ["Roof", "L-07", "L-06", "L-05", "L-04", "L-03", "L-02", "L-01", "B-01"][i] : `L-${String(count - i - 1).padStart(2, "0")}`;
    const lvlEls = byLevel.get(name) ?? [];
    const carbonKg = lvlEls.reduce((s, e) => s + e.carbonKg, 0);
    const cost = lvlEls.reduce((s, e) => s + e.cost, 0);
    levels.push({
      index: count - i - 1,
      name,
      elevation: i * 3.4,
      height: 3.4,
      grossArea: Math.round(project.grossFloorArea / count),
      elementCount: lvlEls.length,
      carbonKg,
      cost,
      completion: Math.max(8, Math.min(100, project.progress + intBetween(-22, 12))),
      type: LEVEL_TYPES[Math.min(i, LEVEL_TYPES.length - 1)],
    });
  }
  return levels;
}

/* ===================== 4D schedule ===================== */
const SCHEDULE_SEED: Omit<ScheduleTask, "id">[] = [
  { name: "Site clearance & enabling works", phase: "Enabling", classificationCode: "NMC-10", level: "Site", startDay: 0, duration: 24, progress: 100, status: "completed", responsible: "BG", dependents: ["sch-2"] },
  { name: "Bulk excavation & earth retention", phase: "Substructure", classificationCode: "NMC-10", level: "B-01", startDay: 18, duration: 32, progress: 100, status: "completed", responsible: "BG", dependents: ["sch-3"] },
  { name: "Piled foundation & raft", phase: "Substructure", classificationCode: "NMC-20", level: "B-01", startDay: 44, duration: 38, progress: 100, status: "completed", responsible: "TV", dependents: ["sch-4"] },
  { name: "Basement waterproof structure", phase: "Substructure", classificationCode: "NMC-20", level: "B-01", startDay: 70, duration: 30, progress: 92, status: "in-progress", responsible: "TV", dependents: ["sch-5"] },
  { name: "Primary frame — lower tower", phase: "Superstructure", classificationCode: "NMC-30", level: "L-01", startDay: 92, duration: 54, progress: 78, status: "in-progress", responsible: "OK", dependents: ["sch-6"] },
  { name: "Primary frame — upper tower", phase: "Superstructure", classificationCode: "NMC-30", level: "L-06", startDay: 120, duration: 66, progress: 54, status: "in-progress", responsible: "OK", dependents: ["sch-7"] },
  { name: "Floor slabs & composite decks", phase: "Superstructure", classificationCode: "NMC-30", level: "L-03", startDay: 110, duration: 70, progress: 64, status: "in-progress", responsible: "RL", dependents: ["sch-8"] },
  { name: "Curtain wall & envelope", phase: "Envelope", classificationCode: "NMC-40", level: "L-02", startDay: 150, duration: 84, progress: 38, status: "upcoming", responsible: "AM", dependents: ["sch-9"] },
  { name: "Roof build-up & PV array", phase: "Envelope", classificationCode: "NMC-40", level: "Roof", startDay: 200, duration: 26, progress: 0, status: "upcoming", responsible: "RT", dependents: ["sch-11"] },
  { name: "Mechanical ductwork risers", phase: "Services", classificationCode: "NMC-60", level: "L-04", startDay: 170, duration: 60, progress: 22, status: "delayed", responsible: "JD", dependents: ["sch-11"] },
  { name: "Electrical & power distribution", phase: "Services", classificationCode: "NMC-60", level: "L-02", startDay: 188, duration: 72, progress: 12, status: "upcoming", responsible: "JD", dependents: ["sch-12"] },
  { name: "Internal partitions & finishes", phase: "Interiors", classificationCode: "NMC-50", level: "L-01", startDay: 230, duration: 90, progress: 0, status: "upcoming", responsible: "AM", dependents: ["sch-13"] },
  { name: "Commissioning & handover", phase: "Handover", classificationCode: "NMC-60", level: "Site", startDay: 300, duration: 40, progress: 0, status: "upcoming", responsible: "SP", dependents: [] },
];

export const SCHEDULE: ScheduleTask[] = SCHEDULE_SEED.map((t, i) => ({ ...t, id: `sch-${i + 1}` }));

export const MILESTONES: Milestone[] = [
  { id: "ms-1", name: "Planning consent", day: 0, reached: true },
  { id: "ms-2", name: "Substructure complete", day: 100, reached: true },
  { id: "ms-3", name: "Structural topping out", day: 186, reached: false },
  { id: "ms-4", name: "Weathertight", day: 226, reached: false },
  { id: "ms-5", name: "Practical completion", day: 340, reached: false },
];

/* ===================== Issues / snags ===================== */
export const ISSUES: Issue[] = [
  { id: "iss-1", title: "Reinforcement spacing conflicts with slab penetrations", level: "L-03", classificationCode: "NMC-30", severity: "major", status: "open", assignee: "OK", raisedDay: 128, description: "Several structural openings clash with the primary reinforcement layout on level L-03.", projectId: "prj-helios" },
  { id: "iss-2", title: "Curtain wall transom deflection exceeds tolerance", level: "L-02", classificationCode: "NMC-40", severity: "critical", status: "in-review", assignee: "AM", raisedDay: 134, description: "Mid-span deflection of glazed transoms exceeds the permissible serviceability limit.", projectId: "prj-helios" },
  { id: "iss-3", title: "Ductwork route clashes with primary beam", level: "L-04", classificationCode: "NMC-60", severity: "major", status: "open", assignee: "JD", raisedDay: 141, description: "Mechanical duct riser intersects a structural steel beam; coordination required.", projectId: "prj-helios" },
  { id: "iss-4", title: "Acoustic seal missing at partition head", level: "L-01", classificationCode: "NMC-50", severity: "minor", status: "resolved", assignee: "AM", raisedDay: 96, description: "Head-of-wall acoustic seal was omitted in three offices; rectification completed.", projectId: "prj-helios" },
  { id: "iss-5", title: "PV array ballast blocks under-sized for wind uplift", level: "Roof", classificationCode: "NMC-60", severity: "major", status: "in-review", assignee: "RT", raisedDay: 150, description: "Calculated wind uplift exceeds the available ballast on the southern PV field.", projectId: "prj-helios" },
  { id: "iss-6", title: "Basement waterproofing detail at service entry", level: "B-01", classificationCode: "NMC-20", severity: "minor", status: "open", assignee: "TV", raisedDay: 138, description: "Penetration sealing detail requires updating to maintain tanking continuity.", projectId: "prj-helios" },
];

/* ===================== Risks ===================== */
export const RISKS: RiskItem[] = [
  { id: "risk-1", title: "Steel section delivery delays", category: "schedule", likelihood: 4, impact: 4, mitigation: "Advance-order critical sections and prequalify a secondary supplier.", owner: "OK" },
  { id: "risk-2", title: "Embodied carbon budget overrun", category: "carbon", likelihood: 3, impact: 5, mitigation: "Introduce ground-granulated slag in foundations and review concrete mixes weekly.", owner: "LK" },
  { id: "risk-3", title: "Glazing procurement cost volatility", category: "cost", likelihood: 4, impact: 3, mitigation: "Lock the curtain-wall package at the next cost checkpoint.", owner: "AM" },
  { id: "risk-4", title: "Coordination gaps between trades", category: "quality", likelihood: 3, impact: 4, mitigation: "Run weekly federated clash-detection and resolution workshops.", owner: "SP" },
  { id: "risk-5", title: "Perimeter hoarding safety exposure", category: "safety", likelihood: 2, impact: 5, mitigation: "Increase protected walkways and conduct daily edge inspections.", owner: "BG" },
  { id: "risk-6", title: "Daylight target shortfall in deep plan", category: "quality", likelihood: 3, impact: 2, mitigation: "Refine internal reflectance and add light-shelves in underperforming zones.", owner: "EN" },
];

/* ===================== Notifications ===================== */
export const NOTIFICATIONS: NotificationItem[] = [
  { id: "ntf-1", kind: "alert", title: "Geospatial Layer degraded", detail: "Source «Geospatial Layer» dropped to 41% health — retry queued.", time: isoDaysAgo(0), read: false },
  { id: "ntf-2", kind: "carbon", title: "Carbon budget exceeded", detail: "Substructure upfront carbon is 412 kgCO₂e/m² against a 380 target.", time: isoDaysAgo(0), read: false },
  { id: "ntf-3", kind: "compliance", title: "Critical fire-rating failure", detail: "14 protected stair enclosures below the REI120 requirement.", time: isoDaysAgo(1), read: false },
  { id: "ntf-4", kind: "sync", title: "Sync completed", detail: "312 new elements reconciled and indexed into the ledger.", time: isoDaysAgo(0), read: true },
  { id: "ntf-5", kind: "mention", title: "A. Moreau assigned you", detail: "Review curtain-wall deflection issue on L-02.", time: isoDaysAgo(1), read: true },
  { id: "ntf-6", kind: "alert", title: "Ductwork clash detected", detail: "Mechanical riser intersects a primary beam on L-04.", time: isoDaysAgo(2), read: true },
];
