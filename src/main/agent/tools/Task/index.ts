/**
 * Task tool — spawn a focused subagent for an isolated piece of work.
 *
 * Why subagents:
 *  - The parent loop's context window is precious. Sending the parent
 *    through 40 tool calls to verify one hypothesis blows it up.
 *  - A subagent gets a fresh window, a tailored toolset, and returns a
 *    single distilled summary the parent can read in 500 tokens.
 *
 * Hand-off shape:
 *  - The subagent runs in a new **synthetic** conversation under the
 *    SAME project so its `agent_message_part` rows are scoped properly
 *    and the user can introspect via the RunningTasksTray.
 *  - On completion the tool returns `{ summary, conversationId,
 *    durationMs, status }` so the parent can quote the summary or
 *    reference the synthetic conversation for full context.
 *  - Cancellation: aborting the parent cascades through the
 *    TaskManager into the subagent's AbortController; the subagent
 *    finishes whatever tool call is in flight then unwinds cleanly.
 *
 * Tool selection inside a subagent:
 *  - The Task tool itself is REMOVED from the subagent's registry to
 *    prevent infinite fan-out.
 *  - TodoWrite is also removed — the subagent should answer, not plan.
 *  - Everything else is forwarded as-is, including the same permission
 *    gate (so the user still sees prompts even for subagent actions).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { AppDatabase } from "../../../db/database.js";
import { ToolRegistry } from "../registry.js";
import { TaskManager } from "../../runtime/TaskManager.js";
import { queryLoop, type AgentRunParams } from "../../runtime/queryLoop.js";
import type { ProviderRef } from "../../llm/types.js";

/* -------------------------------------------------------------------------- */
/* Binder — set by the IPC layer on app boot.                                 */
/* -------------------------------------------------------------------------- */

interface TaskRuntimeBinding {
  db: AppDatabase;
  taskManager: TaskManager;
  /** Build a child tool registry. Used by the runtime to exclude the
   *  Task tool itself and any other tools we don't want a subagent
   *  spawning. */
  buildChildRegistry: () => ToolRegistry;
  /** Provider + model the parent run is using. Subagents inherit. */
  resolveDefaultProvider: () => { provider: ProviderRef; model: string } | null;
  /** Permission gate shared with the parent. */
  buildGateForSubagent: (
    projectId: string,
    conversationId: string
  ) => Promise<import("../../permissions/gate.js").PermissionGate>;
}

let binding: TaskRuntimeBinding | null = null;
export function bindTaskRuntime(b: TaskRuntimeBinding): void {
  binding = b;
}

/* -------------------------------------------------------------------------- */
/* Tool                                                                       */
/* -------------------------------------------------------------------------- */

const inputSchema = z.object({
  description: z
    .string()
    .min(3)
    .max(120)
    .describe("Short title for the subagent (3-5 words). Shown in the RunningTasksTray."),
  prompt: z
    .string()
    .min(10)
    .max(8000)
    .describe(
      "Self-contained instructions for the subagent. Provide all context it needs — it does NOT see the parent conversation."
    ),
  subagent_type: z
    .enum(["explore", "general"])
    .optional()
    .describe(
      "`explore` (read-only investigation, no destructive tools) or `general` (full toolkit minus Task/TodoWrite). Default explore."
    )
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  status: "completed" | "errored" | "cancelled";
  summary: string;
  taskId: string;
  childConversationId: string;
  durationMs: number;
  errorMessage?: string;
}

export const TaskTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Task",
  aliases: ["spawn_task", "subagent"],
  description: "Spawn a focused subagent to do a piece of work in isolation; returns its final summary.",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Spawn a subagent to handle a self-contained piece of work.",
      "Use when the work is big enough that running it inline would blow your context window.",
      "Provide a complete `prompt` — the subagent does NOT see this conversation.",
      "Subagents cannot themselves spawn Task subagents; keep them focused."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (!binding) {
      return { ok: false, errorCode: "not_bound", errorMessage: "Task runtime is not bound" };
    }
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const conv = binding.db.getConversation(ctx.conversationId);
    if (!conv || !conv.projectId) {
      return {
        ok: false,
        errorCode: "no_project",
        errorMessage: "Task tool requires a project-scoped parent conversation."
      };
    }
    const defaults = binding.resolveDefaultProvider();
    if (!defaults) {
      return {
        ok: false,
        errorCode: "no_default_model",
        errorMessage: "No default provider/model is configured for subagents."
      };
    }
    // Create a synthetic conversation under the same project. Use a
    // name that makes the tray useful at a glance.
    const childConv = binding.db.createConversation({
      name: `subtask: ${input.description}`,
      projectId: conv.projectId
    });

    const subagentType = input.subagent_type ?? "explore";
    const childRegistry = binding.buildChildRegistry();
    // Trim the explore subagent's writable surface to read-only tools.
    const allowList = subagentType === "explore"
      ? ["Read", "Grep", "Glob", "ListDir", "WebFetch", "WebSearch", "MemoryRead", "Bash"]
      : null;
    const childTools = allowList
      ? childRegistry.list().filter((t) => allowList.includes(t.name))
      : childRegistry.list();

    const start = Date.now();
    let collectedText = "";

    const gate = await binding.buildGateForSubagent(conv.projectId, childConv.id);

    const handle = binding.taskManager.start({
      projectId: conv.projectId,
      conversationId: ctx.conversationId,
      type: `subagent.${subagentType}`,
      payload: { description: input.description, prompt: input.prompt },
      run: async (signal): Promise<{ status: "completed" | "errored" | "cancelled"; text?: string; errorMessage?: string }> => {
        const params: AgentRunParams = {
          runId: `subagent_${randomUUID()}`,
          conversationId: childConv.id,
          projectId: conv.projectId,
          projectRoot: binding!.db.getProject(conv.projectId)?.path ?? "",
          projectName: binding!.db.getProject(conv.projectId)?.name ?? null,
          userMessage: input.prompt,
          assistantMessageId: null,
          mode: {
            id: "agent",
            label: "Agent",
            systemPrompt: "You are a focused subagent. Answer the user prompt directly and return a concise summary."
          } as unknown as AgentRunParams["mode"],
          provider: defaults.provider,
          model: defaults.model,
          temperature: 0.2,
          maxOutputTokens: 4096,
          language: "en",
          tools: childTools,
          maxIterations: subagentType === "explore" ? 10 : 18,
          signal,
          db: binding!.db,
          gate,
          additionalWorkingDirectories: ctx.additionalWorkingDirectories
        };
        try {
          for await (const ev of queryLoop(params)) {
            if (ev.kind === "text_delta") collectedText += ev.text;
            if (ev.kind === "terminal") {
              if (ev.reason === "cancelled") return { status: "cancelled", text: collectedText };
              if (ev.reason === "errored") return { status: "errored", text: collectedText, errorMessage: ev.message };
              return { status: "completed", text: collectedText };
            }
          }
          return { status: "completed", text: collectedText };
        } catch (e) {
          return { status: "errored", text: collectedText, errorMessage: (e as Error).message };
        }
      }
    });

    // Cancellation cascade: if the parent run aborts mid-subagent, kill
    // the subagent too. The cleanup happens via the `finally` in the
    // run promise; the AbortSignal listener is removed on settle.
    const onParentAbort = () => binding!.taskManager.cancel(handle.id);
    ctx.signal.addEventListener("abort", onParentAbort, { once: true });

    const result = await handle.promise;
    ctx.signal.removeEventListener("abort", onParentAbort);
    const durationMs = Date.now() - start;
    const summary = (result.text ?? "").trim().slice(0, 6000);

    return {
      ok: true,
      value: {
        status: result.status,
        summary: summary || "(subagent produced no text output)",
        taskId: handle.id,
        childConversationId: childConv.id,
        durationMs,
        errorMessage: result.errorMessage
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `Subagent ${out.status} in ${(out.durationMs / 1000).toFixed(1)}s (task ${out.taskId})`;
    const errorLine = out.errorMessage ? `\n[error] ${out.errorMessage}\n` : "";
    return blockFromText(toolUseId, `${header}${errorLine}\n${out.summary}`);
  },
  renderResultForUI(out) {
    return {
      variant: out.status === "completed" ? "ok" : out.status === "cancelled" ? "warning" : "error",
      title: `Task  ${out.status}  ${(out.durationMs / 1000).toFixed(1)}s`,
      body: out.summary.split("\n").slice(0, 20).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "Task", subtitle: input.description };
  }
});
