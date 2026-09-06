import { describe, expect, it } from "vitest";
import { invoiceBuyerFromProject } from "@/lib/invoiceBuyer";

describe("invoiceBuyerFromProject (§220)", () => {
  it("prend le client et l'adresse saisie, pas d'invention", () => {
    const b = invoiceBuyerFromProject({
      client: "Familie Meyer",
      name: "Anbau EG",
      location: "Celle, DE",
      clientStreet: "Markt 3",
      clientZip: "30159",
      clientCity: "Hannover",
      clientLeitweg: "0204:991-12345-67",
    });
    expect(b.buyer_name).toBe("Familie Meyer");
    expect(b.buyer_street).toBe("Markt 3");
    expect(b.buyer_zip).toBe("30159");
    expect(b.buyer_city).toBe("Hannover");
    expect(b.buyer_reference).toBe("0204:991-12345-67");
    expect(b.note).not.toContain("Straße");
  });

  it("sans rue : ville depuis location, note liste les manques", () => {
    const b = invoiceBuyerFromProject({
      client: "Familie Meyer",
      location: "Hannover, DE",
    });
    expect(b.buyer_city).toBe("Hannover");
    expect(b.buyer_street).toBeUndefined();
    expect(b.note).toContain("Straße");
    expect(b.note).toContain("Leitweg-ID");
  });

  it("sans client → nom du projet", () => {
    expect(invoiceBuyerFromProject({ name: "EFH Demo" }).buyer_name).toBe("EFH Demo");
  });
});
