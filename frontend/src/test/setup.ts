import { beforeEach, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ detail: "test backend unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
