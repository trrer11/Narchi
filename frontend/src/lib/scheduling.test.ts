import { describe, expect, it, beforeEach } from "vitest";
import { listSchedule, addAssignment } from "@/lib/scheduling";

describe("Kalender §238", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("startet leer — kein Hélios-Demo", () => {
    expect(listSchedule()).toEqual([]);
  });

  it("entfernt alte Demo-IDs, behält echte", () => {
    localStorage.setItem("narchi:schedule", JSON.stringify([
      { id: "1", userId: "u", userName: "X", projectId: "prj-helios", projectName: "Hélios", type: "entwurf", start: "2026-01-01", end: "2026-01-02", hours: 8 },
      { id: "2", userId: "u", userName: "X", projectId: "echt-1", projectName: "EFH", type: "entwurf", start: "2026-01-01", end: "2026-01-02", hours: 4 },
    ]));
    const list = listSchedule();
    expect(list).toHaveLength(1);
    expect(list[0].projectId).toBe("echt-1");
  });

  it("addAssignment bleibt", () => {
    addAssignment({
      userId: "u", userName: "Anna", projectId: "p1", projectName: "A",
      type: "entwurf", start: "2026-08-01", end: "2026-08-02", hours: 8,
    });
    expect(listSchedule()).toHaveLength(1);
  });
});
