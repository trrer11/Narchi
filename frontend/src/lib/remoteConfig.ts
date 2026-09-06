// NARCHI V5 — Configuration optionnelle d'un projet Supabase.
// L'anon key est publique par conception; les JWT de session restent en mémoire.

const KEY_URL = "narchi:supabase:url";
const KEY_ANON = "narchi:supabase:anon";
const LEGACY_TOKEN_KEYS = ["narchi:supabase:token", "narchi:supabase:uid"];

export interface RemoteConfig {
  url: string;
  anonKey: string;
}

export function getRemoteConfig(): RemoteConfig | null {
  const url = localStorage.getItem(KEY_URL)?.trim();
  const anonKey = localStorage.getItem(KEY_ANON)?.trim();
  if (url && anonKey && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    return { url, anonKey };
  }
  return null;
}

export function setRemoteConfig(url: string, anonKey: string): void {
  const normalized = url.trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalized)) {
    throw new Error("URL Supabase invalide ou non HTTPS.");
  }
  localStorage.setItem(KEY_URL, normalized);
  localStorage.setItem(KEY_ANON, anonKey.trim());
  LEGACY_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new Event("narchi-remote-config"));
}

export function clearRemoteConfig(): void {
  localStorage.removeItem(KEY_URL);
  localStorage.removeItem(KEY_ANON);
  LEGACY_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new Event("narchi-remote-config"));
}

export function isConfigured(): boolean {
  return getRemoteConfig() !== null;
}

export function tableFor(collection: string): string {
  return collection;
}
