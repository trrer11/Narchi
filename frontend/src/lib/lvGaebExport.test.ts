/** §90 — export GAEB du LV co-édité : décisions pures. */
import { describe, expect, it } from "vitest";
import {
  filenameFromDisposition,
  gaebErrorMessage,
  lvGaebDownloadPath,
  lvGaebFallbackFilename,
} from "@/lib/lvGaebExport";

describe("§90 — lvGaebDownloadPath", () => {
  it("Ausschreibung (défaut) : pas de param preise, projekt encodé", () => {
    expect(lvGaebDownloadPath("notiz-buero", false, "Wasserwerk Bönen"))
      .toBe("/api/v5/collab/notiz-buero/lv/gaeb.x31?projekt=Wasserwerk+B%C3%B6nen");
    expect(lvGaebDownloadPath("notiz-buero", false, ""))
      .toBe("/api/v5/collab/notiz-buero/lv/gaeb.x31");
  });

  it("mit Preisen : preise=1 transmis, room encodé", () => {
    expect(lvGaebDownloadPath("team Raum/1", true, "P"))
      .toBe("/api/v5/collab/team%20Raum%2F1/lv/gaeb.x31?preise=1&projekt=P");
  });
});

describe("§90 — filenames & erreurs honnêtes", () => {
  it("fallback propre, disposition servante prioritaire", () => {
    expect(lvGaebFallbackFilename("notiz-buero")).toBe("lv-notiz-buero.x31");
    expect(lvGaebFallbackFilename("///")).toBe("lv-buero.x31");
    expect(filenameFromDisposition('attachment; filename="lv-x.x31"')).toBe("lv-x.x31");
    expect(filenameFromDisposition("inline")).toBeNull();
    expect(filenameFromDisposition(null)).toBeNull();
  });

  it("erreur : detail serveur (OZ ohne EP) prioritaire, jamais inventé", () => {
    const detail = "2 Position(en) ohne EP (01.002, 01.010) — Preise ergänzen.";
    expect(gaebErrorMessage(422, detail)).toBe(detail);
    expect(gaebErrorMessage(422, null)).toContain("abgelehnt");
    expect(gaebErrorMessage(500, null)).toContain("500");
  });
});
