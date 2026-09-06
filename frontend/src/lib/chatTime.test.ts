// Tests de l'horodatage des messages de chat.

import { describe, expect, it } from "vitest";
import { formatChatTime } from "@/lib/chatTime";

const NOW = new Date(2026, 7, 5, 14, 30, 0); // 05.08.2026 14:30 (locale)

describe("formatChatTime", () => {
  it("même jour → heure seule « HH:MM »", () => {
    expect(formatChatTime("2026-08-05T08:05:00", NOW)).toBe("08:05");
  });

  it("autre jour, même année → « JJ.MM. HH:MM »", () => {
    expect(formatChatTime("2026-08-01T21:47:00", NOW)).toBe("01.08. 21:47");
  });

  it("autre année → année incluse", () => {
    expect(formatChatTime("2025-12-31T23:59:00", NOW)).toBe("31.12.2025 23:59");
  });

  it("minuit/zéros paddés", () => {
    expect(formatChatTime("2026-08-05T00:07:00", NOW)).toBe("00:07");
  });

  it("horodatage invalide → chaîne vide (Jamais d'exception)", () => {
    expect(formatChatTime("pas une date", NOW)).toBe("");
  });
});
