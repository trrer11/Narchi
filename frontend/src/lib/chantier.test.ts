/**
 * §104 — Tests de la logique de la page chantier (idée client) : le tri
 * « intelligent » est une vérité de calendrier (EXIF d'abord), jamais une
 * magie. On épingle les bornes : 10 minutes pile = MÊME séance,
 * 10 min 01 s = nouvelle séance.
 */
import { describe, expect, it } from "vitest";

import {
  buildPhotoMangel,
  countPhotoSources,
  dayKeyOf,
  daysSinceProjectStart,
  formatDayLabel,
  formatPhotoCount,
  formatTimeRange,
  groupVisits,
  SESSION_GAP_MS,
  type ChanPhoto,
} from "@/lib/chantier";

const at = (iso: string) => new Date(iso).getTime();

function photo(id: string, localIso: string, source: ChanPhoto["source"] = "exif"): ChanPhoto {
  return { id, name: `${id}.jpg`, takenAt: at(localIso), source, kind: "photo" };
}

describe("§104 — groupVisits (regroupement par date de prise de vue)", () => {
  it("trie l'entrée et regroupe par jour, chaque jour totalisé", () => {
    // DONNÉE VOLONTAIREMENT DÉSORDONNÉE : la vérité vient des dates.
    const days = groupVisits([
      photo("b", "2026-08-10T09:05:00"),
      photo("d", "2026-08-11T11:00:00"),
      photo("a", "2026-08-10T09:00:00"),
      photo("c", "2026-08-10T09:25:00"), // 20 min après b → nouvelle séance
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-08-10", "2026-08-11"]);
    expect(days[0].photoCount).toBe(3);
    expect(days[1].photoCount).toBe(1);
    expect(days[0].sessions.map((s) => s.photoIds)).toEqual([["a", "b"], ["c"]]);
    expect(days[0].sessions[0].from).toBe(at("2026-08-10T09:00:00"));
    expect(days[0].sessions[0].to).toBe(at("2026-08-10T09:05:00"));
  });

  it("borne exacte : ≤ 10 min = même séance, > 10 min = nouvelle séance", () => {
    expect(SESSION_GAP_MS).toBe(600_000);
    const days = groupVisits([
      photo("a", "2026-08-10T09:00:00"),
      photo("b", "2026-08-10T09:10:00"),     // pile 10 min → même séance
      photo("c", "2026-08-10T09:20:01"),     // 10 min 01 s après b… strictement > 10 ?
      photo("d", "2026-08-10T09:31:00"),     // +10 min 59 s > 10 min → rupture
    ]);
    // c − b = 601 s > 600 s → rupture AVANT c ; d − c = 659 s > 600 s → rupture.
    expect(days[0].sessions.map((s) => s.photoIds)).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("minuit passé = nouveau jour, même à 2 minutes d'écart", () => {
    const days = groupVisits([
      photo("a", "2026-08-10T23:59:00"),
      photo("b", "2026-08-11T00:01:00"),
    ]);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-08-10", "2026-08-11"]);
  });

  it("libellés allemands exacts, jamais de plage « HH:MM–HH:MM » ridicule", () => {
    expect(formatDayLabel("2026-08-01")).toBe("01.08.2026");
    expect(formatTimeRange(at("2026-08-10T09:12:00"), at("2026-08-10T09:18:00"))).toBe("09:12–09:18");
    expect(formatTimeRange(at("2026-08-10T09:12:00"), at("2026-08-10T09:12:40"))).toBe("09:12");
    expect(formatPhotoCount(1)).toBe("1 Foto");
    expect(formatPhotoCount(2)).toBe("2 Fotos");
  });

  it("zéro photo → zéro visite (l'écran annonce le vide)", () => {
    expect(groupVisits([])).toEqual([]);
  });

  it("compte honnêtement la source de chaque date", () => {
    const counts = countPhotoSources([
      photo("a", "2026-08-10T09:00:00", "exif"),
      photo("b", "2026-08-10T09:01:00", "fichier-nom"),
      photo("c", "2026-08-10T09:02:00", "fichier-date"),
    ]);
    expect(counts).toEqual({ exif: 1, meta: 0, nom: 1, date: 1 });
    expect(dayKeyOf(at("2026-08-10T09:00:00"))).toBe("2026-08-10");
  });
});

describe("§104 — buildPhotoMangel (Mangel → Issue datée par la PHOTO)", () => {
  const PROJECT = { id: "p-1", startDate: "2026-06-01" };
  const input = {
    title: "Riss in Treppenlauf",
    description: "ca. 30 cm",
    severity: "major" as const,
    classificationCode: "NMC-10-40",
    level: "OG 2",
    photoIds: ["foto-a", "foto-b"],
    earliestTakenAt: at("2026-08-01T09:12:00"),
  };

  it("« Tag N » = jour de la plus ancienne photo, PAS jour de saisie", () => {
    const now = new Date("2026-08-10T15:00:00"); // saisie au bureau le 10 août
    const issue = buildPhotoMangel(input, PROJECT, now, "mgl-x");
    expect(issue.raisedDay).toBe(61);     // 01.08.2026 = 61 jours après le 01.06.
    expect(daysSinceProjectStart("2026-06-01", now)).toBe(70); // la saisie aurait dit 70
    expect(issue.assignee).toBe("Baustelle");
    expect(issue.status).toBe("open");
    expect(issue.projectId).toBe("p-1");
    expect(issue.photoIds).toEqual(["foto-a", "foto-b"]);
  });

  it("sans date de photo : repli au jour de saisie ; zone vide → « k. A. »", () => {
    const issue = buildPhotoMangel(
      { ...input, level: "  ", title: "  Abplatzung  ", photoIds: [], earliestTakenAt: undefined },
      PROJECT,
      new Date("2026-08-10T15:00:00"),
      "mgl-y",
    );
    expect(issue.raisedDay).toBe(70);
    expect(issue.level).toBe("k. A.");
    expect(issue.title).toBe("Abplatzung");
    expect(issue.photoIds).toBeUndefined();
  });

  it("début futur ou invalide : jamais de négatif ni de NaN déguisé", () => {
    expect(daysSinceProjectStart("2026-09-01", new Date("2026-08-10"))).toBe(0);
    expect(daysSinceProjectStart("pas-une-date", new Date("2026-08-10"))).toBe(0);
  });

  it("§107 — la date de visite (jour ISO de la photo la plus ancienne) accompagne le Mangel", () => {
    const issue = buildPhotoMangel(input, PROJECT, new Date("2026-08-10T15:00:00"), "mgl-z");
    expect(issue.visitDate).toBe("2026-08-01"); // lisible « Besuch: 01.08.2026 »
    // Sans photo datée : pas de date inventée — le champ est absent.
    const sans = buildPhotoMangel(
      { ...input, earliestTakenAt: undefined },
      PROJECT,
      new Date("2026-08-10T15:00:00"),
      "mgl-z2",
    );
    expect(sans.visitDate).toBeUndefined();
  });
});
