/**
 * §225 — Anrechenbare Kosten nach HOAI-Praxis: i. d. R. KG 300 + 400.
 * KG 500 nur wenn vertraglich vereinbart — hier nie still addiert.
 * Nichts erfinden: 0 wenn keine Schätzung da ist.
 */
export function anrechenbareAusKg300400(kg300: number, kg400: number): number {
  const a = Number.isFinite(kg300) ? kg300 : 0;
  const b = Number.isFinite(kg400) ? kg400 : 0;
  const sum = a + b;
  if (!(sum > 0)) return 0;
  return Math.round(sum);
}
