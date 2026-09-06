import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./e2e/base";

/**
 * §121 — Suite E2E navigateur RÉEL (Chromium) contre la stack RÉELLE
 * (nginx + FastAPI + PostgreSQL + Redis), lancée par `npm run e2e`.
 *
 * Lois de la maison, rappelées ici parce que ce fichier les matérialise :
 *  - UN SEUL worker : les 4 volets partagent UN serveur et UNE base (comme
 *    deux appareils d'un même bureau) ; la RAM de la machine cible (PC de
 *    bureau Windows) tolère un navigateur, pas un parc.
 *  - ZÉRO retry : un test qui a besoin d'une seconde chance cache un bug —
 *    on préfère un rouge honnête à un vert maquillé.
 *  - AUCUN waitForTimeout magique : chaque attente est un expect.poll ou un
 *    toBeVisible avec échéance explicite (la cause d'un échec reste lisible).
 *  - La stack doit être démarrée AVANT (chez le client : 1_DEMARRER_NARCHI.bat ;
 *    en CI/sandbox : nginx + uvicorn + PostgreSQL + Redis, cf. e2e/README.md).
 *    Le healthcheck global ci-dessous REFUSE de maquiller une stack absente
 *    en faux échec applicatif : il le dit et arrête tout.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    locale: "de-DE",
    // §191 — PWA §101 : un SW peut servir un index.html SANS le hash
    // (Landing, pas de username). Playwright le documente : bloquer les
    // service workers en test = session propre, comme un 1er visiteur.
    serviceWorkers: "block",
    launchOptions: {
      args: [
        "--unsafely-treat-insecure-origin-as-secure=http://host.docker.internal:8080",
        "--unsafely-treat-insecure-origin-as-secure=http://narchi.localhost:8080",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
