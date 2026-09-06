/**
 * SMOKE TEST END-TO-END — Worker IFC NARCHI
 * -----------------------------------------
 * Rejoue en Node le cycle de vie complet du Worker de production :
 *
 *   1. esbuild bundle `src/workers/ifcParser.worker.ts` en ESM + splitting
 *      (même structure que le build Vite : entry légère + chunk web-ifc).
 *   2. Scénario NORMAL      : fichier IFC réel → WORKER_READY + takeoff.
 *   3. Scénario MALFORMÉ    : entrée corrompue → PARSE_ERROR propre,
 *      sans boucle infinie (régression du tokenizer qui tuait le Worker).
 *   4. Scénario QUARANTAINE : le chunk web-ifc est RENOMMÉ (illivraison
 *      réseau simulée — le crash constaté chez l'utilisateur à l'étape
 *      DEMARRAGE). L'import DOIT néanmoins réussir : le worker démarre et
 *      livre le takeoff, seule la validation croisée WASM se dégrade.
 *
 * Usage : node scripts/smoke-ifc-worker.mjs   (depuis frontend/)
 * Exit  : 0 si tous les scénarios passent, 1 sinon.
 */

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(frontendDir, "..");
const harness = path.join(frontendDir, "scripts", "ifc-worker-harness.mjs");
const esbuildBin = path.join(
  frontendDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "esbuild.cmd" : "esbuild",
);

const exampleIfc = path.join(repoDir, "examples", "simple_house_efh.ifc");
if (!fs.existsSync(exampleIfc)) {
  console.error(`✖ Fichier d'exemple introuvable : ${exampleIfc}`);
  process.exit(1);
}

// --- 1) Build du worker ------------------------------------------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-worker-smoke-"));
console.log(`▶ Build esbuild du Worker → ${outDir}`);
execFileSync(
  esbuildBin,
  [
    "src/workers/ifcParser.worker.ts",
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=es2020",
    "--splitting",
    `--outdir=${outDir}`,
    "--alias:@=./src",
    '--define:import.meta.env.VITE_ASSET_BASE=""',
    '--define:import.meta.env.VITE_IFC_WASM_BASE=""',
    "--log-level=warning",
  ],
  { cwd: frontendDir, stdio: "inherit" },
);

const entry = path.join(outDir, "ifcParser.worker.js");
const webIfcChunk = fs
  .readdirSync(outDir)
  .filter((f) => /^web-ifc.*\.js$/i.test(f))
  .map((f) => path.join(outDir, f))[0];
console.log(
  `  entry=${(fs.statSync(entry).size / 1024).toFixed(0)} Ko · chunk web-ifc=${
    webIfcChunk ? `${(fs.statSync(webIfcChunk).size / 1024).toFixed(0)} Ko (import dynamique, séparé)` : "non trouvé"
  }`,
);

// --- 2) Scénarios ------------------------------------------------------------
const malformedFile = path.join(outDir, "malformed.ifc");
fs.writeFileSync(
  malformedFile,
  // Parenthèse orpheline + absence totale d'en-tête STEP : le tokenizer ne
  // doit ni boucler ni générer des tokens à l'infini.
  "#44=IFCWALL('x',));\nCECI N'EST PAS UN FICHIER STEP ###\n",
);

function runScenario(name, ifcFile, scenario) {
  console.log(`\n▶ Scénario ${name}`);
  const run = spawnSync(process.execPath, [harness], {
    env: { ...process.env, ENTRY: entry, IFC_FILE: ifcFile, SCENARIO: scenario },
    encoding: "utf-8",
    timeout: 60_000,
  });
  const lines = (run.stdout ?? "").trim().split("\n").filter(Boolean);
  for (const line of lines) console.log(`  ${line}`);
  if (run.stderr?.trim()) console.log(`  stderr: ${run.stderr.trim().slice(0, 400)}`);
  const verdict = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).find((v) => v?.verdict);
  const passed = run.status === 0 && verdict?.verdict === "OK";
  console.log(passed ? "  ✔ PASS" : `  ✖ FAIL (${verdict?.reason ?? `exit ${run.status}`})`);
  return passed;
}

const results = [];
results.push(["NORMAL (fichier réel)", runScenario("NORMAL", exampleIfc, "normal")]);
results.push(["MALFORMÉ (anti-boucle)", runScenario("MALFORMÉ", malformedFile, "malformed")]);

if (webIfcChunk) {
  // Simule le chunk web-ifc perdu au téléchargement : si web-ifc était un
  // import STATIQUE du worker, l'entry planterait à l'évaluation et ce
  // scénario échouerait à WORKER_READY. C'est exactement le crash utilisateur.
  const quarantined = `${webIfcChunk}.quarantined`;
  fs.renameSync(webIfcChunk, quarantined);
  try {
    results.push(["QUARANTAINE (chunk web-ifc perdu)", runScenario("QUARANTAINE", exampleIfc, "normal")]);
  } finally {
    fs.renameSync(quarantined, webIfcChunk);
  }
} else {
  console.log("\n⚠ Chunk web-ifc introuvable — scénario QUARANTAINE sauté");
}

console.log("\n════════════════ RÉSUMÉ ════════════════");
let allPassed = true;
for (const [name, passed] of results) {
  console.log(` ${passed ? "✔" : "✖"} ${name}`);
  allPassed &&= passed;
}
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(allPassed ? 0 : 1);
