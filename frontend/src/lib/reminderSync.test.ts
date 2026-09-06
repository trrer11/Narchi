import { describe, expect, it } from "vitest";
import {
  ackId,
  loadAcked,
  rememberReminders,
  saveAcked,
  toServerPayload,
  unseenReminders,
  type ServerReminderOut,
} from "@/lib/reminderSync";
import type { CalEntry } from "@/lib/myCalendar";

const NOW = new Date("2026-08-06T09:00:00+02:00").getTime();

function entry(over: Partial<CalEntry>): CalEntry {
  return {
    id: "e1",
    userId: "u1",
    date: "2026-08-07",
    kind: "termin",
    title: "Besprechung",
    startTime: "10:30",
    remindH: 24,
    createdAt: NOW,
    ...over,
  };
}

function fakeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => map,
  };
}

describe("§46 toServerPayload — quelles entrées montent au serveur", () => {
  it("garde : rappel > 0, NON émis localement, événement dans l'horizon", () => {
    const payload = toServerPayload(
      [
        entry({ id: "ok" }),                                     // ✓ rappel 24 h, demain 10:30
        entry({ id: "pas-rappel", remindH: 0 }),                 // ✗ aucun rappel
        entry({ id: "deja-emis", notifiedAt: NOW }),             // ✗ déjà sonné localement (sinon doublon)
        entry({ id: "passe", date: "2026-08-05" }),              // ✗ rendez-vous passé
        entry({ id: "lointain", date: "2026-12-31" }),           // ✗ hors horizon 60 j
      ],
      NOW,
    );
    expect(payload.map((p) => p.entry_id)).toEqual(["ok"]);
    expect(payload[0].title).toBe("Besprechung");
    expect(payload[0].kind).toBe("termin");
    expect(payload[0].remind_before_h).toBe(24);
    expect(payload[0].starts_at).toContain("2026-08-07");
    expect(payload[0].starts_at).toContain("T"); // ISO 8601
  });

  it("tri par début croissant + note présente seulement si existante", () => {
    const payload = toServerPayload(
      [
        entry({ id: "b", date: "2026-08-10" }),
        entry({ id: "a", date: "2026-08-08", note: "Unterlagen" }),
      ],
      NOW,
    );
    expect(payload.map((p) => p.entry_id)).toEqual(["a", "b"]);
    expect(payload[0].note).toBe("Unterlagen");
    expect(payload[1].note).toBeUndefined();
  });
});

describe("§46 déduplication du pull in-app (mémoire navigateur)", () => {
  const due: ServerReminderOut[] = [
    { entry_id: "e1", title: "A", kind: "termin", starts_at: "2026-08-07T08:30:00Z", remind_before_h: 24, note: null, fired_at: "2026-08-06T08:30:00Z", email_sent: false },
    { entry_id: "e2", title: "B", kind: "termin", starts_at: "2026-08-07T09:00:00Z", remind_before_h: 1, note: null, fired_at: "2026-08-06T08:00:00Z", email_sent: true },
  ];

  it("un rappel déjà vu ne re-sonne PAS ; un événement REPORTÉ (fired_at neuf) re-sonne", () => {
    const store = fakeStore();
    let acked = loadAcked(store);
    expect(unseenReminders(due, acked)).toHaveLength(2);
    acked = rememberReminders(acked, due, store);
    expect(unseenReminders(due, acked)).toHaveLength(0);
    // Rechargement « navigateur réouvert » : la mémoire persiste
    const ackedReloaded = loadAcked(store);
    expect(unseenReminders(due, ackedReloaded)).toHaveLength(0);
    // L'événement e1 est reporté → nouveau fired_at → nouvelle sonnerie (honnête)
    const rescheduled = due.map((r) => (r.entry_id === "e1" ? { ...r, fired_at: "2026-08-07T00:00:00Z" } : r));
    expect(unseenReminders(rescheduled, ackedReloaded).map((r) => r.entry_id)).toEqual(["e1"]);
  });

  it("store corrompu → set vide (jamais de crash), clé = entry#fired_at", () => {
    const store = fakeStore();
    store.setItem("narchi:server-reminders-acked", "{kaputt");
    expect(loadAcked(store).size).toBe(0);
    expect(ackId(due[0])).toBe("e1#2026-08-06T08:30:00Z");
    // FIFO cap : >500 n'explose pas la mémoire
    const big = new Set<string>();
    for (let i = 0; i < 600; i++) big.add(`e${i}#t`);
    saveAcked(big, store);
    expect(loadAcked(store).size).toBe(500);
    expect(loadAcked(store).has("e599#t")).toBe(true);
  });
});
