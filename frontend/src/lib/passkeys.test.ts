import { describe, expect, it } from "vitest";
import { bufToB64url, b64urlToBuf } from "./passkeys";

describe("passkeys §246", () => {
  it("b64url roundtrip", () => {
    const src = new Uint8Array([0, 1, 255, 16]).buffer;
    const s = bufToB64url(src);
    expect(s).not.toContain("+");
    expect(s).not.toContain("/");
    expect(new Uint8Array(b64urlToBuf(s))).toEqual(new Uint8Array(src));
  });
});
