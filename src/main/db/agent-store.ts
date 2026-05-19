import type Database from "better-sqlite3";

/**
 * CRUD layer for the agent-runtime tables introduced in migration v5.
 *
 * Kept separate from `AppDatabase` because:
 *  - The agent runtime is a self-contained subsystem; bundling its 20+
 *    helpers into the central DB class would balloon the file and tangle
 *    the chat/messages/projects API surface.
 *  - Tests can spin up an `AgentStore` against an in-memory `Database`
 *    instance without dragging the full app DB through.
 *
 * Every method on this class is synchronous because better-sqlite3 is
 * synchronous. Callers in the main process must already be on the main
 * thread.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One ordered piece of an assistant or tool turn. Mirrors Claude Code's
 * content-block model: the LLM emits a sequence of blocks (text /
 * reasoning / tool_use) and after we run the tools we append matching
 * tool_result blocks in a user message — same shape, different role.
 */
export type MessagePartType =
  | "text"
  | "reasoning"
  | "tool_use"
  | "tool_result"
  | "attachment_ref"
  | "compact_marker";

export interface MessagePart {
  id: string;
  messageId: string;
  /** Ascending; resets per message. */
  seq: number;
  type: MessagePartType;
  /** Set on `tool_use` and `tool_result`; pairs them. */
  toolCallId: string | null;
  /** Set on `tool_use` (the tool the model wants to invoke) and
   *  `tool_result` (mirror for filtering/UI). */
  toolName: string | null;
  /** JSON-encoded canonical input the model produced. */
  inputJson: string | null;
  /** JSON-encoded canonical output the tool produced. */
  outputJson: string | null;
  /** Short preview shown in transcript when the full output spills to disk. */
  outputPreview: string | null;
  isError: boolean;
  /** Absolute path of the spilled output file (if any). */
  outputFilePath: string | null;
  tokens: number | null;
  /** For `text` / `reasoning` parts: the literal string. */
  textContent: string | null;
  createdAt: number;
}

export type ToolRunStatus =
  | "pending"
  | "permission_pending"
  | "running"
  | "completed"
  | "denied"
  | "errored"
  | "cancelled";

export interface ToolRun {
  toolCallId: string;
  conversationId: string;
  messageId: string;
  toolName: string;
  status: ToolRunStatus;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
  costUsd: number | null;
  permissionDecisionJson: string | null;
}

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export interface AgentTodo {
  id: string;
  projectId: string;
  conversationId: string | null;
  content: string;
  status: AgentTodoStatus;
  seq: number;
  updatedAt: number;
}

export type AgentTaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

export interface AgentTask {
  id: string;
  projectId: string;
  conversationId: string | null;
  /** "local_bash" | "local_agent" | "subagent" | "<custom>" */
  type: string;
  status: AgentTaskStatus;
  payloadJson: string;
  resultJson: string | null;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
}

export type PermissionScope = "session" | "project" | "user";
export type PermissionBehavior = "allow" | "deny" | "ask";

export interface PermissionRule {
  id: string;
  scope: PermissionScope;
  projectId: string | null;
  conversationId: string | null;
  toolName: string;
  /** Tool-specific match data — interpreted by the tool's
   *  `preparePermissionMatcher` / gate code (e.g. a path glob, a command
   *  pattern, a host name). */
  patternJson: string;
  behavior: PermissionBehavior;
  source: "user_decision" | "cli" | "settings";
  createdAt: number;
}

export interface MemoryIndexRow {
  id: string;
  projectId: string;
  relativePath: string;
  type: string;
  description: string;
  mtime: number;
  bytes: number;
}

export interface AgentCostLogRow {
  id: number;
  conversationId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function nowMs(): number {
  return Date.now();
}

function genId(prefix: string): string {
  return (
    prefix +
    "_" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

export class AgentStore {
  constructor(private readonly db: Database.Database) {}

  /* ── message_part ─────────────────────────────────────────────────── */

  appendPart(
    input: Omit<MessagePart, "id" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    }
  ): MessagePart {
    const id = input.id ?? genId("part");
    const createdAt = input.createdAt ?? nowMs();
    this.db
      .prepare(
        `INSERT INTO message_part
           (id, message_id, seq, type, tool_call_id, tool_name,
            input_json, output_json, output_preview, is_error,
            output_file_path, tokens, text_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.messageId,
        input.seq,
        input.type,
        input.toolCallId,
        input.toolName,
        input.inputJson,
        input.outputJson,
        input.outputPreview,
        input.isError ? 1 : 0,
        input.outputFilePath,
        input.tokens,
        input.textContent,
        createdAt
      );
    return { ...input, id, createdAt };
  }

  /** Update text / reasoning content of a part in place (used while
   *  streaming text deltas). */
  patchPartText(id: string, text: string): void {
    this.db.prepare(`UPDATE message_part SET text_content = ? WHERE id = ?`).run(text, id);
  }

  /** Update the output of a `tool_result` part after the tool finishes. */
  finalizeToolResultPart(
    id: string,
    update: { outputJson: string | null; outputPreview: string | null; isError: boolean; outputFilePath?: string | null }
  ): void {
    this.db
      .prepare(
        `UPDATE message_part
            SET output_json = ?, output_preview = ?, is_error = ?, output_file_path = ?
          WHERE id = ?`
      )
      .run(
        update.outputJson,
        update.outputPreview,
        update.isError ? 1 : 0,
        update.outputFilePath ?? null,
        id
      );
  }

  listPartsForMessage(messageId: string): MessagePart[] {
    const rows = this.db
      .prepare(`SELECT * FROM message_part WHERE message_id = ? ORDER BY seq ASC`)
      .all(messageId) as Array<RawPart>;
    return rows.map(rowToPart);
  }

  listPartsForConversation(conversationId: string): MessagePart[] {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM message_part p
           INNER JOIN message m ON m.id = p.message_id
          WHERE m.conversation_id = ?
          ORDER BY m.created_at ASC, p.seq ASC`
      )
      .all(conversationId) as Array<RawPart>;
    return rows.map(rowToPart);
  }

  /** Remove every part attached to a message (used when the placeholder
   *  assistant message is deleted because the stream produced nothing). */
  deletePartsForMessage(messageId: string): void {
    this.db.prepare(`DELETE FROM message_part WHERE message_id = ?`).run(messageId);
  }

  /* ── tool_run ─────────────────────────────────────────────────────── */

  recordToolRunStart(input: {
    toolCallId: string;
    conversationId: string;
    messageId: string;
    toolName: string;
    status?: ToolRunStatus;
  }): ToolRun {
    const startedAt = nowMs();
    const status = input.status ?? "pending";
    this.db
      .prepare(
        `INSERT INTO tool_run
           (tool_call_id, conversation_id, message_id, tool_name, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tool_call_id) DO UPDATE SET
           status = excluded.status,
           started_at = excluded.started_at,
           ended_at = NULL,
           error_code = NULL`
      )
      .run(input.toolCallId, input.conversationId, input.messageId, input.toolName, status, startedAt);
    return {
      toolCallId: input.toolCallId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      toolName: input.toolName,
      status,
      startedAt,
      endedAt: null,
      errorCode: null,
      costUsd: null,
      permissionDecisionJson: null
    };
  }

  updateToolRunStatus(toolCallId: string, status: ToolRunStatus, errorCode?: string): void {
    const endedAt = status === "running" || status === "pending" || status === "permission_pending" ? null : nowMs();
    this.db
      .prepare(
        `UPDATE tool_run
            SET status = ?, ended_at = ?, error_code = ?
          WHERE tool_call_id = ?`
      )
      .run(status, endedAt, errorCode ?? null, toolCallId);
  }

  setToolRunPermissionDecision(toolCallId: string, decision: unknown): void {
    this.db
      .prepare(`UPDATE tool_run SET permission_decision_json = ? WHERE tool_call_id = ?`)
      .run(JSON.stringify(decision), toolCallId);
  }

  /** Mark every still-running tool_run in a conversation as cancelled.
   *  Called on app startup so crashed orphan rows don't appear "live". */
  cancelOrphanToolRuns(conversationId: string): number {
    const res = this.db
      .prepare(
        `UPDATE tool_run
            SET status = 'cancelled', ended_at = ?, error_code = 'orphan'
          WHERE conversation_id = ?
            AND status IN ('pending','permission_pending','running')`
      )
      .run(nowMs(), conversationId);
    return Number(res.changes ?? 0);
  }

  /** Global sweep: any tool_run still flagged live across the DB. */
  cancelAllOrphanToolRuns(): number {
    const res = this.db
      .prepare(
        `UPDATE tool_run
            SET status = 'cancelled', ended_at = ?, error_code = 'orphan'
          WHERE status IN ('pending','permission_pending','running')`
      )
      .run(nowMs());
    return Number(res.changes ?? 0);
  }

  getToolRun(toolCallId: string): ToolRun | null {
    const row = this.db
      .prepare(`SELECT * FROM tool_run WHERE tool_call_id = ?`)
      .get(toolCallId) as RawToolRun | undefined;
    return row ? rowToToolRun(row) : null;
  }

  listToolRunsForConversation(conversationId: string): ToolRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM tool_run WHERE conversation_id = ? ORDER BY started_at ASC`)
      .all(conversationId) as Array<RawToolRun>;
    return rows.map(rowToToolRun);
  }

  /* ── agent_todo ───────────────────────────────────────────────────── */

  /** Replace the entire todo list for a project/conversation in one go —
   *  matches Claude Code's `TodoWrite` semantics (the model always sends
   *  the full list, not a diff). */
  setTodoList(
    projectId: string,
    conversationId: string | null,
    items: Array<{ content: string; status: AgentTodoStatus }>
  ): AgentTodo[] {
    const now = nowMs();
    const tx = this.db.transaction(() => {
      // Scope deletion: project-only if conversationId is null, otherwise
      // delete this project+conversation's list (project-wide todos and
      // conversation-attached todos can coexist).
      if (conversationId) {
        this.db
          .prepare(`DELETE FROM agent_todo WHERE project_id = ? AND conversation_id = ?`)
          .run(projectId, conversationId);
      } else {
        this.db
          .prepare(`DELETE FROM agent_todo WHERE project_id = ? AND conversation_id IS NULL`)
          .run(projectId);
      }
      const insert = this.db.prepare(
        `INSERT INTO agent_todo (id, project_id, conversation_id, content, status, seq, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      let seq = 0;
      for (const it of items) {
        insert.run(genId("todo"), projectId, conversationId, it.content, it.status, seq, now);
        seq += 1;
      }
    });
    tx();
    return this.listTodos(projectId, conversationId);
  }

  listTodos(projectId: string, conversationId: string | null): AgentTodo[] {
    const rows = (conversationId
      ? this.db
          .prepare(
            `SELECT * FROM agent_todo
               WHERE project_id = ?
                 AND (conversation_id = ? OR conversation_id IS NULL)
               ORDER BY seq ASC`
          )
          .all(projectId, conversationId)
      : this.db
          .prepare(`SELECT * FROM agent_todo WHERE project_id = ? ORDER BY seq ASC`)
          .all(projectId)) as Array<RawAgentTodo>;
    return rows.map(rowToTodo);
  }

  /* ── agent_task ───────────────────────────────────────────────────── */

  insertAgentTask(input: {
    projectId: string;
    conversationId: string | null;
    type: string;
    payload: unknown;
  }): AgentTask {
    const id = genId("task");
    const startedAt = nowMs();
    this.db
      .prepare(
        `INSERT INTO agent_task
           (id, project_id, conversation_id, type, status, payload_json, result_json, pid, started_at, ended_at)
         VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, NULL)`
      )
      .run(id, input.projectId, input.conversationId, input.type, JSON.stringify(input.payload ?? {}), startedAt);
    return {
      id,
      projectId: input.projectId,
      conversationId: input.conversationId,
      type: input.type,
      status: "pending",
      payloadJson: JSON.stringify(input.payload ?? {}),
      resultJson: null,
      pid: null,
      startedAt,
      endedAt: null
    };
  }

  updateAgentTask(
    id: string,
    patch: Partial<Pick<AgentTask, "status" | "resultJson" | "pid" | "endedAt">>
  ): void {
    const existing = this.getAgentTask(id);
    if (!existing) return;
    const next = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE agent_task
            SET status = ?, result_json = ?, pid = ?, ended_at = ?
          WHERE id = ?`
      )
      .run(next.status, next.resultJson, next.pid, next.endedAt, id);
  }

  getAgentTask(id: string): AgentTask | null {
    const row = this.db.prepare(`SELECT * FROM agent_task WHERE id = ?`).get(id) as
      | RawAgentTask
      | undefined;
    return row ? rowToTask(row) : null;
  }

  listAgentTasks(projectId: string, limit = 50): AgentTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_task
            WHERE project_id = ?
            ORDER BY started_at DESC
            LIMIT ?`
      )
      .all(projectId, limit) as Array<RawAgentTask>;
    return rows.map(rowToTask);
  }

  /** Mark every still-running task as `killed`. Used at startup so the
   *  RunningTasksTray doesn't show ghosts after a crash. */
  killOrphanTasks(): number {
    const res = this.db
      .prepare(
        `UPDATE agent_task SET status = 'killed', ended_at = ?
            WHERE status IN ('pending','running')`
      )
      .run(nowMs());
    return Number(res.changes ?? 0);
  }

  /* ── permission_rule ──────────────────────────────────────────────── */

  insertPermissionRule(
    input: Omit<PermissionRule, "id" | "createdAt"> & { createdAt?: number }
  ): PermissionRule {
    const id = genId("perm");
    const createdAt = input.createdAt ?? nowMs();
    this.db
      .prepare(
        `INSERT INTO permission_rule
           (id, scope, project_id, conversation_id, tool_name, pattern_json, behavior, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.scope,
        input.projectId,
        input.conversationId,
        input.toolName,
        input.patternJson,
        input.behavior,
        input.source,
        createdAt
      );
    return { ...input, id, createdAt };
  }

  /** All rules that could apply to `toolName` in this scope. The caller
   *  (the gate) decides match precedence and pattern semantics. */
  listPermissionRules(
    toolName: string,
    scope: { projectId?: string | null; conversationId?: string | null } = {}
  ): PermissionRule[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM permission_rule
            WHERE tool_name = ?
              AND (project_id IS NULL OR project_id = ?)
              AND (conversation_id IS NULL OR conversation_id = ?)`
      )
      .all(toolName, scope.projectId ?? null, scope.conversationId ?? null) as Array<RawRule>;
    return rows.map(rowToRule);
  }

  deletePermissionRule(id: string): void {
    this.db.prepare(`DELETE FROM permission_rule WHERE id = ?`).run(id);
  }

  /** Drop every `session`-scoped rule. Called when the app starts a fresh
   *  Electron session so "allow this once" from last run doesn't leak. */
  clearSessionPermissionRules(): number {
    const res = this.db.prepare(`DELETE FROM permission_rule WHERE scope = 'session'`).run();
    return Number(res.changes ?? 0);
  }

  /* ── memory_index ─────────────────────────────────────────────────── */

  upsertMemoryIndex(input: Omit<MemoryIndexRow, "id"> & { id?: string }): void {
    const id = input.id ?? genId("mem");
    this.db
      .prepare(
        `INSERT INTO memory_index (id, project_id, relative_path, type, description, mtime, bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, relative_path) DO UPDATE SET
           type = excluded.type,
           description = excluded.description,
           mtime = excluded.mtime,
           bytes = excluded.bytes`
      )
      .run(
        id,
        input.projectId,
        input.relativePath,
        input.type,
        input.description,
        input.mtime,
        input.bytes
      );
  }

  listMemoryIndex(projectId: string): MemoryIndexRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_index WHERE project_id = ? ORDER BY mtime DESC`
      )
      .all(projectId) as Array<RawMemoryIndex>;
    return rows.map(rowToMemoryIndex);
  }

  deleteMemoryIndex(projectId: string, relativePath: string): void {
    this.db
      .prepare(`DELETE FROM memory_index WHERE project_id = ? AND relative_path = ?`)
      .run(projectId, relativePath);
  }

  /* ── conversation run markers (v6) ────────────────────────────────── */

  /** Stamp the conversation row with the most recent run id + status.
   *  Used by the resume-toast flow: an "in_progress" marker on app
   *  start means the previous run died mid-stream. */
  markConversationRun(
    conversationId: string,
    runId: string,
    status: "in_progress" | "completed" | "failed" | "cancelled" | "budget_exceeded"
  ): void {
    const endedAt = status === "in_progress" ? null : nowMs();
    this.db
      .prepare(
        `UPDATE conversation
            SET last_run_id = ?, last_run_status = ?, last_run_ended_at = ?
          WHERE id = ?`
      )
      .run(runId, status, endedAt, conversationId);
  }

  /** Return every conversation row whose `last_run_status` is
   *  'in_progress' — i.e. the agent died mid-stream. The UI shows a
   *  resume-or-discard toast on app boot for each. */
  listInterruptedConversations(): Array<{
    id: string;
    name: string | null;
    projectId: string | null;
    lastRunId: string | null;
    lastRunStartedAt: number | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, name, project_id AS projectId, last_run_id AS lastRunId, last_run_ended_at AS lastRunStartedAt
            FROM conversation
           WHERE last_run_status = 'in_progress'
           ORDER BY id DESC
           LIMIT 50`
      )
      .all() as Array<{
        id: string;
        name: string | null;
        projectId: string | null;
        lastRunId: string | null;
        lastRunStartedAt: number | null;
      }>;
    return rows;
  }

  /* ── agent_cost_log ───────────────────────────────────────────────── */

  appendCostLog(input: Omit<AgentCostLogRow, "id" | "createdAt"> & { createdAt?: number }): void {
    const createdAt = input.createdAt ?? nowMs();
    this.db
      .prepare(
        `INSERT INTO agent_cost_log
           (conversation_id, provider, model, prompt_tokens, completion_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.conversationId,
        input.provider,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.costUsd,
        createdAt
      );
  }

  costSumForConversation(conversationId: string): {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost_usd), 0.0) AS cost_usd
         FROM agent_cost_log
         WHERE conversation_id = ?`
      )
      .get(conversationId) as { prompt_tokens: number; completion_tokens: number; cost_usd: number };
    return {
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      costUsd: Number(row.cost_usd ?? 0)
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Row conversion                                                             */
/* -------------------------------------------------------------------------- */

interface RawPart {
  id: string;
  message_id: string;
  seq: number;
  type: string;
  tool_call_id: string | null;
  tool_name: string | null;
  input_json: string | null;
  output_json: string | null;
  output_preview: string | null;
  is_error: number;
  output_file_path: string | null;
  tokens: number | null;
  text_content: string | null;
  created_at: number;
}

function rowToPart(r: RawPart): MessagePart {
  return {
    id: r.id,
    messageId: r.message_id,
    seq: r.seq,
    type: r.type as MessagePartType,
    toolCallId: r.tool_call_id,
    toolName: r.tool_name,
    inputJson: r.input_json,
    outputJson: r.output_json,
    outputPreview: r.output_preview,
    isError: r.is_error === 1,
    outputFilePath: r.output_file_path,
    tokens: r.tokens,
    textContent: r.text_content,
    createdAt: r.created_at
  };
}

interface RawToolRun {
  tool_call_id: string;
  conversation_id: string;
  message_id: string;
  tool_name: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  error_code: string | null;
  cost_usd: number | null;
  permission_decision_json: string | null;
}

function rowToToolRun(r: RawToolRun): ToolRun {
  return {
    toolCallId: r.tool_call_id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    toolName: r.tool_name,
    status: r.status as ToolRunStatus,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    errorCode: r.error_code,
    costUsd: r.cost_usd,
    permissionDecisionJson: r.permission_decision_json
  };
}

interface RawAgentTodo {
  id: string;
  project_id: string;
  conversation_id: string | null;
  content: string;
  status: string;
  seq: number;
  updated_at: number;
}

function rowToTodo(r: RawAgentTodo): AgentTodo {
  return {
    id: r.id,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    content: r.content,
    status: r.status as AgentTodoStatus,
    seq: r.seq,
    updatedAt: r.updated_at
  };
}

interface RawAgentTask {
  id: string;
  project_id: string;
  conversation_id: string | null;
  type: string;
  status: string;
  payload_json: string;
  result_json: string | null;
  pid: number | null;
  started_at: number;
  ended_at: number | null;
}

function rowToTask(r: RawAgentTask): AgentTask {
  return {
    id: r.id,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    type: r.type,
    status: r.status as AgentTaskStatus,
    payloadJson: r.payload_json,
    resultJson: r.result_json,
    pid: r.pid,
    startedAt: r.started_at,
    endedAt: r.ended_at
  };
}

interface RawRule {
  id: string;
  scope: string;
  project_id: string | null;
  conversation_id: string | null;
  tool_name: string;
  pattern_json: string;
  behavior: string;
  source: string;
  created_at: number;
}

function rowToRule(r: RawRule): PermissionRule {
  return {
    id: r.id,
    scope: r.scope as PermissionScope,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    toolName: r.tool_name,
    patternJson: r.pattern_json,
    behavior: r.behavior as PermissionBehavior,
    source: r.source as PermissionRule["source"],
    createdAt: r.created_at
  };
}

interface RawMemoryIndex {
  id: string;
  project_id: string;
  relative_path: string;
  type: string;
  description: string;
  mtime: number;
  bytes: number;
}

function rowToMemoryIndex(r: RawMemoryIndex): MemoryIndexRow {
  return {
    id: r.id,
    projectId: r.project_id,
    relativePath: r.relative_path,
    type: r.type,
    description: r.description,
    mtime: r.mtime,
    bytes: r.bytes
  };
}
