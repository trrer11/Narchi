import { describe, expect, it } from "vitest";
import { ifcSchemaFamille, ifcSchemaHinweise } from "@/lib/ifcSchema";

describe("ifcSchema §243", () => {
  it("erkennt 4.3 Varianten", () => {
    expect(ifcSchemaFamille("IFC4X3_ADD2")).toBe("ifc4x3");
    expect(ifcSchemaFamille("IFC4X3")).toBe("ifc4x3");
  });
  it("2x3 bleibt Familie 2x3, nicht abgelehnt", () => {
    expect(ifcSchemaFamille("IFC2X3")).toBe("ifc2x3");
    expect(ifcSchemaHinweise("IFC2X3").join(" ")).toContain("akzeptiert");
  });
});
