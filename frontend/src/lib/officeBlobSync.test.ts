import { describe, expect, it } from "vitest";

import { mergeZahlungen } from "./officeBlobSync";

describe("mergeZahlungen", () => {
  it("bezahlt gagne sur offen distant", () => {
    expect(mergeZahlungen({ a: "bezahlt" }, { a: "offen", b: "offen" })).toEqual({
      a: "bezahlt",
      b: "offen",
    });
  });

  it("bezahlt distant ecrase offen local", () => {
    expect(mergeZahlungen({ a: "offen" }, { a: "bezahlt" })).toEqual({ a: "bezahlt" });
  });
});
