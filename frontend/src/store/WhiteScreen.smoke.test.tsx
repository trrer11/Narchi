/**
 * SMOKE TEST ANTI-PAGE-BLANCHE (P0 A1-1)
 * Monte reellement les pages qui crashaient (TypeError sur cles manquantes).
 * Si une seule leve une exception au rendu => test rouge => merge bloque.
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { createElement } from "react";
import { useApp } from "@/store/AppStore";

function Probe() {
  const app = useApp();
  const checks = [
    app.typologies.length,
    app.regions.length,
    app.qualities.length,
    app.costResult.netTotal,
    app.costResult.lines300.length,
    app.hoaiResult,
    app.energyResult.HWB,
    app.kpis.totalElements,
    app.schedule.length,
    app.milestones.length,
    app.risks.length,
    app.compliance.length,
    app.sources.length,
    app.activeElements.length,
    app.activeIssues.length,
    app.activeLevels.length,
    app.activeProject.name,
    app.country.currency,
    app.unreadCount,
    app.estimateForProject("inexistant"),
    app.getMaterial("inexistant"),
  ];
  return createElement("div", { "data-ok": checks.length });
}

describe("Anti page blanche - contrat useApp() complet", () => {
  it("monte un composant consommant TOUTES les cles heritees sans crash", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    expect(() => {
      act(() => { root.render(createElement(Probe)); });
    }).not.toThrow();
    expect(host.querySelector("[data-ok]")).not.toBeNull();
    act(() => root.unmount());
  });

  it("costResult est un vrai calcul DIN 276 (netTotal > 0, KG 300 ventile)", async () => {
    const { deriveCostResult } = await import("@/store/LegacyDerivedSlice");
    const r = deriveCostResult({
      typologyId: "mfh", ngf: 4200, regionId: "de-muc", qualityId: "standard",
      year: 2026, includeVat: true, includeLand: false, landValue: 0,
      untergeschosse: 1, obergeschosse: 5, bauweiseId: "massiv",
      energiestandardId: "kfw55",
    });
    expect(r.netTotal).toBeGreaterThan(0);
    expect(r.kg300).toBeGreaterThan(0);
    expect(r.lines300.length).toBeGreaterThan(0);
    expect(r.grossTotal).toBeGreaterThan(r.netTotal);
  });

  it("kpis retombe sur des zeros sains quand le store est vide", async () => {
    const { deriveKpis } = await import("@/store/LegacyDerivedSlice");
    const k = deriveKpis([], [], [], []);
    expect(k.totalElements).toBe(0);
    expect(k.portfolioValue).toBe(0);
    expect(k.complianceScore).toBe(0);
    expect(Number.isNaN(k.validatedPct)).toBe(false);
  });
});
