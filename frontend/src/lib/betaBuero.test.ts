import { describe, expect, it, beforeEach } from "vitest";
import { absenderIstGefuellt, betaCheckliste, impressumLokalGefuellt } from "@/lib/betaBuero";

describe("betaBuero §242", () => {
  beforeEach(() => localStorage.clear());

  it("leeres Büro: Impressum/Absender falsch", () => {
    expect(impressumLokalGefuellt()).toBe(false);
    expect(absenderIstGefuellt()).toBe(false);
    const k = betaCheckliste({ projektAnzahl: 0, bauteileAktiv: 0, ngf: 0 });
    expect(k.every((s) => !s.ok)).toBe(true);
  });

  it("Absender nur mit Name+USt+IBAN", () => {
    localStorage.setItem("narchi:rechnungen:absender", JSON.stringify({ name: "Büro", vat: "DE1", iban: "DE89" }));
    expect(absenderIstGefuellt()).toBe(true);
  });
});
