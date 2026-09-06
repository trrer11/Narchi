// NARCHI V6.11 — Spracheingabe (Web Speech API) §47.
// Fragen à NARCHI IQ au MICRO — reconnaissance 100 % navigateur (de-DE),
// aucune clé, aucun envoi vers le serveur. La réponse elle-même ne change
// PAS : elle reste produite par les outils réels §40 (pour « chiffre », la
// voix n'est que l'entrée — jamais la source).
//
// Honnêteté : Chrome/Edge/Chromium implémentent SpeechRecognition ;
// Firefox/Safari anciens NON → le module rend null (bouton grisé + raison
// affichée) au lieu d'une panne sourde.

// ---------------------------------------------------------------------------
// Types minimaux (évite la dépendance aux interfaces DOM expérimentales)
// ---------------------------------------------------------------------------

export interface SpeechAlternativeLike {
  transcript: string;
}

export interface SpeechResultLike {
  isFinal: boolean;
  0: SpeechAlternativeLike;
}

export interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}

export interface SpeechErrorEventLike {
  error?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: SpeechEventLike) => void) | null;
  onerror: ((ev: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindowLike {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/** Constructeur Web Speech ou null (navigateur non compatible — ex. Firefox). */
export function getSpeechRecognitionCtor(w: SpeechWindowLike | undefined = typeof window !== "undefined" ? (window as unknown as SpeechWindowLike) : undefined): SpeechRecognitionCtor | null {
  if (!w) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// Messages d'erreur HONNÊTES en allemand (codes W3C SpeechRecognition)
// ---------------------------------------------------------------------------

export function speechErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Mikrofon-Zugriff verweigert — im Browser freigeben und erneut versuchen.";
    case "no-speech":
      return "Nichts verstanden — bitte deutlich ins Mikrofon sprechen.";
    case "audio-capture":
      return "Kein Mikrofon gefunden — bitte ein Audiogerät anschließen.";
    case "network":
      return "Spracherkennung momentan ohne Verbindung — bitte gleich noch einmal.";
    case "aborted":
      return "Spracheingabe abgebrochen.";
    case "language-not-supported":
      return "Sprache de-DE wird von diesem Browser nicht erkannt.";
    default:
      return code ? `Spracheingabe-Fehler: ${code}` : "Spracheingabe nicht verfügbar.";
  }
}

// ---------------------------------------------------------------------------
// Session (un seul enregistrement à la fois, résultat final → callback)
// ---------------------------------------------------------------------------

export interface SpeechHandlers {
  /** Déclenchement effectif (le bouton passe rouge). */
  onStart?: () => void;
  /** Texte provisoire (affiché dans le champ pendant l'écoute). */
  onInterim?: (text: string) => void;
  /** Texte FINAL (soumis automatiquement comme question). */
  onFinal: (text: string) => void;
  onError?: (code: string | undefined, message: string) => void;
  /** Fin d'écoute (silence détecté ou stop manuel). */
  onEnd?: () => void;
}

export interface SpeechSession {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
  /** Nettoyage au démontage — aucun callback ne doit survivre. */
  dispose: () => void;
}

/**
 * Crée une session micro ou null si non supportée. continuous=false +
 * interimResults=true : on parle une phrase, le texte final part en question.
 */
export function createSpeechSession(
  handlers: SpeechHandlers,
  opts: { lang?: string; ctor?: SpeechRecognitionCtor | null } = {},
): SpeechSession | null {
  const Ctor = opts.ctor !== undefined ? opts.ctor : getSpeechRecognitionCtor();
  if (!Ctor) return null;

  let listening = false;
  let disposed = false;

  const make = (): SpeechRecognitionLike => {
    const rec = new Ctor();
    rec.lang = opts.lang ?? "de-DE";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      listening = true;
      handlers.onStart?.();
    };
    rec.onresult = (ev) => {
      if (disposed) return;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        if (r.isFinal) {
          listening = false;
          const text = r[0].transcript.trim();
          if (text) handlers.onFinal(text);
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim.trim()) handlers.onInterim?.(interim.trim());
    };
    rec.onerror = (ev) => {
      if (disposed) return;
      listening = false;
      handlers.onError?.(ev.error, speechErrorMessage(ev.error));
    };
    rec.onend = () => {
      if (disposed) return;
      listening = false;
      handlers.onEnd?.();
    };
    return rec;
  };

  /// Instance créée PARESSEUSEMENT au premier start (certains navigateurs
  /// exigent une instance fraîche par prise — jamais d'instance orpheline).
  let rec: SpeechRecognitionLike | null = null;

  return {
    start() {
      if (disposed || listening) return;
      rec = make();
      try {
        rec.start();
      } catch {
        listening = false;
        rec = null;
      }
    },
    stop() {
      if (!disposed && listening && rec) {
        // stop() laisse le résultat final remonter (contrairement à abort).
        try {
          rec.stop();
        } catch {
          /* déjà arrêté */
        }
      }
    },
    isListening: () => listening,
    dispose() {
      disposed = true;
      listening = false;
      try {
        rec?.abort();
      } catch {
        /* déjà détruit */
      }
      rec = null;
    },
  };
}
