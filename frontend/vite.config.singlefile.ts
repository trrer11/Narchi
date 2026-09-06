import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetBase = (process.env.VITE_ASSET_BASE || "").replace(/\/$/, "");
const assetUrl = (file: string) => `${assetBase}/${file}`;
const threeModuleFile =
  process.env.VITE_THREE_MODULE_FILE || "three.module-0.185.1-narchi-v2.js";

// ============================================================================
// NARCHI — Configuration Vite de build autonome (single-file) pour Arena Sandbox.
// ----------------------------------------------------------------------------
// Objectif : générer un unique index.html autonome embarquant tous les assets
// (JS, CSS, WASM inline ou référencés en base64) afin que l'iframe sandboxée
// d'Arena puisse charger la preview sans dépendre d'un serveur Vite actif.
//
// CONTRAINTE : singlefile est incompatible avec manualChunks. Cette config
// désactive donc le code-splitting. Elle ne doit être utilisée que pour le
// build de la passerelle autonome, jamais pour le build de production standard.
// ============================================================================
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    dedupe: ["three"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    outDir: "../standalone_gateway_dist",
    emptyOutDir: true,
    // Single-file exige un seul chunk ; on désactive tout découpage.
    rollupOptions: {
      external: ["@thatopen/components", "three"],
      output: {
        inlineDynamicImports: true,
        paths: {
          "@thatopen/components": assetUrl("vendor/thatopen-engine.js"),
          three: assetUrl(`vendor/${threeModuleFile}`),
        },
      },
    },
    // Empêche Vite d'émettre des warnings sur la taille du chunk unique.
    chunkSizeWarningLimit: 6000,
  },
});