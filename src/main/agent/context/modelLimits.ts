/**
 * Best-effort context window estimates per model.
 *
 * Used only for sizing the compaction budget — when the model isn't
 * in the table we fall back to a conservative default. Numbers are
 * intentionally rounded down to leave headroom for the response.
 */

export interface ModelContextInfo {
  /** Hard upper bound for prompt + response. */
  contextWindow: number;
  /** Soft target for prompt only — we trigger autocompact at 75% of this. */
  promptBudget: number;
}

const TABLE: Array<{ match: RegExp; info: ModelContextInfo }> = [
  // Anthropic
  { match: /claude-(opus|sonnet|haiku)/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },
  { match: /claude-4|claude-4\.6|claude-4\.7/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },
  // OpenAI (GPT family — Responses + Chat)
  { match: /gpt-5/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },
  { match: /gpt-4o|gpt-4\.1/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  { match: /gpt-4-turbo/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  { match: /gpt-4/i, info: { contextWindow: 8_000, promptBudget: 6_000 } },
  { match: /o3|o4/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  // Google Gemini
  { match: /gemini-2\.\d/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },
  { match: /gemini-1\.5-(pro|flash)/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } }
];

const FALLBACK: ModelContextInfo = { contextWindow: 128_000, promptBudget: 100_000 };

export function modelContextFor(model: string): ModelContextInfo {
  for (const row of TABLE) {
    if (row.match.test(model)) return row.info;
  }
  return FALLBACK;
}
