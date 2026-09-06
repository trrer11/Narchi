/**
 * ERROR BOUNDARY GLOBAL - NARCHI CORE V5 (Active Telemetry Edition)
 * Derniere ligne de defense anti page blanche : toute exception non
 * capturee dans l'arbre React affiche un ecran d'erreur exploitable
 * (message + bouton recharger) au lieu d'un ecran blanc, tout en
 * transmettant le rapport de crash en temps réel vers Sentry.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { hardReloadApplication, isChunkLoadError } from "@/lib/chunkRecovery";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[NARCHI] Crash UI intercepte par l'ErrorBoundary:", error, info.componentStack);
    
    // TRANSMISSION PROACTIVE : Pousse instantanément le rapport de crash vers notre cockpit Sentry
    Sentry.captureException(error, {
      extra: {
        componentStack: info.componentStack,
        context: "Global React UI / 3D Canvas Crash"
      }
    });
  }

  private handleReload = (): void => {
    void hardReloadApplication();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    
    // Détection d'un plantage spécifique du canvas WebGL / Three.js pour guider l'architecte
    const isWebGLCrash = this.state.error.message?.includes("WebGL") ||
                         this.state.error.message?.includes("renderer") ||
                         this.state.error.message?.includes("context lost");
    const isStaleChunk = isChunkLoadError(this.state.error);

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#05070f", color: "#fff", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <div style={{ maxWidth: 560, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {isStaleChunk
              ? "Eine alte Oberfläche steckt noch im Cache"
              : isWebGLCrash
                ? "Die 3D-Ansicht ist abgestürzt"
                : "NARCHI ist auf einen Fehler gestoßen"}
          </h1>
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
            {isStaleChunk
              ? "Alte Caches werden gelöscht, dann lädt die aktuelle Version."
              : isWebGLCrash
                ? "GPU oder Browser hat die Grafikressourcen erschöpft. Ihre Daten sind unberührt."
                : "Die Oberfläche wurde geschützt. Ihre Daten sind unberührt."}
          </p>
          <pre style={{ textAlign: "left", fontSize: 11, color: "#fda4af", background: "#1e293b", borderRadius: 8, padding: 12, overflow: "auto", maxHeight: 140, marginBottom: 16 }}>
            {this.state.error.message}
          </pre>
          <button onClick={this.handleReload} style={{ background: "#3b82f6", color: "#fff", border: 0, borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
            {isStaleChunk ? "Cache leeren und neu laden" : "Anwendung neu laden"}
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
