// NARCHI V5 — Client Supabase officiel (Auth, PostgREST et Realtime).
// Aucun protocole Phoenix manuel et aucune session JWT dans localStorage.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { captureOperationalError } from "@/core/telemetry";
import { getRemoteConfig } from "./remoteConfig";

let cachedClient: SupabaseClient | null = null;
let cachedIdentity = "";

function getClient(): SupabaseClient {
  const config = getRemoteConfig();
  if (!config) throw new Error("Backend Supabase nicht konfiguriert.");
  const identity = `${config.url}|${config.anonKey}`;
  if (!cachedClient || cachedIdentity !== identity) {
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
    cachedIdentity = identity;
  }
  return cachedClient;
}

export interface RemoteSession {
  access_token: string;
  user: { id: string; email: string };
}

export async function remoteSignup(email: string, password: string): Promise<RemoteSession> {
  const { data, error } = await getClient().auth.signUp({ email, password });
  if (error || !data.user) throw new Error(error?.message || "Registrierung fehlgeschlagen.");
  return {
    access_token: data.session?.access_token || "",
    user: { id: data.user.id, email: data.user.email || email },
  };
}

export async function remoteLogin(email: string, password: string): Promise<RemoteSession> {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(error?.message || "Login fehlgeschlagen. E-Mail/Passwort prüfen.");
  }
  return {
    access_token: data.session.access_token,
    user: { id: data.user.id, email: data.user.email || email },
  };
}

export async function clearRemoteSession(): Promise<void> {
  if (!cachedClient) return;
  const { error } = await cachedClient.auth.signOut({ scope: "local" });
  if (error) captureOperationalError(error, { context: "Supabase.signOut" });
}

export async function hasRemoteSession(): Promise<boolean> {
  if (!cachedClient) return false;
  const { data } = await cachedClient.auth.getSession();
  return Boolean(data.session);
}

export async function testConnection(url: string, anonKey: string): Promise<boolean> {
  try {
    const probe = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await probe.from("users").select("id").limit(1);
    return !error || !/fetch|network|invalid api key/i.test(error.message);
  } catch (error) {
    captureOperationalError(error, { context: "Supabase.testConnection" });
    return false;
  }
}

export async function remoteSelect<T>(table: string): Promise<T[]> {
  const { data, error } = await getClient().from(table).select("*");
  if (error) throw error;
  return (data || []) as T[];
}

export async function remoteInsert<T extends { id: string }>(table: string, doc: T): Promise<T> {
  const { data, error } = await getClient().from(table).insert(doc).select().single();
  if (error) throw error;
  return (data || doc) as T;
}

export async function remoteUpdate<T>(table: string, id: string, patch: Partial<T>): Promise<void> {
  const { error } = await getClient()
    .from(table)
    .update(patch as Record<string, unknown>)
    .eq("id", id);
  if (error) throw error;
}

export async function remoteUpsert<T extends { id: string }>(table: string, doc: T): Promise<T> {
  const { data, error } = await getClient()
    .from(table)
    .upsert(doc, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return (data || doc) as T;
}

export async function remoteDelete(table: string, id: string): Promise<void> {
  const { error } = await getClient().from(table).delete().eq("id", id);
  if (error) throw error;
}

type RealtimeListener = (payload: unknown) => void;

export function subscribeRealtime(table: string, callback: RealtimeListener): () => void {
  const client = getClient();
  const channel = client
    .channel(`narchi:${table}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => callback(payload),
    )
    .subscribe((state, error) => {
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        captureOperationalError(error || new Error(state), {
          context: "Supabase.realtime",
          table,
          state,
        });
      }
    });

  return () => {
    void client.removeChannel(channel);
  };
}

export function closeAllRealtime(): void {
  if (cachedClient) void cachedClient.removeAllChannels();
}
