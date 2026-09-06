/**
 * NARCHI V5 — AdaptiveWatchdog
 * Watchdog de chargement IFC adaptatif avec progression détaillée.
 * Remplace les timers fixes destructeurs par un timeout calculé selon
 * le nombre d'éléments IFC et des mises à jour de progression régulières.
 */

export type LoadingPhase =
  | "initializing"
  | "parsing"
  | "triangulating"
  | "uploading_gpu"
  | "finalizing"
  | "complete"
  | "error"
  | "timeout";

export interface LoadingProgress {
  phase: LoadingPhase;
  percent: number;
  elementsProcessed: number;
  elementsTotal: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  throughputElemPerSec: number;
  message: string;
}

export type ProgressCallback = (progress: LoadingProgress) => void;

export class AdaptiveWatchdog {
  private startTime = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private resolved = false;

  private progress: LoadingProgress = {
    phase: "initializing",
    percent: 0,
    elementsProcessed: 0,
    elementsTotal: 0,
    elapsedMs: 0,
    estimatedRemainingMs: 0,
    throughputElemPerSec: 0,
    message: "Initialisation...",
  };

  private readonly BASE_TIMEOUT_MS = 90_000;
  private readonly MS_PER_ELEMENT = 8;
  private readonly MAX_TIMEOUT_MS = 600_000;
  private readonly PROGRESS_INTERVAL_MS = 250;

  constructor(private onProgress: ProgressCallback) {}

  /**
   * Démarre le watchdog avec timeout calculé selon le nombre d'éléments.
   */
  start(
    estimatedElements = 0,
    onTimeout?: () => void
  ): { promise: Promise<void>; done: () => void; fail: (e: Error) => void } {
    this.startTime = Date.now();
    this.progress.elementsTotal = estimatedElements;

    const adaptiveTimeout = Math.min(
      Math.max(this.BASE_TIMEOUT_MS, estimatedElements * this.MS_PER_ELEMENT),
      this.MAX_TIMEOUT_MS
    );

    console.info(
      `[Watchdog] Timeout adaptatif: ${(adaptiveTimeout / 1000).toFixed(0)}s ` +
        `pour ~${estimatedElements} éléments`
    );

    let resolveFn: () => void;
    let rejectFn: (e: Error) => void;

    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    this.intervalTimer = setInterval(() => {
      this.updateProgressEstimates();
      this.onProgress({ ...this.progress });
    }, this.PROGRESS_INTERVAL_MS);

    this.timer = setTimeout(() => {
      if (this.resolved) return;
      this.cleanup();
      this.progress.phase = "timeout";
      this.progress.message = `Timeout après ${(adaptiveTimeout / 1000).toFixed(0)}s`;
      this.onProgress({ ...this.progress });
      onTimeout?.();
      rejectFn!(new Error(`Chargement IFC timeout après ${adaptiveTimeout}ms`));
    }, adaptiveTimeout);

    const done = () => {
      if (this.resolved) return;
      this.resolved = true;
      this.cleanup();
      this.progress.phase = "complete";
      this.progress.percent = 100;
      this.progress.message = "Modèle chargé avec succès";
      this.onProgress({ ...this.progress });
      resolveFn!();
    };

    const fail = (e: Error) => {
      if (this.resolved) return;
      this.resolved = true;
      this.cleanup();
      this.progress.phase = "error";
      this.progress.message = `Erreur : ${e.message}`;
      this.onProgress({ ...this.progress });
      rejectFn!(e);
    };

    return { promise, done, fail };
  }

  /**
   * Met à jour la progression depuis l'extérieur.
   */
  updateProgress(
    update: Partial<
      Pick<LoadingProgress, "phase" | "elementsProcessed" | "elementsTotal" | "message" | "percent">
    >
  ): void {
    Object.assign(this.progress, update);

    if (
      update.elementsProcessed !== undefined &&
      this.progress.elementsTotal > 0
    ) {
      const basePercent = Math.min(
        (this.progress.elementsProcessed / this.progress.elementsTotal) * 90,
        90
      );

      const phaseBonus: Record<LoadingPhase, number> = {
        initializing: 0,
        parsing: 2,
        triangulating: 5,
        uploading_gpu: 8,
        finalizing: 9,
        complete: 10,
        error: 0,
        timeout: 0,
      };

      this.progress.percent = Math.min(
        basePercent + (phaseBonus[this.progress.phase] ?? 0),
        99
      );
    }
  }

  private updateProgressEstimates(): void {
    const elapsed = Date.now() - this.startTime;
    this.progress.elapsedMs = elapsed;

    if (this.progress.elementsProcessed > 0 && elapsed > 0) {
      this.progress.throughputElemPerSec =
        (this.progress.elementsProcessed / elapsed) * 1000;

      if (this.progress.elementsTotal > 0) {
        const remaining =
          this.progress.elementsTotal - this.progress.elementsProcessed;
        this.progress.estimatedRemainingMs =
          (remaining / this.progress.throughputElemPerSec) * 1000;
      }
    }
  }

  private cleanup(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.timer = null;
    this.intervalTimer = null;
  }
}
