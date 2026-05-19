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
import type { ProviderRef, LlmStreamEvent } from "./llm/types.js";
import type { Tool } from "./tools/Tool.js";

void ToolRegistry;
void TaskTool;
void (null as unknown as LlmStreamEvent);

interface ActiveRun {
  controller: AbortController;
  /** WebContents we send events to. */
  sender: WebContents;
  /** Pending permission requests keyed by id; resolves the promise
   *  awaited by the gate. */
  pendingPermissions: Map<
    string,
    { resolve: (resp: PermissionAskResponse) => void; toolCallId: string }
  >;
}

const activeRuns = new Map<string, ActiveRun>();

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
      const runId = randomUUID();
      const controller = new AbortController();
      const sender = event.sender;
      const channel = agentRunChannel(runId);
      const permissionChannel = agentPermissionChannel(runId);

      const run: ActiveRun = {
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
      const tools: Tool[] = registry.list();
      const mode = getMode(input.modeId ?? "agent");

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
      } catch (e) {
        console.warn("[agent] markConversationRun(in_progress) failed", e);
      }

      void (async () => {
        try {
          for await (const ev of queryLoop({
            runId,
            conversationId: input.conversationId,
            projectId: input.projectId,
            projectRoot,
            projectName: project.name,
            userMessage: input.userMessage,
            mode,
            provider: {
              id: input.providerId,
              protocol: input.protocol,
              baseUrl: input.baseUrl,
              apiKey: input.apiKey
            },
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
          })) {
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

  ipcMain.handle(IPC.agent.listInterrupted, () => {
    return database.agent.listInterruptedConversations();
  });

  ipcMain.handle(IPC.agent.discardInterrupted, (_e, conversationId: string) => {
    // The user chose "discard" — flip the marker so the toast doesn't
    // resurrect on next boot. We don't actually try to resume the loop
    // (M4-3 v1 ships discard-only; resume requires reconstructing the
    // exact provider/model/options which we don't persist yet).
    database.agent.markConversationRun(conversationId, "discarded", "cancelled");
  });
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
