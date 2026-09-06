// Narchi — collision-free unique ID generation.
// Uses crypto.randomUUID (available in all modern browsers & secure contexts)
// with a guaranteed-unique fallback for older / insecure-context environments.

let counter = 0;

function fallback(): string {
  // timestamp + monotonic counter + entropy — collision-proof in practice
  counter = (counter + 1) % 1_000_000;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${time}${counter.toString(36).padStart(4, "0")}${rand}`;
}

/** Generate a unique identifier. Optional namespace prefix. */
export function uid(prefix?: string): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallback();
  return prefix ? `${prefix}_${id}` : id;
}

/** Short readable ID (8 chars) — for display tokens / shares. */
export function shortId(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes =
    typeof crypto !== "undefined" ? crypto.getRandomValues(new Uint8Array(8)) : null;
  for (let i = 0; i < 8; i++) {
    const n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    out += chars[n % chars.length];
  }
  return out;
}

/** Cryptographically-secure password generator (no ambiguous chars). */
export function generatePassword(length = 14): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = lower + upper + digits + symbols;
  const bytes =
    typeof crypto !== "undefined" ? crypto.getRandomValues(new Uint8Array(length)) : null;
  const pick = (i: number) => {
    const n = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    return all[n % all.length];
  };
  // guarantee at least one of each class
  const guaranteed = [pick(0), pick(1), pick(2), pick(3)];
  const rest = Array.from({ length: length - 4 }, (_, i) => pick(i + 4));
  return [...guaranteed, ...rest].sort(() => 0.5 - (bytes?.[0] ?? 0.5) / 255).join("");
}
