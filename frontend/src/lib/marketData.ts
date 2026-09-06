// Narchi — configurable market data (Baukostenindex + benchmark overrides).
// Lets the office update cost indices WITHOUT recompiling the app.
// Loads from localStorage if the owner overrode it; otherwise uses defaults.

import { COST_INDEX } from "@/data/countries";

const KEY = "narchi:marketdata:v1";

export interface MarketOverride {
  costIndex?: Record<number, number>;
  updatedAt?: string;
}

export function getEffectiveCostIndex(): Record<number, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const override = JSON.parse(raw) as MarketOverride;
      if (override.costIndex) return { ...COST_INDEX, ...override.costIndex };
    }
  } catch { /* ignore */ }
  return COST_INDEX;
}

export function setMarketOverride(override: MarketOverride) {
  const existing = getMarketOverride();
  localStorage.setItem(KEY, JSON.stringify({
    ...existing,
    ...override,
    updatedAt: new Date().toISOString(),
  }));
  window.dispatchEvent(new Event("narchi-market-updated"));
}

export function getMarketOverride(): MarketOverride {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MarketOverride) : {};
  } catch {
    return {};
  }
}

export function clearMarketOverride() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("narchi-market-updated"));
}
