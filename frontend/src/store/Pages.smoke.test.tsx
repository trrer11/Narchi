/**
 * SMOKE TEST PAGES REELLES - monte les 4 pages qui provoquaient
 * l'ecran blanc, avec le store de production (etat vide = 1er lancement).
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, Suspense } from "react";
import { AuthProvider } from "@/store/AuthStore";

async function mountPage(loader: () => Promise<{ default: React.ComponentType }>) {
  const mod = await loader();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let error: unknown = null;
  const prev = console.error;
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("act(")) return; // bruit React test env
    prev(...args);
  };
  try {
    await act(async () => {
      // Hiérarchie de production : AuthProvider > Suspense > Page (cf. App.tsx)
      root.render(
        createElement(AuthProvider, null,
          createElement(Suspense, { fallback: null }, createElement(mod.default))),
      );
    });
  } catch (e) {
    error = e;
  } finally {
    console.error = prev;
    try { act(() => root.unmount()); } catch { /* noop */ }
    host.remove();
  }
  return error;
}

describe("Pages critiques - zero crash au premier lancement (store vide)", () => {
  it("Overview.tsx se monte sans TypeError", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/Overview"))).toBeNull();
  });
  it("CostEstimation.tsx se monte sans TypeError", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/CostEstimation"))).toBeNull();
  });
  it("Schedule.tsx se monte sans TypeError", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/Schedule"))).toBeNull();
  });
  it("HoaiHonorar.tsx se monte sans TypeError", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/HoaiHonorar"))).toBeNull();
  });
  it("GegEnergie.tsx se monte sans TypeError", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/GegEnergie"))).toBeNull();
  });
});

describe("Racine de l'application (ce que voit l'utilisateur au lancement)", () => {
  it("Legal.tsx (Impressum public) se monte sans crash", async () => {
    expect(await mountPage(() => import("@/pages/Legal"))).toBeNull();
  });
  it("Landing.tsx (premiere page affichee) se monte sans crash", async () => {
    expect(await mountPage(() => import("@/pages/Landing"))).toBeNull();
  });
  it("App.tsx complet (router + providers) se monte sans crash", async () => {
    expect(await mountPage(() => import("@/App"))).toBeNull();
  });
});

describe("Clic Anmelden / Plattform starten (navigation vers /app)", () => {
  it("DashboardShell.tsx (coquille complete du dashboard) se monte sans crash", async () => {
    window.location.hash = "#/app/dashboard/overview";
    expect(await mountPage(() => import("@/pages/dashboard/DashboardShell"))).toBeNull();
  });
  it("Feedback.tsx (2e consommateur de route.split) se monte sans crash", async () => {
    expect(await mountPage(() => import("@/pages/dashboard/Feedback"))).toBeNull();
  });
});
