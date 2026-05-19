/**
 * Best-effort context window estimates per model.
 *
 * Used by the agent runtime to:
 *   - size the autocompact threshold (`promptBudget * COMPACT_THRESHOLD`)
 *   - size the PTL hard-cap (`contextWindow - maxOutputTokens - safety`)
 *
 * Match order matters: more specific patterns must appear BEFORE more
 * generic ones (e.g. `qwen3-max` before the catch-all `qwen`). Numbers
 * are deliberately rounded so we always leave headroom for the response.
 *
 * `promptBudget` is the soft target for prompt-only tokens; we trigger
 * autocompact at 75% of it. `contextWindow` is the hard upper bound for
 * prompt + response combined. When `think` is enabled the effective
 * promptBudget is reduced by a per-tier reservation so reasoning tokens
 * don't eat into the space the model needs for tool arguments.
 *
 * Keep this table in sync with `src/renderer/src/constants/providers.ts`
 * — when a new model is added there it should land here too. Any model
 * we don't recognise falls back to a conservative 128k / 100k.
 */

import type { ThinkBudget } from "@shared/types.js";

export interface ModelContextInfo {
  /** Hard upper bound for prompt + response (per provider docs). */
  contextWindow: number;
  /** Soft target for prompt only — autocompact triggers at 75% of this. */
  promptBudget: number;
}

/**
 * How many tokens to reserve for the model's reasoning trace when think
 * mode is active. Values align with the OpenAI 5-tier ladder and the
 * approximate budget_tokens Anthropic / thinkingBudget Gemini map to.
 * For binary-protocol providers (DeepSeek / GLM / Kimi / MiniMax / Qwen)
 * the runtime hard-maps think_on → "medium" (8k) to be safe.
 */
const THINK_RESERVATION_TOKENS: Record<Exclude<ThinkBudget, "none" | "dynamic">, number> = {
  minimal: 2_000,
  low: 4_000,
  medium: 8_000,
  high: 16_000,
  xhigh: 32_000,
  max: 64_000
};

const TABLE: Array<{ match: RegExp; info: ModelContextInfo }> = [
  /* ── Anthropic ─────────────────────────────────────────────────────── */
  // claude-opus-4-7 / claude-sonnet-4-7 / claude-haiku-4-7 — current
  // generation, 200k window per Anthropic docs.
  { match: /claude-(opus|sonnet|haiku)-4-7/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },
  // Older claude-4 family kept for any user-pinned custom models.
  { match: /claude-(opus|sonnet|haiku)-4/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },
  // Generic claude- prefix catches anything we missed (3.5, 3.7, etc).
  { match: /claude-/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },

  /* ── OpenAI ────────────────────────────────────────────────────────── */
  // GPT-5.5 / 5.4 / 5.3 family: 256k window (Responses + Chat).
  { match: /^gpt-5(\.\d+)?(-(pro|mini|nano))?/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },
  // GPT-4o / 4.1 / 4-turbo: 128k window.
  { match: /^gpt-4o|^gpt-4\.1|^gpt-4-turbo/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  // o-series reasoning models: 200k.
  { match: /^o[34](-mini|-preview)?$/i, info: { contextWindow: 200_000, promptBudget: 160_000 } },
  // Legacy gpt-4 (8k).
  { match: /^gpt-4(?!-)/i, info: { contextWindow: 8_000, promptBudget: 6_000 } },

  /* ── Google Gemini ─────────────────────────────────────────────────── */
  // Gemini 3.x is the current flagship — 1M window for pro/flash, 256k
  // for flash-lite. Match order: lite first so it doesn't get swept up
  // by the generic 3.x pattern.
  { match: /gemini-3(\.\d+)?-flash-lite/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },
  { match: /gemini-3(\.\d+)?(-pro|-flash)?/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },
  // Gemini 2.5 (pro/flash/flash-lite): 1M for pro+flash, 1M for flash-lite as well.
  { match: /gemini-2\.5-flash-lite/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },
  { match: /gemini-2\.\d/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },
  // Older gemini-1.5 family.
  { match: /gemini-1\.5-(pro|flash)/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },

  /* ── DeepSeek ──────────────────────────────────────────────────────── */
  // deepseek-v4-pro / v4-flash: 128k window per DeepSeek docs (think
  // mode does NOT enlarge the window; it just steals from the budget,
  // which is what bit the user in the truncated-tool-call bug).
  { match: /deepseek-v4/i, info: { contextWindow: 128_000, promptBudget: 96_000 } },
  { match: /deepseek/i, info: { contextWindow: 128_000, promptBudget: 96_000 } },

  /* ── Zhipu AI (GLM) ────────────────────────────────────────────────── */
  // GLM-5.x flagship: 128k window. GLM-4.5/4.6 chat: 128k.
  // GLM-Z1 / vision variants: 128k. Keep conservative — 100k prompt.
  { match: /^glm-?[45]/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  { match: /glm-?z\d/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  { match: /glm-/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },

  /* ── Moonshot Kimi ─────────────────────────────────────────────────── */
  // kimi-k2.6 / k2.5: 256k window. Older moonshot-v1-* chat: 8k/32k/128k.
  { match: /kimi-k2(\.\d+)?/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },
  { match: /moonshot-v1-128k/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  { match: /moonshot-v1-32k/i, info: { contextWindow: 32_000, promptBudget: 24_000 } },
  { match: /moonshot-v1-8k/i, info: { contextWindow: 8_000, promptBudget: 6_000 } },

  /* ── Tongyi Qwen ───────────────────────────────────────────────────── */
  // qwen3-max: 1M tokens (Alibaba's flagship long-context model).
  { match: /qwen3?-max/i, info: { contextWindow: 1_000_000, promptBudget: 700_000 } },
  // qwen-long: 10M tokens (specialised long-context variant).
  { match: /qwen-long/i, info: { contextWindow: 10_000_000, promptBudget: 1_000_000 } },
  // qwen3.x plus/flash + qwen3-coder: 256k window.
  { match: /qwen3(\.\d+)?-(plus|flash|coder-plus|coder-flash)/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },
  // qwen-plus / qwen-turbo: 128k.
  { match: /qwen-(plus|turbo)/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },
  // Generic qwen fallback.
  { match: /qwen/i, info: { contextWindow: 128_000, promptBudget: 100_000 } },

  /* ── MiniMax ───────────────────────────────────────────────────────── */
  // MiniMax-M2.x / M1: 256k window (highspeed variants same).
  { match: /minimax-m\d/i, info: { contextWindow: 256_000, promptBudget: 200_000 } },

  /* ── SiliconFlow (proxies above models — match by suffix) ─────────── */
  // SiliconFlow ids look like `deepseek-ai/DeepSeek-V4-Flash`,
  // `Qwen/Qwen3-VL-32B-Instruct`, `zai-org/GLM-5.1`, `moonshotai/Kimi-K2.6`,
  // `MiniMaxAI/MiniMax-M2.5`. The patterns above already match the
  // suffix part case-insensitively, so we don't need extra rows here.
];

const FALLBACK: ModelContextInfo = { contextWindow: 128_000, promptBudget: 100_000 };

/**
 * Look up the (window, budget) for `model`. When `opts.thinkBudget` is
 * a real reasoning tier (not "none" / "dynamic" / undefined), the
 * returned `promptBudget` is reduced by the matching reservation from
 * THINK_RESERVATION_TOKENS — capped at 1/3 of the base promptBudget so
 * tiny-window models (e.g. moonshot-v1-8k) don't go negative if the
 * user accidentally turns on "high" reasoning.
 *
 * `contextWindow` stays untouched: it's the provider's hard ceiling and
 * we don't get to shrink it for our own bookkeeping.
 */
export function modelContextFor(
  model: string,
  opts?: { thinkBudget?: ThinkBudget }
): ModelContextInfo {
  let info: ModelContextInfo = FALLBACK;
  for (const row of TABLE) {
    if (row.match.test(model)) {
      info = row.info;
      break;
    }
  }
  const tb = opts?.thinkBudget;
  if (!tb || tb === "none" || tb === "dynamic") return info;
  const reservation = THINK_RESERVATION_TOKENS[tb];
  // Safety cap: reservation must never exceed 1/3 of the base budget,
  // otherwise small-window models would end up with so little prompt
  // space that autocompact triggers on the very first turn.
  const cap = Math.floor(info.promptBudget / 3);
  const effectiveReservation = Math.min(reservation, cap);
  return {
    contextWindow: info.contextWindow,
    promptBudget: info.promptBudget - effectiveReservation
  };
}
