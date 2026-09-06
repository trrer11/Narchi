/**
 * §50 — helpers purs de la bibliothèque de prix du bureau.
 * (Les appels HTTP sont couverts côté backend par 22 tests pytest.)
 */
import { describe, it, expect } from "vitest";
import {
  batchDeleteSummary,
  eigenpreisQuoteLabel,
  importSummary,
  isAcceptedLibraryFile,
  kgCoverageBadge,
  preisstandYearOptions,
  type ImportCommit,
  type LibraryStats,
} from "./officeLibrary";

const commit: ImportCommit = {
  kind: "csv",
  inserted: 40,
  updated: 2,
  rejected_count: 3,
  total_active: 42,
  sample_rejected: [],
  warnings: [],
};

describe("officeLibrary — helpers purs", () => {
  it("années Preisstand : courante d'abord, jusqu'à 2015", () => {
    const years = preisstandYearOptions(2026);
    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(2015);
    expect(years).toHaveLength(12);
  });

  it("résumé d'import honnête — rejets jamais cachés", () => {
    expect(importSummary(commit)).toBe(
      "40 neu · 2 aktualisiert · 3 abgelehnt (mit Grund) — Bibliothek: 42 Positionen",
    );
    const sansRejets = importSummary({ ...commit, rejected_count: 0 });
    expect(sansRejets).not.toContain("abgelehnt");
    expect(sansRejets).toBe("40 neu · 2 aktualisiert — Bibliothek: 42 Positionen");
  });

  it("extensions acceptées / refusées", () => {
    expect(isAcceptedLibraryFile("bibliothek.csv")).toBe(true);
    expect(isAcceptedLibraryFile("LV-Neubau.X31")).toBe(true);
    expect(isAcceptedLibraryFile("preise.gaeb")).toBe(true);
    expect(isAcceptedLibraryFile("preise.xml")).toBe(true);
    expect(isAcceptedLibraryFile("preise.txt")).toBe(true);
    expect(isAcceptedLibraryFile("photo.png")).toBe(false);
    expect(isAcceptedLibraryFile("devis.docx")).toBe(false);
  });

  it("badge de couverture KG : vert ≥ 50 %, ambre > 0, ardoise à 0", () => {
    const stats = (a: number, b: number): LibraryStats => ({
      total: 0, by_jahr: {}, kg_abgedeckt: a, kg_total: b,
      letzter_import: null, index_quelle: "",
    });
    expect(kgCoverageBadge(stats(13, 26))).toEqual({ label: "13/26 KGs", tone: "emerald" });
    expect(kgCoverageBadge(stats(3, 26)).tone).toBe("amber");
    expect(kgCoverageBadge(stats(0, 26)).tone).toBe("slate");
    expect(kgCoverageBadge(stats(0, 0)).tone).toBe("slate"); // division sûre
  });

  it("label du quota Eigenpreis borné à [0, 100 %]", () => {
    expect(eigenpreisQuoteLabel(0.623)).toBe("62 %");
    expect(eigenpreisQuoteLabel(1)).toBe("100 %");
    expect(eigenpreisQuoteLabel(0)).toBe("0 %");
    expect(eigenpreisQuoteLabel(1.7)).toBe("100 %");
    expect(eigenpreisQuoteLabel(-0.2)).toBe("0 %");
  });

  it("§76 — confirmation de suppression : compte réel, singulier/pluriel honnête", () => {
    expect(batchDeleteSummary({ deleted: 1, source_file: "essai.x31" })).toBe(
      "1 Position aus „essai.x31“ gelöscht – der Rest der Bibliothek bleibt unberührt.",
    );
    expect(batchDeleteSummary({ deleted: 3, source_file: "mon essai-lv.x31" })).toBe(
      "3 Positionen aus „mon essai-lv.x31“ gelöscht – der Rest der Bibliothek bleibt unberührt.",
    );
  });

  it("aucune chaîne CJK dans les labels générés", () => {
    const all = [
      importSummary(commit),
      kgCoverageBadge({ total: 0, by_jahr: {}, kg_abgedeckt: 1, kg_total: 2, letzter_import: null, index_quelle: "" }).label,
      eigenpreisQuoteLabel(0.5),
    ].join(" ");
    expect(all).not.toMatch(/[\u4e00-\u9fff\u3040-\u30ff]/);
  });
});
