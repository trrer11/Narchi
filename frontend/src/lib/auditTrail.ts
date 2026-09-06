// Narchi — SHA-256 chained audit trail (GDPR-compliant, blockchain-inspired).
// Every calculation/project event is appended as a hash-chained record —
// tamper-evident history, verifiable integrity, full traceability.

const TRAIL_KEY = "narchi:audittrail";

export interface AuditEntry {
  seq: number;
  ts: string;
  action: string;
  entity: string;
  details: string;
  prevHash: string;
  hash: string;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function load(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(TRAIL_KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    return [];
  }
}
function save(trail: AuditEntry[]) {
  localStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
}

export async function audit(action: string, entity: string, details: string): Promise<AuditEntry> {
  const trail = load();
  const seq = trail.length + 1;
  const ts = new Date().toISOString();
  const prevHash = trail.length > 0 ? trail[trail.length - 1].hash : "0".repeat(64);
  const hash = await sha256(`${seq}|${ts}|${action}|${entity}|${details}|${prevHash}`);
  const entry: AuditEntry = { seq, ts, action, entity, details, prevHash, hash };
  trail.push(entry);
  save(trail);
  return entry;
}

export function getTrail(): AuditEntry[] {
  return load().reverse(); // newest first
}

export async function verifyTrail(): Promise<{ valid: boolean; brokenAt?: number }> {
  const trail = load();
  for (let i = 0; i < trail.length; i++) {
    const e = trail[i];
    const expectedPrev = i > 0 ? trail[i - 1].hash : "0".repeat(64);
    if (e.prevHash !== expectedPrev) return { valid: false, brokenAt: e.seq };
    const rehash = await sha256(`${e.seq}|${e.ts}|${e.action}|${e.entity}|${e.details}|${e.prevHash}`);
    if (rehash !== e.hash) return { valid: false, brokenAt: e.seq };
  }
  return { valid: true };
}
