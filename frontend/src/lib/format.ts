export const currencySymbols: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
};

export function formatMoney(
  value: number,
  currency: "EUR" | "USD" | "GBP" = "EUR",
  compact = false
): string {
  const symbol = currencySymbols[currency] ?? "€";
  if (compact) {
    const abs = Math.abs(value);
    let body: string;
    if (abs >= 1_000_000_000) body = (value / 1_000_000_000).toFixed(1) + "B";
    else if (abs >= 1_000_000) body = (value / 1_000_000).toFixed(1) + "M";
    else if (abs >= 1_000) body = (value / 1_000).toFixed(1) + "K";
    else body = String(Math.round(value));
    return `${symbol}${body}`;
  }
  return (
    symbol +
    value.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })
  );
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + "B";
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + "K";
  return String(Math.round(value));
}

export function formatCarbon(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2) + " kt";
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + " t";
  return Math.round(value) + " kg";
}

export function formatWeight(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(2) + " kt";
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + " t";
  return Math.round(value) + " kg";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return iso;
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(iso);
}

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
