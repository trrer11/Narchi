/**
 * §121 — Gestes produit réutilisables de la suite E2E.
 *
 * Chaque helper pilote l'interface EXACTEMENT comme un utilisateur :
 * de vrais clics, les vrais sélecteurs visibles (jamais d'appel réseau
 * injecté qui contournerait l'UI — ce serait maquiller la preuve).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { appUrl, BASE_URL } from "./base";

/** Mot de passe de test (jamais en production ; la base est jetable). */
export const E2E_PASSWORD = "E2E-lokal-2026-nur-test!";

/** Photo RÉELLE (JPEG 640×480, lue par l'import puis vérifiée décodée). */
export const FOTO_DATEI = fileURLToPath(new URL("./fixtures/e2e-foto.jpg", import.meta.url));
const FOTO_NAME = "e2e-foto.jpg";

/** E-mail unique par test → un tenant Trial neuf par test : les tests ne se
 *  marchent jamais dessus même s'ils partagent UNE base serveur (comme deux
 *  appareils d'un même bureau). */
export function uniqueEmail(zweck: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${zweck}-${Date.now()}-${rand}@e2e.local`;
}

/** Badge de synchro §117/§118 : l' indicateur produit qui dit la vérité
 *  (« Noch nie synchronisiert » / « Offline — N warten » / « Synchronisiert · HH:MM »). */
export function syncBadge(page: Page): Locator {
  return page.locator('span[title^="Synchronisation über den Narchi-Server"]');
}

/** Le cockpit est monté : la page Projets affiche son bouton principal. */
async function warteAufCockpit(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Nouveau projet" })).toBeVisible({ timeout: 30_000 });
}

/**
 * §190 — Ouvre l'écran de connexion REEL.
 * Playwright + routeur HASH : un seul goto(`…/#/app/projects`) peut laisser
 * le hash vide → Landing (pas de champ username) → timeout 15 s × 5 volets.
 * On charge d'abord la SPA, on pose le hash, et si l'accueil s'affiche on
 * clique « Anmelden » (vrai bouton Landing).
 */
async function ouvrirEcranConnexion(page: Page): Promise<Locator> {
  const erreurs: string[] = [];
  page.on("pageerror", (err) => erreurs.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") erreurs.push(`console: ${msg.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(() => {
    window.location.hash = "/app/projects";
  });
  await page.waitForURL(/#\/app\/projects/, { timeout: 15_000 }).catch(() => undefined);

  // §195 — NE PAS faire locator.or(...).toBeVisible() : Login montre EN
  // MEME TEMPS #login-username ET le bouton Anmelden → Playwright strict
  // mode (2 elements) → faux "introuvable" alors que le formulaire EST la
  // (prouve par le snapshot run 5).
  const benutzer = page.locator("#login-username");
  try {
    await expect(benutzer).toBeVisible({ timeout: 30_000 });
  } catch (e) {
    const landingAnmelden = page.getByRole("button", { name: "Anmelden" });
    if (await landingAnmelden.first().isVisible().catch(() => false)) {
      await landingAnmelden.first().click();
      await expect(benutzer).toBeVisible({ timeout: 15_000 });
      return benutzer;
    }
    const html = (await page.content()).replace(/\s+/g, " ").slice(0, 1200);
    throw new Error(
      `Ecran connexion introuvable. url=${page.url()} title=${await page.title()}\n` +
        `erreurs=${erreurs.join(" | ") || "(aucune)"}\nhtml=${html}\n${e}`,
    );
  }
  return benutzer;
}

/** Création de compte via l'UI (allemande) + première connexion automatique. */
export async function registerViaUi(
  page: Page,
  opts: { email: string; name?: string; firma?: string; passwort?: string },
): Promise<void> {
  const { email, name = "E2E Architektin", firma = "E2E Büro GmbH", passwort = E2E_PASSWORD } = opts;
  const benutzer = await ouvrirEcranConnexion(page);
  await page.getByRole("button", { name: "Noch kein Konto? Registrieren", exact: true }).click();
  await page.locator('input[name="name"]').fill(name);
  await benutzer.fill(email);
  await page.locator('input[name="organization"]').fill(firma);
  await page.locator('input[name="password"]').fill(passwort);
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await warteAufCockpit(page);
}

/** Connexion d'un appareil SUPPLÉMENTAIRE (contexte navigateur distinct) :
 *  le même compte saisi à la main, comme sur le téléphone du bureau. */
export async function loginViaUi(
  page: Page,
  email: string,
  passwort: string = E2E_PASSWORD,
): Promise<void> {
  const benutzer = await ouvrirEcranConnexion(page);
  await benutzer.fill(email);
  await page.locator('input[name="password"]').fill(passwort);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await warteAufCockpit(page);
}

/** Création d'un projet via la modale (flux bureau réel). */
export async function createProjectViaUi(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  const modal = page.locator("form", { has: page.locator('input[name="pname"]') });
  await modal.locator('input[name="pname"]').fill(name);
  await page.getByRole("button", { name: "Créer & Initialiser" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Navigation page Baustelle (routeur hash de l'app). */
export async function geheZurBaustelle(page: Page): Promise<void> {
  await page.goto(appUrl("/app/baustelle"));
  await expect(page.getByRole("heading", { name: "Fotos importieren" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Attend que le badge de synchro dise « Synchronisiert · HH:MM » ET qu'aucune
 * file ne reste visible (« warten », « nicht hochladbar », « geparkt »,
 * « Fehler »). L' heure vient du SERVEUR (server_time), pas de l'horloge
 * locale — si le badge ment, ce helper échoue en citant son texte exact.
 */
export async function warteBisSynchronisiert(page: Page, timeoutMs = 45_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const roh = (await syncBadge(page).textContent()) ?? "";
        const t = roh.replace(/\s+/g, " ").trim();
        if (!/Synchronisiert · \d{2}:\d{2}/.test(t)) return `pas encore « Synchronisiert » : [${t}]`;
        if (/warten|hochladbar|Fehler|geparkt/i.test(t)) return `file encore visible : [${t}]`;
        return "OK";
      },
      { timeout: timeoutMs, intervals: [500, 1_000, 2_000] },
    )
    .toBe("OK");
}

/** Importe la photo fixe via l'input fichier réel et la SÉLECTIONNE
 *  (clic sur sa carte, comme au chantier). */
export async function importiereFotoUndWaehle(page: Page): Promise<void> {
  await page.locator("#bm-import").setInputFiles(FOTO_DATEI);
  // L'ingestion produit vignette EXIF/canvas : coût réel, échéance honnête.
  const caseCoche = page.getByRole("checkbox", { name: FOTO_NAME });
  await caseCoche.waitFor({ state: "attached", timeout: 30_000 });
  // La case est en sr-only (volonté produit, non touchée) : on clique la
  // CARTE visible qui l'enrobe, comme le ferait un doigt au chantier.
  const carte = caseCoche.locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]");
  await carte.click();
  await expect(page.getByText("1 ausgewählt", { exact: true })).toBeVisible();
}

/** Renseigne le titre et enregistre le Mangel (bouton réel du formulaire). */
export async function speichereMangel(page: Page, titel: string): Promise<void> {
  await page.locator("#bm-title").fill(titel);
  await page.getByRole("button", { name: /speichern$/ }).click();
  await expect(page.getByText(/^Offene Mängel \(1\)$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(titel)).toBeVisible();
}

/**
 * Vérifie LA preuve qui vaut de l'or (celle du guide téléphone §120) :
 * sur un appareil frais (IndexedDB vide), le Mangel tiré du serveur s'affiche
 * et sa photo est DÉCODÉE par le navigateur (naturalWidth > 0) — impossible
 * sans versement + pull-through réels §118.
 */
export async function pruefeMangelMitEchtemFoto(page: Page, titel: string): Promise<void> {
  await expect(page.getByText(titel)).toBeVisible({ timeout: 60_000 });
  const img = page.locator('img[alt="Mangel-Foto"]').first();
  await expect(img).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBeGreaterThan(0);
}
