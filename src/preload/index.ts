import type {
  AppearanceSettings,
  ChatAttachment,
  ChatMessage,
  ChatRequestOptions,
  ChatStreamEvent,
  CheckConnectivityRequest,
  CheckConnectivityResult,
  Conversation,
  McpServerConfig,
  McpTestResult,
  ModelConfig,
  Project,
  ProviderConfig,
  ThinkBudget
} from "@shared/types";
import { IPC, chatStreamChannel } from "@shared/ipc-channels";
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
  bulkInitModels: (providerId: string, modelIds: string[]) =>
    ipcRenderer.invoke(IPC.models.bulkInit, providerId, modelIds) as Promise<ModelConfig[]>,
  // Provider config
  getAllProviderConfigs: () => ipcRenderer.invoke(IPC.providers.getAll) as Promise<ProviderConfig[]>,
  getProviderConfig: (providerId: string) =>
    ipcRenderer.invoke(IPC.providers.get, providerId) as Promise<ProviderConfig | null>,
  saveProviderConfig: (config: ProviderConfig) =>
    ipcRenderer.invoke(IPC.providers.save, config) as Promise<ProviderConfig[]>,
  deleteProviderConfig: (providerId: string) =>
    ipcRenderer.invoke(IPC.providers.delete, providerId) as Promise<ProviderConfig[]>,
  // Custom models
  addCustomModel: (providerId: string, modelId: string, supportsThink: boolean, thinkLevels?: string[]) =>
    ipcRenderer.invoke(IPC.models.addCustom, providerId, modelId, supportsThink, thinkLevels) as Promise<
      Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>
    >,
  deleteCustomModel: (providerId: string, modelId: string) =>
    ipcRenderer.invoke(IPC.models.deleteCustom, providerId, modelId) as Promise<
      Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>
    >,
  getCustomModels: (providerId: string) =>
    ipcRenderer.invoke(IPC.models.getCustom, providerId) as Promise<
      Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>
    >,
  getAllCustomModels: () =>
    ipcRenderer.invoke(IPC.models.getAllCustom) as Promise<
      Array<{ providerId: string; modelId: string; supportsThink: boolean; thinkLevels?: string[] }>
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
  testMcpServer: (cfg: McpServerConfig) => ipcRenderer.invoke(IPC.mcp.test, cfg) as Promise<McpTestResult>
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Export the API type so the renderer can `import type` it instead of
// maintaining a separate hand-written declaration in `env.d.ts`. This is the
// single source of truth for the IPC surface.
export type ElectronAPI = typeof electronAPI;
