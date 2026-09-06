// Tests du journal de travail : calcul des heures (Kommen/Gehen/pause),
// validation des saisies, totaux hebdomadaires et persistance locale.

import { beforeEach, describe, expect, it } from "vitest";
import {
  WEEK_TARGET_HOURS,
  WORKLOG_STORAGE_KEY,
  computeWorkedHours,
  emptyWorkday,
  getWorkday,
  loadAllWorklog,
  loadWorklog,
  removeWorkday,
  replaceAllWorklog,
  upsertWorkday,
  weekTotals,
  workdayWarning,
  type WorkdayEntry,
} from "@/lib/worklog";

function day(overrides: Partial<WorkdayEntry> = {}): WorkdayEntry {
  return {
    userId: "u-anna",
    date: "2026-08-03",
    startTime: "08:00",
    endTime: "17:00",
    pauseMinutes: 30,
    tasks: [{ id: "t1", text: "Grundriss EG fertig" }],
    ...overrides,
  };
}

describe("computeWorkedHours", () => {
  it("journée pleine : 9 h − 30 min = 8,5 h", () => {
    expect(computeWorkedHours(day())).toBe(8.5);
  });

  it("sans sortie saisie → null (journée incomplète, pas d'erreur)", () => {
    expect(computeWorkedHours(day({ endTime: "" }))).toBeNull();
    expect(workdayWarning(day({ endTime: "" }))).toBeNull();
  });

  it("entrée seule → null", () => {
    expect(computeWorkedHours(emptyWorkday("u-anna", "2026-08-03"))).toBeNull();
  });

  it("sortie avant entrée → anomalie signalée, heures null", () => {
    const bad = day({ endTime: "07:30" });
    expect(computeWorkedHours(bad)).toBeNull();
    expect(workdayWarning(bad)).toMatch(/Gehen liegt vor Kommen/);
  });

  it("pause plus longue que la journée → anomalie", () => {
    const bad = day({ startTime: "12:00", endTime: "13:00", pauseMinutes: 90 });
    expect(computeWorkedHours(bad)).toBeNull();
    expect(workdayWarning(bad)).toMatch(/Pause länger/);
  });

  it("format d'heure invalide → anomalie", () => {
    expect(workdayWarning(day({ startTime: "8h00" }))).toMatch(/ungültig/);
    expect(workdayWarning(day({ startTime: "25:00" }))).toMatch(/ungültig/);
  });
});

describe("weekTotals", () => {
  it("somme des jours saisis + reste à faire vs cible 40 h", () => {
    const entries = [
      day({ date: "2026-08-03" }), // 8.5 h
      day({ date: "2026-08-04", endTime: "16:30", pauseMinutes: 30 }), // 8 h
      day({ date: "2026-08-05", startTime: "", endTime: "", tasks: [] }), // vide
    ];
    const totals = weekTotals(entries);
    expect(totals.hours).toBe(16.5);
    expect(totals.daysLogged).toBe(2);
    expect(totals.tasksCount).toBe(2);
    expect(totals.restHours).toBe(WEEK_TARGET_HOURS - 16.5);
  });

  it("semaine vierge → hours null", () => {
    expect(weekTotals([]).hours).toBeNull();
  });
});

describe("persistance", () => {
  beforeEach(() => localStorage.removeItem(WORKLOG_STORAGE_KEY));

  it("aller-retour upsert → getWorkday", () => {
    upsertWorkday(day());
    expect(getWorkday("u-anna", "2026-08-03")).toMatchObject({ startTime: "08:00", endTime: "17:00", pauseMinutes: 30 });
    expect(getWorkday("u-anna", "2026-08-03")!.tasks).toHaveLength(1);
  });

  it("upsert remplace la même journée (pas de doublon)", () => {
    upsertWorkday(day());
    upsertWorkday(day({ endTime: "18:00" }));
    expect(loadWorklog("u-anna")).toHaveLength(1);
    expect(loadWorklog("u-anna")[0].endTime).toBe("18:00");
  });

  it("les journées d'autres membres ne sont pas écrasées", () => {
    upsertWorkday(day());
    upsertWorkday(day({ userId: "u-ben", tasks: [] }));
    removeWorkday("u-anna", "2026-08-03");
    expect(loadWorklog("u-anna")).toHaveLength(0);
    expect(loadWorklog("u-ben")).toHaveLength(1);
  });

  it("replaceAllWorklog remplace le journal entier (pull serveur)", () => {
    upsertWorkday(day());
    replaceAllWorklog([day({ userId: "u-ben", date: "2026-08-04", tasks: [] })]);
    expect(loadWorklog("u-anna")).toHaveLength(0);
    expect(loadAllWorklog()).toHaveLength(1);
    expect(loadWorklog("u-ben")[0].date).toBe("2026-08-04");
  });

  it("JSON corrompu → liste vide sans exception", () => {
    localStorage.setItem(WORKLOG_STORAGE_KEY, "###");
    expect(loadWorklog("u-anna")).toEqual([]);
    expect(getWorkday("u-anna", "2026-08-03")).toBeNull();
  });
});
