/** §252 RAG bureau — pas LlamaIndex. Découpage + score lexical. 0 invention. */

export interface FactChunk {
  id: string;
  title: string;
  text: string;
}

const STOP = new Set(
  "der die das den dem des ein eine und oder mit von zu im in am auf für ist sind hat haben wie was wer".split(" "),
);

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function scoreChunk(tokens: string[], chunk: FactChunk): number {
  const hay = `${chunk.title} ${chunk.text}`.toLowerCase();
  let n = 0;
  for (const t of tokens) {
    if (hay.includes(t)) n += 1;
  }
  return n;
}

/** Les N meilleurs chunks ; si aucun jeton ne match, on garde les premiers faits. */
export function retrieveFacts(question: string, chunks: FactChunk[], limit = 6): FactChunk[] {
  const tokens = tokenize(question);
  if (chunks.length === 0) return [];
  if (tokens.length === 0) return chunks.slice(0, limit);
  const ranked = [...chunks]
    .map((c) => ({ c, s: scoreChunk(tokens, c) }))
    .sort((a, b) => b.s - a.s);
  const hit = ranked.filter((x) => x.s > 0).map((x) => x.c);
  if (hit.length > 0) return hit.slice(0, limit);
  return chunks.slice(0, Math.min(3, limit));
}

export function factsToPrompt(chunks: FactChunk[]): string {
  if (chunks.length === 0) return "(keine Fakten)";
  return chunks.map((c) => `[${c.title}]\n${c.text}`).join("\n\n");
}

export function packOfficeChunks(input: {
  projectName: string;
  ngf: number;
  ngfQuelle?: string;
  bauteile: number;
  sourceLabel: string;
  toolAnswer: string;
  toolRows?: { label: string; value: string }[];
}): FactChunk[] {
  const chunks: FactChunk[] = [
    {
      id: "proj",
      title: "Projekt",
      text: `Name: ${input.projectName || "—"}. Quelle: ${input.sourceLabel}. Bauteile: ${input.bauteile}.`,
    },
    {
      id: "ngf",
      title: "NGF",
      text: `NGF ${input.ngf} m², Herkunft ${input.ngfQuelle || "keine"}. 0 bleibt 0.`,
    },
    {
      id: "werkzeug",
      title: "Werkzeugantwort",
      text: input.toolAnswer.slice(0, 2500),
    },
  ];
  if (input.toolRows && input.toolRows.length > 0) {
    chunks.push({
      id: "tabelle",
      title: "Tabelle",
      text: input.toolRows.map((r) => `${r.label}: ${r.value}`).join("; "),
    });
  }
  return chunks;
}
