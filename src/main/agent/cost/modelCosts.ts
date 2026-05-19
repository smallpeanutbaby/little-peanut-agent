/**
 * Per-model USD pricing table (input / output USD per 1M tokens).
 *
 * Conservative defaults — we'd rather over-estimate than show a $0
 * cost. Numbers refreshed against public pricing pages; off-by-a-bit
 * is fine because this is for showing the user a running tally, not
 * for billing.
 */

export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

const TABLE: Array<{ match: RegExp; price: ModelPrice }> = [
  // OpenAI
  { match: /gpt-5\.5/i, price: { inputUsdPerMTok: 5.0, outputUsdPerMTok: 15.0 } },
  { match: /gpt-5/i, price: { inputUsdPerMTok: 3.0, outputUsdPerMTok: 12.0 } },
  { match: /gpt-4o/i, price: { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10.0 } },
  { match: /gpt-4-turbo/i, price: { inputUsdPerMTok: 10.0, outputUsdPerMTok: 30.0 } },
  { match: /gpt-4/i, price: { inputUsdPerMTok: 30.0, outputUsdPerMTok: 60.0 } },
  { match: /o3-mini/i, price: { inputUsdPerMTok: 1.1, outputUsdPerMTok: 4.4 } },
  { match: /o3|o4/i, price: { inputUsdPerMTok: 5.0, outputUsdPerMTok: 20.0 } },
  // Anthropic
  { match: /claude-(opus|claude-4\.7-opus)/i, price: { inputUsdPerMTok: 15.0, outputUsdPerMTok: 75.0 } },
  { match: /claude-sonnet|claude-4\.6/i, price: { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 } },
  { match: /claude-haiku/i, price: { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4.0 } },
  // Google Gemini
  { match: /gemini-2\.\d.*pro/i, price: { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10.0 } },
  { match: /gemini-2\.\d.*flash/i, price: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 } },
  { match: /gemini-1\.5-pro/i, price: { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10.0 } },
  { match: /gemini-1\.5-flash/i, price: { inputUsdPerMTok: 0.075, outputUsdPerMTok: 0.3 } }
];

const FALLBACK: ModelPrice = { inputUsdPerMTok: 3.0, outputUsdPerMTok: 10.0 };

export function priceFor(model: string): ModelPrice {
  for (const row of TABLE) {
    if (row.match.test(model)) return row.price;
  }
  return FALLBACK;
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceFor(model);
  return (
    (promptTokens / 1_000_000) * p.inputUsdPerMTok +
    (completionTokens / 1_000_000) * p.outputUsdPerMTok
  );
}
