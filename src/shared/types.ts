export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export type ThemeMode = "dark" | "light";

export type BackgroundColor = "dark" | "light";

export type TextColor =
  | "ivory"
  | "warm-white"
  | "cream"
  | "soft-gold"
  | "charcoal"
  | "snow"
  | "linen"
  | "pearl"
  | "sand-ink"
  | "hazel"
  | "coffee"
  | "ember"
  | "graphite"
  | "slate"
  | "sage"
  | "olive-ink"
  | "teal-ink"
  | "midnight-ink"
  | "plum-ink";

export interface AppearanceSettings {
  theme: ThemeMode;
  background: BackgroundColor;
  text: TextColor;
  language: "zh-CN" | "en";
}

/**
 * Qualitative reasoning effort levels.
 *
 * Each {@link ThinkProtocol} only exposes a subset (see PROTOCOL_LEVELS in
 * `think-presets.ts`).
 *
 *  - `none`     : reasoning off (mapBudget returns undefined)
 *  - `dynamic`  : Gemini-only "let the model decide" (-1 budget)
 *  - `minimal`  : OpenAI / Gemini lowest tier
 *  - `low/medium/high` : universal
 *  - `xhigh`    : OpenAI 5th tier (added on gpt-5.4 / gpt-5.5)
 *  - `max`      : Anthropic only (64k thinking budget tokens)
 */
export type ThinkBudget =
  | "none"
  | "dynamic"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * Identifies a family of reasoning APIs that share a common control surface.
 * Each protocol has its own canonical set of effort levels — see
 * `PROTOCOL_LEVELS` in `think-presets.ts`. The renderer drives UI off this
 * single field; the main-process adapter (`mapBudget`) translates each level
 * to the provider-specific value (numeric tokens / enum string / -1).
 */
export type ThinkProtocol = "openai" | "anthropic" | "gemini" | "qwen" | "binary";

/**
 * What a model can do. Multi-label — a single model can have any combination
 * (e.g. gpt-5.5 = text + vision + reasoning + tools, claude-opus-4-7 = text
 * + vision + reasoning + tools, kimi-k2.6 = text + vision + reasoning + tools).
 * Drives:
 *  - whether the ModelSelector shows a Think chip (`reasoning`)
 *  - whether ChatPanel's attach-image button is enabled (`vision`)
 *  - small capability badges on the AI config model list
 *  - future filtering / pages for image-gen / audio / embedding
 *
 *  - `text`      : standard chat / text generation
 *  - `vision`    : accepts image inputs (gpt-5.x, claude-4.x, gemini-2.5+/3.x, …)
 *  - `reasoning` : exposes a reasoning_effort / thinking knob
 *  - `tools`     : supports function-calling / tool-use
 *  - `image-gen` : outputs images (gpt-image-1, imagen, …)
 *  - `audio`     : speech in/out
 *  - `embedding` : produces embedding vectors only (no chat)
 */
export type ModelCapability =
  | "text"
  | "vision"
  | "reasoning"
  | "tools"
  | "image-gen"
  | "audio"
  | "embedding";

/**
 * Wire-format protocol identifiers supported by the AI adapter layer.
 *
 * Keep this in sync with `ADAPTERS` in `main/ai/adapter.ts` and the
 * PROTOCOL_OPTIONS list shown in the renderer "添加自定义服务商" modal.
 *
 * Treating this as a union (instead of `string`) gives us:
 *  - Compile-time errors if a new protocol is added without an adapter
 *  - IDE autocompletion in the provider config UI
 *  - A safe place to validate untrusted values at the IPC boundary
 *    (see `isProtocolId` below).
 */
export type ProtocolId =
  | "openai-chat"
  | "openai-responses"
  | "openai-compatible"
  | "anthropic-messages"
  | "google-gemini";

export const PROTOCOL_IDS: readonly ProtocolId[] = [
  "openai-chat",
  "openai-responses",
  "openai-compatible",
  "anthropic-messages",
  "google-gemini"
] as const;

/** Runtime type guard — use at the IPC boundary to reject unknown protocols. */
export function isProtocolId(value: unknown): value is ProtocolId {
  return typeof value === "string" && (PROTOCOL_IDS as readonly string[]).includes(value);
}

export interface ModelConfig {
  providerId: string;
  modelId: string;
  enabled: boolean;
  /**
   * What the model supports. For built-in models this is seeded from the
   * provider catalog (`AI_PROVIDERS_DEFAULT`); for custom models it's set in
   * the "Add model" modal. Stored as a JSON array in SQLite.
   */
  capabilities: ModelCapability[];
  /**
   * Reasoning effort family. `null` when capabilities doesn't include
   * `reasoning`. Single source of truth for which level buttons appear in
   * the ModelSelector dropdown — UI no longer carries a per-model
   * `thinkLevels` array.
   */
  thinkProtocol: ThinkProtocol | null;
  thinkEnabled: boolean;
  thinkBudget: ThinkBudget;
  thinkBodyOn: string;
  thinkBodyOff: string;
  forceTemperature: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  /** One of {@link ProtocolId}; stored as string in DB for forward compat. */
  protocol: ProtocolId | string;
  isCustom: boolean;
}

// ─── Chat / Connectivity ─────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

/**
 * Image / file attachment carried on a user message.
 *
 * `dataUrl` is the canonical wire format ("data:image/png;base64,...") so the
 * renderer can both preview locally and pass it straight into the adapter
 * without an extra IPC round-trip. The DB stores the same `dataUrl` inline.
 *
 * NOTE on storage: keeping the base64 inline is fine for MVP / a few images
 * per conversation. For heavy image usage we should later migrate to
 * userData/attachments and store paths here instead.
 */
export interface ChatAttachment {
  id: string;
  /** "data:image/png;base64,..." or a plain data: URL for the file content. */
  dataUrl: string;
  /** "image/png" | "image/jpeg" | "image/webp" | "image/gif" | ... */
  mimeType: string;
  /** Original file name (display-only). */
  name?: string;
  /** Size in bytes (display / quota only). */
  size?: number;
}

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
  /** Assistant's reasoning/thinking content — passed back to APIs that require it (e.g. DeepSeek). */
  reasoning?: string | null;
  /** Image attachments to send alongside the message (user only). */
  attachments?: ChatAttachment[];
}

export interface ChatRequestOptions {
  providerId: string;
  protocol: ProtocolId | string;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessageInput[];
  thinkEnabled?: boolean;
  thinkBudget?: ThinkBudget;
  /**
   * Reasoning family for this model. Drives how the adapter maps
   * {@link thinkBudget} to a request-body field (reasoning_effort vs
   * budget_tokens vs thinkingBudget vs enable_thinking…). Optional only for
   * backwards compatibility with renderer builds that pre-date v4; main
   * process adapters fall back to a per-adapter default when omitted.
   */
  thinkProtocol?: ThinkProtocol | null;
  temperature?: number;
  maxTokens?: number;
}

export interface CheckConnectivityRequest {
  providerId: string;
  protocol: ProtocolId | string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface CheckConnectivityResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; usage?: { promptTokens?: number; completionTokens?: number } }
  | { type: "error"; message: string; code?: string }
  | { type: "context_trimmed"; dropped: number; originalChars: number; finalChars: number };

// ─── Project & Conversation ──────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  /**
   * Absolute path of the local folder this project is bound to. Empty
   * string for projects created without a folder (legacy / future hand-
   * created projects). Currently set only via the "+" → folder picker
   * flow in the sidebar.
   */
  path: string;
  defaultProviderId: string | null;
  defaultModelId: string | null;
  defaultThinkBudget: ThinkBudget | null;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  projectId: string | null;
  name: string;
  providerId: string | null; // override of project default
  modelId: string | null;
  thinkBudget: ThinkBudget | null;
  thinkEnabled: boolean;
  /**
   * Active chat mode id (e.g. "chat" | "writing" | "code" | ...). Determines the
   * systemPrompt injected on each outgoing message, plus default sampling hints.
   * Switchable mid-conversation; previous messages keep their original wording.
   */
  modeId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  reasoning: string | null;
  tokens: number | null;
  /** Image / file attachments persisted with the message (user only). */
  attachments?: ChatAttachment[];
  createdAt: number;
}

// ─── Git ──────────────────────────────────────────────────────────────

/**
 * Per-file working-tree status. Mirrors the two-letter codes that
 * `git status --porcelain=v1` emits, normalised into a single bucket
 * so the renderer can group + colour-code without re-implementing the
 * porcelain parser.
 */
export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted";

export interface GitFileChange {
  /** Repo-relative path (POSIX-style separators). */
  path: string;
  /** Bucket used by the UI grouping. */
  status: GitFileStatus;
  /** True if the change is in the index (staged). */
  staged: boolean;
  /** Raw two-char porcelain code (e.g. " M", "??", "MM"). Useful for tooltips. */
  raw: string;
}

export interface GitStatusOk {
  ok: true;
  /** Current branch name, or `null` for detached HEAD. */
  branch: string | null;
  /** Upstream ref shown in `## branch...origin/branch`, if any. */
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitStatusErr {
  ok: false;
  reason: "no-path" | "not-a-repo" | "git-not-found" | "git-error";
  message?: string;
}

export type GitStatusResult = GitStatusOk | GitStatusErr;

/** How a review-mode conversation selects its scope. */
export type ReviewScopeKind = "uncommitted" | "commits" | "manual";

export interface ReviewScope {
  kind: ReviewScopeKind;
  /** For `commits` — branch name (defaults to current). */
  branch?: string;
  /** For `commits` — full or short SHAs to review. */
  commitIds?: string[];
  /** For `manual` — free-text description when the project has no git repo. */
  manualDescription?: string;
  /** Human-readable label shown in the UI banner. */
  label?: string;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitBranchesResult {
  ok: true;
  current: string | null;
  branches: string[];
}

export interface GitCommitsResult {
  ok: true;
  branch: string;
  commits: GitCommitSummary[];
}

export interface GitReviewDiffResult {
  ok: true;
  /** Unified diff text (may be truncated). */
  diff: string;
  /** One-line summary for the UI. */
  summary: string;
  truncated: boolean;
  fileCount: number;
}

export type GitBranchesResponse = GitBranchesResult | GitStatusErr;
export type GitCommitsResponse = GitCommitsResult | GitStatusErr;
export type GitReviewDiffResponse = GitReviewDiffResult | GitStatusErr;

// ─── MCP (Model Context Protocol) ────────────────────────────────────

/**
 * Transport types supported by the MCP spec:
 *  - stdio: spawn a local process and speak JSON-RPC over its stdin/stdout
 *  - sse: HTTP POST for requests, separate SSE channel for server messages
 *  - http: streamable HTTP (single endpoint, both ways via SSE-flavored response)
 */
export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  enabled: boolean;

  /** stdio-only: executable path/name, args, and extra env vars. */
  command: string;
  args: string[];
  env: Record<string, string>;

  /** sse/http-only: endpoint URL and request headers (e.g. for auth tokens). */
  url: string;
  headers: Record<string, string>;

  createdAt: number;
  updatedAt: number;
}

/**
 * Result of an MCP `initialize` handshake. We surface the server's reported
 * name/version and which capability flags it advertises so the UI can show a
 * meaningful "connected" panel.
 */
export interface McpTestResult {
  ok: boolean;
  /** Wall-clock latency of the handshake (ms). */
  latencyMs: number;
  /** Server-reported metadata, if the handshake succeeded. */
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
  /** Top-level capability flag names the server advertised ("tools", "resources", ...). */
  capabilities?: string[];
  /** Human-readable failure description on `ok=false`. */
  message?: string;
}

// ─── Agent Runtime ───────────────────────────────────────────────────

/** Structured content block — the atomic unit of an agent message
 *  transcript. Mirrors the canonical block model used inside the
 *  runtime; the renderer reads these directly. */
export type AgentMessagePartType =
  | "text"
  | "reasoning"
  | "tool_use"
  | "tool_result"
  | "attachment_ref"
  | "compact_marker";

export interface AgentMessagePart {
  id: string;
  messageId: string;
  seq: number;
  type: AgentMessagePartType;
  toolCallId: string | null;
  toolName: string | null;
  inputJson: string | null;
  outputJson: string | null;
  outputPreview: string | null;
  isError: boolean;
  outputFilePath: string | null;
  tokens: number | null;
  textContent: string | null;
  createdAt: number;
}

export type AgentToolRunStatus =
  | "pending"
  | "permission_pending"
  | "running"
  | "completed"
  | "denied"
  | "errored"
  | "cancelled";

export interface AgentToolRun {
  toolCallId: string;
  conversationId: string;
  messageId: string;
  toolName: string;
  status: AgentToolRunStatus;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
  costUsd: number | null;
}

export type AgentTodoStatus = "pending" | "in_progress" | "completed";
export interface AgentTodoItem {
  id: string;
  projectId: string;
  conversationId: string | null;
  content: string;
  status: AgentTodoStatus;
  seq: number;
  updatedAt: number;
}

export type AgentTaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

/** A row in `agent_task` — created by `TaskManager.start()` for every
 *  subagent invocation. Surfaced to the RunningTasksTray. */
export interface AgentTaskItem {
  id: string;
  projectId: string;
  conversationId: string | null;
  type: string;
  status: AgentTaskStatus;
  payloadJson: string;
  resultJson: string | null;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
}

/** Wire-format event the main process pushes for each agent run.
 *  Identical to the runtime's `AgentEvent` so the renderer can render
 *  blocks without an extra mapping layer. */
export type AgentRunEvent =
  | {
      kind: "llm";
      event:
        | { type: "message_start" }
        | { type: "text_delta"; text: string }
        | { type: "reasoning_delta"; text: string }
        | { type: "tool_use_start"; id: string; name: string }
        | { type: "tool_use_input_delta"; id: string; jsonChunk: string }
        | { type: "tool_use_stop"; id: string; finalInput: unknown }
        | {
            type: "message_stop";
            stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";
          }
        | { type: "usage"; promptTokens: number; completionTokens: number; costUsd?: number }
        | { type: "error"; code: string; retryable: boolean; message: string };
    }
  | {
      kind: "tool_run_start";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      kind: "tool_run_progress";
      toolCallId: string;
      message?: string;
      data?: unknown;
    }
  | {
      kind: "tool_run_end";
      toolCallId: string;
      status: "completed" | "errored" | "denied" | "cancelled";
      preview?: string;
      isError?: boolean;
      durationMs: number;
    }
  | {
      kind: "context_compacted";
      before: number;
      after: number;
      notes: string[];
    }
  | {
      kind: "context_budget";
      usedTokens: number;
      budgetTokens: number;
      windowTokens: number;
      compacted: boolean;
    }
  | {
      kind: "permission_request";
      toolCallId: string;
      toolName: string;
      input: unknown;
      uiPreview?: { title?: string; subtitle?: string; body?: string };
      /** One-line "why this is risky" string from the tool's
       *  checkPermissions() (e.g. Bash risk classifier output). The
       *  PermissionApprovalModal renders this as the prominent reason
       *  banner above the action buttons. */
      toolReason?: string;
    }
  | {
      kind: "message_persisted";
      messageId: string;
      role: "user" | "assistant";
    }
  | {
      kind: "stage_enter";
      stage: "planner" | "executor" | "reviewer";
      model: string;
    }
  | {
      kind: "stage_exit";
      stage: "planner" | "executor" | "reviewer";
      passed?: boolean;
    }
  | {
      kind: "terminal";
      reason: "completed" | "cancelled" | "budget_exceeded" | "max_iterations" | "stream_error";
      message?: string;
    };

export type PipelineStageRole = "planner" | "executor" | "reviewer";

export interface PipelineStageConfig {
  role: PipelineStageRole;
  providerId: string;
  modelId: string;
  thinkBudget?: ThinkBudget;
}

export interface AgentStartRunInput {
  projectId: string;
  conversationId: string;
  userMessage: string;
  providerId: string;
  protocol: ProtocolId | string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  thinkBudget?: ThinkBudget;
  thinkEnabled?: boolean;
  thinkProtocol?: ThinkProtocol | null;
  maxOutputTokens?: number;
  modeId?: string;
  language?: "zh-CN" | "en";
  pipelineStages?: PipelineStageConfig[];
  /** Review mode — scope chosen in the setup wizard. */
  reviewScope?: ReviewScope;
}

export interface AgentPermissionResponse {
  runId: string;
  toolCallId: string;
  decision: "allow_once" | "allow_session" | "allow_project" | "deny";
}
