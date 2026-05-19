/**
 * Tool execution lifecycle.
 *
 * Pipeline (per `tool_use` block emitted by the LLM):
 *
 *   1. Resolve the tool from the registry. Unknown name -> error block.
 *   2. zod.safeParse the input. Parse failure -> error block.
 *   3. tool.validateInput (optional). Failure -> error block.
 *   4. Permission gate. Deny -> error block. Allow -> proceed.
 *   5. Spawn a child AbortController scoped to this run. Tool.call().
 *   6. Map the result to a canonical `tool_result` block.
 *
 * Everything below `safeParse` honours `params.signal`; the
 * `StreamingToolExecutor` cancels the child controller when a sibling
 * Bash fails (Claude Code's "cascade cancel" behaviour).
 */

import type { z } from "zod";
import type {
  Tool,
  ToolCallContext,
  ToolProgressEvent,
  ToolResult
} from "../tools/Tool.js";
import type { ToolResultBlock } from "../llm/types.js";
import type { PermissionGate, PermissionScopeRef } from "../permissions/gate.js";
import type { AgentStore } from "../../db/agent-store.js";

export interface ToolExecutionContext {
  projectRoot: string;
  conversationId: string;
  messageId: string;
  store: AgentStore;
  gate: PermissionGate;
  scope: PermissionScopeRef;
  /** Parent (run-wide) signal. Tool calls receive a child of this. */
  signal: AbortSignal;
  /** Optional UI progress emitter. */
  onProgress?: (toolCallId: string, ev: ToolProgressEvent) => void;
  /** Forwarded into the tool ctx — extra paths the user opted in to. */
  additionalWorkingDirectories?: string[];
}

export interface ExecutionResult {
  block: ToolResultBlock;
  status: "completed" | "errored" | "denied" | "cancelled";
  durationMs: number;
  preview: string;
  isError: boolean;
}

export async function executeTool(
  tool: Tool,
  rawInput: unknown,
  toolCallId: string,
  ctx: ToolExecutionContext
): Promise<ExecutionResult> {
  const start = Date.now();
  ctx.store.recordToolRunStart({
    toolCallId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    toolName: tool.name,
    status: "pending"
  });

  // Spawn a per-tool controller chained to the parent. Used by the
  // Bash cascade-cancel and by `canUseTool` callbacks.
  const childAc = new AbortController();
  const onParentAbort = () => childAc.abort();
  if (ctx.signal.aborted) childAc.abort();
  else ctx.signal.addEventListener("abort", onParentAbort, { once: true });

  const cleanup = () => ctx.signal.removeEventListener("abort", onParentAbort);

  try {
    // 1. zod safeParse
    const parsed = (tool.inputSchema as z.ZodTypeAny).safeParse(rawInput);
    if (!parsed.success) {
      return finalize(
        ctx,
        toolCallId,
        start,
        "errored",
        toolResultErrorBlock(
          toolCallId,
          `Input validation failed for ${tool.name}: ${formatZodError(parsed.error)}`
        ),
        true,
        cleanup
      );
    }
    const input: unknown = parsed.data;

    // 2. tool.validateInput
    if (tool.validateInput) {
      const v = await tool.validateInput(input as never, buildCallCtx(ctx, toolCallId, childAc));
      if (!v.ok) {
        return finalize(
          ctx,
          toolCallId,
          start,
          "errored",
          toolResultErrorBlock(toolCallId, v.errorMessage),
          true,
          cleanup
        );
      }
    }

    // 3. Permission gate
    ctx.store.updateToolRunStatus(toolCallId, "permission_pending");
    const decision = await ctx.gate.resolve(
      tool,
      input,
      { ...ctx.scope, toolCallId, signal: childAc.signal },
      { toolCallId, signal: childAc.signal, conversationId: ctx.conversationId }
    );
    ctx.store.setToolRunPermissionDecision(toolCallId, decision);
    if (decision.behavior === "deny") {
      return finalize(
        ctx,
        toolCallId,
        start,
        "denied",
        toolResultErrorBlock(toolCallId, `Permission denied: ${decision.reason}`),
        true,
        cleanup
      );
    }

    // 4. Call the tool.
    ctx.store.updateToolRunStatus(toolCallId, "running");
    let result: ToolResult<unknown>;
    try {
      result = await tool.call(input as never, buildCallCtx(ctx, toolCallId, childAc));
    } catch (e) {
      if (childAc.signal.aborted) {
        return finalize(
          ctx,
          toolCallId,
          start,
          "cancelled",
          toolResultErrorBlock(toolCallId, "cancelled"),
          true,
          cleanup
        );
      }
      return finalize(
        ctx,
        toolCallId,
        start,
        "errored",
        toolResultErrorBlock(toolCallId, (e as Error).message || "tool threw"),
        true,
        cleanup
      );
    }

    if (!result.ok) {
      return finalize(
        ctx,
        toolCallId,
        start,
        "errored",
        toolResultErrorBlock(toolCallId, `${result.errorCode}: ${result.errorMessage}`),
        true,
        cleanup
      );
    }

    // 5. Map to canonical block.
    const block = tool.mapResultToBlock(result.value as never, toolCallId);
    const preview = previewFromBlock(block);
    return finalize(ctx, toolCallId, start, "completed", block, !!block.isError, cleanup, preview);
  } catch (e) {
    return finalize(
      ctx,
      toolCallId,
      start,
      "errored",
      toolResultErrorBlock(toolCallId, (e as Error).message || "unexpected"),
      true,
      cleanup
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildCallCtx(
  ctx: ToolExecutionContext,
  toolCallId: string,
  ac: AbortController
): ToolCallContext {
  return {
    projectRoot: ctx.projectRoot,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    toolCallId,
    signal: ac.signal,
    onProgress: (ev) => ctx.onProgress?.(toolCallId, ev),
    canUseTool: async () => ({ behavior: "passthrough" }),
    additionalWorkingDirectories: ctx.additionalWorkingDirectories
  };
}

function finalize(
  ctx: ToolExecutionContext,
  toolCallId: string,
  start: number,
  status: ExecutionResult["status"],
  block: ToolResultBlock,
  isError: boolean,
  cleanup: () => void,
  previewOverride?: string
): ExecutionResult {
  cleanup();
  ctx.store.updateToolRunStatus(
    toolCallId,
    status === "completed" ? "completed" : status === "denied" ? "denied" : status === "cancelled" ? "cancelled" : "errored"
  );
  return {
    block,
    status,
    durationMs: Date.now() - start,
    preview: previewOverride ?? previewFromBlock(block),
    isError
  };
}

export function toolResultErrorBlock(toolCallId: string, message: string): ToolResultBlock {
  return {
    type: "tool_result",
    toolUseId: toolCallId,
    output: { kind: "text", text: message },
    isError: true
  };
}

function previewFromBlock(block: ToolResultBlock): string {
  if (block.output.kind === "text") {
    return truncate(block.output.text, 200);
  }
  if (block.output.kind === "json") {
    return truncate(JSON.stringify(block.output.value), 200);
  }
  const text = block.output.blocks
    .map((b) => (b.type === "text" ? b.text : `[image:${b.mediaType}]`))
    .join(" ");
  return truncate(text, 200);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
