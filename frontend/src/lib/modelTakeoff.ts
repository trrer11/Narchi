// Narchi — model takeoff engine.
// Converts parsed IFC elements (or DXF layer counts) into a DIN 276 cost estimate
// with realistic German unit rates, mass and embodied carbon.

import { parseIfc, type IfcElement, type IfcModel } from "./ifcParser";
import { extractGeometry } from "./ifcGeometry";

export type ModelFormat = "IFC" | "DXF" | "DWG" | "RVT";
export type Precision = "exact" | "approx" | "heuristic";

export interface TakeoffElement {
  expressId: number;
  globalId: string;
  ifcType: string;
  kg: string;
  kgLabel: string;
  name: string;
  level: string;
  unit: string;
  qty: number;
  rawQty?: any;
  weightKg: number;
  cost: number;
  carbonKg: number;
}

export interface KgBucket {
  code: string;
  label: string;
  count: number;
  cost: number;
  carbonKg: number;
  weightKg: number;
}

export interface ModelTakeoff {
  format: ModelFormat;
  precision: Precision;
  precisionNote: string;
  fileName: string;
  fileSize: number;
  projectName: string;
  author: string;
  organization: string;
  schema: string;
  storeys: string[];
  ngf: number;
  volume: number;
  elements: TakeoffElement[];
  kgBuckets: KgBucket[];
  boxes?: import("./ifcGeometry").MeshBox[]; // fallback analytic 3D boxes (IFC only)
  /** Vecteur EXACT soustrait par le recentrage des boîtes (repère IFC natif
      Z-up) — ancre commune pour réconcilier focus QC et scène web-ifc sans
      heuristique de bbox. */
  geometryAnchor?: [number, number, number] | null;
  ifcObjectUrl?: string; // object URL of the active IFC file for real web-ifc rendering
  sourceFile?: File; // active browser File, used for backend IfcOpenShell geometry fallback
  totals: { count: number; cost: number; carbonKg: number; weightKg: number; perM2: number };
  warnings: string[];
}

/* Realistic German unit rates (KG 300/340, ~2024) with mass & carbon factors. */
interface Rate {
  kg: string;
  unit: string;
  rateEur: number; // € per unit
  massPerUnit: number; // kg per unit
  carbonPerKg: number; // kgCO2e per kg
  carbonPerUnit?: number; // override kgCO2e per unit
  name: string;
}

const RATES: Record<string, Rate> = {
  IFCWALL: { kg: "320", unit: "m³", rateEur: 540, massPerUnit: 2500, carbonPerKg: 0.14, name: "Außenwand / Wand (Beton m. Schalung+Bewehrung)" },
  IFCWALLSTANDARDCASE: { kg: "320", unit: "m³", rateEur: 540, massPerUnit: 2500, carbonPerKg: 0.14, name: "Außenwand (Beton)" },
  IFCWALLELEMENTEDCASE: { kg: "320", unit: "m³", rateEur: 540, massPerUnit: 2500, carbonPerKg: 0.14, name: "Wand (elementiert)" },
  IFCSHELL: { kg: "320", unit: "m³", rateEur: 540, massPerUnit: 2500, carbonPerKg: 0.14, name: "Wand / Schale" },
  IFCFOOTING: { kg: "310", unit: "m³", rateEur: 330, massPerUnit: 2500, carbonPerKg: 0.14, name: "Gründung (Beton)" },
  IFCFOUNDATION: { kg: "310", unit: "m³", rateEur: 330, massPerUnit: 2500, carbonPerKg: 0.14, name: "Fundament" },
  IFCPILE: { kg: "310", unit: "m³", rateEur: 360, massPerUnit: 2500, carbonPerKg: 0.14, name: "Pfahl (Beton)" },
  IFCSLAB: { kg: "330", unit: "m³", rateEur: 400, massPerUnit: 2500, carbonPerKg: 0.14, name: "Decke / Bodenplatte" },
  IFCCOLUMN: { kg: "330", unit: "m³", rateEur: 560, massPerUnit: 2500, carbonPerKg: 0.14, name: "Stütze (Beton)" },
  IFCBEAM: { kg: "330", unit: "t", rateEur: 1850, massPerUnit: 1000, carbonPerKg: 1.85, name: "Tragkonstruktion (Stahl)" },
  IFCSTAIR: { kg: "330", unit: "m³", rateEur: 560, massPerUnit: 2500, carbonPerKg: 0.14, name: "Treppe (Beton)" },
  IFCSTAIRFLIGHT: { kg: "330", unit: "m³", rateEur: 560, massPerUnit: 2500, carbonPerKg: 0.14, name: "Treppenlauf" },
  IFCROOF: { kg: "340", unit: "m²", rateEur: 220, massPerUnit: 75, carbonPerKg: 0.7, name: "Dach / Bauwerksabschluss" },
  IFCWINDOW: { kg: "340", unit: "m²", rateEur: 480, massPerUnit: 25, carbonPerKg: 1.25, name: "Fenster" },
  IFCWINDOWSTANDARDCASE: { kg: "340", unit: "m²", rateEur: 480, massPerUnit: 25, carbonPerKg: 1.25, name: "Fenster (Standard)" },
  IFCDOOR: { kg: "340", unit: "m²", rateEur: 560, massPerUnit: 22, carbonPerKg: 1.1, name: "Tür" },
  IFCDOORSTANDARDCASE: { kg: "340", unit: "m²", rateEur: 560, massPerUnit: 22, carbonPerKg: 1.1, name: "Tür (Standard)" },
  IFCCURTAINWALL: { kg: "340", unit: "m²", rateEur: 760, massPerUnit: 38, carbonPerKg: 2.0, name: "Pfosten-Riegel-Fassade" },
  IFCCOVERING: { kg: "360", unit: "m²", rateEur: 68, massPerUnit: 18, carbonPerKg: 0.45, name: "Bodenbelag / Raumfläche" },
  IFCBUILDINGELEMENTPROXY: { kg: "330", unit: "Stk", rateEur: 450, massPerUnit: 150, carbonPerKg: 0.85, name: "Bauteil (Allgemein / Proxy)" },
  IFCMEMBER: { kg: "330", unit: "m³", rateEur: 620, massPerUnit: 1200, carbonPerKg: 0.95, name: "Tragende Stange / Profil" },
  IFCPLATE: { kg: "330", unit: "m²", rateEur: 180, massPerUnit: 85, carbonPerKg: 0.65, name: "Platte / Scheibe" },
  IFCRAILING: { kg: "340", unit: "m", rateEur: 240, massPerUnit: 35, carbonPerKg: 1.1, name: "Geländer / Absturzsicherung" },
  IFCFURNISHINGELEMENT: { kg: "610", unit: "Stk", rateEur: 850, massPerUnit: 60, carbonPerKg: 0.4, name: "Ausstattung / Einbaumöbel" },
  IFCRAMP: { kg: "330", unit: "m²", rateEur: 380, massPerUnit: 450, carbonPerKg: 0.14, name: "Rampe" },
  IFCRAMPFLIGHT: { kg: "330", unit: "m²", rateEur: 380, massPerUnit: 450, carbonPerKg: 0.14, name: "Rampenlauf" },
  IFCFLOWTERMINAL: { kg: "410", unit: "Stk", rateEur: 650, massPerUnit: 25, carbonPerKg: 0.8, name: "TGA Anschlusselement" },
};

const KG_LABELS: Record<string, string> = {
  "310": "Baugrund, Gründung",
  "320": "Außenwände",
  "330": "Tragkonstruktion, Geschossdecken",
  "340": "Dach, Bauwerksabschluss",
  "360": "Raumflächen, Fußböden",
};

/* Choose the dominant quantity for an element given its parsed quantities. */
function primaryQty(el: IfcElement, rate: Rate): number {
  switch (rate.unit) {
    case "m³":
      if (el.qty.volume && el.qty.volume > 0) return el.qty.volume;
      if (el.qty.length && el.qty.width && el.qty.height) return el.qty.length * el.qty.width * el.qty.height;
      if (el.qty.area && el.qty.width) return el.qty.area * el.qty.width;
      return el.qty.length ? el.qty.length * 0.25 * 3.0 : 1.85;
    case "m²":
      if (el.qty.area && el.qty.area > 0) return el.qty.area;
      if (el.qty.length && el.qty.height) return el.qty.length * el.qty.height;
      return el.qty.length ? el.qty.length * 3.0 : 12.5;
    case "t":
      if (el.qty.weight && el.qty.weight > 0) return el.qty.weight / 1000;
      if (el.qty.volume && el.qty.volume > 0) return el.qty.volume * 7.85;
      return 0.45;
    default:
      return el.qty.count ?? 1;
  }
}

export function ifcToTakeoff(model: IfcModel): ModelTakeoff {
  const elements: TakeoffElement[] = [];
  const warnings = [...model.warnings];
  let missingQty = 0;

  for (const el of [...model.elements, ...model.spaces]) {
    const isSpace = el.type === "IFCSPACE";
    const rate = RATES[el.type] || (isSpace ? { kg: "—", name: "Espace (Volume Virtuel)", unit: "m²", rateEur: 0, massPerUnit: 0, carbonPerKg: 0 } : null);
    if (!rate) continue;
    
    let qty = isSpace ? (el.qty.area || (el.qty.width ? el.qty.width * (el.qty.length || 1) : 10)) : primaryQty(el, rate);
    if (qty === null || qty <= 0) {
      if (!isSpace) missingQty++;
      continue;
    }
    qty = Math.round(qty * 100) / 100;
    const weightKg = qty * rate.massPerUnit;
    const carbonKg = rate.carbonPerUnit !== undefined ? qty * rate.carbonPerUnit : weightKg * (rate.carbonPerKg || 0);
    elements.push({
      expressId: el.id,
      globalId: el.globalId || `#${el.id}`,
      ifcType: el.type,
      kg: rate.kg,
      kgLabel: KG_LABELS[rate.kg] ?? rate.kg,
      name: el.name || rate.name,
      level: el.storey,
      unit: rate.unit,
      qty,
      rawQty: el.qty,
      weightKg,
      cost: qty * rate.rateEur,
      carbonKg,
    });
  }

  const ngf = model.buildingArea;
  const volume = model.spaces.reduce((s, sp) => s + (sp.qty.area && sp.qty.height ? sp.qty.area * sp.qty.height : 0), 0);

  const kgBuckets = aggregateKg(elements);
  const totals = {
    count: elements.length,
    cost: elements.reduce((s, e) => s + e.cost, 0),
    carbonKg: elements.reduce((s, e) => s + e.carbonKg, 0),
    weightKg: elements.reduce((s, e) => s + e.weightKg, 0),
    perM2: ngf > 0 ? elements.reduce((s, e) => s + e.cost, 0) / ngf : 0,
  };

  if (missingQty > 0) warnings.push(`${missingQty} Bauteil(e) ohne verwertbare Menge übersprungen.`);
  if (ngf === 0) warnings.push("Keine NGF (Raumfläche) im Modell — €/m² kann nicht berechnet werden. IFC-Räume (IfcSpace) mit NetArea empfohlen.");

  const { boxes, anchor } = extractGeometry(model, model.entities);

  return {
    format: "IFC",
    precision: "exact",
    precisionNote: "Mengen direkt aus dem IFC-Modell (Base Quantities).",
    boxes,
    geometryAnchor: anchor,
    fileName: model.fileName,
    fileSize: model.fileSize,
    projectName: model.projectName,
    author: model.author,
    organization: model.organization,
    schema: model.schema,
    storeys: model.storeys.map((s) => s.name),
    ngf,
    volume,
    elements,
    kgBuckets,
    totals,
    warnings,
  };
}

function aggregateKg(elements: TakeoffElement[]): KgBucket[] {
  const map = new Map<string, KgBucket>();
  for (const e of elements) {
    const b = map.get(e.kg) ?? { code: e.kg, label: e.kgLabel, count: 0, cost: 0, carbonKg: 0, weightKg: 0 };
    b.count++; b.cost += e.cost; b.carbonKg += e.carbonKg; b.weightKg += e.weightKg;
    map.set(e.kg, b);
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

/* ----------------------------- DXF parsing ----------------------------- */
interface DxfLayer { layer: string; entities: number; length: number; }

function parseDxf(text: string): { layers: DxfLayer[]; totalEntities: number; warnings: string[] } {
  const warnings: string[] = [];
  const layerMap = new Map<string, DxfLayer>();
  let totalEntities = 0;
  const lines = text.split(/\r?\n/);
  let i = 0;
  let inEntities = false;

  const ensure = (name: string): DxfLayer => {
    const n = name || "0";
    let l = layerMap.get(n);
    if (!l) { l = { layer: n, entities: 0, length: 0 }; layerMap.set(n, l); }
    return l;
  };

  while (i < lines.length) {
    const code = lines[i]?.trim();
    const val = lines[i + 1]?.trim();
    if (code === "2" && val === "ENTITIES") inEntities = true;
    if (code === "0" && val === "ENDSEC") inEntities = false;
    if (inEntities && code === "0" && val && val !== "ENDSEC") {
      totalEntities++;
      // scan forward for layer (8) and, for polylines/lines, lengths
      let layer = "0";
      let pts: number[] = [];
      let isPoly = /POLYLINE|LWPOLYLINE/.test(val);
      let isLine = val === "LINE";
      let j = i + 2;
      let guard = 0;
      while (j < lines.length && guard < 40) {
        const c2 = lines[j]?.trim();
        const v2 = lines[j + 1]?.trim();
        if (c2 === "0") break;
        if (c2 === "8" && v2) layer = v2;
        if ((isPoly || isLine) && c2 === "10" && v2) pts.push(parseFloat(v2));
        if ((isPoly || isLine) && c2 === "20" && v2) pts.push(parseFloat(v2));
        j += 2; guard++;
      }
      const l = ensure(layer);
      l.entities++;
      if (isLine && pts.length >= 4) {
        l.length += Math.hypot(pts[0] - pts[2], pts[1] - pts[3]);
      }
    }
    i += 2;
  }

  const layers = Array.from(layerMap.values()).sort((a, b) => b.entities - a.entities);
  if (layers.length === 0) warnings.push("Keine DXF-Entitäten gefunden.");
  return { layers, totalEntities, warnings };
}

/* Map a DXF layer name to a DIN 276 KG with a nominal rate. */
function layerToKg(layer: string): { kg: string; label: string; unit: string; rateEur: number; perM: number } | null {
  const l = layer.toLowerCase();
  if (/wand|mauer|wall|aw/.test(l)) return { kg: "320", label: "Außenwände", unit: "m²", rateEur: 410, perM: 3.0 };
  if (/fenster|window|fst/.test(l)) return { kg: "340", label: "Fenster", unit: "m²", rateEur: 460, perM: 1.6 };
  if (/tür|door|dr/.test(l)) return { kg: "340", label: "Türen", unit: "m²", rateEur: 540, perM: 2.1 };
  if (/dach|roof/.test(l)) return { kg: "340", label: "Dach", unit: "m²", rateEur: 185, perM: 1.0 };
  if (/stütze|stuetze|column|pillar/.test(l)) return { kg: "330", label: "Stützen", unit: "m³", rateEur: 420, perM: 0.3 };
  if (/träger|traeger|beam|balken/.test(l)) return { kg: "330", label: "Träger", unit: "t", rateEur: 1850, perM: 0.05 };
  if (/decke|slab|boden|floor/.test(l)) return { kg: "330", label: "Decken", unit: "m³", rateEur: 360, perM: 0.28 };
  if (/fundament|gründung|footing/.test(l)) return { kg: "310", label: "Gründung", unit: "m³", rateEur: 300, perM: 0.4 };
  return null;
}

export function dxfToTakeoff(text: string, fileName: string, fileSize: number): ModelTakeoff {
  const { layers, warnings } = parseDxf(text);
  const elements: TakeoffElement[] = [];
  let idx = 1;
  for (const lyr of layers) {
    const m = layerToKg(lyr.layer);
    if (!m) continue;
    const qty = lyr.length > 0 ? lyr.length * m.perM : lyr.entities * m.perM;
    elements.push({
      expressId: idx++,
      globalId: `DXF-${idx}-${lyr.layer}`,
      ifcType: `LAYER:${lyr.layer}`,
      kg: m.kg,
      kgLabel: m.label,
      name: `Ebene „${lyr.layer}“`,
      level: "—",
      unit: m.unit,
      qty: Math.round(qty * 100) / 100,
      weightKg: 0,
      cost: qty * m.rateEur,
      carbonKg: 0,
    });
  }
  const kgBuckets = aggregateKg(elements);
  const cost = elements.reduce((s, e) => s + e.cost, 0);
  return {
    format: "DXF",
    precision: "approx",
    precisionNote: "Mengen aus DXF-Ebenen (Längen × typische Abmessungen). Für präzise Mengen bitte IFC exportieren.",
    fileName, fileSize,
    projectName: fileName, author: "—", organization: "—", schema: "DXF",
    storeys: [], ngf: 0, volume: 0,
    elements, kgBuckets,
    totals: { count: elements.length, cost, carbonKg: 0, weightKg: 0, perM2: 0 },
    warnings: [...warnings, "DXF enthält keine Volumen-/Massen-/CO₂-Daten — Schätzung ist näherungsweise."],
  };
}

/* ----------------------------- DWG / RVT (binaire propriétaire) ---------
   §67 — RUPTURE AVEC L'HEURISTIQUE : l'ancien code « estimait » des métrés
   à partir de la TAILLE DU FICHIER (fileSize ÷ 45 000 → murs/m³/coûts
   inventés). Même étiquetée « heuristisch », une Kostenschätzung issue
   d'une taille de fichier est indéfendable (doctrine §36 : kein Preis
   ohne Herkunft). NARCHI refuse désormais proprement et GUIDE
   l'utilisateur vers l'export IFC — comme le backend (refus + guide). */
export const BINARY_FORMAT_GUIDE =
  "DWG/RVT werden nicht direkt ausgelesen — NARCHI schätzt NICHT, statt zu raten (§36: kein Preis ohne Herkunft). " +
  "Exportieren Sie bitte IFC : Revit ▸ Datei ▸ Exportieren ▸ IFC · Archicad ▸ Datei ▸ Speichern unter ▸ IFC · " +
  "Allplan ▸ IFC-Schnittstelle · AutoCAD Architecture ▸ IFC-Export. 2D-Grundrisse : als DXF gerne willkommen.";

/* ----------------------------- dispatcher ----------------------------- */
export async function parseConstructionFile(file: File): Promise<ModelTakeoff> {
  const name = file.name.toLowerCase();
  const size = file.size;

  // sniff magic bytes for binary
  const headBuf = await file.slice(0, 8).arrayBuffer();
  const header = new TextDecoder("latin1").decode(headBuf);
  const isBinaryDWG = header.startsWith("AC10");
  const isOLE = Array.from(new Uint8Array(headBuf)).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("") === "d0cf11e0";
  const isZip = header.startsWith("PK");

  if (name.endsWith(".ifc") || name.endsWith(".ifcxml") || name.endsWith(".step")) {
    const text = await file.text();
    if (name.endsWith(".ifcxml")) {
      // §67 — l'ancien code fabriquait ici des métrés heuristiques déguisés
      // en « IFC ». Refus honnête : conversion demandée, pas d'invention.
      throw new Error(
        "IFC-XML wird nicht direkt ausgelesen — bitte als STEP-IFC (.ifc) exportieren. NARCHI schätzt nicht, statt zu raten.",
      );
    }
    const model = parseIfc(text, file.name, size);
    return { ...ifcToTakeoff(model), ifcObjectUrl: URL.createObjectURL(file), sourceFile: file };
  }

  if (name.endsWith(".dxf")) {
    const text = await file.text();
    return dxfToTakeoff(text, file.name, size);
  }

  // §67 — DWG/RVT/RFA et tout binaire propriétaire (OLE/ZIP) : refus NET
  // + guide de conversion, au lieu de métrés inventés (ancienne heuristique).
  if (name.endsWith(".dwg") || name.endsWith(".rvt") || name.endsWith(".rfa") || isOLE || isZip) {
    throw new Error(BINARY_FORMAT_GUIDE);
  }

  // unknown extension → try as text/IFC
  if (!isBinaryDWG && !isOLE) {
    const text = await file.text();
    if (text.includes("DATA;") && text.includes("ENDSEC;")) {
      return ifcToTakeoff(parseIfc(text, file.name, size));
    }
    return dxfToTakeoff(text, file.name, size);
  }
  // §67 — inconnu ET binaire : même refus honnête (plus d'heuristique).
  throw new Error(BINARY_FORMAT_GUIDE);
}

/* =====================================================================
   DEMO MODEL — a real, valid IFC4 building generated client-side so the
   takeoff can be tested instantly without a user file.
   ===================================================================== */
export function generateDemoIfc(): string {
  let id = 1;
  const next = () => id++;
  const L: string[] = [];

  const E = (s: string) => { L.push(s); };

  E("ISO-10303-21;");
  E("HEADER;");
  E("FILE_DESCRIPTION(('ViewDefinition [CoordinationView]','Narchi Takeoff Demo'),'2;1');");
  E(`FILE_NAME('Narchi-Demo-Wohnhaus.ifc','2026-01-15T12:00:00',('A. Moreau'),('Narchi Architekten'),'Narchi','Narchi','');`);
  E("FILE_SCHEMA(('IFC4'));");
  E("ENDSEC;");
  E("DATA;");

  // owner history
  const pPerson = next(); E(`#${pPerson}=IFCPERSON($,'Moreau','Aurelie',$,$,$,$,$);`);
  const pOrg = next(); E(`#${pOrg}=IFCORGANIZATION($,'Narchi Architekten',$,$,$);`);
  const pPAO = next(); E(`#${pPAO}=IFCPERSONANDORGANIZATION(#${pPerson},#${pOrg},$);`);
  const pApp = next(); E(`#${pApp}=IFCAPPLICATION(#${pOrg},'4.2','Narchi','NARCHI');`);
  const pOH = next(); E(`#${pOH}=IFCOWNERHISTORY(#${pPAO},#${pApp},$,.ADDED.,$,$,1705316400);`);

  const origin = next(); E(`#${origin}=IFCCARTESIANPOINT((0.,0.,0.));`);
  const axisZ = next(); E(`#${axisZ}=IFCDIRECTION((0.,0.,1.));`);
  const axisX = next(); E(`#${axisX}=IFCDIRECTION((1.,0.,0.));`);
  const placement0 = next(); E(`#${placement0}=IFCAXIS2PLACEMENT3D(#${origin},#${axisZ},#${axisX});`);
  const ctx = next(); E(`#${ctx}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${placement0},$);`);
  const units = next(); E(`#${units}=IFCUNITASSIGNMENT((#401,#402,#403));`);
  E("#401=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);");
  E("#402=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);");
  E("#403=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);");

  const proj = next(); E(`#${proj}=IFCPROJECT('1PROJ0001',#${pOH},'Narchi Demo MFH',$,$,$,$,(#${ctx}),#${units});`);
  const site = next(); E(`#${site}=IFCSITE('1SITE0001',#${pOH},'Grundstueck',$,$,#${placement0},$,$,.ELEMENT.,$,$,$,$,$);`);
  const bld = next(); E(`#${bld}=IFCBUILDING('1BLDG0001',#${pOH},'Wohnhaus Delta','Mehrgeschossiger Wohnungsbau',#${placement0},$,$,.ELEMENT.,$,$,$);`);

  const stEG = next(); E(`#${stEG}=IFCBUILDINGSTOREY('1STRYEG00',#${pOH},'EG','Erdgeschoss',$,#${placement0},$,$,.ELEMENT.,0.);`);
  const stOG = next(); E(`#${stOG}=IFCBUILDINGSTOREY('1STRYOG00',#${pOH},'OG','Obergeschoss',$,#${placement0},$,$,.ELEMENT.,3.0);`);

  E(`#${next()}=IFCRELAGGREGATES('1RALP0001',#${pOH},$,$,(#${proj}),(#${site}));`);
  E(`#${next()}=IFCRELAGGREGATES('1RALP0002',#${pOH},$,$,(#${site}),(#${bld}));`);
  const relBldSt = next(); E(`#${relBldSt}=IFCRELAGGREGATES('1RALP0003',#${pOH},$,$,(#${bld}),(#${stEG},#${stOG}));`);

  const repCtx = () => {
    const pds = next(); const sr = next();
    E(`#${pds}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${sr}));`);
    E(`#${sr}=IFCSHAPEREPRESENTATION(#${ctx},'Body','SweptSolid',());`);
    return pds;
  };

  // emits an element + its quantity set + rel; records per-storey containment
  const storeyIds = new Map<number, number[]>();
  const ensureStoreyList = (s: number) => {
    let arr = storeyIds.get(s);
    if (!arr) { arr = []; storeyIds.set(s, arr); }
    return arr;
  };
  const emit = (
    type: string,
    guid: string,
    name: string,
    storey: number,
    quants: Array<[string, number, string]>,
  ) => {
    const el = next();
    const shape = repCtx();
    E(`#${el}=${type}('${guid}',#${pOH},'${name}',$,$,#${placement0},#${shape},$);`);
    const qIds: number[] = [];
    for (const [qn, qv, qtype] of quants) {
      const q = next();
      E(`#${q}=${qtype}('${qn}',$,$,${qv});`);
      qIds.push(q);
    }
    const eq = next();
    E(`#${eq}=IFCELEMENTQUANTITY('Q${el}',#${pOH},'BaseQuantities',$,$,(${qIds.map((x) => "#" + x).join(",")}));`);
    E(`#${next()}=IFCRELDEFINESBYPROPERTIES('R${el}',#${pOH},$,$,(#${el}),#${eq});`);
    ensureStoreyList(storey).push(el);
    return el;
  };

  // Realistic MFH: 4 storeys, ~1100 m² NGF, structural shell quantities.
  const wallGuid = (n: number) => "1WALL" + String(n).padStart(6, "0");
  let wn = 1;
  for (const st of [stEG, stOG]) {
    // 7 walls per storey, each L=9 m, W=0.30, H=2.9 → V≈7.83 m³
    for (let k = 0; k < 7; k++) {
      emit("IFCWALLSTANDARDCASE", wallGuid(wn++), `Aussenwand ${st === stEG ? "EG" : "OG"}-${k + 1}`, st, [
        ["Length", 9.0, "IFCQUANTITYLENGTH"], ["Width", 0.30, "IFCQUANTITYLENGTH"], ["Height", 2.9, "IFCQUANTITYLENGTH"],
        ["NetVolume", 7.83, "IFCQUANTITYVOLUME"], ["GrossSideArea", 26.1, "IFCQUANTITYAREA"],
      ]);
    }
  }
  // ground slab (Bodenplatte): 280 m², 0.30 m → 84 m³
  emit("IFCSLAB", "1SLAB000001", "Bodenplatte EG", stEG, [
    ["Area", 280.0, "IFCQUANTITYAREA"], ["Width", 0.30, "IFCQUANTITYLENGTH"], ["NetVolume", 84.0, "IFCQUANTITYVOLUME"],
  ]);
  // suspended floor slabs per storey: 280 m², 0.24 m → 67 m³ each
  emit("IFCSLAB", "1SLAB000002", "Geschossdecke EG", stEG, [["Area", 280.0, "IFCQUANTITYAREA"], ["Width", 0.24, "IFCQUANTITYLENGTH"], ["NetVolume", 67.2, "IFCQUANTITYVOLUME"]]);
  emit("IFCSLAB", "1SLAB000003", "Geschossdecke OG", stOG, [["Area", 280.0, "IFCQUANTITYAREA"], ["Width", 0.24, "IFCQUANTITYLENGTH"], ["NetVolume", 67.2, "IFCQUANTITYVOLUME"]]);
  // columns: 24, V=0.40 each
  for (let k = 0; k < 24; k++) {
    emit("IFCCOLUMN", "1COL" + String(k).padStart(6, "0"), `Stuetze ${k + 1}`, k % 2 ? stEG : stOG, [
      ["Length", 2.9, "IFCQUANTITYLENGTH"], ["Width", 0.35, "IFCQUANTITYLENGTH"], ["Height", 2.9, "IFCQUANTITYLENGTH"], ["NetVolume", 0.40, "IFCQUANTITYVOLUME"],
    ]);
  }
  // beams (steel, per storey): 6 each, V=0.06 m³ → 0.47 t
  for (let k = 0; k < 6; k++) {
    emit("IFCBEAM", "1BEM" + String(k).padStart(6, "0"), `Unterzug ${k + 1}`, stEG, [["Length", 6.0, "IFCQUANTITYLENGTH"], ["NetVolume", 0.06, "IFCQUANTITYVOLUME"], ["Weight", 471.0, "IFCQUANTITYWEIGHT"]]);
  }
  // roof: 280 m², flat roof build-up
  emit("IFCROOF", "1ROOF000001", "Flachdach Aufbau", stOG, [["Area", 280.0, "IFCQUANTITYAREA"]]);
  // windows: 36, 1.8 m² each
  for (let k = 0; k < 36; k++) {
    emit("IFCWINDOW", "1WIN" + String(k).padStart(6, "0"), `Fenster ${k + 1}`, k < 18 ? stEG : stOG, [
      ["Area", 1.8, "IFCQUANTITYAREA"], ["Width", 1.2, "IFCQUANTITYLENGTH"], ["Height", 1.5, "IFCQUANTITYLENGTH"],
    ]);
  }
  // doors: 24, ~2.0 m² each
  for (let k = 0; k < 24; k++) {
    emit("IFCDOOR", "1DOOR" + String(k).padStart(6, "0"), `Tuere ${k + 1}`, stEG, [["Area", 2.0, "IFCQUANTITYAREA"], ["Width", 1.0, "IFCQUANTITYLENGTH"], ["Height", 2.0, "IFCQUANTITYLENGTH"]]);
  }

  // spaces for NGF: EG 5 × 110 m², OG 5 × 110 m² → 1100 m²
  for (const st of [stEG, stOG]) {
    for (let k = 0; k < 5; k++) {
      const sp = next(); const shape = repCtx();
      E(`#${sp}=IFCSPACE('1SPC${String(sp).padStart(6, "0")}',#${pOH},'Wohnen ${st === stEG ? "EG" : "OG"}-${k + 1}',$,$,#${placement0},#${shape},$,.INTERNAL.,$);`);
      const q = next(); E(`#${q}=IFCQUANTITYAREA('NetFloorArea',$,$,110.0);`);
      const eq = next(); E(`#${eq}=IFCELEMENTQUANTITY('Q${sp}',#${pOH},'BaseQuantities',$,$,(#${q}));`);
      E(`#${next()}=IFCRELDEFINESBYPROPERTIES('R${sp}',#${pOH},$,$,(#${sp}),#${eq});`);
      ensureStoreyList(st).push(sp);
    }
  }

  // containment: elements + spaces into their storeys
  for (const [st, ids] of storeyIds) {
    E(`#${next()}=IFCRELCONTAINEDINSPATIALSTRUCTURE('1CNT${String(st).padStart(4, "0")}',#${pOH},'Containment',\$,(${ids.map((x) => "#" + x).join(",")}),#${st});`);
  }
  E("ENDSEC;");
  E("END-ISO-10303-21;");

  return L.join("\n");
}

export async function loadDemoTakeoff(): Promise<ModelTakeoff> {
  const text = generateDemoIfc();
  const blob = new Blob([text], { type: "text/plain" });
  const file = new File([blob], "Narchi-Demo-Wohnhaus.ifc", { type: "text/plain" });
  const model = parseIfc(text, "Narchi-Demo-Wohnhaus.ifc", blob.size);
  
  return {
    ...ifcToTakeoff(model),
    ifcObjectUrl: URL.createObjectURL(file),
    sourceFile: file
  };
}
