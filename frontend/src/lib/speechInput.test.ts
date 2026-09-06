import { describe, expect, it, vi } from "vitest";
import {
  createSpeechSession,
  getSpeechRecognitionCtor,
  speechErrorMessage,
  type SpeechErrorEventLike,
  type SpeechEventLike,
  type SpeechRecognitionLike,
} from "@/lib/speechInput";

/// Simulacre fidèle du comportement navigateur : on pilote onresult/onerror
/// à la main, comme Chrome le ferait avec le micro réel.
class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((ev: SpeechEventLike) => void) | null = null;
  onerror: ((ev: SpeechErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
    this.onstart?.();
  }
  stop() {
    this.stopped += 1;
    this.onend?.();
  }
  abort() {
    this.aborted += 1;
  }
  emitResult(transcript: string, isFinal: boolean) {
    this.onresult?.({
      resultIndex: 0,
      results: { 0: { isFinal, 0: { transcript } }, length: 1 },
    });
  }
  emitError(code: string) {
    this.onerror?.({ error: code });
  }
}

describe("§47 speechInput — détection honnête du support navigateur", () => {
  it("sans API (Firefox…) → null, jamais de fausse promesse", () => {
    expect(getSpeechRecognitionCtor({})).toBeNull();
    expect(getSpeechRecognitionCtor(undefined)).toBeNull();
    expect(createSpeechSession({ onFinal: () => {} }, { ctor: null })).toBeNull();
  });

  it("préfère SpeechRecognition standard, repli webkit", () => {
    expect(getSpeechRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
  });
});

describe("§47 session micro — pipeline voix → question", () => {
  it("phrase FINALE → onFinal avec le texte, instance de-DE non continue", () => {
    FakeRecognition.instances = [];
    const onFinal = vi.fn();
    const onStart = vi.fn();
    const s = createSpeechSession({ onFinal, onStart }, { ctor: FakeRecognition })!;
    s.start();
    const rec = FakeRecognition.instances[0];
    expect(rec.lang).toBe("de-DE");
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(true);
    expect(s.isListening()).toBe(true);
    expect(onStart).toHaveBeenCalledOnce();
    rec.emitResult("  Wie viele Kollisionen?  ", true);
    expect(onFinal).toHaveBeenCalledWith("Wie viele Kollisionen?");
    expect(s.isListening()).toBe(false);
  });

  it("intermédiaire → onInterim (le champ suit la voix), final ignore le vide", () => {
    FakeRecognition.instances = [];
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const s = createSpeechSession({ onInterim, onFinal }, { ctor: FakeRecognition })!;
    s.start();
    const rec = FakeRecognition.instances[0];
    rec.emitResult("wie viele", false);
    expect(onInterim).toHaveBeenCalledWith("wie viele");
    expect(onFinal).not.toHaveBeenCalled();
    rec.emitResult("   ", true);
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("erreur micro → message allemand honnête + session libérée", () => {
    FakeRecognition.instances = [];
    const onError = vi.fn();
    const s = createSpeechSession({ onFinal: () => {}, onError }, { ctor: FakeRecognition })!;
    s.start();
    FakeRecognition.instances[0].emitError("not-allowed");
    expect(onError).toHaveBeenCalledWith("not-allowed", expect.stringContaining("Mikrofon-Zugriff verweigert"));
    expect(s.isListening()).toBe(false);
  });

  it("dispose() au démontage → abort, plus aucun callback ne fuit", () => {
    FakeRecognition.instances = [];
    const onFinal = vi.fn();
    const s = createSpeechSession({ onFinal }, { ctor: FakeRecognition })!;
    s.start();
    s.dispose();
    const rec = FakeRecognition.instances[0];
    expect(rec.aborted).toBe(1);
    rec.emitResult("zu spät", true);
    expect(onFinal).not.toHaveBeenCalled();
    s.start(); // ignoré après dispose
    expect(rec.started).toBe(1);
  });
});

describe("§47 messages d'erreur (allemand, honnêtes)", () => {
  it("codes W3C mappés, inconnu → message générique traçable", () => {
    expect(speechErrorMessage("no-speech")).toContain("Nichts verstanden");
    expect(speechErrorMessage("audio-capture")).toContain("Kein Mikrofon");
    expect(speechErrorMessage("network")).toContain("Verbindung");
    expect(speechErrorMessage("weird-code")).toBe("Spracheingabe-Fehler: weird-code");
    expect(speechErrorMessage(undefined)).toBe("Spracheingabe nicht verfügbar.");
    expect(speechErrorMessage("no-speech")).not.toMatch(/[\u4e00-\u9fff\uff00-\uffef]/);
  });
});
