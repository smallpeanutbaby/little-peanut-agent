/**
 * Anthropic Messages API adapter.
 *
 * Uses content blocks natively — `tool_use` and `tool_result` are
 * first-class. Streaming is via SSE with the `content_block_delta` /
 * `content_block_start` / `content_block_stop` event types. Tool-call
 * arguments arrive as `input_json_delta` (already JSON-fragment).
 *
 * Differences from OpenAI we need to bridge:
 *  - System prompts go in a top-level `system` field, not in the
 *    messages array.
 *  - Each `content_block_start` opens a block with a known index; we
 *    track them by that index and accumulate per-block deltas.
 *  - The model can interleave thinking blocks (`thinking` /
 *    `thinking_delta`). We surface them as `reasoning_delta`.
 */

import { parseSse, mapBudget } from "../../../ai/adapter.js";
import type { LlmAdapter, LlmRequest, LlmStreamEvent, CanonicalMessage, ToolResultPayload } from "../types.js";

type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" | undefined;

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
    Accept: "text/event-stream"
  };
}

function payloadToBlocks(p: ToolResultPayload): Array<Record<string, unknown>> {
  if (p.kind === "text") return [{ type: "text", text: p.text }];
  if (p.kind === "json") return [{ type: "text", text: JSON.stringify(p.value) }];
  return p.blocks.map((b) =>
    b.type === "text"
      ? { type: "text", text: b.text }
      : {
          type: "image",
          source: { type: "base64", media_type: b.mediaType, data: b.base64 }
        }
  );
}

function toAnthropicMessages(messages: CanonicalMessage[]): Array<Record<string, unknown>> {
  // Anthropic forbids system messages in the array.
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const blocks: Array<Record<string, unknown>> = [];
      for (const b of m.blocks) {
        if (b.type === "text") {
          if (b.text) blocks.push({ type: "text", text: b.text });
        } else if (b.type === "tool_use") {
          blocks.push({
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: b.input ?? {}
          });
        } else if (b.type === "tool_result") {
          blocks.push({
            type: "tool_result",
            tool_use_id: b.toolUseId,
            content: payloadToBlocks(b.output),
            ...(b.isError ? { is_error: true } : {})
          });
        }
        // reasoning blocks are not sent back; the model recreates them on
        // its own. (Anthropic does have `redacted_thinking` for caching,
        // but we omit it for v1 simplicity.)
      }
      // Anthropic requires at least one block per message.
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      return { role: m.role === "assistant" ? "assistant" : "user", content: blocks };
    });
}

export class AnthropicLlmAdapter implements LlmAdapter {
  async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const url = `${trimSlash(req.provider.baseUrl)}/messages`;
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: toAnthropicMessages(req.messages),
      stream: true
    };
    if (req.system.length > 0) {
      // Multi-segment system enables prompt caching (each segment can be
      // independently cached). Pass-through verbatim.
      body.system = req.system.map((s) => ({ type: "text", text: s }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.thinkBudget && req.thinkBudget !== "none") {
      const budget = mapBudget("anthropic", req.thinkBudget);
      if (typeof budget === "number") {
        body.thinking = { type: "enabled", budget_tokens: budget };
      }
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      }));
      if (req.toolChoice === "none") {
        body.tool_choice = { type: "none" };
      } else if (typeof req.toolChoice === "object" && req.toolChoice && "name" in req.toolChoice) {
        body.tool_choice = { type: "tool", name: req.toolChoice.name };
      } else {
        body.tool_choice = { type: "auto" };
      }
    }

    yield { type: "message_start" };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: anthropicHeaders(req.provider.apiKey),
        body: JSON.stringify(body),
        signal: req.signal
      });
    } catch (e) {
      yield { type: "error", code: "network", retryable: true, message: (e as Error).message || "network" };
      return;
    }
    if (!res.ok || !res.body) {
      const text = await safeReadBody(res);
      yield {
        type: "error",
        code: String(res.status),
        retryable: res.status === 429 || res.status >= 500,
        message: text
      };
      return;
    }

    // Per-block accumulators, keyed by block index. We only care about
    // tool_use blocks here; text / reasoning are forwarded as they arrive.
    interface PendingTool {
      id: string;
      name: string;
      argsBuf: string;
    }
    const pending = new Map<number, PendingTool>();
    let stopReason: StopReason;
    let usagePrompt = 0;
    let usageCompletion = 0;
    let usageSeen = false;

    try {
      for await (const payload of parseSse(res.body, req.signal)) {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const t = json.type as string;
        if (t === "content_block_start") {
          const idx = Number(json.index ?? 0);
          const block = json.content_block as Record<string, unknown> | undefined;
          if (block?.type === "tool_use") {
            const id = String(block.id ?? `call_${idx}`);
            const name = String(block.name ?? "");
            pending.set(idx, { id, name, argsBuf: "" });
            yield { type: "tool_use_start", id, name };
          }
        } else if (t === "content_block_delta") {
          const idx = Number(json.index ?? 0);
          const d = json.delta as Record<string, unknown> | undefined;
          if (!d) continue;
          if (d.type === "text_delta" && typeof d.text === "string") {
            yield { type: "text_delta", text: d.text };
          } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
            yield { type: "reasoning_delta", text: d.thinking };
          } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
            const cur = pending.get(idx);
            if (cur) {
              cur.argsBuf += d.partial_json;
              yield { type: "tool_use_input_delta", id: cur.id, jsonChunk: d.partial_json };
            }
          }
        } else if (t === "content_block_stop") {
          const idx = Number(json.index ?? 0);
          const cur = pending.get(idx);
          if (cur) {
            let finalInput: unknown = {};
            const trimmed = cur.argsBuf.trim();
            if (trimmed) {
              try {
                finalInput = JSON.parse(trimmed);
              } catch {
                finalInput = { __raw: trimmed, __parse_error: true };
              }
            }
            yield { type: "tool_use_stop", id: cur.id, finalInput };
            pending.delete(idx);
          }
        } else if (t === "message_delta") {
          const d = json.delta as Record<string, unknown> | undefined;
          if (d?.stop_reason && typeof d.stop_reason === "string") {
            stopReason = mapAnthropicStop(d.stop_reason);
          }
          const u = json.usage as Record<string, unknown> | undefined;
          if (u && typeof u.output_tokens !== "undefined") {
            usageCompletion = Number(u.output_tokens);
            usageSeen = true;
          }
        } else if (t === "message_start") {
          const msg = json.message as Record<string, unknown> | undefined;
          const u = msg?.usage as Record<string, unknown> | undefined;
          if (u && typeof u.input_tokens !== "undefined") {
            usagePrompt = Number(u.input_tokens);
            usageSeen = true;
          }
        } else if (t === "message_stop") {
          break;
        } else if (t === "error") {
          const err = json.error as Record<string, unknown> | undefined;
          yield {
            type: "error",
            code: String(err?.type ?? "anthropic_error"),
            retryable: err?.type === "overloaded_error" || err?.type === "rate_limit_error",
            message: String(err?.message ?? "Anthropic error")
          };
          return;
        }
      }
    } catch (e) {
      if (req.signal.aborted) {
        yield { type: "error", code: "aborted", retryable: false, message: "aborted" };
        return;
      }
      yield {
        type: "error",
        code: "stream",
        retryable: true,
        message: (e as Error).message || "stream"
      };
      return;
    }

    if (usageSeen) {
      yield { type: "usage", promptTokens: usagePrompt, completionTokens: usageCompletion };
    }
    yield { type: "message_stop", stopReason };
  }
}

function mapAnthropicStop(reason: string): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
