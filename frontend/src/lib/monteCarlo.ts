// Narchi — Monte Carlo simulation engine for cost sensitivity analysis.
// Real statistical algorithm: runs thousands of randomized scenarios based on
// the cost structure, producing a probability distribution of outcomes.
// This is how serious cost risk analysis is done (P50/P80/P95).

import type { CostResult } from "@/lib/costEngine";

export interface SimulationResult {
  iterations: number;
  mean: number;
  median: number; // P50
  p10: number;   // optimistic
  p90: number;   // pessimistic
  stdDev: number;
  probOverBudget: number; // 0..1 — probability of exceeding a given budget
  distribution: { x: number; y: number }[]; // histogram for chart
  drivers: { factor: string; sensitivity: number; range: [number, number] }[];
}

// Each cost factor gets a realistic triangular distribution of uncertainty.
interface FactorUncertainty {
  name: string;
  base: number;
  low: number;   // multiplier on base (e.g. 0.95 = -5%)
  high: number;  // multiplier on base (e.g. 1.15 = +15%)
}

function triangular(low: number, mode: number, high: number): number {
  // Sample from a triangular distribution
  const u = Math.random();
  const fc = (mode - low) / (high - low);
  if (u < fc) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

export function runMonteCarlo(cost: CostResult, budget?: number, iterations = 5000): SimulationResult {
  // Define uncertainty per KG group (realistic German construction variance)
  const factors: FactorUncertainty[] = [
    { name: "KG 300 Baukonstruktionen", base: cost.kg300, low: 0.92, high: 1.12 },
    { name: "KG 400 Technische Anlagen", base: cost.kg400, low: 0.88, high: 1.20 },
    { name: "KG 500 Außenanlagen", base: cost.kg500, low: 0.85, high: 1.25 },
    { name: "KG 700 Nebenkosten", base: cost.kg700, low: 0.95, high: 1.10 },
    { name: "Region/Markt (Index)", base: 1, low: 0.97, high: 1.05 },
  ];

  const results: number[] = [];
  const driverContributions: Record<string, number[]> = {};
  factors.forEach((f) => (driverContributions[f.name] = []));

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const f of factors) {
      const mult = triangular(f.low, 1.0, f.high);
      const val = f.base * mult;
      total += val;
      driverContributions[f.name].push(val - f.base); // delta
    }
    results.push(total);
  }

  results.sort((a, b) => a - b);
  const mean = results.reduce((s, n) => s + n, 0) / iterations;
  const median = results[Math.floor(iterations * 0.5)];
  const p10 = results[Math.floor(iterations * 0.1)];
  const p90 = results[Math.floor(iterations * 0.9)];
  const variance = results.reduce((s, n) => s + (n - mean) ** 2, 0) / iterations;
  const stdDev = Math.sqrt(variance);

  const probOverBudget = budget ? results.filter((r) => r > budget).length / iterations : 0;

  // histogram (20 bins)
  const min = results[0];
  const max = results[iterations - 1];
  const binSize = (max - min) / 20;
  const distribution: { x: number; y: number }[] = [];
  for (let b = 0; b < 20; b++) {
    const binStart = min + b * binSize;
    const binEnd = binStart + binSize;
    const count = results.filter((r) => r >= binStart && r < binEnd).length;
    distribution.push({ x: binStart, y: count });
  }

  // sensitivity (which factor drives the most variance)
  const drivers = factors
    .map((f) => {
      const deltas = driverContributions[f.name];
      const range: [number, number] = [Math.min(...deltas), Math.max(...deltas)];
      const sensitivity = range[1] - range[0];
      return { factor: f.name, sensitivity, range };
    })
    .sort((a, b) => b.sensitivity - a.sensitivity);

  return { iterations, mean, median, p10, p90, stdDev, probOverBudget, distribution, drivers };
}
