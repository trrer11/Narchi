import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const assetBase = (process.env.VITE_ASSET_BASE || "").replace(/\/$/, "");
const THREE_MODULE_FILE =
  process.env.VITE_THREE_MODULE_FILE || "three.module-0.185.1-narchi-v2.js";
const THREE_CORE_FILE =
  process.env.VITE_THREE_CORE_FILE || "three.core-0.185.1-narchi-v2.js";
const threeRuntimeUrl = `${assetBase}/vendor/${THREE_MODULE_FILE}`;
const threeCoreRuntimeUrl = `${assetBase}/vendor/${THREE_CORE_FILE}`;

// Sous-arborescence versionnée des shims Three.js (mêmes règles de cache
// Edge que le runtime principal : jamais de contenu mutable sous une URL
// stable, pour éviter qu'un 404 ou une vieille copie survive à un déploiement).
const THREE_PKG_DIR = "three-pkg-0.185.1-narchi-v2";

const vendorDir = path.join(root, "public", "vendor");
fs.mkdirSync(vendorDir, { recursive: true });

// Le champ "exports" de three n'expose pas ./package.json : on remonte
// depuis l'entrée résolue du paquet jusqu'à la racine qui contient build/.
function findThreePkgRoot() {
  let dir = path.dirname(require.resolve("three"));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "build"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error("[NARCHI] Three.js package root not found");
}
const threePkgRoot = findThreePkgRoot();

function resolveThreeBuildFile(fileName) {
  const local = path.join(threePkgRoot, "build", fileName);
  if (!fs.existsSync(local)) {
    throw new Error(`[NARCHI] Three.js runtime file missing: ${fileName}`);
  }
  return local;
}

// Depuis Three.js r181+, three.module.js importe explicitement three.core.js.
const coreBytes = fs.readFileSync(resolveThreeBuildFile("three.core.js"));
const upstreamModule = fs.readFileSync(resolveThreeBuildFile("three.module.js"), "utf8");
const versionedModule = upstreamModule.replaceAll("./three.core.js", `./${THREE_CORE_FILE}`);
if (!versionedModule.includes(`./${THREE_CORE_FILE}`)) {
  throw new Error("[NARCHI] three.module.js no longer references the expected core runtime");
}

for (const fileName of ["three.core.js", THREE_CORE_FILE]) {
  fs.writeFileSync(path.join(vendorDir, fileName), coreBytes);
}
for (const fileName of ["three.module.js", THREE_MODULE_FILE]) {
  fs.writeFileSync(path.join(vendorDir, fileName), versionedModule);
}

// ---------------------------------------------------------------------------
// Externalisation complète de Three.js
// ---------------------------------------------------------------------------
// @thatopen/components importe des sous-chemins profonds (three/examples/jsm/*,
// three/build/three.webgpu.js, three.tsl.js). N'externaliser que le
// spécificateur nu « three » laisserait esbuild inliner ces fichiers dans le
// bundle moteur → double instance du runtime Three.js (bugs de rendu,
// `instanceof` cassés, VRAM dupliquée). On mappe donc CHAQUE import qui
// résout dans le paquet three vers une URL externe :
//   - three                  → runtime module versionné
//   - build/three.core.js    → runtime core versionné (instance unique)
//   - build/three.module.js  → runtime module versionné
//   - tout autre sous-chemin → shim ESM minifié sous /vendor/<THREE_PKG_DIR>/
// Les shims sont générés par point fixe : chaque shim est bundlé avec la même
// externalisation, donc ses propres dépendances three internes sont à leur
// tour enregistrées, jusqu'à fermeture du graphe.
// ---------------------------------------------------------------------------

// Résolution manuelle des sous-chemins three (sync, sans esbuild) :
// context.resolve() à l'intérieur d'un onResolve bloque le service esbuild
// (deadlock connu), on lit donc directement le champ "exports" du paquet.
const threeExports = JSON.parse(
  fs.readFileSync(path.join(threePkgRoot, "package.json"), "utf8"),
).exports ?? {};

function resolveExportsEntry(requestSub) {
  const candidates = [`./${requestSub}`, `./${requestSub}.js`, `./${requestSub.replace(/\.js$/, "")}`];
  for (const key of candidates) {
    const entry = threeExports[key];
    const target = typeof entry === "string" ? entry
      : entry && typeof entry === "object" ? (entry.import ?? entry.default ?? entry.require)
      : undefined;
    if (typeof target === "string" && !target.includes("*")) {
      return path.join(threePkgRoot, target);
    }
  }
  return undefined;
}

function resolveThreeDiskPathSync(specifier, importerDir) {
  const candidates = [];
  if (specifier.startsWith("three/")) {
    const sub = specifier.slice("three/".length);
    candidates.push(resolveExportsEntry(sub));
    candidates.push(path.join(threePkgRoot, sub));
    if (!sub.endsWith(".js")) candidates.push(path.join(threePkgRoot, `${sub}.js`));
  } else {
    // Import relatif à l'intérieur du paquet three (./three.core.js, …)
    const base = path.resolve(importerDir, specifier);
    candidates.push(base, `${base}.js`, path.join(base, "index.js"));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`[NARCHI] Cannot resolve three subpath "${specifier}" from ${importerDir}`);
}

function makeThreeExternalPlugin(pendingShims, processedShims) {
  return {
    name: "externalize-three-runtime",
    setup(context) {
      const mapDiskPathToExternal = (diskPath) => {
        const sub = path.relative(threePkgRoot, diskPath).split(path.sep).join("/");
        if (sub === "build/three.core.js") return threeCoreRuntimeUrl;
        if (sub === "build/three.module.js") return threeRuntimeUrl;
        // Un shim déjà généré/en cours ne doit jamais être re-mis en file :
        // les imports croisés (A ↔ B) provoqueraient un ping-pong infini.
        if (!processedShims.has(diskPath) && !pendingShims.has(diskPath)) {
          pendingShims.set(diskPath, `${assetBase}/vendor/${THREE_PKG_DIR}/${sub}`);
        }
        return `${assetBase}/vendor/${THREE_PKG_DIR}/${sub}`;
      };
      context.onResolve({ filter: /^three$/ }, () => ({
        path: threeRuntimeUrl,
        external: true,
      }));
      context.onResolve({ filter: /^three\/.+/ }, (args) => ({
        path: mapDiskPathToExternal(
          resolveThreeDiskPathSync(args.path, path.dirname(args.importer || root)),
        ),
        external: true,
      }));
      // Imports relatifs à l'intérieur même des fichiers du paquet three
      // (ex. three.webgpu.js → ./three.core.js, ./three.tsl.js).
      context.onResolve({ filter: /^\.\.?(\/|$)/ }, (args) => {
        if (!args.importer.startsWith(threePkgRoot)) return undefined;
        const diskPath = resolveThreeDiskPathSync(args.path, path.dirname(args.importer));
        if (!diskPath.startsWith(threePkgRoot + path.sep)) return undefined;
        return { path: mapDiskPathToExternal(diskPath), external: true };
      });
    },
  };
}

// pendingShims : chemin disque → URL externe servie.
const pendingShims = new Map();
const processedShims = new Set();

const vendorBuild = await build({
  stdin: {
    contents: 'export * from "@thatopen/components";',
    resolveDir: root,
    sourcefile: "thatopen-entry.js",
    loader: "js",
  },
  outfile: path.join(vendorDir, "thatopen-engine.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  metafile: true,
  legalComments: "none",
  plugins: [makeThreeExternalPlugin(pendingShims, processedShims)],
  logLevel: "silent",
});

// Point fixe : génère chaque shim enregistré (et ses dépendances three
// internes découvertes en cours de route) jusqu'à fermeture du graphe.
// Garde-fou : un graphe de shims déraisonnable signale une régression du
// mapping — on échoue vite plutôt que de saturer la CI.
const MAX_SHIMS = 200;
const builtShims = [];
while (pendingShims.size > 0) {
  if (builtShims.length >= MAX_SHIMS) {
    throw new Error(`[NARCHI] Too many three shims (>${MAX_SHIMS}): externalization mapping is misbehaving`);
  }
  const [entry, url] = pendingShims.entries().next().value;
  pendingShims.delete(entry);
  processedShims.add(entry);
  const sub = path.relative(threePkgRoot, entry).split(path.sep).join("/");
  if (!fs.existsSync(entry)) {
    throw new Error(`[NARCHI] Three.js subpath not found on disk: three/${sub}`);
  }
  const outfile = path.join(vendorDir, THREE_PKG_DIR, sub);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  console.info(`[NARCHI] shim ${builtShims.length + 1}: three/${sub}`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    plugins: [makeThreeExternalPlugin(pendingShims, processedShims)],
    logLevel: "silent",
  });
  builtShims.push(sub);
}

const bundledThreeInputs = Object.keys(vendorBuild.metafile?.inputs ?? {})
  .filter((file) => /[\\/]node_modules[\\/]three[\\/]/.test(file));
if (bundledThreeInputs.length > 0) {
  throw new Error(`[NARCHI] Three.js was bundled into thatopen-engine.js: ${bundledThreeInputs.join(", ")}`);
}

const manifest = {
  version: 3,
  threeVersion: "0.185.1",
  threeModule: `/vendor/${THREE_MODULE_FILE}`,
  threeCore: `/vendor/${THREE_CORE_FILE}`,
  threePkgDir: `/vendor/${THREE_PKG_DIR}/`,
  threeShims: builtShims,
  moduleSha256: crypto.createHash("sha256").update(versionedModule).digest("hex"),
  coreSha256: crypto.createHash("sha256").update(coreBytes).digest("hex"),
};
fs.writeFileSync(
  path.join(vendorDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.info("[NARCHI] That Open vendor bundle generated.");
console.info(`[NARCHI] Three.js shims externalisés: ${builtShims.length} fichier(s) sous /vendor/${THREE_PKG_DIR}/`);
console.info(
  `[NARCHI] Three.js versioned runtime generated: ${THREE_MODULE_FILE} + ${THREE_CORE_FILE}`,
);
