import { describe, expect, it } from "vitest";
import { legalIsFilled, parseOfficeLegal } from "@/lib/officeLegal";

describe("officeLegal", () => {
  it("ignore les champs inventés / non-string", () => {
    const l = parseOfficeLegal({ firma: "Atelier X", email: 12, extra: "nope" });
    expect(l.firma).toBe("Atelier X");
    expect(l.email).toBe("");
  });
  it("filled seulement si firma+adresse+email", () => {
    expect(legalIsFilled(parseOfficeLegal({ firma: "A", strasse: "B 1", plzOrt: "30159 Hannover", email: "a@b.de" }))).toBe(true);
    expect(legalIsFilled(parseOfficeLegal({ firma: "A" }))).toBe(false);
  });
});
