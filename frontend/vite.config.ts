import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetBase = (process.env.VITE_ASSET_BASE || "").replace(/\/$/, "");
const assetUrl = (file: string) => `${assetBase}/${file}`;
const threeModuleFile =
  process.env.VITE_THREE_MODULE_FILE || "three.module-0.185.1-narchi-v2.js";

// ============================================================================
// NARCHI — Configuration Vite 7 de production (correctif A2-5)
// ----------------------------------------------------------------------------
// Objectif : bundle initial < 500 Ko. Stratégie à deux étages :
//  1. Route-splitting : DashboardShell est chargé en lazy (App.tsx), donc
//     tout le cockpit (25+ pages) sort du chemin critique Landing/Login.
//  2. manualChunks : les dépendances lourdes sont isolées dans des chunks
//     dédiés, mis en cache longue durée par nginx (immutable) et partagés
//     entre les routes qui les consomment.
// NOTE : web-ifc-three/openbim-components ne sont PAS bundlés (le viewer
// charge le runtime web-ifc UMD local depuis /ifc/ à l'exécution).
// ============================================================================
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Force every application import to resolve to the same Three.js package
    // instance. The That Open vendor bundle is generated with Three externalized
    // to the same versioned runtime (see scripts/build-thatopen-vendor.mjs).
    dedupe: ["three"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    // Sandbox de prévisualisation (hôtes éphémères *.e2b.app).
    allowedHosts: [".e2b.app"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,   // §81 — co-édition CRDT : upgrade WebSocket aussi en dev
      },
      "/ws": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  worker: {
    // Workers ES modules explicites : le chunk web-ifc (import dynamique,
    // phase 2 de validation uniquement) est fetché séparément, JAMAIS au
    // démarrage du Worker — un amorçage ne dépend que d'un petit script.
    format: "es",
  },
  build: {
    target: "es2020",
    sourcemap: false,
    // Le seuil d'alerte reflète l'objectif : tout chunk > 500 Ko doit être
    // justifié (seul three-core a le droit de s'en approcher).
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      // Rollup 4 transforme jusqu'à 1000 fichiers en parallèle par défaut :
      // pic mémoire brutal qui peut faire tuer le build (OOM) sur les
      // machines modestes / Docker Desktop WSL2. 20 fichiers simultanés :
      // mémoire bornée, durée quasi inchangée.
      maxParallelFileOps: 20,
      external: ["@thatopen/components", "three"],
      output: {
        paths: {
          "@thatopen/components": assetUrl("vendor/thatopen-engine.js"),
          three: assetUrl(`vendor/${threeModuleFile}`),
        },
        manualChunks(id: string): string | undefined {
          // PIÈGE VITE : les modules virtuels (préload-helper, helpers
          // commonjs) doivent rester dans le socle, sinon Rollup les place
          // dans un chunk lourd (report-pdf) et le tire dans le chemin
          // critique via un import statique du helper.
          if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers")) {
            return "react-vendor";
          }
          if (!id.includes("node_modules")) return undefined;

          // --- Moteur 3D (lourd, utilisé uniquement par le viewer) -------
          if (id.includes("three-mesh-bvh")) return "three-bvh";
          if (id.includes("/three/") || id.includes("\\three\\")) return "three-core";

          // --- Runtime IFC (worker de pré-validation uniquement) ---------
          if (id.includes("web-ifc")) return "web-ifc";

          // --- Génération de rapports (PDF/Excel — pages d'export) -------
          if (id.includes("jspdf-autotable")) return "report-pdf-table";
          if (id.includes("jspdf")) return "report-pdf-core";
          if (id.includes("html2canvas") || id.includes("canvg")) return "report-render";
          if (id.includes("dompurify") || id.includes("purify")) return "report-sanitize";

          // --- Archives & données (BCF, DataVault) -----------------------
          if (id.includes("jszip") || id.includes("fflate")) return "archive";
          if (id.includes("dexie")) return "storage";

          // --- Socle React (stable, cache très longue durée) -------------
          if (
            id.includes("/react-dom/") || id.includes("\\react-dom\\") ||
            id.includes("/react/") || id.includes("\\react\\") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }
          if (id.includes("zustand")) return "react-vendor";

          // --- Infrastructure applicative séparée pour limiter chaque chunk ---
          if (id.includes("@sentry")) return "observability";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query-client";
          if (id.includes("i18next") || id.includes("intl-messageformat")) return "i18n";
          if (id.includes("decimal.js")) return "decimal";

          // --- Reste des node_modules : chunk vendor commun ---------------
          return "vendor";
        },
      },
    },
  },
});
