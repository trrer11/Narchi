// Narchi — API client for the real FastAPI backend (localhost:8000).
// When the Python backend is running, every calculation runs there (ifcopenshell,
// real 2384-price DB, true LCA). When it's offline, Narchi falls back to the
// built-in browser engines (DIN 276, GEG, HOAI) — seamless hybrid mode.

import { secureFetch } from "@/auth/SecuritySanitizer";

const DEFAULT_BASE = "";
const KEY_BASE = "narchi:api:base";
const KEY_MODE = "narchi:api:mode"; // auto | remote | local

export type ApiMode = "auto" | "remote" | "local";

export function getApiBase(): string {
  return localStorage.getItem(KEY_BASE) || DEFAULT_BASE;
}
export function setApiBase(base: string) {
  localStorage.setItem(KEY_BASE, base.replace(/\/$/, ""));
  window.dispatchEvent(new Event("narchi-api-config"));
}
export function getApiMode(): ApiMode {
  return (localStorage.getItem(KEY_MODE) as ApiMode) || "auto";
}
export function setApiMode(mode: ApiMode) {
  localStorage.setItem(KEY_MODE, mode);
  window.dispatchEvent(new Event("narchi-api-config"));
}

/** Is the user forcing local mode, or is the backend down? */
export function preferLocal(): boolean {
  const mode = getApiMode();
  if (mode === "local") return true;
  if (mode === "remote") return false;
  return false; // auto → try remote first
}

let healthCache: { ok: boolean; at: number; version?: string } = { ok: false, at: 0 };

export async function checkBackendHealth(): Promise<{ ok: boolean; version?: string }> {
  const mode = getApiMode();
  if (mode === "local") return { ok: false };
  const base = getApiBase();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    // P1-B' : meme le health check passe par secureFetch — un backend qui
    // repond 401 sur /api/health signale une session invalide, pas un down.
    const res = await secureFetch(`${base}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) { healthCache = { ok: false, at: Date.now() }; return { ok: false }; }
    const data = await res.json();
    healthCache = { ok: true, at: Date.now(), version: data.version };
    return { ok: true, version: data.version };
  } catch {
    healthCache = { ok: false, at: Date.now() };
    return { ok: false };
  }
}

export function isBackendKnownUp(): boolean {
  return healthCache.ok && Date.now() - healthCache.at < 60000;
}

/** §178 — statut système PROFOND (DB + capacités prouvées), null si hors
 * ligne / mode local. La preuve de fiabilité pour l'architecte sceptique. */
export interface SystemStatus {
  status: "operational" | "degraded";
  version: string;
  database: "ok" | "error";
  capabilities: {
    xrechnung_kosit: boolean;
    zugferd_pdfa3: boolean;
    ubl_2_1: boolean;
    versand_eml: boolean;
    peppol_network: boolean;
  };
  llm?: { mode: string; model: string; cloud_enabled: boolean };
  server_time: string;
}

export async function fetchSystemStatus(): Promise<SystemStatus | null> {
  const mode = getApiMode();
  if (mode === "local") return null;
  const base = getApiBase();
  try {
    const res = await secureFetch(`${base}/api/v5/system/status`);
    if (!res.ok) return null;
    return (await res.json()) as SystemStatus;
  } catch {
    return null;
  }
}
export function lastKnownVersion(): string | undefined {
  return healthCache.version;
}

async function api<T>(path: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<T> {
  const base = getApiBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 30000);
  // P1-B' : passerelle UNIQUE de l'apiClient — 100% du trafic REST typed
  // traverse l'intercepteur 401 (credentials geres par secureFetch).
  const res = await secureFetch(`${base}${path}`, {
    ...init,
    signal: ctrl.signal,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/* ----------------------------- TYPED ENDPOINTS ----------------------------- */
// Mirrors the FastAPI routes of the real backend.

export interface BackendComputeResult {
  kg: { code: string; label: string; amount: number; perM2: number }[];
  total: number;
  perM2: number;
  ngf: number;
  bgf: number;
  confidenceLow: number;
  confidenceHigh: number;
  co2Total: number;
  co2PerM2: number;
  gegConform: boolean;
  foerderungen: string[];
  hoaiNetto: number;
  auditHash: string;
}

export const backend = {
  async uploadModel(file: File): Promise<{
    project_id: string;
    job_id: string;
    status: string;
    status_url: string;
  }> {
    const form = new FormData();
    form.append("file", file);
    const base = getApiBase();
    const response = await secureFetch(`${base}/api/v5/ifc/upload`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(`Upload failed (${response.status})`);
    return response.json();
  },

  async compute(input: {
    project_id: string;
    gebaeudeart: string;
    plz: string;
    grossstadt: string;
    bauklasse: string;
    energi_standard?: string;
  }): Promise<BackendComputeResult> {
    return api<BackendComputeResult>("/api/v5/ifc/compute", {
      method: "POST",
      body: JSON.stringify(input),
    }, { timeoutMs: 30000 });
  },

  async generatePdf(estimationId: string): Promise<Blob> {
    const base = getApiBase();
    const trigger = await secureFetch(
      `${base}/api/v5/reports/${encodeURIComponent(estimationId)}/trigger`,
      { method: "POST" },
    );
    if (!trigger.ok) throw new Error(`PDF trigger failed (${trigger.status})`);
    const accepted = await trigger.json() as {
      status: string;
      download_url?: string;
    };

    let downloadUrl = accepted.download_url;
    for (let attempt = 0; !downloadUrl && attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const statusResponse = await secureFetch(
        `${base}/api/v5/reports/${encodeURIComponent(estimationId)}/status`,
      );
      if (!statusResponse.ok) throw new Error(`PDF status failed (${statusResponse.status})`);
      const job = await statusResponse.json() as {
        status: string;
        download_url?: string;
        error?: string;
      };
      if (job.status === "FAILED") throw new Error(job.error || "PDF generation failed");
      downloadUrl = job.download_url;
    }
    if (!downloadUrl) throw new Error("PDF generation timeout");

    const download = await fetch(downloadUrl, { credentials: "omit" });
    if (!download.ok) throw new Error(`PDF download failed (${download.status})`);
    return download.blob();
  },

};
