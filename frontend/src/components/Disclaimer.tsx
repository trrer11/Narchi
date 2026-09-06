// Narchi — legal disclaimer system.
// Every normative calculation carries a clear scope-of-use note so the planner
// always knows it is an Orientierungswert, not a legally binding certificate.
// This protects liability (the #1 concern of a German planning office).

import { Icon } from "@/components/ui";
import { cn } from "@/utils/cn";

export type DisclaimerLevel = "binding" | "orientation" | "illustrative";

const META: Record<DisclaimerLevel, { tone: string; icon: string; title: string; text: string }> = {
  binding: {
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: "shield",
    title: "Rechtsverbindlicher Nachweis",
    text: "Dieses Ergebnis entspricht den offiziellen Berechnungsmethoden und ist einreichungsfähig.",
  },
  orientation: {
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    icon: "alert",
    title: "Orientierungswert — kein rechtsverbindlicher Nachweis",
    text: "Dieser Wert dient der frühen Kostensicherheit in der Planung. Für die Baueingabe / den Energieausweis ist die Prüfung und Bestätigung durch einen zugelassenen Sachverständigen (Energiefachberater, Prüfstatiker) erforderlich. Die fachliche Verantwortung verbleibt beim Planer.",
  },
  illustrative: {
    tone: "border-slate-200 bg-slate-50 text-slate-600",
    icon: "spark",
    title: "Illustrativer Wert",
    text: "Dieser Wert ist eine Planungshilfe und ersetzt keine offizielle Berechnung.",
  },
};

export function Disclaimer({
  level = "orientation",
  domain,
  className,
}: {
  level?: DisclaimerLevel;
  domain?: string;
  className?: string;
}) {
  const m = META[level];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed", m.tone, className)}>
      <Icon name={m.icon as never} size={15} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">{m.title}{domain && <span className="font-normal"> · {domain}</span>}</p>
        <p className="mt-0.5 opacity-90">{m.text}</p>
      </div>
    </div>
  );
}
