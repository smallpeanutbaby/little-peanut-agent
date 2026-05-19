/**
 * TodoWrite tool — manage the agent's plan as a persistent todo list.
 *
 * Whole-list replace semantics (matches Claude Code's TodoWrite):
 *   - The model sends the FULL list every time.
 *   - The runtime stores it into `agent_todo` rows for the active
 *     project + conversation; existing rows are deleted in the same
 *     transaction so there is no diff/merge logic to get wrong.
 *   - At most one item should be `in_progress` at a time, but we don't
 *     enforce that — Claude Code lets the model decide.
 *
 * The tool itself has no side effects outside the DB so it is always
 * allowed (no permission prompt).
 */

import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { AppDatabase } from "../../../db/database.js";

const todoItemSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(280)
    .describe("One-line description of the task. Use the imperative mood ('add X', not 'I will add X')."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("`pending` not started; `in_progress` actively being worked on (only one item at a time); `completed` done.")
});

const inputSchema = z.object({
  items: z
    .array(todoItemSchema)
    .min(1)
    .max(50)
    .describe(
      "Full ordered list of todo items for this run. Send the WHOLE list every time you call this tool — the runtime replaces the existing list atomically."
    )
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  total: number;
  inProgress: number;
  completed: number;
  pending: number;
}

/**
 * The TodoWrite tool needs access to the database to persist into
 * `agent_todo`. Since tools don't currently receive the AppDatabase in
 * their ctx, we close over a module-level setter the runtime sets up
 * during `registerAgentIpc`. This avoids leaking the DB type into the
 * generic `ToolCallContext`.
 */
let dbRef: AppDatabase | null = null;
export function bindTodoWriteDatabase(db: AppDatabase): void {
  dbRef = db;
}

export const TodoWriteTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "TodoWrite",
  aliases: ["todo_write"],
  description: "Replace the agent's persistent todo list for the current conversation.",
  inputSchema,
  isReadOnly: () => false,
  // Conceptually safe to concurrently fire alongside read tools, but
  // we keep it serial so the UI sees a consistent list at any moment.
  isConcurrencySafe: () => false,
  prompt: () =>
    [
      "Replace the entire todo list for this conversation in one call.",
      "Use this for any task that has more than 2-3 discrete steps so the user can see the plan and follow progress.",
      "Statuses: `pending` (not started), `in_progress` (one at a time — flip to `in_progress` BEFORE you start working), `completed` (done).",
      "Send the FULL list every time; the runtime replaces the previous list atomically."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (!dbRef) {
      return { ok: false, errorCode: "not_bound", errorMessage: "TodoWrite is not bound to a database" };
    }
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    // We need a projectId; the ctx already carries conversationId. The
    // runtime ensures `agent` mode is only enabled inside project
    // conversations, but defensively resolve via the DB.
    const conv = dbRef.getConversation(ctx.conversationId);
    if (!conv || !conv.projectId) {
      return {
        ok: false,
        errorCode: "no_project",
        errorMessage: "TodoWrite requires a project-scoped conversation."
      };
    }
    const items = input.items.map((it) => ({ content: it.content, status: it.status }));
    const persisted = dbRef.agent.setTodoList(conv.projectId, conv.id, items);
    return {
      ok: true,
      value: {
        total: persisted.length,
        inProgress: persisted.filter((t) => t.status === "in_progress").length,
        completed: persisted.filter((t) => t.status === "completed").length,
        pending: persisted.filter((t) => t.status === "pending").length
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    return blockFromText(
      toolUseId,
      `Updated todo list — ${out.total} item${out.total === 1 ? "" : "s"} ` +
        `(${out.inProgress} in progress, ${out.pending} pending, ${out.completed} completed).`
    );
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `Todo  (${out.completed}/${out.total} done)`,
      body: `${out.inProgress} in progress · ${out.pending} pending`
    };
  },
  renderUseForUI(input) {
    return { label: "TodoWrite", subtitle: `${input.items.length} item${input.items.length === 1 ? "" : "s"}` };
  }
});
