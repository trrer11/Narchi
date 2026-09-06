/**
 * Mein Kalender — moteur (lib/myCalendar.ts).
 * Contrats verrouillés (demande utilisateur 2026-08-06) :
 *  - fériés ALLEMANDS calculés (Pâques gaussienne + règles Bundesland) ;
 *  - heures IST/SOLL automatiques, base vide tant que rien n'est noté ;
 *  - rappel paramétrable AVANT l'échéance (remindH, dédoublonné) ;
 *  - chaque personne ne voit/ne supprime que SES lignes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CAL_KIND_META,
  countdownLabel,
  createMyEntry,
  deleteMyEntry,
  dueReminders,
  easterSunday,
  entryStartsAt,
  formatH,
  germanHolidays,
  holidayOn,
  isoWeekNumber,
  istHoursDay,
  listAllEntries,
  listMyEntries,
  replaceAllEntries,
  monthGridDates,
  monthSummary,
  sollHoursDay,
  upcomingReminders,
  type CalEntry,
} from "@/lib/myCalendar";

const AT = (iso: string, hm = "09:00") => new Date(`${iso}T${hm}:00`).getTime();

function entry(over: Partial<CalEntry>): CalEntry {
  return {
    id: "x",
    userId: "me",
    date: "2026-08-10",
    kind: "aufgabe",
    title: "T",
    createdAt: AT("2026-08-06"),
    ...over,
  };
}

describe("fériés allemands — calculés (jamais semés)", () => {
  it("dimanche de Pâques grégorien (Gauss/Meeus) — années témoins", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
  });

  it("Karfreitag / Ostermontag / Himmelfahrt / Pfingsten 2026 dérivent de Pâques", () => {
    const byName = new Map(germanHolidays(2026, "NI").map((h) => [h.name, h.date]));
    expect(byName.get("Karfreitag")).toBe("2026-04-03");
    expect(byName.get("Ostermontag")).toBe("2026-04-06");
    expect(byName.get("Christi Himmelfahrt")).toBe("2026-05-14");
    expect(byName.get("Pfingstmontag")).toBe("2026-05-25");
  });

  it("Bundesland respecté : Reformationstag férié en NI, Fronleichnam non", () => {
    const ni = new Set(germanHolidays(2026, "NI").map((h) => h.name));
    expect(ni.has("Reformationstag")).toBe(true);
    expect(ni.has("Fronleichnam")).toBe(false);
    expect(ni.has("Heilige Drei Könige")).toBe(false);
    const nw = new Set(germanHolidays(2026, "NW").map((h) => h.name));
    expect(nw.has("Fronleichnam")).toBe(true);
    expect(germanHolidays(2026, "NI").length).toBeLessThan(germanHolidays(2026, "NW").length);
  });

  it("Nationaux : Noël (2 jours), Tag der Arbeit, Tag der Deutschen Einheit", () => {
    expect(holidayOn("2026-12-25", "NI")?.name).toContain("Weihnachtsfeiertag");
    expect(holidayOn("2026-12-26", "NI")?.name).toContain("Weihnachtsfeiertag");
    expect(holidayOn("2026-05-01", "NI")?.name).toBe("Tag der Arbeit");
    expect(holidayOn("2026-10-03", "NI")?.name).toBe("Tag der Deutschen Einheit");
    expect(holidayOn("2026-08-15", "NI")).toBeNull(); // journée ordinaire
  });
});

describe("heures travaillées — calcul AUTOMATIQUE", () => {
  it("IST = somme des durées du jour ; Urlaub et Krankheit n'y comptent pas", () => {
    const h = istHoursDay([
      entry({ kind: "aufgabe", durationH: 6 }),
      entry({ id: "t2", kind: "termin", durationH: 2 }),
      entry({ id: "t3", kind: "fortbildung", durationH: 3.5 }),
      entry({ id: "u1", kind: "urlaub", durationH: 8 }),
      entry({ id: "k1", kind: "krank", durationH: 8 }),
    ]);
    expect(h).toBe(11.5);
  });

  it("SOLL = 8 h jour ouvré ; 0 h Week-end, férié, Urlaub ou Krankheit", () => {
    const absences = [entry({ kind: "urlaub", date: "2026-08-10" })];
    expect(sollHoursDay("2026-08-10", "NI", [])).toBe(8); // lundi
    expect(sollHoursDay("2026-08-09", "NI", [])).toBe(0); // dimanche
    expect(sollHoursDay("2026-08-15", "NI", [])).toBe(0); // samedi
    expect(sollHoursDay("2026-08-10", "NI", absences)).toBe(0); // Urlaub posé
  });

  it("monthSummary : IST 8,5 h · 1 Urlaubstag · 0 Kranktag (août 2026)", () => {
    const entries = [
      entry({ kind: "aufgabe", durationH: 8, date: "2026-08-03" }),
      entry({ id: "t", kind: "termin", durationH: 0.5, date: "2026-08-04" }),
      entry({ id: "u", kind: "urlaub", date: "2026-08-10" }),
      entry({ id: "k", kind: "krank", date: "2026-08-11" }),
    ];
    const s = monthSummary(entries, 2026, 7, "NI");
    expect(s.workH).toBe(8.5);
    expect(s.vacationD).toBe(1);
    expect(s.sickD).toBe(1);
    expect(s.targetH).toBe((21 - 2) * 8); // 21 jours ouvrés moins 2 absences
    expect(s.deltaH).toBe(8.5 - 152);
  });

  it("plage Urlaub multi-jours : couvre chaque jour, fériés exclus du décompte", () => {
    // Urlaub de vendredi à lundi : 2 jours comptés (ven+luin), pas le W.E.
    const entries = [entry({ kind: "urlaub", date: "2026-08-07", end: "2026-08-10" })];
    const s = monthSummary(entries, 2026, 7, "NI");
    expect(s.vacationD).toBe(2);
  });

  it("grille 42 cases, commence un lundi ; KW ISO du 6 août 2026 = 32", () => {
    const grid = monthGridDates(2026, 7);
    expect(grid.length).toBe(42);
    expect(grid[0]).toBe("2026-07-27"); // lundi de la 1re semaine affichée
    expect(grid).toContain("2026-08-01");
    expect(isoWeekNumber("2026-08-06")).toBe(32);
    expect(isoWeekNumber("2026-01-01")).toBe(1);
  });
});

describe("rappel AVANT l'échéance — « notification qui apparaît avant »", () => {
  it("dueReminders se déclenche ≤ remindH AVANT le début, jamais après", () => {
    const now = AT("2026-08-09", "09:30");
    const tomorrow0900 = entry({ id: "a", kind: "termin", date: "2026-08-10", startTime: "09:00", remindH: 24 });
    expect(entryStartsAt(tomorrow0900) - now).toBe(Math.floor(23.5 * 3600000)); // 23,5 h → dû
    expect(dueReminders([tomorrow0900], now).map((e) => e.id)).toEqual(["a"]);
    // Rappel 1 h : trop tôt maintenant → pas dû
    const short = { ...tomorrow0900, id: "b", remindH: 1 };
    expect(dueReminders([short], now)).toEqual([]);
    // Déjà notifié → jamais deux fois (anti-spam)
    const seen = { ...tomorrow0900, id: "c", notifiedAt: now - 60000 };
    expect(dueReminders([seen], now)).toEqual([]);
    // Sans rappel → rien
    const silent = { ...tomorrow0900, id: "d", remindH: 0 };
    expect(dueReminders([silent], now)).toEqual([]);
  });

  it("upcomingReminders : 7 jours triés, passé > 1 h exclu, Urlaub exclu", () => {
    const now = AT("2026-08-10", "10:00");
    const list = [
      entry({ id: "b1", kind: "termin", date: "2026-08-12", startTime: "14:00" }),
      entry({ id: "b2", kind: "aufgabe", date: "2026-08-11", startTime: "09:00" }),
      entry({ id: "past", kind: "termin", date: "2026-08-10", startTime: "07:00" }),
      entry({ id: "far", kind: "termin", date: "2026-08-25", startTime: "09:00" }),
      entry({ id: "u", kind: "urlaub", date: "2026-08-11" }),
    ];
    expect(upcomingReminders(list, now).map((e) => e.id)).toEqual(["b2", "b1"]);
  });

  it("compte à rebours allemand : jetzt · Min. · Std. · Tagen · vorbei", () => {
    const now = AT("2026-08-10", "10:00");
    expect(countdownLabel(now, now)).toBe("jetzt");
    expect(countdownLabel(now + 30 * 60000, now)).toBe("in 30 Min.");
    expect(countdownLabel(now + 3600000, now)).toBe("in 1 Std.");
    expect(countdownLabel(AT("2026-08-11", "10:00"), now)).toBe("morgen");
    expect(countdownLabel(AT("2026-08-13", "10:00"), now)).toBe("in 3 Tagen");
    expect(countdownLabel(AT("2026-08-10", "06:00"), now)).toBe("vorbei");
    expect(formatH(7.5)).toBe("7,5 h");
  });
});

describe("persistance privée — narchi:my-calendar", () => {
  beforeEach(() => {
    try { localStorage.removeItem("narchi:my-calendar"); } catch { /* défensif */ }
  });

  it("base VIDE au départ (aucune donnée semée)", () => {
    expect(listMyEntries("me")).toEqual([]);
  });

  it("chaque personne gère SON calendrier : liste filtrée + suppression protégée", () => {
    const mine = createMyEntry({
      userId: "me", date: "2026-08-10", kind: "termin", title: "Jour fixe", startTime: "14:00",
    });
    createMyEntry({ userId: "her", date: "2026-08-10", kind: "urlaub", title: "Sommerurlaub", end: "2026-08-14" });
    expect(listMyEntries("me").map((e) => e.title)).toEqual(["Jour fixe"]);
    expect(listMyEntries("her").map((e) => e.title)).toEqual(["Sommerurlaub"]);
    // Garde-fou : supprimer la ligne d'un collègue = refusé silencieusement
    deleteMyEntry(mine.id, "her");
    expect(listMyEntries("me").length).toBe(1);
    deleteMyEntry(mine.id, "me");
    expect(listMyEntries("me")).toEqual([]);
    expect(listMyEntries("her").length).toBe(1);
    expect(Object.keys(CAL_KIND_META)).toHaveLength(6);
    replaceAllEntries([entry({ id: "z", userId: "me", title: "Sync" })]);
    expect(listAllEntries()).toHaveLength(1);
    expect(listMyEntries("me")[0].title).toBe("Sync");
    expect(entryStartsAt(listMyEntries("her")[0])).toBe(AT("2026-08-10", "09:00"));
  });
});
