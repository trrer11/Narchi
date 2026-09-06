// Narchi — Interactive Feedback Flow component.
// Runs inside the Copilot: one question at a time, quick-tap, progress bar.
// Offers a voice option (30s → 2min) as alternative for busy architects.

import { useRef, useState } from "react";
import { Button, Icon } from "@/components/ui";
import {
  FEEDBACK_QUESTIONS,
  VoiceRecorder,
  completeFeedbackSession,
  isVoiceSupported,
  savePartialAnswer,
  saveVoiceFeedback,
  startFeedbackSession,
  type FeedbackSession,
} from "@/lib/feedbackEngine";
import { cn } from "@/utils/cn";

export function FeedbackFlow({ onDone }: { onDone: (summary: string) => void }) {
  const [step, setStep] = useState(0);
  const [session, setSession] = useState<FeedbackSession>(() => startFeedbackSession());
  const [mode, setMode] = useState<"choose" | "survey" | "voice">("choose");
  const [textAnswer, setTextAnswer] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "recording" | "stopped" | "error">("idle");
  const [voiceDuration, setVoiceDuration] = useState(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);

  /* ---- Mode chooser ---- */
  if (mode === "choose") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Wie möchtest du Feedback geben?</p>
        <button
          onClick={() => setMode("survey")}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-brand-300 bg-brand-50 p-4 text-left transition-all hover:bg-brand-100"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-ink-950"><Icon name="pulse" size={20} /></span>
          <div>
            <p className="font-semibold text-slate-900">⚡ Quick-Survey (60s)</p>
            <p className="text-xs text-slate-500">7 Fragen — Tippen statt Tippen. Ein Klick pro Frage.</p>
          </div>
        </button>
        {isVoiceSupported() && (
          <button
            onClick={() => setMode("voice")}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-slate-200 p-4 text-left transition-all hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500 text-white"><Icon name="bolt" size={20} /></span>
            <div>
              <p className="font-semibold text-slate-900">🎤 Sprachnachricht (einfach!)</p>
              <p className="text-xs text-slate-500">Sprich einfach — wie mit einem Kollegen. Wir transkribieren automatisch.</p>
            </div>
          </button>
        )}
      </div>
    );
  }

  /* ---- Voice mode ---- */
  if (mode === "voice") {
    const toggleRecording = async () => {
      if (voiceStatus === "recording") {
        const result = recorderRef.current?.stop();
        if (result) {
          setVoiceText(result.transcript || voiceText);
          setVoiceDuration(result.durationSec);
          setVoiceStatus("stopped");
        }
      } else {
        if (!recorderRef.current) {
          recorderRef.current = new VoiceRecorder({
            onTranscript: (t) => setVoiceText(t),
            onStatus: (s) => setVoiceStatus(s as never),
          });
        }
        const ok = await recorderRef.current.start();
        if (!ok) setVoiceStatus("error");
      }
    };

    const submitVoice = () => {
      const updated = saveVoiceFeedback(session, voiceText, voiceDuration);
      completeFeedbackSession(updated);
      const summary = `🎤 Sprachfeedback (${voiceDuration}s): "${voiceText.slice(0, 120)}${voiceText.length > 120 ? "…" : ""}"`;
      onDone(summary);
    };

    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-slate-700">🎤 Erzähl uns von deiner Erfahrung</p>
        <p className="text-xs text-slate-500">Sprich frei — 30 Sekunden bis 2 Minuten. Was hat geklappt? Was fehlt? Was war enttäuschend?</p>

        {/* Record button */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={toggleRecording}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition-all",
              voiceStatus === "recording" ? "bg-rose-500 scale-110 animate-pulse" : "bg-brand-500 hover:scale-105"
            )}
          >
            <Icon name={voiceStatus === "recording" ? "x" : "bolt"} size={32} />
          </button>
          <span className="text-xs font-semibold text-slate-500">
            {voiceStatus === "recording" ? "🔴 Aufnahme läuft — sprich jetzt!" : voiceStatus === "stopped" ? "✓ Aufnahme beendet" : voiceStatus === "error" ? "⚠️ Mikrofon nicht verfügbar" : "Tippen zum Aufnehmen"}
          </span>
        </div>

        {/* Live transcript */}
        {voiceText && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Transkription (live)</p>
            <textarea
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-slate-400">{voiceDuration > 0 && `${voiceDuration}s · `}Du kannst den Text korrigieren.</p>
          </div>
        )}

        {voiceStatus === "error" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <Icon name="alert" size={13} className="mr-1 inline" />
            Mikrofon-Zugriff verweigert. Nutze die Quick-Survey oder erlaube den Zugriff in den Browser-Einstellungen.
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMode("choose")}>Zurück</Button>
          <Button size="sm" icon="check" disabled={voiceText.trim().length < 5} onClick={submitVoice} className="flex-1">Feedback absenden</Button>
        </div>
      </div>
    );
  }

  /* ---- Survey mode ---- */
  if (step >= FEEDBACK_QUESTIONS.length) {
    // finished
    const completed = completeFeedbackSession(session);
    const rating = session.answers["overall"] as number;
    const killer = session.answers["killer_feature"] as string;
    const summary = `⭐ Bewertung: ${rating}/5 · Top-Feature: ${killer || "—"} · Stimme: ${completed.contact ? "ja" : "anonym"}`;
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600"><Icon name="check" size={28} /></div>
        <p className="font-display text-lg font-bold text-slate-900">Danke! 🙏</p>
        <p className="text-sm text-slate-500">Dein Feedback hilft uns, Narchi für echte Büros besser zu machen.</p>
        <Button size="sm" variant="ghost" onClick={() => onDone(summary)}>Schließen</Button>
      </div>
    );
  }

  const q = FEEDBACK_QUESTIONS[step];
  const progress = (step / FEEDBACK_QUESTIONS.length) * 100;

  const answer = (value: string | number) => {
    const updated = savePartialAnswer(session, q.id, value);
    setSession(updated);
    setStep(step + 1);
  };

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] font-bold text-slate-400">{step + 1}/{FEEDBACK_QUESTIONS.length}</span>
      </div>

      <p className="text-sm font-semibold text-slate-800">{q.question}</p>
      {q.hint && <p className="text-xs text-slate-400">{q.hint}</p>}

      {/* Rating */}
      {q.type === "rating" && (
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => answer(n)} className="flex h-12 flex-1 items-center justify-center rounded-xl border-2 border-slate-200 text-xl transition-all hover:border-brand-400 hover:bg-brand-50">
              {["😣", "😕", "😐", "🙂", "🤩"][n - 1]}
            </button>
          ))}
        </div>
      )}

      {/* Emoji options */}
      {q.type === "emoji" && (
        <div className="grid gap-2">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => answer(opt)} className="flex items-center gap-2 rounded-xl border-2 border-slate-200 p-3 text-left transition-all hover:border-brand-400 hover:bg-brand-50">
              <span className="text-xl">{opt.split(" ")[0]}</span>
              <span className="text-sm text-slate-700">{opt.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
        </div>
      )}

      {/* Choice */}
      {q.type === "choice" && (
        <div className="grid gap-2">
          {q.options?.map((opt, i) => (
            <button key={i} onClick={() => answer(opt)} className="rounded-xl border-2 border-slate-200 p-3 text-left text-sm text-slate-700 transition-all hover:border-brand-400 hover:bg-brand-50">
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Text */}
      {q.type === "text" && (
        <div className="space-y-2">
          <textarea
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            rows={3}
            placeholder="Schreib hier…"
            className="w-full rounded-xl border-2 border-slate-200 p-3 text-sm focus:border-brand-400 focus:outline-none"
          />
          <Button size="sm" variant="secondary" className="w-full" disabled={!textAnswer.trim() && !q.optional} onClick={() => { if (textAnswer.trim()) answer(textAnswer); else setStep(step + 1); }}>
            {q.optional && !textAnswer.trim() ? "Überspringen" : "Weiter"}
          </Button>
        </div>
      )}

      {/* Skip */}
      {q.optional && q.type !== "text" && (
        <button onClick={() => setStep(step + 1)} className="text-xs text-slate-400 hover:text-slate-600">Überspringen →</button>
      )}

      {/* Back */}
      {step > 0 && (
        <button onClick={() => setStep(step - 1)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <Icon name="chevronLeft" size={12} /> Zurück
        </button>
      )}
    </div>
  );
}
