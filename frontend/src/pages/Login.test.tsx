/**
 * §100 — Écran de connexion : vérité §36 + une seule langue.
 *
 * Épingle ce que la pass visuel/vérité a corrigé :
 * - TOUT en allemand (marché cible ; le mode registrieren l'était déjà,
 *   la connexion était restée en français) ;
 * - AUCUNE affirmation non prouvable (« certifié DIN 276 », « Zero-Leak »,
 *   pastille « Production V5 ») — remplacées par des faits vérifiables
 *   dans le code (Argon2id, auto-hébergement, Destatis 61261, DIN 276,
 *   GAEB X31/X83, invitations 72 h) ;
 * - le bouton œil porte un aria-label et bascule RÉELLEMENT le type du
 *   champ (avant : icône loupe « search » sans aria) ;
 * - la bascule login ⇄ register reste allemande dans les deux sens.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import Login from "@/pages/Login";
import { AuthProvider } from "@/store/AuthStore";

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(AuthProvider, null, createElement(Login, { onDone: () => {} })));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { host, root };
}

describe("Login — §100 pass visuel + vérité", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  });

  it("est intégralement en allemand et sans affirmation inventée", async () => {
    const { host, root } = await mount();
    const text = host.textContent ?? "";
    // Langue : plus AUCUNE trace de l'ancien écran français.
    expect(text).toContain("Anmelden");
    expect(text).toContain("Mit Ihrem Büro-Konto anmelden.");
    expect(text).not.toContain("Connexion");
    expect(text).not.toContain("Se connecter");
    expect(text).not.toContain("Mot de passe");
    expect(text).not.toContain("Saisissez vos identifiants");
    // Vérité §36 : les slogans invérifiables sont PARTIS.
    expect(text).not.toContain("Zero-Leak");
    expect(text).not.toContain("certifié DIN 276");
    expect(text).not.toContain("Production V5");
    // À leur place : uniquement des faits vérifiables dans le code.
    expect(text).toContain("Argon2id");
    expect(text).toContain("Selbst gehostet");
    expect(text).toContain("DIN 276");
    expect(text).toContain("GAEB X31/X83");
    expect(text).toContain("Destatis 61261");
    expect(text).toContain("72 h");
    expect(text).toContain("NARCHI — Software für Architekturbüros");
    act(() => root.unmount());
    host.remove();
  });

  it("le bouton œil bascule réellement password ⇄ text avec aria-label", async () => {
    const { host, root } = await mount();
    const pwd = host.querySelector<HTMLInputElement>("#login-password");
    const eyeBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Passwort anzeigen"]');
    expect(pwd).not.toBeNull();
    expect(pwd!.type).toBe("password");
    expect(eyeBtn).not.toBeNull();
    await act(async () => { eyeBtn!.click(); });
    expect(pwd!.type).toBe("text");
    expect(host.querySelector('button[aria-label="Passwort verbergen"]')).not.toBeNull();
    await act(async () => {
      (host.querySelector<HTMLButtonElement>('button[aria-label="Passwort verbergen"]'))!.click();
    });
    expect(pwd!.type).toBe("password");
    act(() => root.unmount());
    host.remove();
  });

  it("la bascule vers registrieren reste allemande (Name, optional, toggle)", async () => {
    const { host, root } = await mount();
    const toggle = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Noch kein Konto? Registrieren",
    );
    expect(toggle).toBeDefined();
    await act(async () => { toggle!.click(); });
    const text = host.textContent ?? "";
    expect(text).toContain("Konto erstellen");
    expect(text).toContain("Eigenen Testbereich anlegen — kostenlos, ohne Karte.");
    expect(text).toContain("Passwort (min. 8 Zeichen)");
    expect(text).toContain("(optional)");
    expect(text).toContain("Schon registriert? Anmelden");
    expect(text).not.toContain("Connexion");
    // Et le retour : toujours allemand.
    const back = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Schon registriert? Anmelden",
    );
    await act(async () => { back!.click(); });
    expect(host.textContent).toContain("Mit Ihrem Büro-Konto anmelden.");
    act(() => root.unmount());
    host.remove();
  });

  it("lien d'invitation ?invite=… : mode registrieren + bandeau 72 h", async () => {
    window.history.replaceState(null, "", "/?invite=jeton-signe-de-test");
    const { host, root } = await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("Konto erstellen");
    expect(text).toContain("Einladung erkannt — sie ist 72 h gültig");
    expect(text).toContain("Ihr Konto wird dem Arbeitsraum des Einladenden hinzugefügt.");
    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
  });
});
