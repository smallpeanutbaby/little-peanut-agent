/**
 * Agent IPC layer.
 *
 * Registers handlers for `agent:start-run` / `agent:cancel-run` /
 * `agent:answer-permission` plus a per-run push channel
 * `agent:run:{runId}` over which the renderer subscribes to
 * `AgentRunEvent` payloads.
 *
 * Lifecycle:
 *  - `start-run` creates an AbortController, persists the user message
 *    via the runtime, and spawns the queryLoop. Returns `{ runId }`.
 *  - Every event the loop yields is forwarded to the renderer on
 *    `agent:run:{runId}`.
 *  - When the loop terminates, the controller is removed from the map.
 *  - `cancel-run` aborts the controller; the loop yields a `cancelled`
 *    terminal event and exits.
 *  - Permission requests piggy-back on a separate per-run channel so
 *    the renderer can present a modal; the response feeds the same
 *    promise the gate awaits.
 */

import { ipcMain, app, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IPC,
  agentRunChannel,
  agentPermissionChannel
} from "@shared/ipc-channels.js";
import type {
  AgentPermissionResponse,
  AgentRunEvent,
  AgentStartRunInput
} from "@shared/types.js";
import { getMode } from "@shared/modes.js";
import type { AppDatabase } from "../db/database.js";
import { buildDefaultToolRegistry, ToolRegistry } from "./tools/registry.js";
import { bindTodoWriteDatabase } from "./tools/TodoWrite/index.js";
import { bindMemoryWriteDatabase } from "./tools/MemoryWrite/index.js";
import { bindTaskRuntime } from "./tools/Task/index.js";
import { TaskTool } from "./tools/Task/index.js";
import { TaskManager } from "./runtime/TaskManager.js";
import { PermissionGate, type PermissionApprover, type PermissionAskRequest, type PermissionAskResponse } from "./permissions/gate.js";
import { queryLoop } from "./runtime/queryLoop.js";
import { runPipeline, type PipelineRunParams } from "./runtime/pipelineLoop.js";
import type { ProviderRef, LlmStreamEvent } from "./llm/types.js";
import type { Tool } from "./tools/Tool.js";

void ToolRegistry;
void TaskTool;
void (null as unknown as LlmStreamEvent);

interface ActiveRun {
  conversationId: string;
  controller: AbortController;
  /** WebContents we send events to. */
  sender: WebContents;
  /** Pending permission requests keyed by id; resolves the promise
   *  awaited by the gate. */
  pendingPermissions: Map<
    string,
    { resolve: (resp: PermissionAskResponse) => void; toolCallId: string }
  >;
  /** Gate reference for toggling bypass mode at runtime. */
  gate?: PermissionGate;
}

const activeRuns = new Map<string, ActiveRun>();
let globalBypassPermissions = false;

export function registerAgentIpc(database: AppDatabase): void {
  // Bind the DB-aware tools that can't get a handle through ToolCallContext.
  bindTodoWriteDatabase(database);
  bindMemoryWriteDatabase(database);

  // Singleton TaskManager — owns subagent agent_task rows.
  const taskManager = new TaskManager(database);

  // The Task tool inherits provider+model from the *most recent* parent
  // run started on this process. We update this on every startRun call.
  // (Concurrency is fine: subagents always inherit from the run that
  //  spawned them because the binding is captured at tool-call time.)
  let lastProviderRef: { provider: ProviderRef; model: string } | null = null;

  bindTaskRuntime({
    db: database,
    taskManager,
    buildChildRegistry: () => {
      const r = buildDefaultToolRegistry();
      r.unregister?.("Task");
      r.unregister?.("TodoWrite");
      return r;
    },
    resolveDefaultProvider: () => lastProviderRef,
    buildGateForSubagent: async (projectId, conversationId) => {
      const subapprover: PermissionApprover = {
        ask: async () => ({ kind: "deny" })
      };
      // Best-effort: re-use the most recent active run on this process
      // so subagent permission prompts still reach a UI.
      const recent = [...activeRuns.values()][0];
      const approver: PermissionApprover = recent
        ? buildApproverFromRun(recent, projectId, conversationId)
        : subapprover;
      return new PermissionGate(database.agent, approver);
    }
  });

  ipcMain.handle(
    IPC.agent.startRun,
    async (event, input: AgentStartRunInput): Promise<{ runId: string }> => {
      if (!input.projectId || !input.conversationId) {
        throw new Error("agent.startRun requires projectId + conversationId");
      }
      const project = database.listProjects().find((p) => p.id === input.projectId);
      if (!project) {
        throw new Error(`unknown project ${input.projectId}`);
      }
      const projectRoot = project.path || process.cwd();
      // Surface a clear error if the user's bound project folder no
      // longer exists on disk (renamed / deleted / external drive
      // unmounted). Without this, every Bash / ListDir / Read call
      // inside the run fails with an opaque ENOENT and the user can't
      // tell what's wrong. We refuse the whole run instead — they need
      // to update the project binding before anything will work.
      try {
        const st = fs.statSync(projectRoot);
        if (!st.isDirectory()) {
          throw new Error(`project root is not a directory: ${projectRoot}`);
        }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new Error(
            `项目目录不存在: ${projectRoot}\n` +
              "请到「项目设置」里更新绑定路径，或者把文件夹放回原位。"
          );
        }
        throw e;
      }
      const runId = randomUUID();
      const controller = new AbortController();
      const sender = event.sender;
      const channel = agentRunChannel(runId);
      const permissionChannel = agentPermissionChannel(runId);

      const run: ActiveRun = {
        conversationId: input.conversationId,
        controller,
        sender,
        pendingPermissions: new Map()
      };
      activeRuns.set(runId, run);

      const approver: PermissionApprover = {
        ask: (req: PermissionAskRequest, signal: AbortSignal) =>
          new Promise<PermissionAskResponse>((resolve, reject) => {
            run.pendingPermissions.set(req.id, {
              resolve,
              toolCallId: req.id
            });
            const onAbort = () => {
              run.pendingPermissions.delete(req.id);
              reject(new Error("aborted"));
            };
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
            // Push a permission request event to the renderer.
            const payload: AgentRunEvent = {
              kind: "permission_request",
              toolCallId: req.id,
              toolName: req.toolName,
              input: req.input,
              uiPreview: req.uiPreview,
              toolReason: req.toolReason
            };
            try {
              sender.send(channel, payload);
              sender.send(permissionChannel, { ...payload, id: req.id });
            } catch {
              // renderer gone — abort.
              run.pendingPermissions.delete(req.id);
              reject(new Error("renderer disconnected"));
            }
          })
      };

      const gate = new PermissionGate(database.agent, approver);
      gate.bypassAll = globalBypassPermissions;
      run.gate = gate;
      const registry = buildDefaultToolRegistry();
      // MCP: surface every connected MCP server's tools to this run.
      // Connection objects live in the singleton McpManager and are
      // reused across runs; we just resolve the descriptors here.
      try {
        const { getMcpManager } = await import("./mcp/registry.js");
        await getMcpManager().refreshAll(database.listMcpServers());
        const mcpTools = await getMcpManager().buildTools();
        for (const t of mcpTools) {
          try {
            registry.register(t);
          } catch {
            /* duplicate name — ignore */
          }
        }
      } catch (e) {
        console.warn("[agent] MCP tool wiring failed", e);
      }

      // Skills: discover SKILL.md files under both project + global
      // skill roots, bind the catalog so the `Skill` tool can resolve
      // names, and surface descriptions into the system prompt.
      let skillHints: Array<{ name: string; source: "project" | "user"; description: string }> = [];
      try {
        const { loadSkills } = await import("./skills/loader.js");
        const { bindSkillCatalog } = await import("./tools/Skill/index.js");
        const skillRoots: Array<{ dir: string; source: "project" | "user" }> = [];
        if (projectRoot) skillRoots.push({ dir: path.join(projectRoot, ".agent", "skills"), source: "project" });
        try {
          skillRoots.push({ dir: path.join(app.getPath("userData"), "skills"), source: "user" });
        } catch {
          /* test env */
        }
        const skills = await loadSkills(skillRoots);
        bindSkillCatalog(skills);
        skillHints = skills.map((s) => ({ name: s.name, source: s.source, description: s.description }));
      } catch (e) {
        console.warn("[agent] skills wiring failed", e);
      }
      const allTools: Tool[] = registry.list();
      const mode = getMode(input.modeId ?? "agent");

      // Plan mode = hard read-only enforcement.
      //
      // We strip every non-read-only tool from the list the LLM sees, so
      // even if the systemPrompt is ignored OR the model invents a
      // tool name, it literally cannot dispatch a destructive call. The
      // user explicitly hands the plan off via the "Execute as Agent"
      // button in the renderer — that switches conversation.modeId to
      // "agent" and sends the plan as a new message, at which point the
      // full toolset comes back.
      //
      // We trust each tool's `isReadOnly()` flag: built-in writers
      // (Write, Edit, Bash, Delete, TodoWrite, MemoryWrite, Task) return
      // false; built-in readers (Read, Grep, Glob, ListDir, ReadLints,
      // WebSearch, WebFetch, MemoryRead, Skill) return true. MCP tools
      // default to false (registry.ts:95), so user-configured MCP
      // servers are also denied in plan mode — a deliberate safe
      // default, since we can't introspect arbitrary MCP semantics.
      const tools: Tool[] =
        mode.id === "plan"
          ? allTools.filter((t) => {
              try {
                return t.isReadOnly({} as never) === true;
              } catch {
                return false;
              }
            })
          : allTools;

      // Stash the parent provider+model so any spawned subagents inherit.
      lastProviderRef = {
        provider: {
          id: input.providerId,
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey
        },
        model: input.model
      };

      // Mark the conversation as having an in-flight run so a crash
      // mid-stream surfaces in the resume-toast list at next boot.
      try {
        database.agent.markConversationRun(input.conversationId, runId, "in_progress");
        database.agent.saveRunOptions(input.conversationId, {
          providerId: input.providerId,
          protocol: input.protocol,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          model: input.model,
          temperature: input.temperature,
          thinkBudget: input.thinkBudget,
          maxOutputTokens: input.maxOutputTokens,
          modeId: input.modeId,
          language: input.language
        });
      } catch (e) {
        console.warn("[agent] markConversationRun(in_progress) failed", e);
      }

      void (async () => {
        try {
          const primaryProvider: ProviderRef = {
            id: input.providerId,
            protocol: input.protocol,
            baseUrl: input.baseUrl,
            apiKey: input.apiKey
          };

          const eventSource: AsyncIterable<import("./runtime/types.js").AgentEvent> =
            input.pipelineStages && input.pipelineStages.length === 3
              ? runPipeline({
                  runId,
                  conversationId: input.conversationId,
                  projectId: input.projectId,
                  projectRoot,
                  projectName: project.name,
                  userMessage: input.userMessage,
                  mode,
                  language: input.language ?? "zh-CN",
                  tools,
                  signal: controller.signal,
                  db: database,
                  gate,
                  additionalWorkingDirectories: undefined,
                  skillHints,
                  stages: await resolvePipelineStages(input.pipelineStages, primaryProvider, database)
                })
              : queryLoop({
                  runId,
                  conversationId: input.conversationId,
                  projectId: input.projectId,
                  projectRoot,
                  projectName: project.name,
                  userMessage: input.userMessage,
                  mode,
                  provider: primaryProvider,
                  model: input.model,
                  temperature: input.temperature ?? mode.defaultTemperature,
                  thinkBudget: input.thinkBudget ?? mode.defaultThinkBudget,
                  maxOutputTokens: input.maxOutputTokens,
                  language: input.language ?? "zh-CN",
                  tools,
                  signal: controller.signal,
                  db: database,
                  gate,
                  skillHints
                });

          for await (const ev of eventSource) {
            try {
              sender.send(channel, ev as AgentRunEvent);
              // Best-effort JSONL trace for offline inspection. Skipped
              // automatically when Electron's userData path isn't available.
              appendTraceLine(runId, ev);
            } catch {
              // renderer closed mid-run.
              controller.abort();
              break;
            }
            if (ev.kind === "terminal") {
              const dbStatus: "completed" | "failed" | "cancelled" | "budget_exceeded" =
                ev.reason === "completed"
                  ? "completed"
                  : ev.reason === "cancelled"
                    ? "cancelled"
                    : ev.reason === "budget_exceeded"
                      ? "budget_exceeded"
                      : "failed";
              try {
                database.agent.markConversationRun(input.conversationId, runId, dbStatus);
                appendTraceLine(runId, { kind: "terminal", reason: ev.reason, message: ev.message ?? null, at: Date.now() });
              } catch (e) {
                console.warn("[agent] markConversationRun(terminal) failed", e);
              }
              break;
            }
          }
        } catch (e) {
          try {
            sender.send(channel, {
              kind: "terminal",
              reason: "stream_error",
              message: (e as Error).message || "unexpected"
            } satisfies AgentRunEvent);
          } catch {
            /* ignore */
          }
        } finally {
          // Reject any still-pending permission asks so the gate's
          // promise resolves and the tool loop unwinds.
          for (const p of run.pendingPermissions.values()) {
            p.resolve({ kind: "deny" });
          }
          run.pendingPermissions.clear();
          activeRuns.delete(runId);
        }
      })();

      return { runId };
    }
  );

  ipcMain.handle(IPC.agent.cancelRun, (_e, runId: string) => {
    const run = activeRuns.get(runId);
    if (run) {
      run.controller.abort();
    }
  });

  ipcMain.handle(IPC.agent.setBypassPermissions, (_e, bypass: boolean) => {
    globalBypassPermissions = bypass;
    for (const [, run] of activeRuns) {
      if (run.gate) {
        run.gate.bypassAll = bypass;
        if (bypass) {
          for (const [id, pending] of run.pendingPermissions) {
            pending.resolve({ kind: "allow", scope: "once" });
            run.pendingPermissions.delete(id);
          }
        }
      }
    }
  });

  ipcMain.handle(IPC.agent.answerPermission, (_e, payload: AgentPermissionResponse) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;
    const pending = run.pendingPermissions.get(payload.toolCallId);
    if (!pending) return;
    run.pendingPermissions.delete(payload.toolCallId);
    if (payload.decision === "deny") {
      pending.resolve({ kind: "deny" });
      return;
    }
    const scope: "once" | "session" | "project" =
      payload.decision === "allow_session"
        ? "session"
        : payload.decision === "allow_project"
          ? "project"
          : "once";
    pending.resolve({ kind: "allow", scope });
  });

  ipcMain.handle(IPC.agent.listParts, (_e, conversationId: string) => {
    return database.agent.listPartsForConversation(conversationId);
  });

  ipcMain.handle(IPC.agent.listToolRuns, (_e, conversationId: string) => {
    return database.agent.listToolRunsForConversation(conversationId);
  });

  ipcMain.handle(IPC.agent.listTodos, (_e, projectId: string, conversationId?: string | null) => {
    return database.agent.listTodos(projectId, conversationId ?? null);
  });

  ipcMain.handle(IPC.agent.listTasks, (_e, projectId: string, limit?: number) => {
    return database.agent.listAgentTasks(projectId, limit ?? 20);
  });

  ipcMain.handle(IPC.agent.cancelTask, (_e, taskId: string) => {
    return taskManager.cancel(taskId);
  });

  ipcMain.handle(IPC.agent.costSummary, (_e, conversationId: string) => {
    return database.agent.costSumForConversation(conversationId);
  });

  /**
   * Context budget snapshot — used by the chat panel to render the
   * "X / 128k" ring as soon as the user opens an existing conversation,
   * BEFORE any new turn streams. Recomputes the same numbers the
   * queryLoop would emit on its first `context_budget` event so the
   * pre-turn and mid-turn displays stay consistent.
   */
  ipcMain.handle(
    IPC.agent.contextSnapshot,
    async (
      _e,
      input: {
        conversationId: string;
        model: string;
        thinkBudget?: import("@shared/types.js").ThinkBudget;
      }
    ): Promise<{ usedTokens: number; budgetTokens: number; windowTokens: number; compacted: boolean }> => {
      // Lazy-import to avoid pulling agent runtime modules into a non-agent
      // codepath at startup. Note these modules are still bundled into the
      // main process; this is just an import-graph nicety.
      const { modelContextFor } = await import("./context/modelLimits.js");
      const { tokensForHistory } = await import("./context/tokenizer.js");
      const messages = database.listMessages(input.conversationId);
      // Cheap canonicalisation: tokensForHistory only needs text content,
      // so we wrap each message in a single text block (matching how the
      // queryLoop's `loadCanonicalHistory` would emit legacy rows without
      // parts). Per-tool-call parts in newer rows are summarised via the
      // text preview the renderer already persists. This stays a
      // best-effort estimate — we'd over-count slightly compared to the
      // real per-tool-block tokenisation, but the user reads this number
      // as a rough utilisation gauge, not a billing meter.
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
          blocks: [{ type: "text" as const, text: m.content ?? "" }]
        }));
      const usedTokens = tokensForHistory(history);
      const ctx = modelContextFor(input.model, { thinkBudget: input.thinkBudget });
      return {
        usedTokens,
        budgetTokens: ctx.promptBudget,
        windowTokens: ctx.contextWindow,
        compacted: false
      };
    }
  );

  ipcMain.handle(IPC.agent.listInterrupted, () => {
    const activeConversationIds = new Set(
      [...activeRuns.values()].map((r) => r.conversationId)
    );
    return database.agent
      .listInterruptedConversations()
      .filter((row) => !activeConversationIds.has(row.id));
  });

  ipcMain.handle(IPC.agent.discardInterrupted, (_e, conversationId: string) => {
    database.agent.markConversationRun(conversationId, "discarded", "cancelled");
    database.agent.clearRunOptions(conversationId);
  });

  /* ── Resume an interrupted run ──────────────────────────────────── */

  ipcMain.handle(
    IPC.agent.resumeRun,
    async (event, conversationId: string): Promise<{ runId: string }> => {
      const opts = database.agent.loadRunOptions(conversationId);
      if (!opts) {
        throw new Error("No persisted run options for this conversation — cannot resume.");
      }
      const conv = database.getConversation(conversationId);
      if (!conv || !conv.projectId) {
        throw new Error("Conversation not found or has no project.");
      }
      const project = database.listProjects().find((p) => p.id === conv.projectId);
      if (!project) {
        throw new Error(`unknown project ${conv.projectId}`);
      }
      const projectRoot = project.path || process.cwd();
      // Same project-root guard as startRun — see comment there.
      try {
        const st = fs.statSync(projectRoot);
        if (!st.isDirectory()) {
          throw new Error(`project root is not a directory: ${projectRoot}`);
        }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new Error(
            `项目目录不存在: ${projectRoot}\n` +
              "请到「项目设置」里更新绑定路径，或者把文件夹放回原位。"
          );
        }
        throw e;
      }

      // Prefer current provider config over the stale snapshot when
      // the provider still exists (credentials may have been rotated).
      let providerId = String(opts.providerId ?? "");
      let protocol = String(opts.protocol ?? "");
      let baseUrl = String(opts.baseUrl ?? "");
      let apiKey = String(opts.apiKey ?? "");
      const currentProvider = database.getProviderConfig?.(providerId);
      if (currentProvider) {
        protocol = currentProvider.protocol ?? protocol;
        baseUrl = currentProvider.baseUrl ?? baseUrl;
        apiKey = currentProvider.apiKey ?? apiKey;
      }

      const model = String(opts.model ?? "");
      const modeId = String(opts.modeId ?? "agent");
      const language = (opts.language as "zh-CN" | "en") ?? "zh-CN";

      // Find the last assistant message with empty content — the
      // unfinished placeholder from the crashed run.
      const messages = database.listMessages(conversationId);
      let assistantMessageId: string | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant" && messages[i].content === "") {
          assistantMessageId = messages[i].id;
          break;
        }
      }

      const runId = randomUUID();
      const controller = new AbortController();
      const sender = event.sender;
      const channel = agentRunChannel(runId);
      const permissionChannel = agentPermissionChannel(runId);

      const run: ActiveRun = {
        conversationId,
        controller,
        sender,
        pendingPermissions: new Map()
      };
      activeRuns.set(runId, run);

      const approver: PermissionApprover = {
        ask: (req: PermissionAskRequest, signal: AbortSignal) =>
          new Promise<PermissionAskResponse>((resolve, reject) => {
            run.pendingPermissions.set(req.id, { resolve, toolCallId: req.id });
            const onAbort = () => {
              run.pendingPermissions.delete(req.id);
              reject(new Error("aborted"));
            };
            if (signal.aborted) { onAbort(); return; }
            signal.addEventListener("abort", onAbort, { once: true });
            const payload: AgentRunEvent = {
              kind: "permission_request",
              toolCallId: req.id,
              toolName: req.toolName,
              input: req.input,
              uiPreview: req.uiPreview,
              toolReason: req.toolReason
            };
            try {
              sender.send(channel, payload);
              sender.send(permissionChannel, { ...payload, id: req.id });
            } catch {
              run.pendingPermissions.delete(req.id);
              reject(new Error("renderer disconnected"));
            }
          })
      };

      const gate = new PermissionGate(database.agent, approver);
      gate.bypassAll = globalBypassPermissions;
      run.gate = gate;
      const registry = buildDefaultToolRegistry();
      try {
        const { getMcpManager } = await import("./mcp/registry.js");
        await getMcpManager().refreshAll(database.listMcpServers());
        const mcpTools = await getMcpManager().buildTools();
        for (const t of mcpTools) {
          try { registry.register(t); } catch { /* dup */ }
        }
      } catch (e) {
        console.warn("[agent] MCP tool wiring failed (resume)", e);
      }
      let skillHints: Array<{ name: string; source: "project" | "user"; description: string }> = [];
      try {
        const { loadSkills } = await import("./skills/loader.js");
        const { bindSkillCatalog } = await import("./tools/Skill/index.js");
        const skillRoots: Array<{ dir: string; source: "project" | "user" }> = [];
        if (projectRoot) skillRoots.push({ dir: path.join(projectRoot, ".agent", "skills"), source: "project" });
        try { skillRoots.push({ dir: path.join(app.getPath("userData"), "skills"), source: "user" }); } catch { /* test */ }
        const skills = await loadSkills(skillRoots);
        bindSkillCatalog(skills);
        skillHints = skills.map((s) => ({ name: s.name, source: s.source, description: s.description }));
      } catch (e) {
        console.warn("[agent] skills wiring failed (resume)", e);
      }
      const tools: Tool[] = registry.list();
      const mode = getMode(modeId);

      lastProviderRef = {
        provider: { id: providerId, protocol, baseUrl, apiKey },
        model
      };

      try {
        database.agent.markConversationRun(conversationId, runId, "in_progress");
      } catch (e) {
        console.warn("[agent] markConversationRun(resume) failed", e);
      }

      void (async () => {
        try {
          for await (const ev of queryLoop({
            runId,
            conversationId,
            projectId: conv.projectId,
            projectRoot,
            projectName: project.name,
            userMessage: null,
            assistantMessageId,
            mode,
            provider: { id: providerId, protocol, baseUrl, apiKey },
            model,
            temperature: (opts.temperature as number | undefined) ?? mode.defaultTemperature,
            thinkBudget: (opts.thinkBudget as import("@shared/types.js").ThinkBudget | undefined) ?? mode.defaultThinkBudget,
            maxOutputTokens: opts.maxOutputTokens as number | undefined,
            language,
            tools,
            signal: controller.signal,
            db: database,
            gate,
            skillHints
          })) {
            try {
              sender.send(channel, ev as AgentRunEvent);
              appendTraceLine(runId, ev);
            } catch {
              controller.abort();
              break;
            }
            if (ev.kind === "terminal") {
              const dbStatus: "completed" | "failed" | "cancelled" | "budget_exceeded" =
                ev.reason === "completed" ? "completed"
                  : ev.reason === "cancelled" ? "cancelled"
                    : ev.reason === "budget_exceeded" ? "budget_exceeded"
                      : "failed";
              try {
                database.agent.markConversationRun(conversationId, runId, dbStatus);
                appendTraceLine(runId, { kind: "terminal", reason: ev.reason, message: ev.message ?? null, at: Date.now() });
              } catch (e) {
                console.warn("[agent] markConversationRun(resume terminal) failed", e);
              }
              break;
            }
          }
        } catch (e) {
          try {
            sender.send(channel, {
              kind: "terminal",
              reason: "stream_error",
              message: (e as Error).message || "unexpected"
            } satisfies AgentRunEvent);
          } catch { /* ignore */ }
        } finally {
          for (const p of run.pendingPermissions.values()) p.resolve({ kind: "deny" });
          run.pendingPermissions.clear();
          activeRuns.delete(runId);
        }
      })();

      return { runId };
    }
  );
}

/** Cancel every active run owned by a webContents. Called when the
 *  renderer window closes so we don't keep streaming into a dead pipe. */
export function cancelAllAgentRunsForSender(sender: WebContents): void {
  for (const [runId, run] of activeRuns.entries()) {
    if (run.sender === sender) {
      run.controller.abort();
      activeRuns.delete(runId);
    }
  }
}

/** Cancel every active run regardless of owner. */
export function cancelAllAgentRuns(): void {
  for (const run of activeRuns.values()) run.controller.abort();
  activeRuns.clear();
}

/* -------------------------------------------------------------------------- */
/* JSONL traces                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Append a single event to `<userData>/agent-traces/{runId}.jsonl`.
 *
 * Best-effort and synchronous: we only call this from the event loop
 * which already does heavier work per event. If the directory doesn't
 * exist we create it lazily on first write; subsequent writes append.
 *
 * Disabled silently when the Electron `app` module isn't available
 * (e.g. unit tests).
 */
let _tracesDir: string | null = null;
function tracesDir(): string | null {
  if (_tracesDir) return _tracesDir;
  try {
    const dir = path.join(app.getPath("userData"), "agent-traces");
    fs.mkdirSync(dir, { recursive: true });
    _tracesDir = dir;
    return dir;
  } catch {
    return null;
  }
}
function appendTraceLine(runId: string, payload: unknown): void {
  const dir = tracesDir();
  if (!dir) return;
  try {
    fs.appendFileSync(path.join(dir, `${runId}.jsonl`), JSON.stringify(payload) + "\n");
  } catch {
    /* ignore — traces are best-effort */
  }
}

/**
 * Build a permission approver that routes subagent permission requests
 * through an existing parent run's WebContents + pendingPermissions
 * map. This lets the user see and answer subagent prompts from the
 * same modal queue used by the parent.
 *
 * `projectId` / `conversationId` are accepted for the IPC payload so
 * the renderer can show "[subagent in <project>]" context if it
 * wants; the gate doesn't use them itself.
 */
function buildApproverFromRun(
  run: ActiveRun,
  _projectId: string,
  _conversationId: string
): PermissionApprover {
  return {
    ask: (req, signal) =>
      new Promise<PermissionAskResponse>((resolve, reject) => {
        run.pendingPermissions.set(req.id, { resolve, toolCallId: req.id });
        const onAbort = () => {
          run.pendingPermissions.delete(req.id);
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        const payload: AgentRunEvent = {
          kind: "permission_request",
          toolCallId: req.id,
          toolName: req.toolName,
          input: req.input,
          uiPreview: req.uiPreview,
          toolReason: req.toolReason
        };
        try {
          // Find which channel the parent run owns and push the request there.
          for (const [parentRunId, parentRun] of activeRuns.entries()) {
            if (parentRun === run) {
              parentRun.sender.send(agentRunChannel(parentRunId), payload);
              parentRun.sender.send(agentPermissionChannel(parentRunId), { ...payload, id: req.id });
              break;
            }
          }
        } catch {
          run.pendingPermissions.delete(req.id);
          reject(new Error("renderer disconnected"));
        }
      })
  };
}

/**
 * Resolve pipeline stage configs into concrete ProviderRef objects.
 * Each stage may use a different provider/model. Falls back to the
 * primary provider when a stage's credentials aren't found.
 */
async function resolvePipelineStages(
  stages: import("@shared/types.js").PipelineStageConfig[],
  primaryProvider: ProviderRef,
  database: AppDatabase
): Promise<PipelineRunParams["stages"]> {
  const resolveOne = async (cfg: import("@shared/types.js").PipelineStageConfig) => {
    let provider: ProviderRef = primaryProvider;
    if (cfg.providerId && cfg.providerId !== primaryProvider.id) {
      const pc = database.getProviderConfig(cfg.providerId);
      if (pc) {
        provider = {
          id: pc.id,
          protocol: pc.protocol,
          baseUrl: pc.baseUrl,
          apiKey: pc.apiKey
        };
      }
    }
    return {
      provider,
      model: cfg.modelId,
      thinkBudget: cfg.thinkBudget
    };
  };

  const plannerCfg = stages.find((s) => s.role === "planner") ?? stages[0];
  const executorCfg = stages.find((s) => s.role === "executor") ?? stages[1];
  const reviewerCfg = stages.find((s) => s.role === "reviewer") ?? stages[2];

  return {
    planner: await resolveOne(plannerCfg),
    executor: await resolveOne(executorCfg),
    reviewer: await resolveOne(reviewerCfg)
  };
}
