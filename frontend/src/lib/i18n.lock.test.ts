import { describe, expect, it } from "vitest";
import { getLang, setLang, t, LANGS } from "./i18n";

describe("§224 Sprache fest auf Deutsch", () => {
  it("getLang ist immer de", () => {
    expect(getLang()).toBe("de");
  });

  it("setLang('fr') ändert nichts", () => {
    setLang("fr");
    expect(getLang()).toBe("de");
    expect(t("common.close")).toBe("Schließen");
  });

  it("kein FR/EN-Katalog mehr", () => {
    expect(LANGS.map((l) => l.code)).toEqual(["de"]);
    expect(t("common.search")).toBe("Suche…");
  });
});
