import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import "./index.css";
import { initTheme } from "@/lib/theme";
import { initializeSecurityLayer } from "@/auth/SecuritySanitizer";
import { initializeFrontendTelemetry } from "@/core/telemetry"; // Télémétrie active V4
import App from "./App";
import { queryClient } from "@/lib/queryClient";

// 1. Couche de sécurité AVANT tout rendu : purge des tokens hérités du
// localStorage + vérifications HTTPS/CSP (voir auth/SecuritySanitizer.ts).
initializeSecurityLayer();

// 2. Initialisation de la couche de télémétrie et d'observabilité de production
initializeFrontendTelemetry();

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>
);
