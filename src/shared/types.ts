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

export type ThinkBudget = "none" | "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

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
  | { type: "error"; message: string; code?: string };

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
