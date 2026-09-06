import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/AppStore";
import { Card, Icon, PageHeader } from "@/components/ui";
import { IqThread, useIqContext, type IqExchange } from "@/components/IqChat";
import { answerQuestion, IQ_CAPABILITIES } from "@/lib/narchiIq";
import { createSpeechSession, getSpeechRecognitionCtor, type SpeechSession } from "@/lib/speechInput";
import { FeedbackFlow } from "@/components/FeedbackFlow";
import { explainWithLocalLlm, fetchIqStatus, type IqLlmStatus } from "@/lib/iqLocal";
import { factsToPrompt, packOfficeChunks, retrieveFacts } from "@/lib/iqRetrieve";
import type { IqAnswer } from "@/lib/narchiIq";

/// Suggestions chips : 5 exemplaires de chaque famille (réelles — jamais
/// décoratives ; chaque chip appelle un VRAI outil).
const MODEL_CHIPS = IQ_CAPABILITIES.filter((c) => c.scope === "modell").slice(0, 5).map((c) => c.example);
const ADHOC_CHIPS = IQ_CAPABILITIES.filter((c) => c.scope === "adhoc").slice(0, 5).map((c) => c.example);

export default function NarchiIq() {
  const { navigate, costConfig, activeProject, activeElements } = useApp();
  const ctx = useIqContext();
  const [llm, setLlm] = useState<IqLlmStatus | null>(null);
  const [history, setHistory] = useState<IqExchange[]>([]);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  /// §47 — micro Web Speech (de-DE, 100 % navigateur) : la voix remplace la
  /// FRAPPE uniquement — la réponse reste produite par les outils réels.
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const speechRef = useRef<SpeechSession | null>(null);
  /// null = navigateur sans Web Speech API (Firefox…) → bouton grisé + raison.
  const speechSupported = getSpeechRecognitionCtor() !== null;

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    if (/feedback|rückmeldung|meinung|verbesser|bewert/i.test(question)) {
      setFeedback(true);
      setQuery("");
      inputRef.current?.focus();
      return;
    }
    const answer = answerQuestion(question, ctx);
    setHistory((h) => [
      {
        id: nextId.current++,
        question,
        answer,
        at: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      },
      ...h,
    ]);
    setQuery("");
    inputRef.current?.focus();
  };

  // §164 — cible « vue?mode=ve » (lien profond VE-Studio §161) : on sépare le
  // chemin de la requête, sinon « /app/lca?mode=ve » serait pris pour un chemin.
  const handleNavigate = (target: string) => {
    const [path, queryPart] = target.split("?");
    const query = queryPart
      ? Object.fromEntries(new URLSearchParams(queryPart))
      : undefined;
    navigate(`/app/${path}`, query);
  };

  /// §47 — bascule micro : le texte provisoire s'affiche dans le champ à mesure
  /// qu'on parle ; la phrase FINALE est posée comme question (même pipeline ask
  /// → outils réels, zéro chiffre génératif).
  const toggleMic = () => {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    setSpeechError(null);
    const session = createSpeechSession({
      onStart: () => setListening(true),
      onInterim: (text) => setQuery(text),
      onFinal: (text) => {
        setListening(false);
        ask(text);
      },
      onError: (_code, message) => {
        setListening(false);
        setSpeechError(message);
      },
      onEnd: () => setListening(false),
    });
    if (!session) {
      setSpeechError("Spracheingabe nicht verfügbar — bitte Chrome/Edge/Chromium verwenden.");
      return;
    }
    speechRef.current?.dispose();
    speechRef.current = session;
    session.start();
  };

  /// Nettoyage micro au démontage (aucun callback fantôme).
  useEffect(() => () => speechRef.current?.dispose(), []);
  useEffect(() => {
    void fetchIqStatus().then(setLlm);
  }, []);

  const explainAnswer = async (answer: IqAnswer) => {
    const lastQ = history[0]?.question ?? "Erklärung";
    const chunks = packOfficeChunks({
      projectName: activeProject?.name || "",
      ngf: costConfig.ngf || 0,
      ngfQuelle: costConfig.ngfQuelle,
      bauteile: activeElements.length,
      sourceLabel: ctx.sourceLabel,
      toolAnswer: answer.text,
      toolRows: answer.rows,
    });
    const picked = retrieveFacts(lastQ, chunks);
    const text = await explainWithLocalLlm(lastQ, factsToPrompt(picked));
    setHistory((h) => [
      {
        id: nextId.current++,
        question: `Lokal erklären: ${lastQ}`,
        answer: {
          text,
          tools: [],
          warning:
            llm?.mode === "ollama"
              ? `Ollama lokal · ${picked.length} Fakten-Schnipsel — keine neuen Zahlen.`
              : "Kein Ollama — Server sagt das ehrlich.",
        },
        at: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      },
      ...h,
    ]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="NARCHI IQ — Frag das Modell"
        subtitle="Zahlen kommen von Werkzeugen. Optionales lokales Ollama erklärt sie — keine Cloud."
      />

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
        LLM:{" "}
        {llm == null
          ? "Status wird geladen…"
          : llm.mode === "ollama"
            ? `lokal · ${llm.model || "llama3.2:3b"} · kein US-Cloud`
            : llm.mode === "cloud"
              ? "Cloud (explizit eingeschaltet)"
              : "aus — nur Werkzeuge (8 GB: Ollama llama3.2:3b optional)"}
      </div>

      {/* Bandeau de transparence — deux familles d'outils, zéro génératif. */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-xs leading-relaxed text-brand-900">
        <strong>Warum keine erfundenen Zahlen?</strong> Zuerst rechnen echte Motoren.
        Ollama (wenn an) erklärt nur diese Fakten.
        dieselben Zahlen wie auf den Fachseiten. Unter jeder Antwort stehen die ausgeführten
        Werkzeuge. Zwei Familien :
        <strong> Modell-Werkzeuge</strong> (Clash-Radar, Befundgruppen, Norm-Audit, ÖKOBAUDAT, GEG — brauchen die geladene Maquette) und
        <strong> Ad-hoc-Werkzeuge</strong> (Schnell-Schätzung DIN 276 mit Typologie/Stadt, HOAI-Tafel 2021 — funktionieren sofort).
        {" "}Quelle : {ctx.sourceLabel} · {ctx.elements.length.toLocaleString("de-DE")} Bauteile.
      </div>

      {/* Questions types — regroupées par famille (bureau-lisible). */}
      <Card className="p-4 space-y-3">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Modell-Fragen · Messung am Modell ({ctx.elements.length.toLocaleString("de-DE")} Bauteile)
          </p>
          <div className="flex flex-wrap gap-2">
            {MODEL_CHIPS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-100"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Ad-hoc-Werkzeuge · ohne Modell sofort nutzbar
          </p>
          <div className="flex flex-wrap gap-2">
            {ADHOC_CHIPS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm transition-colors hover:border-sky-400 hover:bg-sky-100"
              >
                {q}
              </button>
            ))}
            <button
              onClick={() => { setFeedback(true); }}
              className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 shadow-sm transition-colors hover:bg-brand-100"
            >
              🎤 Feedback geben
            </button>
          </div>
        </div>
      </Card>

      {/* Saisie — §47 : micro bascule (rouge pulsant à l'écoute), texte
          provisoire visible, phrase finale posée automatiquement. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            onClick={toggleMic}
            disabled={!speechSupported}
            aria-label={listening ? "Spracheingabe stoppen" : "Frage per Mikrofon stellen (de-DE)"}
            title={
              !speechSupported
                ? "Spracheingabe nicht verfügbar — dieser Browser hat keine Web Speech API (Chrome/Edge empfohlen)"
                : listening
                  ? "Aufnahme stoppen"
                  : "Frage diktieren (de-DE) — 100 % navigateur, rien ne quitte le poste"
            }
            className={
              listening
                ? "flex items-center justify-center rounded-xl bg-rose-600 px-4 py-3 text-white shadow-sm transition-colors hover:bg-rose-700"
                : "flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-500 shadow-sm transition-colors hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            <Icon name="mic" size={18} className={listening ? "animate-pulse" : undefined} />
          </button>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(query)}
            placeholder={listening ? "🎤 Sprechen — der Text folgt Ihrer Stimme …" : "Deine Frage — tippen oder diktieren (🎤), Enter zum Fragen"}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <button
            onClick={() => ask(query)}
            disabled={!query.trim()}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="arrowRight" size={16} />
            Fragen
          </button>
        </div>
        {listening && (
          <p className="text-xs font-semibold text-rose-600">
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            Aufnahme läuft — Frage deutlich sprechen, sie wird automatisch gestellt.
          </p>
        )}
        {speechError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            🎤 {speechError}
          </p>
        )}
      </div>

      {/* Historique (le plus récent en haut) */}
      <IqThread
        exchanges={history}
        onNavigate={handleNavigate}
        onExplain={(a) => void explainAnswer(a)}
        feedbackSlot={
          feedback ? (
            <Card className="p-4">
              <FeedbackFlow
                onDone={(summary) => {
                  setFeedback(false);
                  setHistory((h) => [
                    {
                      id: nextId.current++,
                      question: "Feedback geben 🎤",
                      answer: { text: summary, tools: [], warning: undefined },
                      at: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
                    },
                    ...h,
                  ]);
                }}
              />
            </Card>
          ) : undefined
        }
        emptyHint={
          <Card className="p-10 text-center text-sm text-slate-400">
            <Icon name="spark" size={28} className="mx-auto mb-3 text-brand-400" />
            Stelle eine Frage — Modell-Werkzeuge messen, Ad-hoc-Werkzeuge schätzen.
          </Card>
        }
      />
    </div>
  );
}
