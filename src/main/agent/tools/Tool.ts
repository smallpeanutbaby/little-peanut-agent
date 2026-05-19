/**
 * Tool protocol.
 *
 * The `Tool<In, Out>` interface is the contract every tool must satisfy.
 * It is intentionally close to Claude Code's `Tool<>` type so each
 * starter implementation can be cross-referenced; differences are:
 *
 *  - We use zod (a runtime dependency on the renderer / preload) as the
 *    canonical input-schema language. `inputSchema` is a `z.ZodTypeAny`
 *    that the runtime calls `safeParse` against. The model sees a
 *    JSON-Schema-translated version (see ../llm/toolSpec.ts).
 *  - Tools are pure data + functions; they do not own state. State
 *    (e.g. last permission decision) lives in the runtime's
 *    `ToolPromptContext` / `permission_rule` table.
 *  - `mapResultToBlock` is the bridge to the LLM's tool_result block
 *    format. We keep `renderResultForUI` separate so the UI card can be
 *    richer than what the model sees (avoiding double-token cost).
 *
 * `buildTool(partial)` merges sensible defaults (`isConcurrencySafe`,
 * `isDestructive`, `checkPermissions`, …) so individual tool files only
 * declare what they need.
 */

import type { ZodTypeAny, z } from "zod";
import { zodToJsonSchema, type JsonSchema } from "../llm/toolSpec.js";
import type { ToolResultPayload, ToolResultBlock } from "../llm/types.js";

/* -------------------------------------------------------------------------- */
/* Result / progress                                                          */
/* -------------------------------------------------------------------------- */

/** Generic result envelope returned by `tool.call`. Tools may either
 *  succeed (`ok: true` with a typed payload) or fail with an error
 *  message + code. Cancellation is signalled via the AbortSignal
 *  on `ToolCallContext.signal`; tools that throw an `AbortError`
 *  cause the executor to mark the run as `cancelled` rather than
 *  `errored`. */
export type ToolResult<Out> =
  | {
      ok: true;
      value: Out;
      /** Number of tokens to bill against the conversation cost log.
       *  Optional — most tools leave this to be estimated by the
       *  runtime from the serialized payload. */
      tokens?: number;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

/** UI-facing progress events. The runtime fans these out to the
 *  renderer as `tool_progress` IPC events; they are NOT persisted. */
export interface ToolProgressEvent {
  /** Free-form short message ("Reading 1/3 files…"). */
  message?: string;
  /** Optional 0..1 fraction. */
  progress?: number;
  /** Tool-specific structured payload (e.g. bash partial stdout). */
  data?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Permission                                                                 */
/* -------------------------------------------------------------------------- */

export type PermissionDecision =
  | { behavior: "allow"; reason?: string; updatedInput?: unknown }
  | { behavior: "deny"; reason: string }
  | { behavior: "ask"; reason?: string }
  /** Forward the decision to the central permission gate (default for
   *  most tools — they don't have inherent per-input policy). */
  | { behavior: "passthrough" };

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** Context passed to `prompt()` so the system prompt text can vary by
 *  project / mode without making each tool's description a literal. */
export interface ToolPromptContext {
  projectRoot: string | null;
  modeId: string;
  /** Display language for the description (zh-CN / en). */
  language: "zh-CN" | "en";
}

/** Context passed to every tool invocation. Bundles the project root,
 *  the abort signal for the whole run, and the canUseTool callback the
 *  Bash / Edit / Write tools use when they need to ask the user mid-call
 *  (e.g. confirm a follow-up write). */
export interface ToolCallContext {
  projectRoot: string;
  conversationId: string;
  messageId: string;
  toolCallId: string;
  signal: AbortSignal;
  /** Optional progress emitter. May be a no-op. */
  onProgress?: (ev: ToolProgressEvent) => void;
  /** Defer to the central permission gate. Used by composite tools
   *  (e.g. Bash spawning a follow-up tool). */
  canUseTool: (toolName: string, input: unknown) => Promise<PermissionDecision>;
  /** Extra directories the user explicitly opted in to (project
   *  settings). Tools that touch the filesystem feed this into
   *  `validateProjectPath`. */
  additionalWorkingDirectories?: string[];
}

/* -------------------------------------------------------------------------- */
/* Tool interface                                                             */
/* -------------------------------------------------------------------------- */

export interface Tool<In extends ZodTypeAny = ZodTypeAny, Out = unknown> {
  /** Stable identifier. Use snake_case to match Claude Code's catalog. */
  name: string;
  /** Optional alias list (e.g. ["fs_read"] for "Read"). */
  aliases?: string[];
  /** One-paragraph human description. Used as fallback for the LLM
   *  description if `prompt()` returns "". */
  description: string;
  /** Zod schema for the tool's input. The runtime runs `safeParse` and
   *  feeds the model a `JSON Schema` derived via `zodToJsonSchema`. */
  inputSchema: In;
  /** Override the auto-generated JSON Schema. Useful when a tool needs
   *  schema features we don't translate (e.g. discriminated unions). */
  inputJsonSchema?: JsonSchema;
  /** Whether this tool only reads (true) or has side effects (false).
   *  Drives the concurrent-batching policy in `StreamingToolExecutor`. */
  isReadOnly: (input: z.infer<In>) => boolean;
  /** Whether this tool can be safely scheduled in parallel with other
   *  read-only tools. Defaults to true for read-only, false otherwise. */
  isConcurrencySafe?: (input: z.infer<In>) => boolean;
  /** Hint to the permission gate. Destructive operations always escalate
   *  to `ask` unless an explicit `allow` rule matches. */
  isDestructive?: (input: z.infer<In>) => boolean;
  /** Long-form description shown to the model. May vary by mode /
   *  language. Should NOT include the tool name (the wire layer adds it).
   */
  prompt: (ctx: ToolPromptContext) => Promise<string> | string;
  /** Static permission decision based on the input alone. The gate then
   *  combines this with persisted rules / user approval. */
  checkPermissions: (input: z.infer<In>, ctx: ToolCallContext) => Promise<PermissionDecision> | PermissionDecision;
  /** Optional extra input validation beyond the zod schema (e.g.
   *  "file exists", "path is inside project root"). Errors here are
   *  shown to the model as a tool_result with `isError: true`. */
  validateInput?: (
    input: z.infer<In>,
    ctx: ToolCallContext
  ) => Promise<{ ok: true } | { ok: false; errorMessage: string; errorCode?: string }>;
  /** The actual work. Must honour `ctx.signal`. */
  call: (input: z.infer<In>, ctx: ToolCallContext) => Promise<ToolResult<Out>>;
  /** Translate the success payload into a `tool_result` block for the
   *  next LLM turn. */
  mapResultToBlock: (out: Out, toolUseId: string) => ToolResultBlock;
  /** Compact, structured payload the renderer can render as a card.
   *  Falls back to a JSON dump when omitted. */
  renderResultForUI?: (out: Out) => UiToolResult;
  /** Optional UI metadata for the tool_use card (icon override, label). */
  renderUseForUI?: (input: z.infer<In>) => UiToolUse;
}

/* UI-facing payloads — kept loose so the renderer can extend without
   churning every tool. */
export interface UiToolUse {
  label?: string;
  /** Short one-liner shown in the card header (e.g. file path). */
  subtitle?: string;
}

export interface UiToolResult {
  /** "ok" | "error" — colour of the card. */
  variant?: "ok" | "error";
  /** Header line. */
  title?: string;
  /** Body — typically a code-block or short text. */
  body?: string;
  /** Optional structured payload (e.g. diff before/after). */
  data?: unknown;
}

/* -------------------------------------------------------------------------- */
/* buildTool — defaults                                                       */
/* -------------------------------------------------------------------------- */

export function buildTool<In extends ZodTypeAny, Out>(
  partial: PartialTool<In, Out>
): Tool<In, Out> {
  const isReadOnly = partial.isReadOnly ?? (() => false);
  const isDestructive = partial.isDestructive ?? (() => false);
  const isConcurrencySafe =
    partial.isConcurrencySafe ??
    ((input) => {
      // Default policy: read-only tools are concurrency-safe; everything
      // else serializes against itself. Tools can override (e.g. Glob is
      // CS even though it touches the filesystem).
      return isReadOnly(input);
    });
  const checkPermissions =
    partial.checkPermissions ??
    (() => ({ behavior: "passthrough" as const }));

  return {
    ...partial,
    description: partial.description ?? "",
    isReadOnly,
    isConcurrencySafe,
    isDestructive,
    checkPermissions,
    inputJsonSchema:
      partial.inputJsonSchema ?? zodToJsonSchema(partial.inputSchema)
  };
}

type PartialTool<In extends ZodTypeAny, Out> = Omit<
  Tool<In, Out>,
  | "isConcurrencySafe"
  | "isDestructive"
  | "checkPermissions"
  | "inputJsonSchema"
> & {
  isConcurrencySafe?: Tool<In, Out>["isConcurrencySafe"];
  isDestructive?: Tool<In, Out>["isDestructive"];
  checkPermissions?: Tool<In, Out>["checkPermissions"];
  inputJsonSchema?: Tool<In, Out>["inputJsonSchema"];
};

/* -------------------------------------------------------------------------- */
/* Helpers — building common tool_result payloads                             */
/* -------------------------------------------------------------------------- */

export function textPayload(text: string): ToolResultPayload {
  return { kind: "text", text };
}

export function jsonPayload(value: unknown): ToolResultPayload {
  return { kind: "json", value };
}

/** Tools that already format their output as plain text use this
 *  helper to skip the per-tool boilerplate. */
export function blockFromText(
  toolUseId: string,
  text: string,
  isError = false
): ToolResultBlock {
  return {
    type: "tool_result",
    toolUseId,
    output: textPayload(text),
    ...(isError ? { isError: true } : {})
  };
}
