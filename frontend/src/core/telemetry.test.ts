import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordDiagnosticEvent } from "./telemetry";

describe("frontend diagnostic telemetry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sends a bounded event without passwords or bearer tokens", async () => {
    const fetchMock = vi.mocked(fetch);
    recordDiagnosticEvent(
      "FRONTEND_TEST_ERROR",
      "error",
      "Request failed Bearer abcdefghijklmnopqrstuvwxyz",
      {
        password: "DoNotWriteThisPassword",
        authorization: "Bearer zyxwvutsrqponmlkjihgfedcba",
        accountHint: "private.person@example.com",
        status: 401,
      },
    );

    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const body = String(init.body);
    expect(body).not.toContain("DoNotWriteThisPassword");
    expect(body).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(body).not.toContain("zyxwvutsrqponmlkjihgfedcba");
    expect(body).not.toContain("private.person@example.com");
    expect(body).toContain("[REDACTED_EMAIL]");
    expect(body).toContain("FRONTEND_TEST_ERROR");
    expect(body).toContain('"status":401');
    expect(init.credentials).toBe("omit");
  });

  it("keeps at most fifty local diagnostic events", () => {
    for (let index = 0; index < 60; index += 1) {
      recordDiagnosticEvent("FRONTEND_BUFFER_TEST", "info", `event-${index}`);
    }
    const stored = JSON.parse(localStorage.getItem("narchi:diagnostics:v1") || "[]");
    expect(stored).toHaveLength(50);
    expect(stored[0].message).toBe("event-10");
    expect(stored[49].message).toBe("event-59");
  });
});
