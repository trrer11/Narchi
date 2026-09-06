import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const exact = { three: "0.185.1", "@thatopen/components": "3.4.6", "@thatopen/fragments": "3.4.6" };

for (const [name, version] of Object.entries(exact)) {
  if (pkg.dependencies?.[name] !== version) throw new Error(`[VERIFY] package.json ${name} must be ${version}`);
  if (lock.packages?.[""]?.dependencies?.[name] !== version) throw new Error(`[VERIFY] lock root ${name} must be ${version}`);
  const installed = lock.packages?.[`node_modules/${name}`]?.version;
  if (installed !== version) throw new Error(`[VERIFY] lock installed ${name} is ${installed}, expected ${version}`);
}

const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const publicWorker = path.join(root, "public/ifc/fragments-worker.mjs");
if (!fs.existsSync(publicWorker) || fs.statSync(publicWorker).size === 0) throw new Error("[VERIFY] public Worker missing");

// Installation monorepo : le paquet peut être hissé dans le node_modules parent.
const packageWorker = [
  path.join(root, "node_modules/@thatopen/fragments/dist/Worker/worker.mjs"),
  path.join(root, "..", "node_modules/@thatopen/fragments/dist/Worker/worker.mjs"),
].find((candidate) => fs.existsSync(candidate));
if (!packageWorker) throw new Error("[VERIFY] installed Fragments Worker missing; run npm ci");
const publicWorkerHash = sha256(publicWorker);
const packageWorkerHash = sha256(packageWorker);
if (publicWorkerHash !== packageWorkerHash) {
  throw new Error(`[VERIFY] Worker hash mismatch: package=${packageWorkerHash} public=${publicWorkerHash}`);
}

const dist = path.join(root, "dist");
const distWorker = path.join(dist, "ifc/fragments-worker.mjs");
if (!fs.existsSync(distWorker) || sha256(distWorker) !== publicWorkerHash) throw new Error("[VERIFY] dist Worker differs from public Worker");

const vendorManifestPath = path.join(dist, "vendor/manifest.json");
const vendorManifest = JSON.parse(fs.readFileSync(vendorManifestPath, "utf8"));
const moduleFile = path.join(dist, vendorManifest.threeModule.replace(/^\//, ""));
const coreFile = path.join(dist, vendorManifest.threeCore.replace(/^\//, ""));
if (sha256(moduleFile) !== vendorManifest.moduleSha256) throw new Error("[VERIFY] Three module hash mismatch");
if (sha256(coreFile) !== vendorManifest.coreSha256) throw new Error("[VERIFY] Three core hash mismatch");

const jsFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:js|mjs)$/.test(entry.name)) jsFiles.push(file);
  }
}
walk(dist);
const source = jsFiles.map(file => fs.readFileSync(file, "utf8")).join("\n");
const runtimeUrls = [...new Set([...source.matchAll(/(?:https?:\/\/[^"']*)?\/vendor\/three\.module-[^"']+\.js/g)].map(m => m[0]))];
if (runtimeUrls.length > 1) throw new Error(`[VERIFY] Multiple Three runtime URLs found: ${runtimeUrls.join(", ")}`);
if (runtimeUrls.length === 1 && !runtimeUrls[0].includes(vendorManifest.threeModule.replace(/^\//, ""))) {
  throw new Error(`[VERIFY] Unexpected Three runtime URL: ${runtimeUrls[0]}`);
}

console.log(JSON.stringify({
  status: "verified",
  versions: exact,
  workerSha256: publicWorkerHash,
  workerBytes: fs.statSync(publicWorker).size,
  threeRuntimeUrls: runtimeUrls,
  jsFiles: jsFiles.length,
}, null, 2));
