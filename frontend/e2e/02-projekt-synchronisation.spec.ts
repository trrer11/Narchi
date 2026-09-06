/**
 * §121 — VOLET 2 : « quand je crée un objet au bureau, je le vois sur
 * l'autre compte » — la plainte du client, éprouvée bout en bout.
 *
 * Appareil A : création du projet via la modale. Puis appareil B (contexte
 * navigateur NEUF : IndexedDB vide, zéro cookie — la seule façon pour le
 * projet d'y apparaître est le tirage serveur §118). Si cette preuve passe,
 * le miroir Projets fonctionne en conditions réelles.
 */
import { expect, test } from "@playwright/test";

import {
  createProjectViaUi,
  geheZurBaustelle,
  loginViaUi,
  registerViaUi,
  uniqueEmail,
  warteBisSynchronisiert,
} from "./helpers";

test("am Büro-PC angelegtes Projekt erscheint auf dem zweiten Gerät", async ({ page, browser }) => {
  const email = uniqueEmail("proj");
  const projektName = `E2E Zentrale ${Date.now()}`;

  // Appareil A (le PC du bureau) : compte neuf + projet créé à la souris.
  await registerViaUi(page, { email });
  await createProjectViaUi(page, projektName);

  // Le badge de la page Baustelle atteste que le projet a QUITTÉ l'appareil
  // (file « Projekte: 1 warten » revenue à zéro + heure serveur affichée).
  await geheZurBaustelle(page);
  await warteBisSynchronisiert(page);

  // Appareil B (le second poste) : MÊME compte, stockage vide.
  const geraetB = await browser.newContext();
  const b = await geraetB.newPage();
  try {
    await loginViaUi(b, email);
    // Le projet doit apparaître SANS aucune saisie sur B : tirage serveur §118.
    await expect(b.getByRole("heading", { name: projektName, exact: true })).toBeVisible({
      timeout: 60_000,
    });
  } finally {
    await geraetB.close();
  }
});
