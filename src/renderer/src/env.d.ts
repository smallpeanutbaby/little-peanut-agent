import type {
  AppInfo,
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

declare global {
  interface Window {
    electronAPI?: {
      ready: boolean;
      getAppInfo: () => Promise<AppInfo>;
      getAppearanceSettings: () => Promise<AppearanceSettings>;
      setAppearanceSettings: (settings: AppearanceSettings) => Promise<AppearanceSettings>;
      getUiPref: (key: string) => Promise<string | null>;
      setUiPref: (key: string, value: string) => Promise<void>;
      getModelConfigs: (providerId: string) => Promise<ModelConfig[]>;
      saveModelConfig: (config: ModelConfig) => Promise<ModelConfig[]>;
      setAllModelsEnabled: (providerId: string, enabled: boolean) => Promise<ModelConfig[]>;
      bulkInitModels: (providerId: string, modelIds: string[]) => Promise<ModelConfig[]>;
      // Provider config
      getAllProviderConfigs: () => Promise<ProviderConfig[]>;
      getProviderConfig: (providerId: string) => Promise<ProviderConfig | null>;
      saveProviderConfig: (config: ProviderConfig) => Promise<ProviderConfig[]>;
      deleteProviderConfig: (providerId: string) => Promise<ProviderConfig[]>;
      // Custom models
      addCustomModel: (providerId: string, modelId: string, supportsThink: boolean, thinkLevels?: string[]) => Promise<Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>>;
      deleteCustomModel: (providerId: string, modelId: string) => Promise<Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>>;
      getCustomModels: (providerId: string) => Promise<Array<{ modelId: string; supportsThink: boolean; thinkLevels?: string[] }>>;
      getAllCustomModels: () => Promise<Array<{ providerId: string; modelId: string; supportsThink: boolean; thinkLevels?: string[] }>>;
      // Connectivity check
      checkConnectivity: (req: CheckConnectivityRequest) => Promise<CheckConnectivityResult>;
      // Chat streaming
      startChatStream: (req: ChatRequestOptions & { conversationId?: string; assistantMessageId?: string; modeId?: string }) => Promise<{ streamId: string }>;
      cancelChatStream: (streamId: string) => Promise<void>;
      onChatStream: (streamId: string, handler: (ev: ChatStreamEvent) => void) => () => void;
      // Projects
      listProjects: () => Promise<Project[]>;
      createProject: (input: { name: string; path?: string; defaultProviderId?: string | null; defaultModelId?: string | null; defaultThinkBudget?: ThinkBudget | null; systemPrompt?: string }) => Promise<Project>;
      updateProject: (id: string, patch: Partial<Project>) => Promise<Project | null>;
      deleteProject: (id: string) => Promise<void>;
      // Native dialogs
      pickDirectory: () => Promise<string | null>;
      // Conversations
      listConversations: (projectId: string | null) => Promise<Conversation[]>;
      getConversation: (id: string) => Promise<Conversation | null>;
      createConversation: (input: { projectId: string | null; name: string; providerId?: string | null; modelId?: string | null; thinkBudget?: ThinkBudget | null; thinkEnabled?: boolean; modeId?: string }) => Promise<Conversation>;
      updateConversation: (id: string, patch: Partial<Conversation>) => Promise<Conversation | null>;
      deleteConversation: (id: string) => Promise<void>;
      // Messages
      listMessages: (conversationId: string) => Promise<ChatMessage[]>;
      appendMessage: (input: {
        conversationId: string;
        role: "system" | "user" | "assistant";
        content: string;
        reasoning?: string | null;
        attachments?: ChatAttachment[] | null;
      }) => Promise<ChatMessage>;
      deleteMessage: (id: string) => Promise<void>;
      getConversationPreviews: (conversationIds: string[]) => Promise<Record<string, { role: string; content: string; createdAt: number } | null>>;
      // MCP Servers
      listMcpServers: () => Promise<McpServerConfig[]>;
      getMcpServer: (id: string) => Promise<McpServerConfig | null>;
      saveMcpServer: (input: Omit<McpServerConfig, "createdAt" | "updatedAt"> & { id?: string }) => Promise<McpServerConfig>;
      deleteMcpServer: (id: string) => Promise<void>;
      setMcpServerEnabled: (id: string, enabled: boolean) => Promise<McpServerConfig | null>;
      testMcpServer: (cfg: McpServerConfig) => Promise<McpTestResult>;
    };
  }
}

export {};
