/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // happy-dom fournit localStorage/sessionStorage/document pour les
    // tests de la couche sécurité (ChatSecurity) et des hooks React.
    environment: "happy-dom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Isolation stricte : chaque fichier de test a son propre contexte,
    // indispensable pour les stores singletons (SecureFinanceStore).
    isolate: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI ? { junit: "./vitest-report.xml" } : undefined,
    coverage: {
      provider: "v8",
      include: ["src/finance/**", "src/auth/**", "src/bim/**", "src/engine/**"],
      thresholds: {
        // Barrière qualité sur les modules de sécurité livrés.
        lines: 80,
        functions: 80,
      },
    },
  },
});
