/**
 * TEST ANTI-REGRESSION "page de login sautee".
 * Cause : AuthStore injectait un defaultDemoOwner quand le backend etait
 * injoignable => user jamais null => Router n'affichait jamais Login.
 * Exigence : sans cookie narchi_session valide et sans session locale,
 * l'acces a /app DOIT afficher la page d'identification.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

describe("Flux d'authentification - login obligatoire sans session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.hash = "#/app/dashboard/overview";
  });

  it("sans session : useAuth expose user=null une fois ready", async () => {
    // Backend injoignable (fetch rejette) = pire cas production.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { AuthProvider, useAuth } = await import("@/store/AuthStore");

    let snapshot: { user: unknown; ready: boolean } | null = null;
    function Probe() {
      const { user, ready } = useAuth();
      snapshot = { user, ready };
      return null;
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(AuthProvider, null, createElement(Probe)));
    });
    // Laisse le useEffect de restauration se terminer.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(true);
    // LE point du correctif : plus d'auto-connexion demo.
    expect(snapshot!.user).toBeNull();

    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("App.tsx sur /app sans session affiche l'ecran de connexion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { default: App } = await import("@/App");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(App)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    const html = host.innerHTML;
    // La coquille dashboard NE doit PAS etre montee sans session.
    expect(html).not.toContain("Portfolio");
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
