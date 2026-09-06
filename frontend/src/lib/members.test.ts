/** §80 — matrice Büro 3 niveaux, miroir du serveur (les deux cassent ensemble). */
import { describe, expect, it } from "vitest";
import { canEditTarget, onceCredentialsText, roleCapabilities, roleLabel, statusLabel } from "./members";

describe("members — matrice de rôles (§80, spécification utilisateur)", () => {
  it("TEST-080-A : capabilities exactes — owner tout, admin sans rôles, membre rien", () => {
    expect(roleCapabilities("owner")).toEqual({ canManageMembers: true, canInvite: true, canChangeRoles: true });
    expect(roleCapabilities("admin")).toEqual({ canManageMembers: true, canInvite: true, canChangeRoles: false });
    expect(roleCapabilities("architect")).toEqual({ canManageMembers: false, canInvite: false, canChangeRoles: false });
    expect(roleCapabilities("guest")).toEqual({ canManageMembers: false, canInvite: false, canChangeRoles: false });
  });

  it("TEST-080-B : canEditTarget — admin jamais sur owner/admin, owner jamais sur owner", () => {
    expect(canEditTarget("owner", "admin")).toBe(true);
    expect(canEditTarget("owner", "architect")).toBe(true);
    expect(canEditTarget("owner", "owner")).toBe(false);      // ni soi ni autre owner ici
    expect(canEditTarget("admin", "architect")).toBe(true);
    expect(canEditTarget("admin", "admin")).toBe(false);
    expect(canEditTarget("admin", "owner")).toBe(false);
    expect(canEditTarget("architect", "architect")).toBe(false);
  });

  it("TEST-080-C : libellés DE honnêtes + statut", () => {
    expect(roleLabel("owner").label).toBe("Eigentümer");
    expect(roleLabel("admin").label).toBe("Geschäftsführung");
    expect(roleLabel("architect").label).toBe("Mitglied");
    expect(statusLabel(true)).toBe("aktiv");
    expect(statusLabel(false)).toBe("deaktiviert");
  });

  it("TEST-080-D : texte d'identifiants complet, aucune chaîne CJK", () => {
    const text = onceCredentialsText("Anna", "anna@büro.de", "geheim123");
    expect(text).toContain("anna@büro.de");
    expect(text).toContain("geheim123");
    expect([text, roleLabel("admin").label, statusLabel(false)].join(" "))
      .not.toMatch(/[\u4e00-\u9fff\u3040-\u30ff]/);
  });
});
