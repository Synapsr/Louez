import type { AiAssistant, AiVisibilityView } from "@louez/api/contracts/ai-visibility";

/** Brand names stay as they are in every language; `other` is translated by the caller. */
export const AI_ASSISTANT_NAMES: Record<Exclude<AiAssistant, "other">, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  mistral: "Le Chat (Mistral)",
  meta_ai: "Meta AI",
  grok: "Grok",
  deepseek: "DeepSeek",
};

export interface AiAssistantRow {
  assistant: AiAssistant;
  visits: number;
  /** Reservations made during those visits, where the view counts them per assistant. */
  bookings?: number;
  hits: number;
}

/**
 * One row per assistant that sent a visit or whose crawlers read the store:
 * the most visits first, then the most reads.
 */
export function toAiAssistantRows(
  view: Pick<AiVisibilityView, "visits" | "crawls">,
): AiAssistantRow[] {
  const visits = new Map(view.visits.byAssistant.map((row) => [row.assistant, row.visits]));
  const hits = new Map(view.crawls.byAssistant.map((row) => [row.assistant, row.hits]));
  return [...new Set([...visits.keys(), ...hits.keys()])]
    .map((assistant) => ({
      assistant,
      visits: visits.get(assistant) ?? 0,
      hits: hits.get(assistant) ?? 0,
    }))
    .sort((a, b) => b.visits - a.visits || b.hits - a.hits);
}
