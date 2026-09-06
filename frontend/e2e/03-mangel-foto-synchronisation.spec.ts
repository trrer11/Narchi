/**
 * §121 — VOLET 3 : la preuve qui vaut de l'or (celle que le guide téléphone
 * §120 demandait de faire à la main) : un Mangel AVEC PHOTO saisi sur un
 * appareil est visible sur un AUTRE appareil, photo DÉCODÉE par le navigateur.
 *
 * Enjeu §118 : le texte du Mangel voyage par la synchro des issues, la PHOTO
 * par le versement média + pull-through au premier affichage. `naturalWidth
 * > 0` prouve que Chromium a reçu ET décodé de vrais octets JPEG depuis le
 * serveur — pas une vignette décorative.
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
  uniqueEmail,
  warteBisSynchronisiert,
} from "./helpers";

test("Mangel mit Foto erscheint auf dem zweiten Gerät — Foto echt decodiert", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("mangel");
  const projektName = `E2E Baustelle ${Date.now()}`;
  const titel = `Riss im Treppenlauf OG 2 (E2E ${Date.now()})`;

  // Appareil A : projet → page Baustelle → import photo réelle → Mangel.
  await registerViaUi(page, { email });
  await createProjectViaUi(page, projektName);
  await geheZurBaustelle(page);
  await warteBisSynchronisiert(page);

  await importiereFotoUndWaehle(page);
  await speichereMangel(page, titel);

  // Attendre que TEXTE et PHOTO aient quitté l'appareil (badge sans file).
  await warteBisSynchronisiert(page);

  // Appareil B : stockage vide. Le Mangel arrive par tirage ; la photo par
  // pull-through au premier affichage (chemin exact du « téléphone du bureau »).
  const geraetB = await browser.newContext();
  const b = await geraetB.newPage();
  try {
    await loginViaUi(b, email);
    // D'abord la page Projets : le projet doit être tiré AVANT que la
    // Baustelle filtre ses Mängel (auto-sélection du premier projet §111).
    await expect(b.getByRole("heading", { name: projektName, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await geheZurBaustelle(b);
    await pruefeMangelMitEchtemFoto(b, titel);
  } finally {
    await geraetB.close();
  }
});
