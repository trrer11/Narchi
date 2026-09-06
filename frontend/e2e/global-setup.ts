import { request } from "@playwright/test";

import { BASE_URL } from "./base";

/**
 * §121 — Garde-fou honnêteté : la suite E2E exige la VRAIE stack
 * (nginx → FastAPI → PostgreSQL). Sans elle, chaque test échouerait avec des
 * messages de navigation abscons qui feraient croire à un bug PRODUIT alors
 * que c'est l'environnement qui manque. On refuse de démarrer, et on dit
 * exactement quoi lancer.
 */
export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL, timeout: 5_000 });
  try {
    const spa = await ctx.get("/");
    if (!spa.ok()) {
      throw new Error(`HTTP ${spa.status()}`);
    }
    // Le backend RÉEL doit répondre à travers nginx (pas seulement le HTML).
    const api = await ctx.get("/api/health");
    if (!api.ok()) {
      throw new Error(`/api/health → HTTP ${api.status()}`);
    }
  } catch (e) {
    throw new Error(
      [
        `[E2E] Aucune stack NARCHI joignable sur ${BASE_URL}.`,
        "  Chez vous (Windows) : double-cliquez 1_DEMARRER_NARCHI.bat puis attendez",
        "  que http://localhost:8080 affiche la page de connexion, et relancez `npm run e2e`.",
        "  Sans stack démarrée cette suite ne Prouve rien : on préfère ne rien dire.",
        `  Détail: ${e instanceof Error ? e.message : String(e)}`,
      ].join("\n"),
    );
  } finally {
    await ctx.dispose();
  }
}
