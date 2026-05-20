import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import type {
  AppInfo,
  AppearanceSettings,
  ChatAttachment,
  ChatRequestOptions,
  ChatStreamEvent,
  CheckConnectivityRequest,
  CheckConnectivityResult,
  Conversation,
  GitStatusResult,
  GitBranchesResponse,
  GitReviewDiffResponse,
  ReviewScope,
  McpServerConfig,
  ModelCapability,
  ModelConfig,
  Project,
  ProviderConfig,
  ThinkBudget,
  ThinkProtocol
} from "@shared/types.js";
import { IPC, chatStreamChannel } from "@shared/ipc-channels.js";
import type { AppDatabase } from "../db/database.js";
import { getAdapter } from "../ai/adapter.js";
import { getMode, compressMessages } from "@shared/modes.js";
import { testMcpServer } from "../mcp/client.js";
import { getGitStatus } from "../git/status.js";
import { getReviewDiff, listGitBranches, listGitCommits } from "../git/review.js";
import { formatUserFacingError } from "@shared/displayText.js";
import { registerAgentIpc, cancelAllAgentRunsForSender } from "../agent/ipc.js";

/** Tracks active streaming requests so the renderer can cancel them. */
const activeStreams = new Map<string, AbortController>();

export function registerIpc(appInfo: AppInfo, database: AppDatabase) {
  ipcMain.handle(IPC.app.getInfo, () => appInfo);
  ipcMain.handle(IPC.settings.getAppearance, () => database.getAppearanceSettings());
  ipcMain.handle(IPC.settings.setAppearance, (_event, settings: AppearanceSettings) => {
    database.saveAppearanceSettings(settings);
    return database.getAppearanceSettings();
  });

  // ─── UI Preferences ────────────────────────────────────────────────
  ipcMain.handle(IPC.uiPrefs.get, (_event, key: string) => database.getUiPref(key));
  ipcMain.handle(IPC.uiPrefs.set, (_event, key: string, value: string) => {
    database.setUiPref(key, value);
  });

  // ─── Model Config ──────────────────────────────────────────────────
  ipcMain.handle(IPC.models.getConfigs, (_event, providerId: string) => {
    return database.getModelConfigs(providerId);
  });
  ipcMain.handle(IPC.models.saveConfig, (_event, config: ModelConfig) => {
    database.saveModelConfig(config);
    return database.getModelConfigs(config.providerId);
  });
  ipcMain.handle(IPC.models.setAllEnabled, (_event, providerId: string, enabled: boolean) => {
    database.setAllModelsEnabled(providerId, enabled);
    return database.getModelConfigs(providerId);
  });
  ipcMain.handle(IPC.models.bulkInit, (_event, providerId: string, models: Array<string | { id: string; capabilities?: ModelCapability[]; thinkProtocol?: ThinkProtocol | null }>) => {
    // Accept both the new {id, capabilities, thinkProtocol}[] shape and the
    // legacy `string[]` shape so older renderer builds keep working through
    // a deploy.
    const normalised = models.map((m) => (typeof m === "string" ? { id: m } : m));
    database.bulkInitModels(providerId, normalised);
    return database.getModelConfigs(providerId);
  });

  // ─── Provider Config ───────────────────────────────────────────────
  ipcMain.handle(IPC.providers.getAll, () => {
    return database.getAllProviderConfigs();
  });
  ipcMain.handle(IPC.providers.get, (_event, providerId: string) => {
    return database.getProviderConfig(providerId);
  });
  ipcMain.handle(IPC.providers.save, (_event, config: ProviderConfig) => {
    database.saveProviderConfig(config);
    return database.getAllProviderConfigs();
  });
  ipcMain.handle(IPC.providers.delete, (_event, providerId: string) => {
    database.deleteProviderConfig(providerId);
    return database.getAllProviderConfigs();
  });

  // ─── Custom Models ─────────────────────────────────────────────────
  ipcMain.handle(
    IPC.models.addCustom,
    (
      _event,
      providerId: string,
      modelId: string,
      capabilities: ModelCapability[],
      thinkProtocol: ThinkProtocol | null
    ) => {
      database.addCustomModel(providerId, modelId, capabilities ?? ["text"], thinkProtocol ?? null);
      return database.getCustomModels(providerId);
    }
  );
  ipcMain.handle(IPC.models.deleteCustom, (_event, providerId: string, modelId: string) => {
    database.deleteCustomModel(providerId, modelId);
    return database.getCustomModels(providerId);
  });
  ipcMain.handle(IPC.models.getCustom, (_event, providerId: string) => {
    return database.getCustomModels(providerId);
  });
  ipcMain.handle(IPC.models.getAllCustom, () => {
    return database.getAllCustomModels();
  });

  // ─── Connectivity Check ────────────────────────────────────────────
  ipcMain.handle(IPC.connectivity.check, async (_event, req: CheckConnectivityRequest): Promise<CheckConnectivityResult> => {
    if (!req?.apiKey?.trim()) return { ok: false, message: "API Key 未填写" };
    if (!req?.baseUrl?.trim()) return { ok: false, message: "API 地址未填写" };
    if (!req?.model?.trim()) return { ok: false, message: "未指定测试模型" };
    const adapter = getAdapter(req.protocol);
    return adapter.check(req);
  });

  // ─── Chat Streaming ────────────────────────────────────────────────
  ipcMain.handle(IPC.chat.startStream, (event, req: ChatRequestOptions & { conversationId?: string; assistantMessageId?: string; modeId?: string }): { streamId: string } => {
    const streamId = randomUUID();
    const ac = new AbortController();
    activeStreams.set(streamId, ac);
    const sender = event.sender;
    const channel = chatStreamChannel(streamId);

    // Inject the active mode's system prompt + default sampling hints, then
    // compress messages to fit the mode's context budget. The renderer is
    // still the source of truth for provider/model selection; mode only
    // influences systemPrompt, defaults, and the rolling context window.
    const mode = getMode(req.modeId);
    const hasSystem = req.messages.some((m) => m.role === "system");
    const messagesWithSystem = hasSystem
      ? req.messages
      : [{ role: "system" as const, content: mode.systemPrompt }, ...req.messages];

    const compressed = compressMessages(messagesWithSystem, mode);
    if (compressed.dropped > 0) {
      console.info(
        `[chat] context trimmed: dropped=${compressed.dropped}, ` +
          `chars ${compressed.originalChars} → ${compressed.finalChars}, mode=${mode.id}`
      );
    }

    const effectiveReq: ChatRequestOptions = {
      ...req,
      messages: compressed.messages as ChatRequestOptions["messages"],
      temperature: req.temperature ?? mode.defaultTemperature,
      thinkBudget: req.thinkBudget ?? mode.defaultThinkBudget
    };

    void (async () => {
      if (compressed.dropped > 0) {
        try {
          sender.send(channel, {
            type: "context_trimmed",
            dropped: compressed.dropped,
            originalChars: compressed.originalChars,
            finalChars: compressed.finalChars
          } satisfies ChatStreamEvent);
        } catch { /* renderer gone */ }
      }
      let accumulatedText = "";
      let accumulatedReasoning = "";
      let lastError: string | null = null;
      let cancelled = false;

      /* ── Stream safety nets ────────────────────────────────────────────
       * Some providers (Kimi/Moonshot in particular) occasionally accept
       * the request, send TLS bytes, and then go silent without ever
       * emitting `[DONE]`. In that case our `for await` would block
       * forever and the renderer's sidebar dot would spin indefinitely.
       *
       * We guard with two timers:
       *   - INACTIVITY_MS: aborted if no event arrives within this window.
       *   - MAX_MS: hard ceiling on total stream duration.
       * Either firing aborts the controller, which causes the inner loop
       * (or the underlying fetch) to bail out.
       */
      const INACTIVITY_MS = 60_000;
      const MAX_MS = 5 * 60_000;
      let inactivityTimer: NodeJS.Timeout | null = null;
      const armInactivity = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          if (!ac.signal.aborted) {
            lastError = `60s 未收到任何数据，自动终止`;
            ac.abort();
          }
        }, INACTIVITY_MS);
      };
      armInactivity();
      const maxTimer = setTimeout(() => {
        if (!ac.signal.aborted) {
          lastError = `已超过 ${Math.round(MAX_MS / 60_000)} 分钟，自动终止`;
          ac.abort();
        }
      }, MAX_MS);

      try {
        const adapter = getAdapter(effectiveReq.protocol);
        for await (const ev of adapter.stream(effectiveReq, ac.signal)) {
          armInactivity();
          if (ac.signal.aborted) {
            cancelled = true;
            try { sender.send(channel, { type: "error", message: lastError || "已取消" } satisfies ChatStreamEvent); } catch { /* ignore */ }
            break;
          }
          if (ev.type === "text") accumulatedText += ev.text;
          else if (ev.type === "reasoning") accumulatedReasoning += ev.text;
          else if (ev.type === "error") lastError = ev.message;
          // The renderer window may have been closed mid-stream — `sender.send`
          // throws if the WebContents is destroyed. We swallow that so the
          // finally block still finalizes the DB row.
          try { sender.send(channel, ev); } catch { /* renderer gone */ }
          if (ev.type === "done" || ev.type === "error") break;
        }
        // If the loop exited because the controller was aborted (timeout)
        // without us seeing a done/error event in the adapter output, we
        // still need to notify the renderer. Otherwise the sidebar dot
        // never clears.
        if (ac.signal.aborted && !cancelled) {
          cancelled = true;
          try { sender.send(channel, { type: "error", message: lastError || "已取消" } satisfies ChatStreamEvent); } catch { /* ignore */ }
        }
      } catch (e) {
        lastError = (e as Error).message || "未知错误";
        try { sender.send(channel, { type: "error", message: lastError } satisfies ChatStreamEvent); } catch { /* ignore */ }
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        clearTimeout(maxTimer);
        activeStreams.delete(streamId);
        // Persist behaviour:
        //  - If we got any text/reasoning, save it (even on cancel/error so the
        //    user keeps partial output).
        //  - If we got nothing AND there was an error, write a short marker so
        //    the user can see what happened when they come back to the conversation.
        //  - If we got nothing AND it was a clean cancel with no error, delete
        //    the empty placeholder so the UI doesn't show a ghost bubble.
        if (req.assistantMessageId) {
          try {
            if (accumulatedText || accumulatedReasoning) {
              database.finalizeMessage(req.assistantMessageId, accumulatedText, accumulatedReasoning || null);
            } else if (lastError) {
              const safe = formatUserFacingError(lastError, "stream_error");
              database.finalizeMessage(req.assistantMessageId, `⚠️ ${safe}`, null);
            } else if (cancelled) {
              database.deleteMessage(req.assistantMessageId);
            }
          } catch { /* ignore */ }
        }
      }
    })();

    return { streamId };
  });

  ipcMain.handle(IPC.chat.cancelStream, (_event, streamId: string) => {
    const ac = activeStreams.get(streamId);
    if (ac) ac.abort();
    activeStreams.delete(streamId);
  });

  // ─── Projects ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.projects.list, () => database.listProjects());
  ipcMain.handle(IPC.projects.create, (_e, input: { name: string; path?: string; defaultProviderId?: string | null; defaultModelId?: string | null; defaultThinkBudget?: ThinkBudget | null; systemPrompt?: string }) => database.createProject(input));
  ipcMain.handle(IPC.projects.update, (_e, id: string, patch: Partial<Project>) => database.updateProject(id, patch));
  ipcMain.handle(IPC.projects.delete, (_e, id: string) => database.deleteProject(id));

  // ─── Dialog ────────────────────────────────────────────────────────
  // Native folder picker used by the sidebar "+ New project" flow. Returns
  // `null` when the user cancels; otherwise the absolute path of the
  // single directory they picked.
  ipcMain.handle(IPC.dialog.pickDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const opts = { properties: ["openDirectory", "createDirectory"] as const };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ─── Conversations ────────────────────────────────────────────────
  ipcMain.handle(IPC.conversations.list, (_e, projectId: string | null) => database.listConversations(projectId));
  ipcMain.handle(IPC.conversations.get, (_e, id: string) => database.getConversation(id));
  ipcMain.handle(IPC.conversations.create, (_e, input: { projectId: string | null; name: string; providerId?: string | null; modelId?: string | null; thinkBudget?: ThinkBudget | null; thinkEnabled?: boolean; modeId?: string }) => database.createConversation(input));
  ipcMain.handle(IPC.conversations.update, (_e, id: string, patch: Partial<Conversation>) => database.updateConversation(id, patch));
  ipcMain.handle(IPC.conversations.delete, (_e, id: string) => database.deleteConversation(id));

  // ─── Messages ──────────────────────────────────────────────────────
  // Renderer-only: filter out tool_result rows (persisted as role='user'
  // to satisfy the LLM protocol) and pipeline-stage orchestration
  // prompts. The agent runtime still uses `database.listMessages` for
  // the unfiltered history it sends to the model.
  ipcMain.handle(IPC.messages.list, (_e, conversationId: string) => database.listMessagesForRenderer(conversationId));
  ipcMain.handle(IPC.messages.append, (_e, input: {
    conversationId: string;
    role: "system" | "user" | "assistant";
    content: string;
    reasoning?: string | null;
    attachments?: ChatAttachment[] | null;
  }) => database.appendMessage(input));
  ipcMain.handle(IPC.messages.delete, (_e, id: string) => database.deleteMessage(id));
  ipcMain.handle(IPC.conversations.previews, (_e, ids: string[]) => database.getConversationPreviews(ids));

  // ─── Shell ────────────────────────────────────────────────────────
  // Open the given absolute path in the OS file manager. Returns "" on
  // success (Electron's contract) or a human-readable error string. We
  // forward the error verbatim so the renderer can surface it.
  ipcMain.handle(IPC.shell.openPath, async (_e, path: string): Promise<string> => {
    if (!path || typeof path !== "string") return "invalid path";
    return shell.openPath(path);
  });

  // ─── Git ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.git.status, async (_e, projectPath: string): Promise<GitStatusResult> => {
    return getGitStatus(projectPath);
  });
  ipcMain.handle(IPC.git.listBranches, async (_e, projectPath: string): Promise<GitBranchesResponse> => {
    return listGitBranches(projectPath);
  });
  ipcMain.handle(IPC.git.listCommits, async (_e, projectPath: string, branch: string, limit?: number) => {
    return listGitCommits(projectPath, branch, limit);
  });
  ipcMain.handle(IPC.git.reviewDiff, async (_e, projectPath: string, scope: ReviewScope): Promise<GitReviewDiffResponse> => {
    return getReviewDiff(projectPath, scope);
  });

  // ─── MCP Servers ──────────────────────────────────────────────────
  ipcMain.handle(IPC.mcp.list, () => database.listMcpServers());
  ipcMain.handle(IPC.mcp.get, (_e, id: string) => database.getMcpServer(id));
  ipcMain.handle(IPC.mcp.save, (_e, input: Omit<McpServerConfig, "createdAt" | "updatedAt"> & { id?: string }) => database.saveMcpServer(input));
  ipcMain.handle(IPC.mcp.delete, (_e, id: string) => database.deleteMcpServer(id));
  ipcMain.handle(IPC.mcp.setEnabled, (_e, id: string, enabled: boolean) => {
    database.setMcpServerEnabled(id, enabled);
    return database.getMcpServer(id);
  });
  ipcMain.handle(IPC.mcp.test, async (_e, cfg: McpServerConfig) => testMcpServer(cfg));

  // ─── Agent Runtime ─────────────────────────────────────────────────
  registerAgentIpc(database);
}

/** Convenience: when window is closed, abort any in-flight streams owned by it.
 *  Wired in from `main/index.ts` via the `closed` window event so users don't
 *  pay for orphaned API tokens / network activity after closing the window. */
export function cancelAllStreamsForWindow(win: BrowserWindow) {
  for (const ac of activeStreams.values()) ac.abort();
  activeStreams.clear();
  try {
    cancelAllAgentRunsForSender(win.webContents);
  } catch {
    /* ignore */
  }
}
