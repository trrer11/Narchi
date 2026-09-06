// Narchi — Guided Feedback Engine.
// Conversational, interactive survey that runs INSIDE the Copilot.
// One question at a time, quick-tap answers, progress, voice option.
// Designed to maximize response rate from busy architects.

import { uid } from "@/utils/uid";
import { storage } from "@/utils/localStore";

export type FeedbackQType = "rating" | "emoji" | "choice" | "text" | "voice";

export interface FeedbackQuestion {
  id: string;
  type: FeedbackQType;
  question: string;
  hint?: string;
  options?: string[]; // for choice / emoji
  optional?: boolean;
}

export interface FeedbackSession {
  id: string;
  startedAt: string;
  completedAt?: string;
  answers: Record<string, string | number>;
  voiceTranscript?: string;
  voiceDurationSec?: number;
  contact?: string; // email if they want follow-up
}

const SESSION_KEY = "narchi:feedback-sessions";
const PARTIAL_KEY = "narchi:feedback-partial";

/* The 7 golden questions — designed by product researchers for maximum
   signal with minimum friction. Each takes <10s to answer. */
export const FEEDBACK_QUESTIONS: FeedbackQuestion[] = [
  {
    id: "overall",
    type: "rating",
    question: "Wie gefällt dir Narchi insgesamt?",
    hint: "1 = gar nicht · 5 = begeistert",
  },
  {
    id: "killer_feature",
    type: "choice",
    question: "Welche Funktion war für dich am wertvollsten?",
    options: [
      "Kostenschätzung (DIN 276)",
      "GEG-Energiebilanz",
      "HOAI-Honorar",
      "Modell-Import (IFC)",
      "Crew Agents (6 KI)",
      "Planprüfung / Clash-Radar",
      "Copilot (Sprachassistent)",
      "Keine — fehlt noch was",
    ],
  },
  {
    id: "accuracy",
    type: "emoji",
    question: "Wie realistisch sind die berechneten Kosten?",
    hint: "Verglichen mit deinen Erfahrungen",
    options: ["😖 Viel zu niedrig", "😕 Etwas daneben", "😐 Geht so", "🙂 Ganz nah", "🤩 Sehr realistisch"],
  },
  {
    id: "would_use",
    type: "choice",
    question: "Würdest du Narchi in deinem Büro einsetzen?",
    options: [
      "Ja, sofort — im aktuellen Zustand",
      "Ja, wenn [Feature X] noch kommt",
      "Vielleicht — muss mehr können",
      "Nein — löst nicht mein Problem",
    ],
  },
  {
    id: "pay",
    type: "choice",
    question: "Was wäre dir Narchi pro Monat wert?",
    options: ["Nutzung gratis", "Bis 29 €", "Bis 49 €", "Bis 99 €", "Mehr als 99 €"],
    optional: true,
  },
  {
    id: "missing",
    type: "text",
    question: "Was fehlt dir am meisten?",
    hint: "Ein Satz reicht — z.B. «echter 3D-Viewer» oder «Excel-Export»",
    optional: true,
  },
  {
    id: "contact",
    type: "text",
    question: "Möchtest du auf dem Laufenden bleiben?",
    hint: "E-Mail (optional) — wir informieren dich über Updates",
    optional: true,
  },
];

export function startFeedbackSession(): FeedbackSession {
  const session: FeedbackSession = {
    id: uid("fb"),
    startedAt: new Date().toISOString(),
    answers: {},
  };
  storage.set(PARTIAL_KEY, session);
  return session;
}

export function savePartialAnswer(session: FeedbackSession, questionId: string, answer: string | number): FeedbackSession {
  const updated = { ...session, answers: { ...session.answers, [questionId]: answer } };
  storage.set(PARTIAL_KEY, updated);
  return updated;
}

export function saveVoiceFeedback(session: FeedbackSession, transcript: string, durationSec: number): FeedbackSession {
  const updated = { ...session, voiceTranscript: transcript, voiceDurationSec: durationSec };
  storage.set(PARTIAL_KEY, updated);
  return updated;
}

export function completeFeedbackSession(session: FeedbackSession, contact?: string): FeedbackSession {
  const completed: FeedbackSession = {
    ...session,
    completedAt: new Date().toISOString(),
    contact: contact || session.contact,
  };
  // add to sessions list
  const sessions = storage.get<FeedbackSession[]>(SESSION_KEY, []);
  sessions.push(completed);
  storage.set(SESSION_KEY, sessions);
  // clear partial
  storage.remove(PARTIAL_KEY);
  return completed;
}

export function getFeedbackSessions(): FeedbackSession[] {
  return storage.get<FeedbackSession[]>(SESSION_KEY, []);
}

export function hasPartialSession(): boolean {
  return storage.has(PARTIAL_KEY);
}

export function getPartialSession(): FeedbackSession | null {
  return storage.get<FeedbackSession | null>(PARTIAL_KEY, null);
}

/* Voice recording via MediaRecorder + transcription via Web Speech API */
export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private stream: MediaStream | null = null;
  private recognition: any = null;
  private transcript = "";
  private onTranscript?: (text: string) => void;
  private onStatus?: (status: "recording" | "stopped" | "error") => void;

  constructor(callbacks: { onTranscript?: (text: string) => void; onStatus?: (status: string) => void }) {
    this.onTranscript = callbacks.onTranscript;
    this.onStatus = callbacks.onStatus as any;
  }

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      this.mediaRecorder.start();
      this.startTime = Date.now();
      this.transcript = "";

      // Start speech recognition in parallel (live transcription)
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        this.recognition = new SR();
        this.recognition.lang = "de-DE";
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.onresult = (event: any) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          this.transcript = text;
          this.onTranscript?.(text);
        };
        this.recognition.start();
      }
      this.onStatus?.("recording");
      return true;
    } catch {
      this.onStatus?.("error");
      return false;
    }
  }

  stop(): { transcript: string; durationSec: number } {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.onStatus?.("stopped");
    return { transcript: this.transcript, durationSec: Math.round((Date.now() - this.startTime) / 1000) };
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }
}

export function isVoiceSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}
