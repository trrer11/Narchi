/**
 * §121 — VOLET 5 (mesuré, livré parce que RÉELLEMENT VERT) : import d'une
 * VRAIE maquette IFC dans le navigateur réel.
 *
 * Ce que ça prouve : le moteur web-ifc (WASM local, zéro CDN) charge dans le
 * Chromium réel, parse le fichier exemple du dépôt (examples/simple_house_efh.ifc)
 * et la Mengenliste se peuple avec des éléments RÉELS — la chaîne
 * « fichier IFC → Bauteile » n'est pas une maquette d'écran.
 *
 * §199 — le .bat ne monte QUE frontend/ → /app. ../../examples/ devenait
 * /examples/... (ENOENT). Copie dans e2e/fixtures/ (comme e2e-foto.jpg).
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { appUrl } from "./base";
import { createProjectViaUi, registerViaUi, uniqueEmail } from "./helpers";

const IFC_DATEI = fileURLToPath(
  new URL("./fixtures/simple_house_efh.ifc", import.meta.url),
);

test("echte IFC-Datei wird geparst — Bauteile-Mengenliste befüllt", async ({ page }) => {
  test.setTimeout(240_000); // parsing WASM réel mesuré ~90 s en headless
  const email = uniqueEmail("ifc");
  await registerViaUi(page, { email });
  await createProjectViaUi(page, `E2E Modell ${Date.now()}`);

  await page.goto(appUrl("/app/import"));
  const champ = page.locator('input[type="file"][accept*=".ifc"]');
  await champ.waitFor({ state: "attached" });
  await champ.setInputFiles(IFC_DATEI);

  // Le parsing WASM réel peut prendre un moment en headless : échéance
  // honnête, mais la preuve exige la LISTE RÉELLE, pas un spinner.
  await expect(page.getByText(/Positionen aus IFC-Modell/)).toBeVisible({ timeout: 180_000 });
  // Au moins UNE ligne de Bauteil réelle dans la liste (type IFC rendu en
  // MAJUSCULES par l'app : « IFCWALLSTANDARDCASE »).
  await expect(page.getByText(/IfcWall|IfcSlab|IfcBeam|IfcColumn|IfcDoor|IfcWindow|IfcRoof/i).first())
    .toBeVisible({ timeout: 30_000 });
});
