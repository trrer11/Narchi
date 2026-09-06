/**
 * §224 — NARCHI spricht Deutsch. Punkt.
 *
 * Der Sprachumschalter ist seit §48 entfernt. Trotzdem blieb i18next
 * mit LanguageDetector + fallbackLng „en“ und einem FR-Wörterbuch, das
 * deutsche Seitentitel (PageHeader ruft t(title)) wieder ins Französische
 * zog, sobald der Browser fr/en war oder localStorage narchi:lang gesetzt.
 *
 * Hier: eine Sprache, kein Detector, kein Fallback EN.
 */
import i18next from "i18next";
import ICU from "i18next-icu";
import { initReactI18next, useTranslation } from "react-i18next";

export type Lang = "de";

const LANG_KEY = "narchi:lang";

type Dict = Record<string, string>;

/** §232 — UI ist fest DE (keine t()-Titel). Nur noch die Schlüssel, die Tests/API brauchen. */
const de: Dict = {
  "common.search": "Suche…",
  "common.close": "Schließen",
};

void i18next.use(ICU).use(initReactI18next).init({
  resources: { de: { translation: de } },
  lng: "de",
  fallbackLng: "de",
  supportedLngs: ["de"],
  load: "languageOnly",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  returnNull: false,
  showSupportNotice: false,
});

try {
  if (typeof localStorage !== "undefined") localStorage.removeItem(LANG_KEY);
} catch {
  /* privater Modus */
}

if (typeof document !== "undefined") {
  document.documentElement.lang = "de";
}

export function getLang(): Lang {
  return "de";
}

/** Produkt ist DE-only — Aufruf bleibt harmlos, Sprache wechselt nicht. */
export function setLang(_lang: string): void {
  void i18next.changeLanguage("de");
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return i18next.t(key, vars);
}

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "de", label: "Deutsch", flag: "DE" },
];

export function useLang(): Lang {
  useTranslation();
  return "de";
}

export { i18next };
