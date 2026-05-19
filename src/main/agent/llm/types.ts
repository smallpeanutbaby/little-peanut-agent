/**
 * Canonical LLM intermediate representation.
 *
 * Every provider speaks its own dialect of "messages + tools + streaming
 * events". The runtime only ever sees this canonical shape; per-provider
 * adapters do the translation in both directions. Adding a new provider
 * is therefore a self-contained file under `./adapters/<id>.ts` — the
 * main loop never grows a switch statement.
 *
 * Design notes (cribbed from Claude Code's `query.ts`):
 *
 *  - `CanonicalMessage.blocks` is order-sensitive: the model sees text /
 *    tool_use blocks in the order we send them, and tool_result blocks
 *    in a user message MUST appear in the same order the model emitted
 *    their matching tool_use.
 *  - We never trust `stop_reason`. The runtime decides "needs follow-up"
 *    by inspecting whether the stream produced any `tool_use_stop`
 *    events. A provider can claim end_turn while still asking us to run
 *    a tool, and vice versa.
 *  - `tool_use_input_delta` chunks are emitted as raw JSON fragments
 *    because OpenAI streams `arguments` as concatenated string deltas
 *    and Anthropic streams a `partial_json` field. The runtime treats
 *    those chunks as opaque UI previews; the `finalInput` on
 *    `tool_use_stop` is the authoritative value (`unknown`, validated
 *    by the tool's zod schema later).
 */

import type { ProtocolId, ThinkBudget } from "@shared/types.js";

/** Single role pivot. We collapse system/developer into "system" because
 *  every provider we care about supports that. */
export type CanonicalRole = "system" | "user" | "assistant";

/** Identifies a tool the model wants to invoke. `name` is the registered
 *  tool name; `input` is the model's claimed arguments (unvalidated). */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

/** Reply to a tool_use. Lives in a `user` message slot per Anthropic
 *  convention; OpenAI adapters translate it to a `tool` role message. */
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  /** Free-form payload. Most tools return text; some return structured
   *  data which the adapter may flatten back to text for the wire. */
  output: ToolResultPayload;
  isError?: boolean;
}

export type ToolResultPayload =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "mixed"; blocks: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; base64: string }> };

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ReasoningBlock {
  type: "reasoning";
  text: string;
}

export type ContentBlock = TextBlock | ReasoningBlock | ToolUseBlock | ToolResultBlock;

export interface CanonicalMessage {
  role: CanonicalRole;
  blocks: ContentBlock[];
}

/* -------------------------------------------------------------------------- */
/* Tool spec sent to the model                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tool description sent to the LLM. Adapters translate this to the
 * provider's tool / function-calling envelope.
 *  - OpenAI Chat Completions: `tools: [{ type: "function", function: { name, description, parameters } }]`
 *  - Anthropic Messages: `tools: [{ name, description, input_schema }]`
 *  - Gemini: `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`
 */
export interface CanonicalToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Adapters pass it through; Anthropic restricts certain
   *  schema keywords (e.g. `$ref`), which the adapter sanitises. */
  inputSchema: Record<string, unknown>;
}

/** Force-call behaviour. Defaults to "auto" so the model is free to
 *  decide whether to call a tool or answer directly. */
export type ToolChoice = "auto" | "none" | { name: string };

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One model invocation. The runtime constructs a fresh `LlmRequest`
 * every turn (no mutation across turns) so adapters can stream without
 * worrying about previous-turn state bleeding through.
 */
export interface LlmRequest {
  provider: ProviderRef;
  /** Provider-specific model id, e.g. "gpt-5.5-medium" / "claude-4.7-opus". */
  model: string;
  /** Multi-segment system prompt. Adapters concatenate with "\n\n" when
   *  the provider only supports a single string (OpenAI Chat). The
   *  segmentation matters for Anthropic prompt caching. */
  system: string[];
  messages: CanonicalMessage[];
  tools?: CanonicalToolSpec[];
  toolChoice?: ToolChoice;
  temperature?: number;
  thinkBudget?: ThinkBudget;
  /** Hard upper bound for completion tokens. Different providers spell
   *  this differently; adapters do the mapping. */
  maxOutputTokens?: number;
  /** Threaded through every fetch / SSE reader / pipe so user-initiated
   *  cancel can unblock instantly. */
  signal: AbortSignal;
}

export interface ProviderRef {
  /** Stable id from `provider_config.id`. */
  id: string;
  /** Wire protocol (see `ProtocolId` in shared/types). */
  protocol: ProtocolId | string;
  baseUrl: string;
  apiKey: string;
}

/* -------------------------------------------------------------------------- */
/* Streaming events                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Canonical stream event. Adapters yield these; the runtime + IPC layer
 * propagate them verbatim to the renderer. Adding a new event type is a
 * one-line addition here + per-adapter translation + renderer handler —
 * no other layer needs to change.
 */
export type LlmStreamEvent =
  | { type: "message_start" }
  /** Text token(s) appended to the current assistant text block. */
  | { type: "text_delta"; text: string }
  /** Reasoning token(s). Some providers expose this (Anthropic
   *  thinking_delta, OpenAI reasoning models). */
  | { type: "reasoning_delta"; text: string }
  /** A tool_use block opened with this id + name. Input is not yet
   *  available; the model is still streaming it. */
  | { type: "tool_use_start"; id: string; name: string }
  /** Partial JSON chunk for the in-flight tool_use input. Use only for
   *  UI preview — do not parse incrementally. */
  | { type: "tool_use_input_delta"; id: string; jsonChunk: string }
  /** Tool_use block closed; `finalInput` is the authoritative input
   *  (already parsed from the accumulated JSON). */
  | { type: "tool_use_stop"; id: string; finalInput: unknown }
  /** Model finished the turn. `stopReason` is the provider's claim. */
  | {
      type: "message_stop";
      stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
    }
  /** Usage / cost telemetry. Emitted at most once per turn. */
  | {
      type: "usage";
      promptTokens: number;
      completionTokens: number;
      costUsd?: number;
    }
  /** Recoverable / unrecoverable error. `retryable` lets the
   *  `withRetry` wrapper decide whether to retry without surfacing the
   *  error to the user. */
  | { type: "error"; code: string; retryable: boolean; message: string };

/* -------------------------------------------------------------------------- */
/* Adapter interface                                                          */
/* -------------------------------------------------------------------------- */

export interface LlmAdapter {
  /** Yields canonical events until the model turn completes. Must honor
   *  `request.signal` (abort -> finish cleanly with an `error` event). */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}
