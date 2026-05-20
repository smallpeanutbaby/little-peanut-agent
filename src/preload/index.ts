import type {
  AgentMessagePart,
  AgentPermissionResponse,
  AgentRunEvent,
  AgentStartRunInput,
  AgentTaskItem,
  AgentTodoItem,
  AgentToolRun,
  AppearanceSettings,
  ChatAttachment,
  ChatMessage,
  ChatRequestOptions,
  ChatStreamEvent,
  CheckConnectivityRequest,
  CheckConnectivityResult,
  Conversation,
  GitStatusResult,
  GitBranchesResponse,
  GitCommitsResponse,
  GitReviewDiffResponse,
  ReviewScope,
  McpServerConfig,
  McpTestResult,
  ModelCapability,
  ModelConfig,
  Project,
  ProviderConfig,
  ThinkBudget,
  ThinkProtocol
} from "@shared/types.js";
import { IPC, agentRunChannel, chatStreamChannel } from "@shared/ipc-channels.js";
import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  ready: true,
  getAppInfo: () => ipcRenderer.invoke(IPC.app.getInfo),
  getAppearanceSettings: () => ipcRenderer.invoke(IPC.settings.getAppearance) as Promise<AppearanceSettings>,
  setAppearanceSettings: (settings: AppearanceSettings) =>
    ipcRenderer.invoke(IPC.settings.setAppearance, settings) as Promise<AppearanceSettings>,
  getUiPref: (key: string) => ipcRenderer.invoke(IPC.uiPrefs.get, key) as Promise<string | null>,
  setUiPref: (key: string, value: string) => ipcRenderer.invoke(IPC.uiPrefs.set, key, value) as Promise<void>,
  getModelConfigs: (providerId: string) =>
    ipcRenderer.invoke(IPC.models.getConfigs, providerId) as Promise<ModelConfig[]>,
  saveModelConfig: (config: ModelConfig) =>
    ipcRenderer.invoke(IPC.models.saveConfig, config) as Promise<ModelConfig[]>,
  setAllModelsEnabled: (providerId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.models.setAllEnabled, providerId, enabled) as Promise<ModelConfig[]>,
  /**
   * Seed the model_config table for a provider. Accepts either the legacy
   * `string[]` shape (model ids) or the new
   * `{id, capabilities?, thinkProtocol?}[]` shape — the IPC handler
   * normalises both.
   */
  bulkInitModels: (
    providerId: string,
    models: Array<string | { id: string; capabilities?: ModelCapability[]; thinkProtocol?: ThinkProtocol | null }>
  ) => ipcRenderer.invoke(IPC.models.bulkInit, providerId, models) as Promise<ModelConfig[]>,
  // Provider config
  getAllProviderConfigs: () => ipcRenderer.invoke(IPC.providers.getAll) as Promise<ProviderConfig[]>,
  getProviderConfig: (providerId: string) =>
    ipcRenderer.invoke(IPC.providers.get, providerId) as Promise<ProviderConfig | null>,
  saveProviderConfig: (config: ProviderConfig) =>
    ipcRenderer.invoke(IPC.providers.save, config) as Promise<ProviderConfig[]>,
  deleteProviderConfig: (providerId: string) =>
    ipcRenderer.invoke(IPC.providers.delete, providerId) as Promise<ProviderConfig[]>,
  // Custom models — v4 surface: capabilities[] + thinkProtocol.
  addCustomModel: (
    providerId: string,
    modelId: string,
    capabilities: ModelCapability[],
    thinkProtocol: ThinkProtocol | null
  ) =>
    ipcRenderer.invoke(IPC.models.addCustom, providerId, modelId, capabilities, thinkProtocol) as Promise<
      Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>
    >,
  deleteCustomModel: (providerId: string, modelId: string) =>
    ipcRenderer.invoke(IPC.models.deleteCustom, providerId, modelId) as Promise<
      Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>
    >,
  getCustomModels: (providerId: string) =>
    ipcRenderer.invoke(IPC.models.getCustom, providerId) as Promise<
      Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>
    >,
  getAllCustomModels: () =>
    ipcRenderer.invoke(IPC.models.getAllCustom) as Promise<
      Array<{
        providerId: string;
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>
    >,

  // Connectivity check
  checkConnectivity: (req: CheckConnectivityRequest) =>
    ipcRenderer.invoke(IPC.connectivity.check, req) as Promise<CheckConnectivityResult>,

  // Chat streaming
  startChatStream: (req: ChatRequestOptions & { conversationId?: string; assistantMessageId?: string; modeId?: string }) =>
    ipcRenderer.invoke(IPC.chat.startStream, req) as Promise<{ streamId: string }>,
  cancelChatStream: (streamId: string) => ipcRenderer.invoke(IPC.chat.cancelStream, streamId) as Promise<void>,
  onChatStream: (streamId: string, handler: (ev: ChatStreamEvent) => void) => {
    const channel = chatStreamChannel(streamId);
    const listener = (_event: unknown, payload: ChatStreamEvent) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // Projects
  listProjects: () => ipcRenderer.invoke(IPC.projects.list) as Promise<Project[]>,
  createProject: (input: {
    name: string;
    path?: string;
    defaultProviderId?: string | null;
    defaultModelId?: string | null;
    defaultThinkBudget?: ThinkBudget | null;
    systemPrompt?: string;
  }) => ipcRenderer.invoke(IPC.projects.create, input) as Promise<Project>,
  updateProject: (id: string, patch: Partial<Project>) =>
    ipcRenderer.invoke(IPC.projects.update, id, patch) as Promise<Project | null>,
  deleteProject: (id: string) => ipcRenderer.invoke(IPC.projects.delete, id) as Promise<void>,

  // Native dialogs
  pickDirectory: () => ipcRenderer.invoke(IPC.dialog.pickDirectory) as Promise<string | null>,

  // Shell — reveal a path in Finder / Explorer. Returns "" on success or an
  // error string on failure (Electron `shell.openPath` contract).
  openPath: (path: string) => ipcRenderer.invoke(IPC.shell.openPath, path) as Promise<string>,

  // Git — structured `git status` for a project's working directory.
  getGitStatus: (projectPath: string) =>
    ipcRenderer.invoke(IPC.git.status, projectPath) as Promise<GitStatusResult>,
  listGitBranches: (projectPath: string) =>
    ipcRenderer.invoke(IPC.git.listBranches, projectPath) as Promise<GitBranchesResponse>,
  listGitCommits: (projectPath: string, branch: string, limit?: number) =>
    ipcRenderer.invoke(IPC.git.listCommits, projectPath, branch, limit) as Promise<GitCommitsResponse>,
  getReviewDiff: (projectPath: string, scope: ReviewScope) =>
    ipcRenderer.invoke(IPC.git.reviewDiff, projectPath, scope) as Promise<GitReviewDiffResponse>,

  // Conversations
  listConversations: (projectId: string | null) =>
    ipcRenderer.invoke(IPC.conversations.list, projectId) as Promise<Conversation[]>,
  getConversation: (id: string) =>
    ipcRenderer.invoke(IPC.conversations.get, id) as Promise<Conversation | null>,
  createConversation: (input: {
    projectId: string | null;
    name: string;
    providerId?: string | null;
    modelId?: string | null;
    thinkBudget?: ThinkBudget | null;
    thinkEnabled?: boolean;
    modeId?: string;
  }) => ipcRenderer.invoke(IPC.conversations.create, input) as Promise<Conversation>,
  updateConversation: (id: string, patch: Partial<Conversation>) =>
    ipcRenderer.invoke(IPC.conversations.update, id, patch) as Promise<Conversation | null>,
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversations.delete, id) as Promise<void>,

  // Messages
  listMessages: (conversationId: string) =>
    ipcRenderer.invoke(IPC.messages.list, conversationId) as Promise<ChatMessage[]>,
  appendMessage: (input: {
    conversationId: string;
    role: "system" | "user" | "assistant";
    content: string;
    reasoning?: string | null;
    attachments?: ChatAttachment[] | null;
  }) => ipcRenderer.invoke(IPC.messages.append, input) as Promise<ChatMessage>,
  deleteMessage: (id: string) => ipcRenderer.invoke(IPC.messages.delete, id) as Promise<void>,
  getConversationPreviews: (conversationIds: string[]) =>
    ipcRenderer.invoke(IPC.conversations.previews, conversationIds) as Promise<
      Record<string, { role: string; content: string; createdAt: number } | null>
    >,

  // MCP Servers
  listMcpServers: () => ipcRenderer.invoke(IPC.mcp.list) as Promise<McpServerConfig[]>,
  getMcpServer: (id: string) => ipcRenderer.invoke(IPC.mcp.get, id) as Promise<McpServerConfig | null>,
  saveMcpServer: (input: Omit<McpServerConfig, "createdAt" | "updatedAt"> & { id?: string }) =>
    ipcRenderer.invoke(IPC.mcp.save, input) as Promise<McpServerConfig>,
  deleteMcpServer: (id: string) => ipcRenderer.invoke(IPC.mcp.delete, id) as Promise<void>,
  setMcpServerEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.mcp.setEnabled, id, enabled) as Promise<McpServerConfig | null>,
  testMcpServer: (cfg: McpServerConfig) => ipcRenderer.invoke(IPC.mcp.test, cfg) as Promise<McpTestResult>,

  // ─── Agent Runtime ──────────────────────────────────────────────────
  startAgentRun: (input: AgentStartRunInput) =>
    ipcRenderer.invoke(IPC.agent.startRun, input) as Promise<{ runId: string }>,
  cancelAgentRun: (runId: string) =>
    ipcRenderer.invoke(IPC.agent.cancelRun, runId) as Promise<void>,
  answerAgentPermission: (resp: AgentPermissionResponse) =>
    ipcRenderer.invoke(IPC.agent.answerPermission, resp) as Promise<void>,
  onAgentRun: (runId: string, handler: (ev: AgentRunEvent) => void) => {
    const channel = agentRunChannel(runId);
    const listener = (_event: unknown, payload: AgentRunEvent) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  listAgentParts: (conversationId: string) =>
    ipcRenderer.invoke(IPC.agent.listParts, conversationId) as Promise<AgentMessagePart[]>,
  listAgentToolRuns: (conversationId: string) =>
    ipcRenderer.invoke(IPC.agent.listToolRuns, conversationId) as Promise<AgentToolRun[]>,
  listAgentTodos: (projectId: string, conversationId?: string | null) =>
    ipcRenderer.invoke(IPC.agent.listTodos, projectId, conversationId ?? null) as Promise<AgentTodoItem[]>,
  listAgentTasks: (projectId: string, limit?: number) =>
    ipcRenderer.invoke(IPC.agent.listTasks, projectId, limit) as Promise<AgentTaskItem[]>,
  cancelAgentTask: (taskId: string) =>
    ipcRenderer.invoke(IPC.agent.cancelTask, taskId) as Promise<boolean>,
  agentCostSummary: (conversationId: string) =>
    ipcRenderer.invoke(IPC.agent.costSummary, conversationId) as Promise<{
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
    }>,
  agentContextSnapshot: (input: {
    conversationId: string;
    model: string;
    thinkBudget?: import("@shared/types.js").ThinkBudget;
  }) =>
    ipcRenderer.invoke(IPC.agent.contextSnapshot, input) as Promise<{
      usedTokens: number;
      budgetTokens: number;
      windowTokens: number;
      compacted: boolean;
    }>,
  listInterruptedConversations: () =>
    ipcRenderer.invoke(IPC.agent.listInterrupted) as Promise<
      Array<{ id: string; name: string | null; projectId: string | null; lastRunId: string | null; lastRunStartedAt: number | null }>
    >,
  discardInterruptedConversation: (conversationId: string) =>
    ipcRenderer.invoke(IPC.agent.discardInterrupted, conversationId) as Promise<void>,
  resumeAgentRun: (conversationId: string) =>
    ipcRenderer.invoke(IPC.agent.resumeRun, conversationId) as Promise<{ runId: string }>,
  setBypassPermissions: (bypass: boolean) =>
    ipcRenderer.invoke(IPC.agent.setBypassPermissions, bypass) as Promise<void>
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Export the API type so the renderer can `import type` it instead of
// maintaining a separate hand-written declaration in `env.d.ts`. This is the
// single source of truth for the IPC surface.
export type ElectronAPI = typeof electronAPI;
