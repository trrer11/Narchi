/** §245 — statut + reformulation Ollama. Chiffres restent ceux des outils. */

import { secureFetch } from "@/auth/SecuritySanitizer";

export type IqLlmMode = "off" | "ollama" | "cloud";

export interface IqLlmStatus {
  mode: IqLlmMode;
  model: string;
  ollama_url: string;
  cloud_enabled: boolean;
}

export async function fetchIqStatus(): Promise<IqLlmStatus> {
  const fallback: IqLlmStatus = { mode: "off", model: "", ollama_url: "", cloud_enabled: false };
  try {
    const res = await secureFetch("/api/v5/iq/status");
    if (!res.ok) return fallback;
    const body = (await res.json()) as Partial<IqLlmStatus>;
    const mode = body.mode === "ollama" || body.mode === "cloud" ? body.mode : "off";
    return {
      mode,
      model: String(body.model ?? ""),
      ollama_url: String(body.ollama_url ?? ""),
      cloud_enabled: Boolean(body.cloud_enabled),
    };
  } catch {
    return fallback;
  }
}

export async function explainWithLocalLlm(question: string, facts: string): Promise<string> {
  const res = await secureFetch("/api/v5/iq/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, facts }),
  });
  const body = (await res.json()) as { ok?: boolean; answer?: string };
  return String(body.answer ?? "Keine Antwort.");
}
