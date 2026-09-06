import { recordDiagnosticEvent } from "@/core/telemetry";

const RECOVERY_KEY = "narchi:chunk-recovery-at";
const RECOVERY_WINDOW_MS = 30_000;
const CHUNK_ERROR_RE = /dynamically imported module|failed to fetch.*module|chunkloaderror|loading chunk/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_RE.test(message);
}

/** Garde pure et testable : une seule actualisation, tous chunks confondus. */
export function shouldAttemptChunkRecovery(previous: number, now: number): boolean {
  return !Number.isFinite(previous) || previous <= 0 || now - previous >= RECOVERY_WINDOW_MS;
}

function readPreviousRecovery(): number {
  try {
    return Number(sessionStorage.getItem(RECOVERY_KEY) || 0);
  } catch {
    return 0;
  }
}

function rememberRecovery(timestamp: number): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, String(timestamp));
  } catch {
    // Même sans sessionStorage, le paramètre URL empêche les caches obsolètes.
  }
}

async function clearStaleRuntimeCaches(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}

export async function hardReloadApplication(): Promise<void> {
  try {
    await clearStaleRuntimeCaches();
  } catch (error) {
    console.warn("[ChunkRecovery] Cache cleanup failed:", error);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("__narchi_reload", Date.now().toString());
  window.location.replace(url.toString());
}

export async function importWithChunkRecovery<T>(
  loader: () => Promise<T>,
  chunkName: string,
): Promise<T> {
  try {
    // Ne jamais effacer ici le garde global : un autre import lazy réussi
    // (FloatingChat) effaçait auparavant la trace de l'échec DashboardShell,
    // ce qui autorisait une actualisation infinie toutes les 200 ms.
    return await loader();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;

    const previous = readPreviousRecovery();
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    recordDiagnosticEvent(
      "FRONTEND_CHUNK_LOAD_FAILED",
      "error",
      `Chargement du module ${chunkName} impossible`,
      {
        chunkName,
        browserMessage: message,
        recoveryAlreadyAttempted: !shouldAttemptChunkRecovery(previous, now),
      },
    );

    if (!shouldAttemptChunkRecovery(previous, now)) {
      console.error(`[ChunkRecovery] ${chunkName} failed after recovery:`, error);
      recordDiagnosticEvent(
        "FRONTEND_CHUNK_RECOVERY_ABORTED",
        "error",
        `Rechargement en boucle bloqué pour ${chunkName}`,
        { chunkName },
      );
      throw new Error(
        `Le module ${chunkName} reste indisponible après actualisation. ` +
        "La boucle de rechargement a été bloquée. Consultez les diagnostics frontend.",
      );
    }

    rememberRecovery(now);
    recordDiagnosticEvent(
      "FRONTEND_CHUNK_RECOVERY_STARTED",
      "warning",
      `Nettoyage du cache avant rechargement de ${chunkName}`,
      { chunkName },
    );
    await hardReloadApplication();
    // La navigation remplace le document. Cette promesse évite un rendu
    // intermédiaire pendant que le navigateur charge le nouvel index.html.
    return await new Promise<T>(() => undefined);
  }
}
