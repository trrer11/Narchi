/** §77 — garde-fous purs du branding bureau (validation réelle : serveur). */
import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, validateLogoFile } from "./branding";

describe("branding — validateLogoFile (§77)", () => {
  it("TEST-077-A : PNG et JPEG acceptés, SVG refusé honnêtement (XSS)", () => {
    expect(validateLogoFile({ type: "image/png", size: 12_000 })).toBeNull();
    expect(validateLogoFile({ type: "image/jpeg", size: 12_000 })).toBeNull();
    expect(validateLogoFile({ type: "image/svg+xml", size: 200 })).toContain("SVG");
    expect(validateLogoFile({ type: "application/pdf", size: 200 })).toContain("PNG");
  });

  it("TEST-077-B : surpoids refusé avec la taille DITE, borne incluse, vide refusé", () => {
    const err = validateLogoFile({ type: "image/png", size: MAX_LOGO_BYTES + 1 });
    expect(err).toContain("512 kB");
    expect(err).toContain(`${Math.ceil((MAX_LOGO_BYTES + 1) / 1024)} kB`); // taille réelle affichée
    expect(validateLogoFile({ type: "image/png", size: MAX_LOGO_BYTES })).toBeNull(); // borne incluse
    expect(validateLogoFile({ type: "image/png", size: 0 })).toContain("leer");
  });

  it("TEST-077-C : limite accordée avec le serveur — exactement 512 ko binaires", () => {
    expect(MAX_LOGO_BYTES).toBe(512 * 1024);
  });

  it("TEST-077-D : aucune chaîne CJK dans les messages", () => {
    const msgs = [
      validateLogoFile({ type: "image/svg+xml", size: 1 }),
      validateLogoFile({ type: "image/png", size: MAX_LOGO_BYTES + 1 }),
      validateLogoFile({ type: "image/png", size: 0 }),
    ].join(" ");
    expect(msgs).not.toMatch(/[\u4e00-\u9fff\u3040-\u30ff]/);
  });
});
