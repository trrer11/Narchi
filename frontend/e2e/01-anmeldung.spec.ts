/**
 * §121 — VOLET 1 : création de compte et connexion, en allemand, pour de vrai.
 *
 * Ce que ça prouve : le formulaire public crée bien un compte (tenant Trial
 * auto), qu'un mauvais mot de passe est REFUSÉ À L'ÉCRAN (pas avalé en
 * silence), et que le bon mot de passe ouvre le cockpit — le tout contre le
 * VRAI backend (Argon2id, cookie HttpOnly, PostgreSQL), pas contre une maquette.
 */
import { expect, test } from "@playwright/test";

import { appUrl } from "./base";
import { E2E_PASSWORD, registerViaUi, uniqueEmail } from "./helpers";

test("Konto erstellen → falsches Passwort sichtbar abgelehnt → echte Anmeldung", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("auth");

  // 1) Création de compte via le formulaire réel.
  await registerViaUi(page, { email, name: "E2E Architektin", firma: "E2E Büro GmbH" });
  await expect(page.getByRole("button", { name: "Nouveau projet" })).toBeVisible();

  // 2) Un DEUXIÈME appareil (contexte navigateur neuf, zéro cookie) se trompe
  //    de mot de passe : l'erreur doit être VISIBLE et l'écran de connexion
  //    doit rester (jamais d'entrée silencieuse dans le cockpit).
  const falsch = await browser.newContext();
  const p2 = await falsch.newPage();
  try {
    await p2.goto(appUrl("/app/projects"));
    await p2.locator('input[name="username"]').fill(email);
    await p2.locator('input[name="password"]').fill("falsches-passwort-123");
    await p2.getByRole("button", { name: "Anmelden", exact: true }).click();
    const fehler = p2.locator("div.border-rose-200.bg-rose-50");
    await expect(fehler).toBeVisible();
    await expect(fehler).toContainText(/incorrects|falsch|ungültig/i);
    // Toujours sur l'écran de connexion :
    await expect(p2.locator('input[name="username"]')).toBeVisible();

    // 3) Le BON mot de passe ouvre le cockpit sur ce même deuxième appareil.
    await p2.locator('input[name="password"]').fill(E2E_PASSWORD);
    await p2.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(p2.getByRole("button", { name: "Nouveau projet" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await falsch.close();
  }
});
