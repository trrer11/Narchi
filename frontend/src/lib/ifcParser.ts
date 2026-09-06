// Narchi — real IFC (STEP ISO 10303-21) parser, runs fully in the browser.
// Extracts building elements, their base quantities, spatial structure and NGF.
// No WASM dependency → reliable in a single-file build.

import { ifcSchemaHinweise } from "./ifcSchema";

export type TokenKind = "string" | "number" | "ref" | "enum" | "null" | "list" | "ident" | "star";
export interface Token {
  kind: TokenKind;
  value: unknown;
}

export interface IfcEntity {
  id: number;
  type: string;
  args: Token[];
}

export interface ParsedQuantity {
  length?: number;
  width?: number;
  height?: number;
  area?: number;
  volume?: number;
  count?: number;
  weight?: number;
}

export interface IfcElement {
  id: number;
  globalId: string;
  type: string;
  name: string;
  longName: string;
  predefinedType: string;
  storey: string;
  qty: ParsedQuantity;
}

export interface IfcModel {
  ok: boolean;
  fileName: string;
  fileSize: number;
  schema: string;
  projectName: string;
  author: string;
  organization: string;
  buildingName: string;
  siteName: string;
  storeys: { name: string; elevation: number }[];
  elements: IfcElement[];
  spaces: IfcElement[];
  buildingArea: number;
  warnings: string[];
  entities: Map<number, IfcEntity>;
}

const ELEMENT_TYPES = new Set([
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE", "IFCSHELL", "IFCSITE", "IFCGEOGRAPHICELEMENT",
  "IFCSLAB", "IFCFOOTING", "IFCPILE", "IFCCOLUMN", "IFCBEAM", "IFCROOF",
  "IFCDOOR", "IFCDOORSTANDARDCASE", "IFCWINDOW", "IFCWINDOWSTANDARDCASE", "IFCCURTAINWALL", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAILING",
  "IFCCOVERING", "IFCFURNISHINGELEMENT", "IFCSPACE", "IFCBUILDINGELEMENTPROXY", "IFCMEMBER", "IFCPLATE", "IFCRAMP", "IFCRAMPFLIGHT", "IFCFLOWTERMINAL", "IFCFOUNDATION",
]);

const SPATIAL_CONTAINMENT = "IFCRELCONTAINEDINSPATIALSTRUCTURE";
const REL_DEF_PROPS = "IFCRELDEFINESBYPROPERTIES";
const ELEMENT_QUANTITY = "IFCELEMENTQUANTITY";

/* ----------------------------- tokenizer ----------------------------- */
function matchCloseParen(s: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  const n = s.length;
  while (i < n && depth > 0) {
    const c = s[i];
    if (c === "'") {
      i++;
      while (i < n) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { i += 2; continue; }
          i++; break;
        }
        i++;
      }
    } else if (c === "(") { depth++; i++; }
    else if (c === ")") { depth--; if (depth === 0) return i; i++; }
    else i++;
  }
  return n - 1;
}

/// Décodage des échappements de chaîne IFC (STEP ISO 10303-21) :
///   \X\HH           → octet hexadécimal ISO-8859-1  : « B\X\E9ton » → « Béton »
///   \X2\XXXX…\X0\   → séquence Unicode BMP (4 hex/caractère)
///   \X4\XXXXXXXX…\X0\ → séquence astrale (8 hex/caractère)
/// Sans cela, les noms Revit allemands/français s'affichaient en brut
/// (« m\X\E9tallique ») — retour utilisateur 2026-08-06.
export function decodeIfcEscapes(raw: string): string {
  if (!raw.includes("\\")) return raw;
  return raw
    .replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_m, hex: string) => {
      const cps: number[] = [];
      for (let i = 0; i < hex.length; i += 4) cps.push(parseInt(hex.slice(i, i + 4), 16));
      return String.fromCharCode(...cps);
    })
    .replace(/\\X4\\((?:[0-9A-Fa-f]{8})+)\\X0\\/g, (_m, hex: string) => {
      const cps: number[] = [];
      for (let i = 0; i < hex.length; i += 8) cps.push(parseInt(hex.slice(i, i + 8), 16));
      return String.fromCodePoint(...cps);
    })
    .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export function tokenizeArgs(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const c = str[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === ",") { i++; continue; }
    if (c === "(") {
      const close = matchCloseParen(str, i);
      const inner = str.slice(i + 1, close);
      tokens.push({ kind: "list", value: tokenizeArgs(inner) });
      i = close + 1;
    } else if (c === "'") {
      let j = i + 1;
      let out = "";
      while (j < n) {
        if (str[j] === "'") {
          if (str[j + 1] === "'") { out += "'"; j += 2; continue; }
          break;
        }
        out += str[j]; j++;
      }
      tokens.push({ kind: "string", value: decodeIfcEscapes(out) });
      i = j + 1;
    } else if (c === "#") {
      let j = i + 1;
      let num = "";
      while (j < n && /[0-9]/.test(str[j])) { num += str[j]; j++; }
      tokens.push({ kind: "ref", value: parseInt(num, 10) });
      i = j;
    } else if (c === "$") { tokens.push({ kind: "null", value: null }); i++; }
    else if (c === "*") { tokens.push({ kind: "star", value: null }); i++; }
    else if (c === ".") {
      let j = i + 1;
      let e = "";
      while (j < n && str[j] !== ".") { e += str[j]; j++; }
      tokens.push({ kind: "enum", value: e });
      i = j + 1;
    } else {
      let j = i;
      let chunk = "";
      while (j < n && !/[,()\s]/.test(str[j])) { chunk += str[j]; j++; }
      if (j === i) {
        // Caractère inattendu ne correspondant à aucune branche (parenthèse
        // orpheline, séparateur résiduel après désynchronisation d'une chaîne
        // aux quotes échappées, …). Sans ce garde-fou, la boucle n'avancerait
        // plus jamais : tokens infinis, OOM, Worker tué silencieusement par
        // le navigateur. On ignore le caractère — terminaison garantie.
        i++;
        continue;
      }
      const num = Number(chunk);
      if (chunk !== "" && !isNaN(num)) tokens.push({ kind: "number", value: num });
      else tokens.push({ kind: "ident", value: chunk });
      i = j;
    }
  }
  return tokens;
}

function splitStepRecords(data: string): string[] {
  // Un séparateur `;` dans une chaîne STEP ne termine pas une entité.
  // Un simple `split(";")` tronquait les noms/propriétés IFC contenant
  // des points-virgules et pouvait rendre le modèle partiellement illisible.
  const records: string[] = [];
  let start = 0;
  let inString = false;
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    if (char === "'") {
      if (inString && data[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (char === ";" && !inString) {
      records.push(data.slice(start, index));
      start = index + 1;
    }
  }

  if (start < data.length) records.push(data.slice(start));
  return records;
}

function parseRecord(record: string): IfcEntity | null {
  const t = record.trim();
  if (!t.startsWith("#")) return null;
  const eq = t.indexOf("=");
  if (eq < 0) return null;
  const id = parseInt(t.slice(1, eq).trim(), 10);
  if (isNaN(id)) return null;
  const after = t.slice(eq + 1).trim();
  const pOpen = after.indexOf("(");
  const pClose = after.lastIndexOf(")");
  if (pOpen < 0 || pClose < 0) return null;
  const type = after.slice(0, pOpen).trim().toUpperCase();
  const argStr = after.slice(pOpen + 1, pClose);
  return { id, type, args: tokenizeArgs(argStr) };
}

/* ----------------------------- accessors ----------------------------- */
const strVal = (t?: Token): string => (t && t.kind === "string" ? (t.value as string) : "");
const numVal = (t?: Token): number | undefined => (t && t.kind === "number" ? (t.value as number) : undefined);
const refVal = (t?: Token): number | undefined => (t && t.kind === "ref" ? (t.value as number) : undefined);
const listVal = (t?: Token): Token[] => (t && t.kind === "list" ? (t.value as Token[]) : []);

function lastNumber(args: Token[]): number | undefined {
  for (let i = args.length - 1; i >= 0; i--) if (args[i].kind === "number") return args[i].value as number;
  return undefined;
}

/* ----------------------------- main parser ----------------------------- */

function emptyIfcModel(fileName: string, fileSize: number, warnings: string[]): IfcModel {
  return {
    ok: false, fileName, fileSize, schema: "", projectName: "", author: "", organization: "",
    buildingName: "", siteName: "", storeys: [], elements: [], spaces: [], buildingArea: 0, warnings,
    entities: new Map(),
  };
}

function indexEntityRecords(records: Iterable<string>): { entities: IfcEntity[]; byId: Map<number, IfcEntity> } {
  const byId = new Map<number, IfcEntity>();
  const entities: IfcEntity[] = [];
  for (const rec of records) {
    const e = parseRecord(rec);
    if (e) { byId.set(e.id, e); entities.push(e); }
  }
  return { entities, byId };
}

const SCHEMA_RE = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/;

function assembleIfcModel(
  entities: IfcEntity[],
  byId: Map<number, IfcEntity>,
  schema: string,
  fileName: string,
  fileSize: number,
  warnings: string[],
): IfcModel {
  // header (project / org)
  let projectName = "";
  let author = "";
  let organization = "";
  for (const e of entities) {
    if (e.type === "IFCPROJECT" && !projectName) projectName = strVal(e.args[2]);
    if (e.type === "IFCORGANIZATION" && !organization) organization = strVal(e.args[1]);
    if (e.type === "IFCPERSON" && !author) {
      const fam = strVal(e.args[2]);
      const giv = strVal(e.args[1]);
      author = `${fam}${giv ? ", " + giv : ""}`.trim();
    }
  }

  // storeys
  const storeys: { id: number; name: string; elevation: number }[] = [];
  for (const e of entities) {
    if (e.type === "IFCBUILDINGSTOREY") {
      const name = strVal(e.args[2]) || strVal(e.args[7]);
      const elevation = numVal(e.args[9]) ?? 0;
      storeys.push({ id: e.id, name: name || "Geschoss", elevation });
    }
  }
  const storeyNameById = new Map<number, string>();
  storeys.forEach((s) => storeyNameById.set(s.id, s.name));

  // element → storey via containment
  const elementStorey = new Map<number, number>();
  for (const e of entities) {
    if (e.type === SPATIAL_CONTAINMENT) {
      const rel = refVal(e.args[5]);
      const related = listVal(e.args[4]).map(refVal).filter((x): x is number => x !== undefined);
      for (const r of related) if (rel !== undefined) elementStorey.set(r, rel);
    }
  }

  // quantity sets: propertyDefinition id -> quantity entity ids
  const propDefQuants = new Map<number, number[]>();
  for (const e of entities) {
    if (e.type === ELEMENT_QUANTITY) {
      const quants = listVal(e.args[5]).map(refVal).filter((x): x is number => x !== undefined);
      propDefQuants.set(e.id, quants);
    }
  }
  // element -> quantity entity ids
  const elementQuants = new Map<number, number[]>();
  for (const e of entities) {
    if (e.type === REL_DEF_PROPS) {
      const pd = refVal(e.args[5]);
      const related = listVal(e.args[4]).map(refVal).filter((x): x is number => x !== undefined);
      if (pd !== undefined && propDefQuants.has(pd)) {
        for (const r of related) {
          const arr = elementQuants.get(r) ?? [];
          arr.push(...(propDefQuants.get(pd) ?? []));
          elementQuants.set(r, arr);
        }
      }
    }
  }

  const parseQuantityEntity = (q: IfcEntity): { name: string; value?: number } => {
    const name = strVal(q.args[0]).toLowerCase();
    const value = lastNumber(q.args);
    return { name, value };
  };

  const collectQty = (quantIds: number[]): ParsedQuantity => {
    const q: ParsedQuantity = {};
    const seen = new Set<number>();
    for (const id of quantIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const ent = byId.get(id);
      if (!ent) continue;
      const { name, value } = parseQuantityEntity(ent);
      if (value === undefined) continue;
      if (/(length|perimeter|länge|longueur|len)/i.test(name) && q.length === undefined) q.length = value;
      else if (/(width|thickness|depth|breite|dicke|largeur|epaisseur|wid)/i.test(name) && q.width === undefined) q.width = value;
      else if (/(height|höhe|hauteur|hgt)/i.test(name) && q.height === undefined) q.height = value;
      else if (/(count|anzahl|nombre|qty)/i.test(name) && q.count === undefined) q.count = value;
      else if (/(weight|mass|gewicht|poids)/i.test(name) && q.weight === undefined) q.weight = value;
      else if (/(volume|vol)/i.test(name) && q.volume === undefined) q.volume = value;
      else if (/(area|footprint|foot|fläche|flache|surface)/i.test(name) && q.area === undefined) q.area = value;
    }
    return q;
  };

  const elements: IfcElement[] = [];
  const spaces: IfcElement[] = [];
  for (const e of entities) {
    if (!ELEMENT_TYPES.has(e.type)) continue;
    const storeyId = elementStorey.get(e.id);
    const storey = storeyId !== undefined ? storeyNameById.get(storeyId) ?? "—" : "—";
    const rec: IfcElement = {
      id: e.id,
      globalId: strVal(e.args[0]),
      type: e.type,
      name: strVal(e.args[2]),
      longName: strVal(e.args[7]),
      predefinedType: strVal(e.args[4]) || (e.args[9]?.kind === "enum" ? (e.args[9].value as string) : ""),
      storey,
      qty: collectQty(elementQuants.get(e.id) ?? []),
    };
    if (e.type === "IFCSPACE") spaces.push(rec);
    else elements.push(rec);
  }

  // NGF: prefer sum of space net floor area
  let ngf = 0;
  for (const s of spaces) {
    if (s.qty.area && s.qty.area > 0) ngf += s.qty.area;
  }
  if (ngf === 0) {
    // fallback: storey areas
    for (const st of storeys) {
      const q = collectQty(elementQuants.get(st.id) ?? []);
      if (q.area) ngf += q.area;
    }
  }

  if (elements.length === 0) warnings.push("Keine quantifizierbaren Bauteile (Wand/Decke/Stütze/…) mit Mengen gefunden.");
  warnings.push(...ifcSchemaHinweise(schema));

  return {
    ok: true,
    fileName,
    fileSize,
    schema,
    projectName: projectName || fileName,
    author: author || "—",
    organization: organization || "—",
    buildingName: "Gebäude aus Modell",
    siteName: "Standort aus Modell",
    storeys: storeys.map((s) => ({ name: s.name, elevation: s.elevation })),
    elements,
    spaces,
    buildingArea: ngf,
    warnings,
    entities: byId,
  };
}

export function parseIfc(text: string, fileName: string, fileSize: number): IfcModel {
  const warnings: string[] = [];

  const dataStart = text.indexOf("DATA;");
  const dataEnd = text.indexOf("ENDSEC;", dataStart);
  if (dataStart < 0 || dataEnd < 0) {
    warnings.push("Kein DATA-Abschnitt gefunden — keine gültige IFC-STEP-Datei.");
    return emptyIfcModel(fileName, fileSize, warnings);
  }
  const data = text.slice(dataStart + 5, dataEnd);
  const { entities, byId } = indexEntityRecords(splitStepRecords(data));
  if (entities.length === 0) {
    warnings.push("Keine IFC-Entitäten im DATA-Abschnitt erkannt.");
    return emptyIfcModel(fileName, fileSize, warnings);
  }

  const schemaMatch = text.match(SCHEMA_RE);
  const schema = schemaMatch ? schemaMatch[1] : "IFC";
  return assembleIfcModel(entities, byId, schema, fileName, fileSize, warnings);
}

/* ------------------------- streaming byte parser ----------------------- *
 * Variante à empreinte mémoire réduite : au lieu de convertir TOUT le
 * fichier en chaîne UTF-16 (≈ 2× la taille du fichier) puis de re-couper le
 * DATA en sous-chaînes (≈ 1× de plus), on scanne les marqueurs STEP au
 * niveau des octets et on décode des fenêtres de quelques Mo, chaque
 * enregistrement étant indexé puis libéré immédiatement. Le pic mémoire du
 * Worker passe de ~3× la taille du fichier à ~0,1× + le graphe d'entités —
 * décisif sur les postes dont la RAM est déjà saturée par la stack Docker.
 * ----------------------------------------------------------------------- */

const STREAM_CHUNK_SIZE = 4 * 1024 * 1024;
const DATA_MARKER = new TextEncoder().encode("DATA;");
const ENDSEC_MARKER = new TextEncoder().encode("ENDSEC;");

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromPos: number): number {
  const first = needle[0];
  const last = haystack.length - needle.length;
  let pos = haystack.indexOf(first, fromPos);
  while (pos >= 0 && pos <= last) {
    let match = true;
    for (let k = 1; k < needle.length; k++) {
      if (haystack[pos + k] !== needle[k]) { match = false; break; }
    }
    if (match) return pos;
    pos = haystack.indexOf(first, pos + 1);
  }
  return -1;
}

/**
 * Découpe incrémentale d'enregistrements STEP (`;` hors chaînes, quotes
 * doublées gérées — y compris lorsqu'elles chevauchent deux fenêtres).
 */
class StepRecordStreamer {
  private carry = "";
  private inString = false;

  push(chunkText: string, isFinal: boolean): string[] {
    const pending = this.carry + chunkText;
    const out: string[] = [];
    let start = 0;
    let index = 0;
    while (index < pending.length) {
      const char = pending[index];
      if (char === "'") {
        if (this.inString) {
          if (index + 1 < pending.length) {
            if (pending[index + 1] === "'") {
              index += 2; // quote échappée : reste dans la chaîne
              continue;
            }
            this.inString = false;
          } else if (!isFinal) {
            break; // frontière de fenêtre : décision reportée au prochain push
          } else {
            this.inString = false;
          }
        } else {
          this.inString = true;
        }
      } else if (char === ";" && !this.inString) {
        out.push(pending.slice(start, index));
        start = index + 1;
      }
      index += 1;
    }
    if (isFinal) {
      const tail = pending.slice(start);
      this.carry = "";
      if (tail.length > 0) out.push(tail);
    } else {
      this.carry = pending.slice(start);
    }
    return out;
  }
}

export function parseIfcBytes(
  bytes: Uint8Array,
  fileName: string,
  chunkSize: number = STREAM_CHUNK_SIZE,
): IfcModel {
  const fileSize = bytes.byteLength;
  const warnings: string[] = [];

  const dataStart = indexOfBytes(bytes, DATA_MARKER, 0);
  const dataEnd = dataStart >= 0 ? indexOfBytes(bytes, ENDSEC_MARKER, dataStart) : -1;
  if (dataStart < 0 || dataEnd < 0) {
    warnings.push("Kein DATA-Abschnitt gefunden — keine gültige IFC-STEP-Datei.");
    return emptyIfcModel(fileName, fileSize, warnings);
  }

  const decoder = new TextDecoder("utf-8");
  const headerText = decoder.decode(bytes.subarray(0, dataStart));
  const schemaMatch = headerText.match(SCHEMA_RE);
  const schema = schemaMatch ? schemaMatch[1] : "IFC";

  const streamDecoder = new TextDecoder("utf-8");
  const streamer = new StepRecordStreamer();
  const byId = new Map<number, IfcEntity>();
  const entities: IfcEntity[] = [];
  const consume = (record: string): void => {
    const e = parseRecord(record);
    if (e) { byId.set(e.id, e); entities.push(e); }
  };

  const sectionStart = dataStart + DATA_MARKER.length;
  let cursor = sectionStart;
  while (cursor < dataEnd) {
    const end = Math.min(cursor + chunkSize, dataEnd);
    const isFinal = end >= dataEnd;
    const chunkText = streamDecoder.decode(bytes.subarray(cursor, end), { stream: !isFinal });
    for (const record of streamer.push(chunkText, isFinal)) consume(record);
    cursor = end;
  }

  if (entities.length === 0) {
    warnings.push("Keine IFC-Entitäten im DATA-Abschnitt erkannt.");
    return emptyIfcModel(fileName, fileSize, warnings);
  }

  return assembleIfcModel(entities, byId, schema, fileName, fileSize, warnings);
}
