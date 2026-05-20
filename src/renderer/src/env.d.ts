import type {
  AgentMessagePart,
  AgentPermissionResponse,
  AgentRunEvent,
  AgentStartRunInput,
  AgentTaskItem,
  AgentTodoItem,
  AgentToolRun,
  AppInfo,
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
      /** Accepts either model-id strings (legacy) or `{id, capabilities, thinkProtocol}` objects (v4). */
      bulkInitModels: (
        providerId: string,
        models: Array<string | { id: string; capabilities?: ModelCapability[]; thinkProtocol?: ThinkProtocol | null }>
      ) => Promise<ModelConfig[]>;
      // Provider config
      getAllProviderConfigs: () => Promise<ProviderConfig[]>;
      getProviderConfig: (providerId: string) => Promise<ProviderConfig | null>;
      saveProviderConfig: (config: ProviderConfig) => Promise<ProviderConfig[]>;
      deleteProviderConfig: (providerId: string) => Promise<ProviderConfig[]>;
      // Custom models — v4 surface: capabilities[] + thinkProtocol.
      addCustomModel: (
        providerId: string,
        modelId: string,
        capabilities: ModelCapability[],
        thinkProtocol: ThinkProtocol | null
      ) => Promise<Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>>;
      deleteCustomModel: (providerId: string, modelId: string) => Promise<Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>>;
      getCustomModels: (providerId: string) => Promise<Array<{
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>>;
      getAllCustomModels: () => Promise<Array<{
        providerId: string;
        modelId: string;
        capabilities: ModelCapability[];
        thinkProtocol: ThinkProtocol | null;
        supportsThink: boolean;
        thinkLevels?: string[];
      }>>;
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
      // Shell
      openPath: (path: string) => Promise<string>;
      // Git
      getGitStatus: (projectPath: string) => Promise<GitStatusResult>;
      listGitBranches: (projectPath: string) => Promise<GitBranchesResponse>;
      listGitCommits: (projectPath: string, branch: string, limit?: number) => Promise<GitCommitsResponse>;
      getReviewDiff: (projectPath: string, scope: ReviewScope) => Promise<GitReviewDiffResponse>;
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
      // Agent runtime
      startAgentRun: (input: AgentStartRunInput) => Promise<{ runId: string }>;
      cancelAgentRun: (runId: string) => Promise<void>;
      answerAgentPermission: (resp: AgentPermissionResponse) => Promise<void>;
      onAgentRun: (runId: string, handler: (ev: AgentRunEvent) => void) => () => void;
      listAgentParts: (conversationId: string) => Promise<AgentMessagePart[]>;
      listAgentToolRuns: (conversationId: string) => Promise<AgentToolRun[]>;
      listAgentTodos: (projectId: string, conversationId?: string | null) => Promise<AgentTodoItem[]>;
      listAgentTasks: (projectId: string, limit?: number) => Promise<AgentTaskItem[]>;
      cancelAgentTask: (taskId: string) => Promise<boolean>;
      agentCostSummary: (conversationId: string) => Promise<{
        promptTokens: number;
        completionTokens: number;
        costUsd: number;
      }>;
      listInterruptedConversations: () => Promise<Array<{
        id: string;
        name: string | null;
        projectId: string | null;
        lastRunId: string | null;
        lastRunStartedAt: number | null;
      }>>;
      discardInterruptedConversation: (conversationId: string) => Promise<void>;
      resumeAgentRun: (conversationId: string) => Promise<{ runId: string }>;
      setBypassPermissions: (bypass: boolean) => Promise<void>;
    };
  }
}

export {};
