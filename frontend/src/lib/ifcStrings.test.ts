import { describe, expect, it } from "vitest";
import { decodeIfcEscapes, tokenizeArgs } from "@/lib/ifcParser";

describe("decodeIfcEscapes — chaînes IFC lisibles (fin du « B\\X\\E9ton »)", () => {
  it("\\X\\HH : octet ISO-8859-1 → caractère", () => {
    expect(decodeIfcEscapes("Sol:B\\X\\E9ton 160 mm")).toBe("Sol:Béton 160 mm");
    expect(decodeIfcEscapes("platelage m\\X\\E9tallique")).toBe("platelage métallique");
    expect(decodeIfcEscapes("Au\\X\\DFenwand")).toBe("Außenwand");
    expect(decodeIfcEscapes("f\\X\\FCr")).toBe("für");
  });

  it("\\X2\\XXXX\\X0\\ : séquence Unicode BMP", () => {
    expect(decodeIfcEscapes("\\X2\\00E900C4\\X0\\")).toBe("éÄ");
  });

  it("\\X4\\XXXXXXXX\\X0\\ : séquence astrale", () => {
    expect(decodeIfcEscapes("\\X4\\0001F3D7\\X0\\")).toBe("🏗");
  });

  it("chaîne sans échappement : inchangée (fast path)", () => {
    expect(decodeIfcEscapes("IFCWALL")).toBe("IFCWALL");
  });

  it("intégration tokenizer : les apostrophes '' restent valides", () => {
    const tokens = tokenizeArgs("'C\\X\\E4ble d''acier',5");
    expect(tokens[0]).toEqual({ kind: "string", value: "Cäble d'acier" });
  });
});
