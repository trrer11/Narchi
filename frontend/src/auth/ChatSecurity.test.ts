/**
 * SUITE VITEST — ChatSecurity (SecuritySanitizer)
 * Valide la neutralisation XSS et la politique de session (Faille n°4).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  sanitizeChatMessage,
  sanitizeChatMessageStrict,
  purgeLegacyTokenStorage,
  validateXSSProtection,
  XSS_TEST_VECTORS,
} from "./SecuritySanitizer";

describe("sanitizeChatMessage — neutralisation XSS", () => {
  it("échappe les 5 caractères sensibles < > \" ' / en entités HTML", () => {
    expect(sanitizeChatMessage(`<>"'/`)).toBe("&lt;&gt;&quot;&#x27;&#x2F;");
  });

  it("échappe & en premier (pas de double-échappement)", () => {
    expect(sanitizeChatMessage("A & B")).toBe("A &amp; B");
    expect(sanitizeChatMessage("&lt;")).toBe("&amp;lt;");
  });

  it("neutralise un payload <script> complet", () => {
    const out = sanitizeChatMessage(`<script>alert("xss")</script>`);
    expect(out).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;");
    expect(out).not.toMatch(/[<>"]/);
  });

  it("neutralise l'injection d'attribut onerror", () => {
    const out = sanitizeChatMessage(`<img src=x onerror=alert(1)>`);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("&lt;img");
  });

  it("supprime les caractères de contrôle et bidi (Trojan Source)", () => {
    const out = sanitizeChatMessage("abc\u0000\u0007\u202Edef\u2066ghi");
    expect(out).toBe("abcdefghi");
  });

  it("préserve les retours à la ligne et tabulations légitimes", () => {
    expect(sanitizeChatMessage("ligne1\nligne2\tfin")).toBe("ligne1\nligne2\tfin");
  });

  it("tronque à 4000 caractères (anti-DoS d'affichage)", () => {
    const out = sanitizeChatMessage("a".repeat(10_000));
    expect(out.length).toBe(4000);
  });

  it("retourne une chaîne vide pour toute entrée non-string", () => {
    expect(sanitizeChatMessage(undefined as unknown as string)).toBe("");
    expect(sanitizeChatMessage(null as unknown as string)).toBe("");
    expect(sanitizeChatMessage(42 as unknown as string)).toBe("");
  });

  it("neutralise TOUS les vecteurs XSS de référence", () => {
    for (const vector of XSS_TEST_VECTORS) {
      const out = sanitizeChatMessage(vector);
      expect(out, `vecteur survivant : ${vector}`).not.toMatch(/[<>"']/);
    }
    expect(validateXSSProtection()).toBe(true);
  });
});

describe("sanitizeChatMessageStrict — champs à haut risque", () => {
  it("supprime les schémas d'URI exécutables", () => {
    const out = sanitizeChatMessageStrict("javascript:alert(1) vbscript:x data:text/html,evil");
    expect(out).not.toMatch(/javascript:|vbscript:|data:text\/html/i);
  });

  it("supprime les gestionnaires d'événements inline", () => {
    const out = sanitizeChatMessageStrict("onclick=steal() onload = pwn()");
    expect(out).not.toMatch(/on\w+\s*=/i);
  });

  it("échappe les backticks (injection template ES6)", () => {
    expect(sanitizeChatMessageStrict("`payload`")).toBe("&#x60;payload&#x60;");
  });
});

describe("purgeLegacyTokenStorage — politique de session cookie-only", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("supprime le token hérité narchi:session de localStorage ET sessionStorage", () => {
    localStorage.setItem("narchi:session", "eyJhbGciOiJIUzI1NiJ9.fake.jwt");
    sessionStorage.setItem("narchi:session", "eyJhbGciOiJIUzI1NiJ9.fake.jwt");
    purgeLegacyTokenStorage();
    expect(localStorage.getItem("narchi:session")).toBeNull();
    expect(sessionStorage.getItem("narchi:session")).toBeNull();
  });

  it("supprime le token distant hérité narchi:remote:token", () => {
    localStorage.setItem("narchi:remote:token", "legacy-remote-token");
    purgeLegacyTokenStorage();
    expect(localStorage.getItem("narchi:remote:token")).toBeNull();
  });

  it("préserve les clés légitimes (chatread, préférences UI)", () => {
    localStorage.setItem("narchi:chatread:u1:c1", "2026-07-06T00:00:00Z");
    localStorage.setItem("narchi:api:mode", "auto");
    purgeLegacyTokenStorage();
    expect(localStorage.getItem("narchi:chatread:u1:c1")).toBe("2026-07-06T00:00:00Z");
    expect(localStorage.getItem("narchi:api:mode")).toBe("auto");
  });

  it("après purge, AUCUN token JWT ne subsiste dans le stockage JavaScript", () => {
    localStorage.setItem("narchi:session", "jwt-a");
    sessionStorage.setItem("narchi:session", "jwt-b");
    purgeLegacyTokenStorage();
    const allKeys = [
      ...Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)),
      ...Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)),
    ];
    expect(allKeys).not.toContain("narchi:session");
    expect(allKeys).not.toContain("narchi:remote:token");
  });
});
