/**
 * Context compaction strategies.
 *
 * Two flavours, both inspired by Claude Code:
 *
 *  - **microcompact**: surgical. After every tool round, look at the
 *    NEW tool_result block(s) the loop just appended. If any of them
 *    is fat (>`MICRO_BLOCK_THRESHOLD` tokens), replace its body with a
 *    short summary referencing the run id; the renderer still shows
 *    the full text from the persisted `message_part` row. This is the
 *    cheap "free shrinking" pass.
 *
 *  - **autocompact**: the heavyweight pass. When `tokensForHistory >
 *    targetBudget * COMPACT_THRESHOLD`, we summarise EVERY message
 *    older than `keepRecent` into one synthetic "assistant" message
 *    with the headline, decisions, open questions, and pointers to
 *    the persisted rows. The rest of the history is kept verbatim so
 *    the model retains the most recent turns at full fidelity.
 *
 *  - **PTL fallback** (Provider Token Limit): when even after
 *    autocompact the request would exceed the model's published
 *    context window, we drop tool_result bodies entirely (replacing
 *    each with a `[truncated for context limit]` marker) BEFORE the
 *    LLM call. The renderer still shows the originals.
 */

import type { CanonicalMessage, ContentBlock, ToolResultBlock } from "../llm/types.js";
import { tokensForBlock, tokensForHistory } from "./tokenizer.js";

const MICRO_BLOCK_THRESHOLD = 2000;
const COMPACT_THRESHOLD = 0.75;
const KEEP_RECENT_MESSAGES = 6;

export interface CompactionMetrics {
  before: number;
  after: number;
  strategy: "noop" | "microcompact" | "autocompact" | "ptl";
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/* microcompact                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Look at the LAST user message (which carries the tool_result blocks
 * the loop just appended) and shrink any oversize tool_result bodies
 * to a one-line summary + pointer. Mutates the message in place and
 * returns a metrics record for telemetry.
 */
export function microcompactLastToolResults(messages: CanonicalMessage[]): CompactionMetrics {
  const before = tokensForHistory(messages);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return { before, after: before, strategy: "noop" };
  }
  let shrunk = 0;
  last.blocks = last.blocks.map((block) => {
    if (block.type !== "tool_result") return block;
    const size = tokensForBlock(block);
    if (size <= MICRO_BLOCK_THRESHOLD) return block;
    shrunk += 1;
    return shrinkToolResult(block);
  });
  const after = tokensForHistory(messages);
  return {
    before,
    after,
    strategy: shrunk > 0 ? "microcompact" : "noop",
    notes: shrunk > 0 ? `${shrunk} tool_result block(s) summarised` : undefined
  };
}

function shrinkToolResult(block: ToolResultBlock): ToolResultBlock {
  const original = previewToolResult(block);
  const text =
    `[tool_result for ${block.toolUseId} — summarised by microcompact]\n` +
    `Original size: ${tokensForBlock(block)} tokens.\n` +
    `Preview:\n${original.slice(0, 800)}${original.length > 800 ? "\n…" : ""}`;
  return {
    type: "tool_result",
    toolUseId: block.toolUseId,
    output: { kind: "text", text },
    isError: block.isError
  };
}

function previewToolResult(block: ToolResultBlock): string {
  const p = block.output;
  if (p.kind === "text") return p.text;
  if (p.kind === "json") {
    try {
      return JSON.stringify(p.value, null, 2);
    } catch {
      return String(p.value);
    }
  }
  return p.blocks
    .map((b) => (b.type === "text" ? b.text : `[image:${b.mediaType}]`))
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* autocompact                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Returns a NEW messages array with everything older than
 * `KEEP_RECENT_MESSAGES` collapsed into a single synthetic assistant
 * message summarising the trimmed window.
 *
 * Triggered when `tokensForHistory(messages) > budget * COMPACT_THRESHOLD`.
 * `budget` should be the model's effective context window minus the
 * room reserved for the next reply (caller decides).
 */
export function autocompact(
  messages: CanonicalMessage[],
  budget: number
): { messages: CanonicalMessage[]; metrics: CompactionMetrics } {
  const before = tokensForHistory(messages);
  if (before <= budget * COMPACT_THRESHOLD || messages.length <= KEEP_RECENT_MESSAGES + 2) {
    return { messages, metrics: { before, after: before, strategy: "noop" } };
  }
  const keepFrom = messages.length - KEEP_RECENT_MESSAGES;
  const old = messages.slice(0, keepFrom);
  const recent = messages.slice(keepFrom);
  const summary = summariseOlder(old);
  const newMessages: CanonicalMessage[] = [
    {
      role: "assistant",
      blocks: [
        {
          type: "text",
          text: summary
        }
      ]
    },
    ...recent
  ];
  const after = tokensForHistory(newMessages);
  return {
    messages: newMessages,
    metrics: {
      before,
      after,
      strategy: "autocompact",
      notes: `collapsed ${old.length} messages into 1 summary`
    }
  };
}

function summariseOlder(old: CanonicalMessage[]): string {
  // Build a compact text summary: user prompts verbatim, assistant
  // text shortened, tool calls listed by name + count, tool_result
  // bodies dropped (the model only sees the summary not the data).
  const lines: string[] = ["[autocompact summary of earlier turns]"];
  const toolUseCounts = new Map<string, number>();
  for (const msg of old) {
    if (msg.role === "user") {
      const text = msg.blocks
        .filter((b: ContentBlock) => b.type === "text" || b.type === "tool_result")
        .map((b: ContentBlock) =>
          b.type === "text"
            ? `user: ${b.text}`
            : `user: [tool_result for ${(b as ToolResultBlock).toolUseId}]`
        )
        .join("\n");
      if (text) lines.push(text);
    } else if (msg.role === "assistant") {
      for (const b of msg.blocks) {
        if (b.type === "text") {
          lines.push(`assistant: ${shorten(b.text, 400)}`);
        } else if (b.type === "tool_use") {
          toolUseCounts.set(b.name, (toolUseCounts.get(b.name) ?? 0) + 1);
        }
      }
    }
  }
  if (toolUseCounts.size > 0) {
    const tally = [...toolUseCounts.entries()]
      .map(([name, n]) => `${name}×${n}`)
      .join(", ");
    lines.push(`tools called: ${tally}`);
  }
  lines.push("[end summary — the full transcript is persisted in the conversation; reference it only if asked]");
  return lines.join("\n");
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "…";
}

/* -------------------------------------------------------------------------- */
/* PTL fallback                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Last-resort: drop tool_result bodies to fit under `hardCap`. Used
 * when even autocompact wouldn't bring us under the provider's
 * published context window.
 */
export function applyPtlFallback(
  messages: CanonicalMessage[],
  hardCap: number
): { messages: CanonicalMessage[]; metrics: CompactionMetrics } {
  const before = tokensForHistory(messages);
  if (before <= hardCap) {
    return { messages, metrics: { before, after: before, strategy: "noop" } };
  }
  const newMessages = messages.map((msg) => ({
    ...msg,
    blocks: msg.blocks.map((b) =>
      b.type === "tool_result"
        ? ({
            type: "tool_result",
            toolUseId: b.toolUseId,
            output: {
              kind: "text" as const,
              text: `[tool_result for ${b.toolUseId} truncated to fit provider context window]`
            },
            isError: b.isError
          } as ToolResultBlock)
        : b
    )
  }));
  const after = tokensForHistory(newMessages);
  return {
    messages: newMessages,
    metrics: {
      before,
      after,
      strategy: "ptl",
      notes: "dropped tool_result bodies"
    }
  };
}
