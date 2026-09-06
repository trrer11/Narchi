/**
 * §101 — Tests PWA (#10). Pas de faux « ça marche » : on épingle
 *  1. le CONTRAT du service worker (lu depuis le fichier réel public/sw.js) ;
 *  2. le manifeste (parsé) et l'EXISTENCE physique des icônes PNG ;
 *  3. la correspondance des raccourcis avec de VRAIES routes du cockpit ;
 *  4. la pureté du module (aucun import React/DOM au chargement — un import
 *     de lib ne doit jamais enregistrer un SW en test/dev) et la machine
 *     d'état de la pastille de mise à jour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolutionForRegistration, PWA_SW_URL } from "@/lib/pwa";

// Les gates courent depuis frontend/ (README §2) — chemins parlants,
// jamais import.meta.url (schéma non-fichier sous vitest, attrapé au test).
const PUBLIC_DIR = resolve(process.cwd(), "public");
const swSource = readFileSync(`${PUBLIC_DIR}/sw.js`, "utf-8");
const manifest = JSON.parse(readFileSync(`${PUBLIC_DIR}/manifest.json`, "utf-8"));
const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
const shellSource = readFileSync(
  resolve(process.cwd(), "src/pages/dashboard/DashboardShell.tsx"),
  "utf-8",
);

describe("§101 — contrat du service worker (public/sw.js)", () => {
  it("version de cache datée et bumpée (narchi-shell-vN)", () => {
    expect(swSource).toMatch(/const CACHE_VERSION = "narchi-shell-v\d+";/);
  });

  it("ne met JAMAIS en cache /api/ ni le non-GET", () => {
    expect(swSource).toContain('url.pathname.startsWith("/api/")');
    expect(swSource).toContain('request.method === "GET"');
  });

  it("navigation network-first avec repli hors-ligne sur la coquille", () => {
    expect(swSource).toContain('cache: "no-store"');
    expect(swSource).toContain("networkFirstShell");
    expect(swSource).toContain("ignoreSearch: true");
  });

  it("gère le message SKIP_WAITING (prompt utilisateur) et skipWaiting()", () => {
    expect(swSource).toContain("SKIP_WAITING");
    expect(swSource).toContain("self.skipWaiting()");
  });

  it("purge strictement les anciens caches à l'activation", () => {
    expect(swSource).toContain("caches.delete(name)");
    expect(swSource).toContain("self.clients.claim()");
  });

  it("est servi là où le code le cherche", () => {
    expect(PWA_SW_URL).toBe("/sw.js");
    expect(existsSync(`${PUBLIC_DIR}/sw.js`)).toBe(true);
  });
});

describe("§101 — manifeste installable & icônes RÉELLES", () => {
  it("champs d'installation PWA", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/#/app/overview");
    expect(manifest.lang).toBe("de");
    expect(manifest.theme_color).toBe("#f59e0b");
    expect(manifest.background_color).toBe("#05070f");
    expect(manifest.short_name).toBe("Narchi");
  });

  it("icônes PNG 192+512 (any ET maskable) référencées… et présentes sur disque", () => {
    const icons: Array<{ src: string; sizes: string; purpose?: string }> = manifest.icons;
    const bySrc = new Map(icons.map((i) => [i.src, i]));
    for (const src of ["/icon-192.png", "/icon-512.png", "/icon-maskable-192.png", "/icon-maskable-512.png"]) {
      const icon = bySrc.get(src);
      expect(icon, `${src} référencé`).toBeDefined();
      expect(existsSync(`${PUBLIC_DIR}${src}`), `${src} existe`).toBe(true);
    }
    expect(bySrc.get("/icon-maskable-512.png")!.purpose).toBe("maskable");
    expect(bySrc.get("/icon-512.png")!.purpose).toBe("any");
    // La variante SVG reste servie (écrans denses) mais ne porte plus
    // « maskable » toute seule — les PNG maskables existent pour ça.
    expect(bySrc.get("/icon.svg")!.purpose).toBe("any");
  });

  it("les raccourcis pointent des pages RÉELLES du cockpit (aucun lien mort)", () => {
    const ids = (manifest.shortcuts as Array<{ url: string; name: string }>).map((s) =>
      s.url.replace("/#/app/", ""),
    );
    expect(ids.length).toBe(3);
    for (const id of ids) {
      expect(shellSource, `route ${id} existe dans DashboardShell`).toContain(`id: "${id}"`);
    }
    // #10 §101 : le raccourci « GEG-Energie » a été remplacé par la
    // Preisbibliothek — moteur de prix §50-§99, raccourci du produit réel.
    expect(ids).toContain("prices");
    expect(ids).toContain("cost");
    expect(ids).toContain("import");
    // §103 — le raccourci « baustelle » (ancienne page terrain §102, idée
    // téléphone abandonnée) est RETIRÉ avec elle — jamais de lien mort
    // dans le manifeste. §104 : la nouvelle page chantier (voie bureau,
    // idée client) rouvrira un raccourci si le client le demande.
    expect(ids).not.toContain("baustelle");
  });

  it("index.html référence le manifeste et fixe la barre de thème", () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
    expect(indexHtml).toContain('<meta name="theme-color"');
  });
});

describe("§101 — pureté & pastille de mise à jour", () => {
  it("lib/pwa.ts n'importe ni React ni composant (aucun effet de bord à l'import)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/pwa.ts"), "utf-8");
    expect(src).not.toMatch(/from "react"|from 'react'|createRoot|JSX/);
  });

  it("en test/dev, l'enregistrement est un no-op sans effet de bord", async () => {
    // import.meta.env.PROD est faux sous vitest → jamais d'appel navigateur.
    const mod = await import("@/lib/pwa");
    const detach = mod.registerPwaServiceWorker({ onOutcome: () => undefined });
    expect(typeof detach).toBe("function");
    detach();
  });

  it("machine d'état : update trouvée => pastille persistante ; clean => contrôlée", () => {
    expect(resolutionForRegistration("updatefound")).toBe("pending_user");
    expect(resolutionForRegistration("clean")).toBe("controlled");
  });
});

describe("§101 — bannière de mise à jour", () => {
  it("rend ce qu'elle promet : pastille neutre par défaut (rien à rafraîchir)", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act, createElement } = await import("react");
    const { default: PwaUpdatePrompt } = await import("@/components/PwaUpdatePrompt");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(PwaUpdatePrompt));
    });
    // PROD=false en test → aucun enregistrement, pastille muette.
    expect(host.textContent ?? "").toBe("");
    act(() => root.unmount());
    host.remove();
  });
});
