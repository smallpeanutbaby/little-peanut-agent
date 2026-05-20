/**
 * OpenAI-compatible adapter (Chat Completions).
 *
 * Speaks the standard `/chat/completions` endpoint with `tools` /
 * `tool_calls`. Used for OpenAI proper plus every OpenAI-compatible
 * relay (DeepSeek / Moonshot / Qwen DashScope / SiliconFlow / etc.).
 *
 * Streaming quirk: OpenAI delivers tool call arguments as a sequence of
 * partial JSON string deltas in `choices[].delta.tool_calls[i].function.arguments`.
 * We accumulate the string per tool index and parse once on stop. We do
 * NOT try to incrementally parse partial JSON — too easy to mis-handle
 * trailing commas / unicode escapes / nested arrays cut mid-token.
 */

import { parseSse } from "../../../ai/adapter.js";
import { mapBudget } from "../../../ai/adapter.js";
import type { LlmAdapter, LlmRequest, LlmStreamEvent, CanonicalMessage } from "../types.js";
import { formatUserFacingError } from "@shared/displayText.js";

type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" | undefined;

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "claude-cli/1.0.0",
    "X-Stainless-Lang": "js",
    Accept: "text/event-stream"
  };
}

/* -------------------------------------------------------------------------- */
/* Canonical -> OpenAI translation                                            */
/* -------------------------------------------------------------------------- */

/**
 * Flatten a canonical message into the OpenAI wire shape. Tool results
 * become separate `role: "tool"` messages because OpenAI does not allow
 * embedding them in user content.
 */
function toOpenAiMessages(
  system: string[],
  messages: CanonicalMessage[]
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (system.length > 0) {
    out.push({ role: "system", content: system.join("\n\n") });
  }
  for (const m of messages) {
    if (m.role === "system") {
      const text = m.blocks
        .map((b) => (b.type === "text" ? b.text : b.type === "reasoning" ? b.text : ""))
        .filter(Boolean)
        .join("\n");
      out.push({ role: "system", content: text });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.blocks
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      const reasoning = m.blocks
        .filter((b) => b.type === "reasoning")
        .map((b) => (b.type === "reasoning" ? b.text : ""))
        .join("");
      const toolCalls = m.blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          if (b.type !== "tool_use") return null;
          return {
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input ?? {})
            }
          };
        })
        .filter(Boolean);
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (reasoning) msg.reasoning_content = reasoning;
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }
    // user role: may carry text + tool_result blocks. Tool results are
    // emitted as separate `role: "tool"` messages with matching
    // tool_call_id, *before* any pending user text — because OpenAI
    // requires every tool_call_id from the preceding assistant message
    // be answered before the next user turn.
    const toolResults = m.blocks.filter((b) => b.type === "tool_result");
    for (const tr of toolResults) {
      if (tr.type !== "tool_result") continue;
      out.push({
        role: "tool",
        tool_call_id: tr.toolUseId,
        content: payloadToText(tr.output)
      });
    }
    const text = m.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    if (text) {
      out.push({ role: "user", content: text });
    }
  }
  return sanitizeToolMessages(out);
}

/**
 * Ensure every `role: "tool"` message is preceded by an assistant message
 * that contains its `tool_call_id`. DeepSeek / OpenAI reject requests
 * where tool results are orphaned (no matching tool_calls).
 *
 * Also ensures that every tool_call_id in an assistant message has a
 * matching tool result; if not, injects a synthetic one so the API
 * doesn't complain about missing results.
 */
function sanitizeToolMessages(msgs: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let pendingToolCallIds = new Set<string>();

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      // Before pushing a new assistant with tool_calls, fill any
      // unanswered tool_call_ids from the PREVIOUS assistant.
      for (const id of pendingToolCallIds) {
        out.push({ role: "tool", tool_call_id: id, content: "[no result — interrupted]" });
      }
      pendingToolCallIds = new Set<string>();
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) pendingToolCallIds.add(tc.id);
      }
      out.push(msg);
      continue;
    }

    if (msg.role === "tool") {
      const tcId = msg.tool_call_id as string;
      if (pendingToolCallIds.has(tcId)) {
        pendingToolCallIds.delete(tcId);
        out.push(msg);
      } else {
        // Orphaned tool result — no preceding tool_call_id. Drop it to
        // avoid the API error; the information is still in the DB.
        console.warn(`[openai-adapter] dropping orphaned tool result for ${tcId}`);
      }
      continue;
    }

    // For non-tool, non-assistant messages: fill any unanswered tool_calls
    // before we switch to a user/system turn.
    if (msg.role !== "assistant" && pendingToolCallIds.size > 0) {
      for (const id of pendingToolCallIds) {
        out.push({ role: "tool", tool_call_id: id, content: "[no result — interrupted]" });
      }
      pendingToolCallIds = new Set<string>();
    }
    out.push(msg);
  }

  // Fill any remaining unanswered tool_calls at the end.
  for (const id of pendingToolCallIds) {
    out.push({ role: "tool", tool_call_id: id, content: "[no result — interrupted]" });
  }

  return out;
}

function payloadToText(p: { kind: "text"; text: string } | { kind: "json"; value: unknown } | { kind: "mixed"; blocks: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; base64: string }> }): string {
  if (p.kind === "text") return p.text;
  if (p.kind === "json") return JSON.stringify(p.value);
  return p.blocks
    .map((b) => (b.type === "text" ? b.text : `[image:${b.mediaType}]`))
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

export class OpenAILlmAdapter implements LlmAdapter {
  async *stream(req: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const url = `${trimSlash(req.provider.baseUrl)}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAiMessages(req.system, req.messages),
      stream: true,
      stream_options: { include_usage: true }
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    const thinkOn = req.thinkEnabled !== false && !!req.thinkBudget && req.thinkBudget !== "none";
    if (thinkOn) {
      const protocol = req.thinkProtocol ?? "openai";
      if (protocol === "binary") {
        body.enable_thinking = true;
      } else if (protocol === "qwen") {
        body.enable_thinking = true;
        const level = mapBudget("qwen", req.thinkBudget!);
        if (typeof level === "string") body.thinking_budget = level;
      } else if (protocol === "openai") {
        const effort = mapBudget("openai", req.thinkBudget!);
        if (effort) body.reasoning_effort = effort;
      }
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      }));
      if (req.toolChoice === "none") {
        body.tool_choice = "none";
      } else if (typeof req.toolChoice === "object" && req.toolChoice && "name" in req.toolChoice) {
        body.tool_choice = {
          type: "function",
          function: { name: req.toolChoice.name }
        };
      } else {
        body.tool_choice = "auto";
      }
    }

    yield { type: "message_start" };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: openAiHeaders(req.provider.apiKey),
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
        message: formatUserFacingError(text, "stream_error")
      };
      return;
    }

    // tool_use accumulators keyed by `index` (OpenAI streams deltas
    // identified by integer index, not call id — only the first chunk
    // carries the id + name).
    interface PendingCall {
      id: string;
      name: string;
      argsBuf: string;
    }
    const pending = new Map<number, PendingCall>();
    let stopReason: StopReason;

    try {
      for await (const payload of parseSse(res.body, req.signal)) {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
        if (choice) {
          const delta = choice.delta as Record<string, unknown> | undefined;
          if (delta) {
            const rContent =
              delta.reasoning_content ??
              delta.reasoning ??
              (typeof delta.reasoning === "object" &&
              delta.reasoning !== null &&
              typeof (delta.reasoning as { content?: unknown }).content === "string"
                ? (delta.reasoning as { content: string }).content
                : undefined);
            if (typeof rContent === "string" && rContent.length > 0) {
              yield { type: "reasoning_delta", text: rContent };
            }
            const content = delta.content;
            if (typeof content === "string" && content.length > 0) {
              yield { type: "text_delta", text: content };
            }
            const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
              for (const tc of toolCalls) {
                const idx = (tc.index as number) ?? 0;
                let cur = pending.get(idx);
                if (!cur) {
                  cur = {
                    id: String(tc.id ?? `call_${idx}`),
                    name: String((tc.function as Record<string, unknown> | undefined)?.name ?? ""),
                    argsBuf: ""
                  };
                  pending.set(idx, cur);
                  if (cur.name) {
                    yield { type: "tool_use_start", id: cur.id, name: cur.name };
                  }
                } else if (tc.id && !cur.id.startsWith("call_")) {
                  cur.id = String(tc.id);
                }
                const fn = tc.function as Record<string, unknown> | undefined;
                if (fn?.name && !cur.name) {
                  cur.name = String(fn.name);
                  yield { type: "tool_use_start", id: cur.id, name: cur.name };
                }
                if (typeof fn?.arguments === "string" && fn.arguments.length > 0) {
                  cur.argsBuf += fn.arguments;
                  yield { type: "tool_use_input_delta", id: cur.id, jsonChunk: fn.arguments };
                }
              }
            }
          }
          const fr = choice.finish_reason;
          if (typeof fr === "string" && fr) {
            stopReason = mapOpenAiFinish(fr);
          }
        }
        const usage = json.usage as Record<string, unknown> | undefined;
        if (usage) {
          yield {
            type: "usage",
            promptTokens: Number(usage.prompt_tokens ?? 0),
            completionTokens: Number(usage.completion_tokens ?? 0)
          };
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

    // Emit tool_use_stop for every pending tool call. Parse the accumulated
    // arguments here; if it's not valid JSON, surface `{}` so the runtime's
    // zod validation can produce a clean error.
    for (const cur of pending.values()) {
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
    }

    yield { type: "message_stop", stopReason };
  }
}

function mapOpenAiFinish(reason: string): StopReason {
  // OpenAI: stop | length | tool_calls | content_filter | function_call
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "stop_sequence";
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
