// NARCHI V6.11 — Surface de chat UNIQUE (§42) : même moteur (narchiIq.ts),
// même rendu — utilisée par la page « NARCHI IQ » ET par le panneau
// flottant global (⌘J). Zéro duplication de logique = zéro dérive.

import { useMemo } from "react";
import { useApp } from "@/store/AppStore";
import { Icon } from "@/components/ui";
import { cn } from "@/utils/cn";
import { AuditEngine } from "@/lib/AuditEngine";
import { ClashDetector, type Clash } from "@/lib/planpruefung";
import {
  classOfElements,
  groupClashes,
  splitConnections,
  withGroupLevels,
  DEFAULT_CONNECTION_FILTER,
  type ClashGroup,
} from "@/lib/clashGroups";
import { matchMaterials, type MatchSummary } from "@/lib/materialMatch";
import { resolveAuditInput } from "@/lib/qcSources";
import type { AuditReport } from "@/lib/AuditEngine";
import type { IqAnswer, IqContext } from "@/lib/narchiIq";

export interface IqExchange {
  id: number;
  question: string;
  answer: IqAnswer;
  at: string;
}

interface IqCache {
  clashes?: Clash[];
  real?: Clash[];
  connectionCount?: number;
  groups?: ClashGroup[];
  audit?: AuditReport;
  match?: MatchSummary;
}

/// Contexte de vérité : mêmes sources et mêmes moteurs que les pages (QC,
/// Estimation, LCA, Énergie) → forcément mêmes chiffres. Getters paresseux :
/// une question « Kosten » ne recalcule pas le radar des 17 000 paires.
export function useIqContext(): IqContext {
  const { elements, takeoff, activeProjectId, activeProject, costResult, energyResult, costConfig } = useApp();
  return useMemo<IqContext>(() => {
    const projectElements = elements.filter((e) => e.projectId === activeProjectId);
    const auditInput = resolveAuditInput(projectElements, takeoff);
    const els = auditInput.elements;
    const byId = new Map(els.map((e) => [e.id, e]));
    const classOf = classOfElements((id) => byId.get(id));
    const cache: IqCache = {};
    const getClashes = () => (cache.clashes ??= ClashDetector.detectClashes(els));
    const getSplit = () => {
      if (cache.real === undefined) {
        const split = splitConnections(getClashes(), classOf, DEFAULT_CONNECTION_FILTER);
        cache.real = split.real;
        cache.connectionCount = split.connections.length;
      }
      return { real: cache.real, connectionCount: cache.connectionCount! };
    };
    return {
      source: auditInput.source,
      sourceLabel: auditInput.sourceLabel,
      projectName: activeProject.name,
      typologyName: activeProject.type ?? costConfig.typologyId,
      ngf: costConfig.ngf,
      elements: els,
      costResult,
      energyResult,
      getClashes: () => getSplit().real,
      getGroups: () =>
        (cache.groups ??= withGroupLevels(groupClashes(getSplit().real, classOf), (id) => byId.get(id))),
      getConnectionCount: () => getSplit().connectionCount,
      getAudit: () => (cache.audit ??= AuditEngine.runFullAudit(els)),
      getMatch: () => (cache.match ??= matchMaterials(els, costConfig.ngf)),
    };
  }, [elements, activeProjectId, takeoff, costResult, energyResult, activeProject, costConfig]);
}

/// Rendu `**gras**` léger (réponses templatisées du moteur).
export function iqFormatText(t: string) {
  return t.split("\n").map((line, i) => (
    <p key={i} className={cn("leading-relaxed", line.startsWith("•") && "ml-2")}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={j} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </p>
  ));
}

/// Une réponse à la NARCHI IQ : texte, tableaux, outils, warning, action.
export function IqAnswerBody({
  answer,
  compact = false,
  onNavigate,
  onExplain,
}: {
  answer: IqAnswer;
  compact?: boolean;
  onNavigate?: (target: string) => void;
  onExplain?: (answer: IqAnswer) => void;
}) {
  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <p className={cn("leading-relaxed text-slate-700", compact ? "text-[13px]" : "text-sm")}>{iqFormatText(answer.text)}</p>
      {answer.rows && answer.rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          {answer.rows.map((r, i) => (
            <div key={i} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-xs", i % 2 === 0 ? "bg-slate-50" : "bg-white")}>
              <span className="min-w-0 truncate text-slate-600">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-2 text-right">
                <span className="font-semibold tabular-nums text-slate-900">{r.value}</span>
                {r.hint && <span className="text-[10px] text-slate-400">{r.hint}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {answer.warning && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">⚠ {answer.warning}</p>
      )}
      {(answer.action && onNavigate) || onExplain ? (
        <div className="flex flex-wrap gap-2">
          {answer.action && onNavigate && (
            <button
              onClick={() => onNavigate(answer.action!.target)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-brand-700"
            >
              {answer.action.label}
              <Icon name="arrowRight" size={12} />
            </button>
          )}
          {onExplain && (
            <button
              type="button"
              onClick={() => onExplain(answer)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-brand-400"
            >
              Lokal erklären
            </button>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
          {answer.tools.length > 0 ? "ausgeführte Werkzeuge:" : "kein Werkzeug nötig"}
        </span>
        {answer.tools.map((t) => (
          <span key={t.id} title={t.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/// Fil de conversation complet (question à droite, réponse à gauche).
export function IqThread({
  exchanges,
  emptyHint,
  compact = false,
  onNavigate,
  onExplain,
  feedbackSlot,
}: {
  exchanges: IqExchange[];
  emptyHint: React.ReactNode;
  compact?: boolean;
  onNavigate?: (target: string) => void;
  onExplain?: (answer: IqAnswer) => void;
  feedbackSlot?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {exchanges.map((ex) => (
        <div key={ex.id} className={cn("space-y-2", compact && "space-y-1.5")}>
          <div className="flex justify-end">
            <div className={cn("rounded-2xl rounded-br-sm bg-brand-600 text-white shadow-sm", compact ? "max-w-[90%] px-3.5 py-2 text-sm" : "max-w-xl px-4 py-2.5 text-sm")}>
              {ex.question}
            </div>
          </div>
          <div className={compact ? "max-w-full" : "max-w-3xl"}>
            <div className={cn("rounded-2xl rounded-bl-sm bg-white ring-1 ring-slate-200 shadow-sm", compact ? "px-3.5 py-2.5" : "p-4")}>
              <IqAnswerBody answer={ex.answer} compact={compact} onNavigate={onNavigate} onExplain={onExplain} />
              <div className="mt-1 text-right text-[10px] text-slate-300">{ex.at}</div>
            </div>
          </div>
        </div>
      ))}
      {feedbackSlot}
      {exchanges.length === 0 && !feedbackSlot && emptyHint}
    </div>
  );
}
