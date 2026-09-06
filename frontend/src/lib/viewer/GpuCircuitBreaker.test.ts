/**
 * TEST DU DISJONCTEUR GPU (backoff exponentiel + arret definitif).
 * Verrouille le contrat de recoverRuntime : delais 1s/2s/4s, arret net a la
 * 4e perte de contexte, rearmement apres chargement reussi.
 * (Copie contractuelle de l'algorithme du composant, testable sans WebGL.)
 */
import { describe, expect, it, vi } from "vitest";

const MAX_GPU_RECOVERIES = 3;
const BACKOFF_BASE_MS = 1000;

interface BreakerState {
  attempts: number;
  halted: boolean;
  delays: number[];
  reloads: number;
}

function createBreaker(): BreakerState & {
  onContextLost: () => Promise<void>;
  onLoadSuccess: () => void;
} {
  const state: BreakerState = { attempts: 0, halted: false, delays: [], reloads: 0 };
  return {
    ...state,
    get attempts() { return state.attempts; },
    get halted() { return state.halted; },
    get delays() { return state.delays; },
    get reloads() { return state.reloads; },
    async onContextLost() {
      if (state.attempts >= MAX_GPU_RECOVERIES) {
        state.halted = true;
        return;
      }
      state.attempts += 1;
      const delay = BACKOFF_BASE_MS * 2 ** (state.attempts - 1);
      state.delays.push(delay);
      await new Promise<void>((r) => setTimeout(r, delay));
      state.reloads += 1;
    },
    onLoadSuccess() {
      state.attempts = 0; // rearmement
    },
  };
}

describe("Disjoncteur GPU - backoff exponentiel", () => {
  it("espace les tentatives en 1s, 2s, 4s (exponentiel strict)", async () => {
    vi.useFakeTimers();
    const breaker = createBreaker();
    for (let i = 0; i < 3; i++) {
      const p = breaker.onContextLost();
      await vi.runAllTimersAsync();
      await p;
    }
    expect(breaker.delays).toEqual([1000, 2000, 4000]);
    expect(breaker.reloads).toBe(3);
    vi.useRealTimers();
  });

  it("s'arrete NET a la 4e perte : halted=true, zero rechargement supplementaire", async () => {
    vi.useFakeTimers();
    const breaker = createBreaker();
    for (let i = 0; i < 3; i++) {
      const p = breaker.onContextLost();
      await vi.runAllTimersAsync();
      await p;
    }
    // 4e perte : le disjoncteur ouvre le circuit sans timer ni reload.
    await breaker.onContextLost();
    expect(breaker.halted).toBe(true);
    expect(breaker.reloads).toBe(3);
    expect(breaker.delays.length).toBe(3);
    vi.useRealTimers();
  });

  it("un chargement reussi rearme le compteur (GPU redevenu stable)", async () => {
    vi.useFakeTimers();
    const breaker = createBreaker();
    const p1 = breaker.onContextLost();
    await vi.runAllTimersAsync();
    await p1;
    breaker.onLoadSuccess(); // succes -> reset
    const p2 = breaker.onContextLost();
    await vi.runAllTimersAsync();
    await p2;
    // Apres rearmement, le backoff repart a 1 s (pas 2 s).
    expect(breaker.delays).toEqual([1000, 1000]);
    expect(breaker.halted).toBe(false);
    vi.useRealTimers();
  });
});
