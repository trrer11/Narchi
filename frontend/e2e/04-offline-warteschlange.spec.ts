/**
 * §121 — VOLET 4 : le test MODE AVION du guide §120, automatisé.
 *
 * Couper le réseau (émulation Chromium `setOffline`, navigator.onLine réel)
 * → saisir un Mangel+photo → le badge doit DIRE la file (« Offline — N
 * Änderung(en) warten »), jamais « Synchronisiert ». Réseau rendu → event
 * `online` réel → la file part toute seule → badge « Synchronisiert · HH:MM »
 * (heure SERVEUR) → et on vérifie sur un SECOND appareil frais que le Mangel
 * et sa photo ont VRAIMENT rejoint le serveur (pas une file mastiquée).
 */
import { expect, test } from "@playwright/test";

import {
  createProjectViaUi,
  geheZurBaustelle,
  importiereFotoUndWaehle,
  loginViaUi,
  pruefeMangelMitEchtemFoto,
  registerViaUi,
  speichereMangel,
  syncBadge,
  uniqueEmail,
  warteBisSynchronisiert,
} from "./helpers";

test("Offline-Mangel wartet ehrlich in der Queue und wird nachgeholt", async ({
  page,
  context,
  browser,
}) => {
  const email = uniqueEmail("offline");
  const projektName = `E2E Funkloch ${Date.now()}`;
  const titel = `Mangel aus dem Funkloch (E2E ${Date.now()})`;

  await registerViaUi(page, { email });
  await createProjectViaUi(page, projektName);
  await geheZurBaustelle(page);
  await warteBisSynchronisiert(page);

  // ---- RÉSEAU COUPÉ (comme le mode avion du guide) --------------------
  await context.setOffline(true);

  // Le produit doit rester utilisable : import + Mangel sauvegardé LOCALEMENT.
  await importiereFotoUndWaehle(page);
  await speichereMangel(page, titel);

  // Le badge doit avouer la file (la poussée échoue d'office hors-ligne,
  // debounce 800 ms → phase « offline »).
  await expect
    .poll(
      async () => ((await syncBadge(page).textContent()) ?? "").replace(/\s+/g, " ").trim(),
      { timeout: 15_000, intervals: [300, 600, 1_000] },
    )
    .toMatch(/Offline — \d+ Änderung\(en\) warten/);

  // ---- RÉSEAU RENDU ----------------------------------------------------
  await context.setOffline(false);
  await warteBisSynchronisiert(page);

  // ---- PREUVE SERVEUR SUR APPAREIL FRAIS -------------------------------
  const geraetB = await browser.newContext();
  const b = await geraetB.newPage();
  try {
    await loginViaUi(b, email);
    await expect(b.getByRole("heading", { name: projektName, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await geheZurBaustelle(b);
    await pruefeMangelMitEchtemFoto(b, titel);
  } finally {
    await geraetB.close();
  }
});
