/** §243 — FILE_SCHEMA honnête. IFC 2x3 reste accepté. 4.3 reconnu. */

export type IfcSchemaFamille = "ifc2x3" | "ifc4" | "ifc4x3" | "inconnu";

export function ifcSchemaFamille(raw: string): IfcSchemaFamille {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.includes("IFC4X3") || s.includes("IFC43")) return "ifc4x3";
  if (s.startsWith("IFC4")) return "ifc4";
  if (s.includes("IFC2X3") || s === "IFC2X" || s.includes("IFC2X2")) return "ifc2x3";
  return "inconnu";
}

export function ifcSchemaHinweise(raw: string): string[] {
  const fam = ifcSchemaFamille(raw);
  const out: string[] = [];
  if (fam === "ifc4x3") {
    out.push("IFC 4.3 erkannt (ISO 16739-1:2024) — Schema akzeptiert.");
  } else if (fam === "ifc2x3") {
    out.push("IFC 2x3 — akzeptiert. Öffentliche Vergabe DE zielt 2027 auf IFC 4.3; bitte aus Revit/Archicad als IFC4/4.3 exportieren wenn möglich.");
  } else if (fam === "inconnu") {
    out.push(`FILE_SCHEMA « ${raw || "—"} » nicht klassifiziert — Mengen nur wenn der Parser Entitäten liest.`);
  }
  return out;
}
