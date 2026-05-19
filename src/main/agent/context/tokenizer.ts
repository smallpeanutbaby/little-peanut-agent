/**
 * Token counter for context budgeting.
 *
 * Uses `gpt-tokenizer` (cl100k_base) by default — Anthropic/Gemini
 * tokens differ but the magnitude is close enough for the autocompact
 * heuristic. We add a small overhead for tool block envelopes so the
 * estimate doesn't undercount.
 *
 * Only ever called for budgeting decisions, never for billing — the
 * provider's reported `usage` is authoritative for cost.
 */

import { encode } from "gpt-tokenizer";
import type { CanonicalMessage, ContentBlock } from "../llm/types.js";

const PER_BLOCK_OVERHEAD = 3;
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export function tokensForBlock(block: ContentBlock): number {
  if (block.type === "text" || block.type === "reasoning") {
    return estimateTokens(block.text) + PER_BLOCK_OVERHEAD;
  }
  if (block.type === "tool_use") {
    return estimateTokens(block.name) + estimateTokens(safeJson(block.input)) + PER_BLOCK_OVERHEAD;
  }
  // tool_result
  const payload = block.output;
  if (payload.kind === "text") return estimateTokens(payload.text) + PER_BLOCK_OVERHEAD;
  if (payload.kind === "json") return estimateTokens(safeJson(payload.value)) + PER_BLOCK_OVERHEAD;
  let n = PER_BLOCK_OVERHEAD;
  for (const b of payload.blocks) {
    if (b.type === "text") n += estimateTokens(b.text);
    else n += 256; // images are roughly this; we don't have dims here
  }
  return n;
}

export function tokensForMessage(msg: CanonicalMessage): number {
  let n = PER_MESSAGE_OVERHEAD;
  for (const block of msg.blocks) n += tokensForBlock(block);
  return n;
}

export function tokensForHistory(messages: CanonicalMessage[]): number {
  let n = 0;
  for (const m of messages) n += tokensForMessage(m);
  return n;
}

function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
