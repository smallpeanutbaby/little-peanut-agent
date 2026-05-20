/**
 * Unified context budgeting — shared by queryLoop and contextSnapshot.
 *
 * Goal: the number we show in the UI (`usedTokens`) must never exceed
 * `windowTokens`, and the payload we send must fit under the provider's
 * hard prompt cap (window minus reserved output headroom).
 */

import type { CanonicalMessage } from "../llm/types.js";
import type { ModelContextInfo } from "./modelLimits.js";
import {
  autocompact,
  applyPtlFallback,
  microcompactAllToolResults,
  truncateMessagesToFit
} from "./compaction.js";
import { tokensForHistory } from "./tokenizer.js";

const OUTPUT_RESERVE = 4096;
const SAFETY_MARGIN = 2000;

export function computePromptHardCap(
  contextWindow: number,
  maxOutputTokens = OUTPUT_RESERVE
): number {
  return Math.max(8_000, contextWindow - maxOutputTokens - SAFETY_MARGIN);
}

export interface PreparedContext {
  messages: CanonicalMessage[];
  usedTokens: number;
  hardCap: number;
  compacted: boolean;
  notes: string[];
  before: number;
}

/**
 * Run the full compaction pipeline until history fits under `hardCap`.
 * Trigger autocompact early (≈85% of hard cap) so we don't ride the cliff.
 */
export function prepareContextForLlm(
  history: CanonicalMessage[],
  ctx: ModelContextInfo,
  opts?: { maxOutputTokens?: number }
): PreparedContext {
  const hardCap = computePromptHardCap(ctx.contextWindow, opts?.maxOutputTokens ?? OUTPUT_RESERVE);
  const before = tokensForHistory(history);
  let current = history;
  const notes: string[] = [];

  const softTrigger = Math.min(
    Math.floor(ctx.promptBudget * 0.75),
    Math.floor(hardCap * 0.85)
  );

  if (before > softTrigger) {
    const ac = autocompact(current, hardCap);
    if (ac.metrics.strategy !== "noop") {
      current = ac.messages;
      notes.push(`autocompact ${ac.metrics.before}→${ac.metrics.after}`);
    }
  }

  let ptl = applyPtlFallback(current, hardCap);
  if (ptl.metrics.strategy !== "noop") {
    current = ptl.messages;
    notes.push(`ptl ${ptl.metrics.before}→${ptl.metrics.after}`);
  }

  if (tokensForHistory(current) > hardCap) {
    const mc = microcompactAllToolResults(current);
    if (mc.strategy !== "noop") {
      current = mc.messages;
      notes.push(`microcompact-all ${mc.before}→${mc.after}`);
    }
  }

  for (const keepRecent of [4, 2, 0] as const) {
    if (tokensForHistory(current) <= hardCap) break;
    const ac = autocompact(current, hardCap, { keepRecent, force: true });
    if (ac.metrics.strategy !== "noop") {
      current = ac.messages;
      notes.push(`autocompact(keep=${keepRecent}) ${ac.metrics.before}→${ac.metrics.after}`);
    }
  }

  ptl = applyPtlFallback(current, hardCap);
  if (ptl.metrics.strategy !== "noop") {
    current = ptl.messages;
    notes.push(`ptl ${ptl.metrics.before}→${ptl.metrics.after}`);
  }

  if (tokensForHistory(current) > hardCap) {
    const truncated = truncateMessagesToFit(current, hardCap);
    current = truncated.messages;
    if (truncated.metrics.strategy !== "noop") {
      notes.push(`truncate ${truncated.metrics.before}→${truncated.metrics.after}`);
    }
  }

  const usedTokens = Math.min(tokensForHistory(current), ctx.contextWindow);
  return {
    messages: current,
    usedTokens,
    hardCap,
    compacted: notes.length > 0,
    notes,
    before
  };
}
