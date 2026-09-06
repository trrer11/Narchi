import { describe, expect, it } from "vitest";
import { applyModellZumBuero } from "@/lib/applyModellZumBuero";

describe("applyModellZumBuero §239", () => {
  it("NGF 0 bleibt 0", () => {
    const r = applyModellZumBuero({ ngf: 0, storeys: ["EG"], volume: 0 });
    expect(r.ngf).toBe(0);
    expect(r.quelle).toBe("keine");
    expect(r.hinweis).toContain("0");
  });

  it("IfcSpace-Fläche ist Messung", () => {
    const r = applyModellZumBuero({ ngf: 1100, storeys: ["EG", "OG"], volume: 3000 });
    expect(r.ngf).toBe(1100);
    expect(r.geschosse).toBe(2);
    expect(r.quelle).toBe("messung");
  });
});
