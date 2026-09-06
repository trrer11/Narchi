/**
 * NARCHI V5 — diagnostics frontend persistants et corrélables.
 *
 * Les erreurs React/JavaScript sont envoyées au backend sous forme nettoyée :
 * aucun cookie, mot de passe, jeton, corps métier ou paramètre d'URL.
 * Une petite copie circulaire reste dans le navigateur si le backend est coupé.
 */

import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN?.trim() || "";
const DIAGNOSTIC_ENDPOINT = "/api/v5/diagnostics/client-events";
const LOCAL_BUFFER_KEY = "narchi:diagnostics:v1";
const MAX_LOCAL_EVENTS = 50;
let initialized = false;

export interface OperationalErrorContext {
  context: string;
  [key: string]: unknown;
}

export type DiagnosticLevel = "debug" | "info" | "warning" | "error";

interface ClientDiagnosticEvent {
  event_id: string;
  event_code: string;
  level: DiagnosticLevel;
  message: string;
  context: Record<string, unknown>;
  stack?: string;
  client_timestamp: string;
  page: string;
  release?: string;
}

const SENSITIVE_KEY = /password|passwd|pwd|secret|authorization|cookie|token|api[_-]?key|dsn/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const URL_CREDENTIALS = /(\:\/\/[^\s:/@]+:)([^\s@]+)(@)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function sanitizeText(value: string, maxLength = 2_000): string {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]$3")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .slice(0, maxLength);
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeValue(item, "", depth + 1));
  }
  if (typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [itemKey, itemValue] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      cleaned[itemKey.slice(0, 128)] = sanitizeValue(itemValue, itemKey, depth + 1);
    }
    return cleaned;
  }
  return sanitizeText(String(value));
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Erreur non sérialisable");
  }
}

function eventId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `fe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persistLocally(event: ClientDiagnosticEvent): void {
  try {
    const previous = JSON.parse(localStorage.getItem(LOCAL_BUFFER_KEY) || "[]");
    const buffer = Array.isArray(previous) ? previous.slice(-(MAX_LOCAL_EVENTS - 1)) : [];
    buffer.push(event);
    localStorage.setItem(LOCAL_BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // Diagnostic best-effort : quota/stockage privé ne doit jamais casser l'UI.
  }
}

function sendToBackend(event: ClientDiagnosticEvent): void {
  try {
    void fetch(DIAGNOSTIC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Le tampon local conserve l'événement si le backend est inaccessible.
  }
}

/** Enregistre un jalon sans jamais bloquer l'action utilisateur. */
export function recordDiagnosticEvent(
  eventCode: string,
  level: DiagnosticLevel,
  message: string,
  context: Record<string, unknown> = {},
  stack?: string,
): string {
  const id = eventId();
  const event: ClientDiagnosticEvent = {
    event_id: id,
    event_code: eventCode.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64),
    level,
    message: sanitizeText(message),
    context: sanitizeValue(context) as Record<string, unknown>,
    stack: stack ? sanitizeText(stack, 8_000) : undefined,
    client_timestamp: new Date().toISOString(),
    page: typeof window === "undefined" ? "unknown" : window.location.pathname.slice(0, 512),
    release: import.meta.env.VITE_APP_RELEASE || undefined,
  };
  persistLocally(event);
  sendToBackend(event);
  return id;
}

/** Capture une erreur interceptée sans casser le fallback utilisateur. */
export function captureOperationalError(
  error: unknown,
  context: OperationalErrorContext,
): void {
  const normalized = asError(error);
  const safeContext = sanitizeValue(context) as Record<string, unknown>;
  const diagnosticId = recordDiagnosticEvent(
    "FRONTEND_OPERATIONAL_ERROR",
    "error",
    normalized.message,
    safeContext,
    normalized.stack,
  );
  console.error(`[${context.context}] [diagnostic:${diagnosticId}]`, normalized, safeContext);

  if (!SENTRY_DSN || !initialized) return;
  Sentry.withScope((scope) => {
    scope.setTag("narchi.error_context", context.context);
    scope.setTag("narchi.diagnostic_id", diagnosticId);
    for (const [key, value] of Object.entries(safeContext)) {
      if (key !== "context") scope.setExtra(key, value);
    }
    Sentry.captureException(normalized);
  });
}

export function initializeFrontendTelemetry(): void {
  if (initialized) return;
  initialized = true;

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.1,
      environment: import.meta.env.MODE || "production",
      release: import.meta.env.VITE_APP_RELEASE || undefined,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          delete event.request.query_string;
        }
        return event;
      },
    });
    console.info("[Telemetry] Sentry frontend initialisé.");
  } else {
    console.info("[Telemetry] Sentry frontend désactivé (VITE_SENTRY_DSN absent).");
  }

  recordDiagnosticEvent("FRONTEND_STARTED", "info", "Frontend NARCHI initialisé", {
    browser: navigator.userAgent.slice(0, 300),
    language: navigator.language,
    online: navigator.onLine,
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureOperationalError(event.reason, { context: "window.unhandledrejection" });
  });

  window.addEventListener("error", (event) => {
    if (event.error) {
      captureOperationalError(event.error, {
        context: "window.error",
        filename: event.filename ? new URL(event.filename, window.location.origin).pathname : "",
        line: event.lineno,
        column: event.colno,
      });
    }
  });
}
