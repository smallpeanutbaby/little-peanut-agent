/**
 * Google Gemini adapter.
 *
 * Wire shape (highlights vs OpenAI/Anthropic):
 *  - Endpoint: `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
 *  - `system` segments fuse into the top-level `systemInstruction.parts`.
 *  - Roles: assistant → "model", user → "user". No "tool" role; tool
 *    responses live in a `user` message with `parts[].functionResponse`.
 *  - Tools: `tools: [{ functionDeclarations: [...] }]`. Gemini's schema
 *    dialect doesn't accept `$schema`/`additionalProperties` / `oneOf`
 *    via the wire, so the adapter strips them before sending.
 *  - Streaming: Gemini ships ONE `functionCall` part per chunk with the
 *    whole input filled in (no JSON deltas). The adapter emits
 *    `tool_use_start` + immediately `tool_use_stop` for each.
 *  - `usageMetadata` arrives on the final chunk → emit one `usage`.
 *
 * Caveats:
 *  - Gemini's `parallel function calling` is limited to "one per turn"
 *    on smaller models; that constraint is fine for the runtime, which
 *    handles serial execution natively.
 *  - The reasoning surface ("thinking") is opt-in via
 *    `generationConfig.thinkingConfig.thinkingBudget`. We map our
 *    `thinkBudget` through the existing `mapBudget("gemini", …)`.
 */

import { parseSse, mapBudget } from "../../../ai/adapter.js";
import type { LlmAdapter, LlmRequest, LlmStreamEvent, CanonicalMessage, ToolResultPayload } from "../types.js";

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function payloadToText(p: ToolResultPayload): string {
  if (p.kind === "text") return p.text;
  if (p.kind === "json") return JSON.stringify(p.value);
  return p.blocks
    .map((b) => (b.type === "text" ? b.text : `[image:${b.mediaType}]`))
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Message translation                                                        */
/* -------------------------------------------------------------------------- */

function buildContents(messages: CanonicalMessage[]): {
  systemInstruction: string | null;
  contents: Array<Record<string, unknown>>;
} {
  let systemInstruction: string | null = null;
  const contents: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      const text = msg.blocks
        .filter((b) => b.type === "text" || b.type === "reasoning")
        .map((b) => (b.type === "text" || b.type === "reasoning" ? b.text : ""))
        .join("\n\n");
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text;
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of msg.blocks) {
      if (block.type === "text") {
        if (block.text) parts.push({ text: block.text });
      } else if (block.type === "reasoning") {
        // Don't echo our own reasoning back to Gemini — its prompts
        // don't have a slot for it. Keep silent.
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            name: block.name,
            args: typeof block.input === "object" && block.input !== null ? block.input : {}
          }
        });
      } else if (block.type === "tool_result") {
        parts.push({
          functionResponse: {
            // Gemini matches tool_result back to tool_use by NAME, not
            // by id. The runtime sets `name` on the matching tool_use
            // block, but here we only have the toolUseId. Use the id
            // string as the name when nothing better is available; the
            // model treats unknown names as opaque and proceeds.
            name: block.toolUseId,
            response: {
              content: payloadToText(block.output),
              isError: !!block.isError
            }
          }
        });
      }
    }
    if (parts.length === 0) continue;
    contents.push({ role: msg.role === "assistant" ? "model" : "user", parts });
  }
  return { systemInstruction, contents };
}

/* -------------------------------------------------------------------------- */
/* Tool spec translation                                                      */
/* -------------------------------------------------------------------------- */

function sanitiseJsonSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema" || k === "additionalProperties" || k === "$ref" || k === "definitions" || k === "$defs") continue;
    if (k === "oneOf" || k === "anyOf" || k === "allOf") {
      // Gemini rejects these; collapse to the first variant's properties.
      const arr = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
      if (arr.length > 0) Object.assign(cleaned, sanitiseJsonSchemaForGemini(arr[0]));
      continue;
    }
    if (k === "properties" && v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        out[pk] = sanitiseJsonSchemaForGemini(pv as Record<string, unknown>);
      }
      cleaned[k] = out;
      continue;
    }
    if (k === "items" && v && typeof v === "object") {
      cleaned[k] = sanitiseJsonSchemaForGemini(v as Record<string, unknown>);
      continue;
    }
    cleaned[k] = v;
  }
  return cleaned;
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

export class GeminiLlmAdapter implements LlmAdapter {
  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    yield { type: "message_start" };

    const url =
      `${trimSlash(request.provider.baseUrl)}/models/${encodeURIComponent(request.model)}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(request.provider.apiKey)}`;

    const systemSegments = request.system.filter((s) => s && s.trim().length > 0);
    const systemFromSegments = systemSegments.join("\n\n---\n\n");
    const { systemInstruction: systemFromMessages, contents } = buildContents(request.messages);
    const finalSystem = [systemFromSegments, systemFromMessages].filter(Boolean).join("\n\n");

    const body: Record<string, unknown> = { contents };
    if (finalSystem) {
      body.systemInstruction = { parts: [{ text: finalSystem }] };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitiseJsonSchemaForGemini(t.inputSchema)
          }))
        }
      ];
    }
    if (request.toolChoice && request.toolChoice !== "auto") {
      body.toolConfig = {
        functionCallingConfig:
          request.toolChoice === "none"
            ? { mode: "NONE" }
            : { mode: "ANY", allowedFunctionNames: [request.toolChoice.name] }
      };
    }

    const genCfg: Record<string, unknown> = {};
    if (request.maxOutputTokens !== undefined) genCfg.maxOutputTokens = request.maxOutputTokens;
    if (request.temperature !== undefined) genCfg.temperature = request.temperature;
    if (request.thinkBudget !== undefined) {
      const budget = mapBudget("gemini", request.thinkBudget);
      if (typeof budget === "number") genCfg.thinkingConfig = { thinkingBudget: budget };
    }
    if (Object.keys(genCfg).length > 0) body.generationConfig = genCfg;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: request.signal
      });
    } catch (e) {
      yield { type: "error", code: "network", retryable: true, message: (e as Error).message };
      yield { type: "message_stop", stopReason: "error" };
      return;
    }
    if (!res.ok || !res.body) {
      const text = await readErrorBody(res);
      yield { type: "error", code: `http_${res.status}`, retryable: res.status >= 500 || res.status === 429, message: text };
      yield { type: "message_stop", stopReason: "error" };
      return;
    }

    let stopReason: LlmStreamEvent extends { type: "message_stop"; stopReason?: infer R } ? R : never;
    stopReason = undefined as never;
    let usagePrompt = 0;
    let usageCompletion = 0;
    let usageSeen = false;
    let toolSeq = 0;

    try {
      for await (const payload of parseSse(res.body, request.signal)) {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
        const content = candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined;
        if (content?.parts) {
          for (const part of content.parts) {
            if (typeof part.text === "string" && part.text) {
              if (part.thought) {
                yield { type: "reasoning_delta", text: String(part.text) };
              } else {
                yield { type: "text_delta", text: String(part.text) };
              }
            } else if (part.functionCall && typeof part.functionCall === "object") {
              const fc = part.functionCall as { name?: string; args?: unknown };
              const id = `gemini_call_${Date.now()}_${toolSeq++}`;
              yield { type: "tool_use_start", id, name: String(fc.name ?? "unknown") };
              yield { type: "tool_use_stop", id, finalInput: fc.args ?? {} };
              stopReason = "tool_use";
            }
          }
        }
        if (candidate?.finishReason) {
          stopReason = mapFinishReason(String(candidate.finishReason));
        }
        const usage = json.usageMetadata as
          | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
          | undefined;
        if (usage) {
          usagePrompt = usage.promptTokenCount ?? usagePrompt;
          usageCompletion = usage.candidatesTokenCount ?? usageCompletion;
          usageSeen = true;
        }
      }
    } catch (e) {
      if (request.signal.aborted) {
        yield { type: "error", code: "aborted", retryable: false, message: "aborted" };
      } else {
        yield { type: "error", code: "stream_error", retryable: true, message: (e as Error).message };
      }
      stopReason = "error";
    }

    if (usageSeen) {
      yield { type: "usage", promptTokens: usagePrompt, completionTokens: usageCompletion };
    }
    yield { type: "message_stop", stopReason };
  }
}

function mapFinishReason(
  reason: string
): "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error" {
  const r = reason.toUpperCase();
  if (r === "STOP") return "end_turn";
  if (r === "MAX_TOKENS") return "max_tokens";
  if (r === "SAFETY" || r === "RECITATION" || r === "OTHER") return "stop_sequence";
  return "end_turn";
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text || `HTTP ${res.status} ${res.statusText}`;
  } catch {
    return `HTTP ${res.status} ${res.statusText}`;
  }
}
