import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const publicIfc = path.join(root, "public", "ifc");

const packageRoots = [
  path.join(root, "node_modules"),
  path.join(root, "..", "node_modules"),
];

const webIfcSource = packageRoots
  .map((modulesDir) => path.join(modulesDir, "web-ifc"))
  .find((dir) =>
    fs.existsSync(path.join(dir, "web-ifc-api.js")) &&
    fs.existsSync(path.join(dir, "web-ifc.wasm")),
  );

const fragmentsWorker = packageRoots
  .map((modulesDir) => path.join(modulesDir, "@thatopen", "fragments", "dist", "Worker", "worker.mjs"))
  .find((filePath) => fs.existsSync(filePath));

if (!webIfcSource || !fragmentsWorker) {
  console.error(
    "[NARCHI] Assets web-ifc/@thatopen introuvables. Exécutez npm ci avant le build.",
  );
  process.exit(1);
}

fs.mkdirSync(publicIfc, { recursive: true });

function copyRequired(sourcePath, outputName) {
  if (!fs.existsSync(sourcePath)) {
    console.error(`[NARCHI] Asset requis manquant: ${sourcePath}`);
    process.exit(1);
  }
  fs.copyFileSync(sourcePath, path.join(publicIfc, outputName));
  console.log(`[NARCHI] copied ${path.basename(sourcePath)} -> public/ifc/${outputName}`);
}

function copyOptional(sourcePath, outputName) {
  if (!fs.existsSync(sourcePath)) return;
  fs.copyFileSync(sourcePath, path.join(publicIfc, outputName));
  console.log(`[NARCHI] copied ${path.basename(sourcePath)} -> public/ifc/${outputName}`);
}

copyRequired(path.join(webIfcSource, "web-ifc-api.js"), "web-ifc-api.js");
copyRequired(path.join(webIfcSource, "web-ifc.wasm"), "web-ifc.wasm");
copyOptional(path.join(webIfcSource, "web-ifc-mt.wasm"), "web-ifc-mt.wasm");
copyRequired(fragmentsWorker, "fragments-worker.mjs");

// Supprime les reliquats du loader web-ifc-three abandonné.
for (const obsolete of ["IFCWorker.js", "web-ifc-api.wasm"]) {
  fs.rmSync(path.join(publicIfc, obsolete), { force: true });
}

const workerSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(publicIfc, "fragments-worker.mjs"))).digest("hex");

const manifest = {
  generatedAt: new Date().toISOString(),
  engine: "@thatopen/components",
  webIfcSource: path.relative(root, webIfcSource),
  fragmentsWorkerSource: path.relative(root, fragmentsWorker),
  fragmentsWorkerSha256: workerSha256,
  fragmentsWorkerBytes: fs.statSync(path.join(publicIfc, "fragments-worker.mjs")).size,
  files: fs.readdirSync(publicIfc).sort(),
};
fs.writeFileSync(
  path.join(publicIfc, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
