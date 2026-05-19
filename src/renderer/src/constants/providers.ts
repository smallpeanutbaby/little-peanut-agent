import type { ModelCapability, ThinkProtocol } from "@shared/types";

/**
 * Lightweight model descriptor used by the provider catalog UI.
 *
 *  - `capabilities`  : multi-label, drives capability chips, attach-image
 *                       availability, and future filtering.
 *  - `thinkProtocol` : reasoning family — `PROTOCOL_LEVELS` in
 *                       `think-presets.ts` derives the level picker from this.
 *                       Omit when the model has no reasoning capability.
 */
export interface ProviderModel {
  id: string;
  capabilities: ModelCapability[];
  thinkProtocol?: ThinkProtocol;
}

// ── Capability shortcuts ─────────────────────────────────────────────
// Most modern chat models fall into one of these three shapes. Aliasing them
// keeps the catalog skimmable instead of hiding behind 5-element literals.
const TEXT_TOOLS: ModelCapability[] = ["text", "tools"];
const VISION_CHAT: ModelCapability[] = ["text", "vision", "tools"];
const REASONING_CHAT: ModelCapability[] = ["text", "reasoning", "tools"];
const VISION_REASONING_CHAT: ModelCapability[] = ["text", "vision", "reasoning", "tools"];

/**
 * Built-in AI provider catalog. The renderer renders this verbatim in the
 * "AI 配置" page; users can additionally add custom providers via
 * `AddProviderModal`.
 *
 * When adding/removing entries here, keep `ProtocolId` (in `@shared/types`)
 * and the adapter factory in `main/ai/adapter.ts` in sync.
 */
export const AI_PROVIDERS_DEFAULT = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      // ── Frontier (reasoning_effort: none/low/medium/high/xhigh) ──
      // gpt-5.5 is the flagship; mini/nano variants live under gpt-5.4.
      // All current models accept image input. Source: platform.openai.com/docs/models.
      { id: "gpt-5.5", capabilities: VISION_REASONING_CHAT, thinkProtocol: "openai" },
      { id: "gpt-5.5-pro", capabilities: VISION_REASONING_CHAT, thinkProtocol: "openai" },
      { id: "gpt-5.4", capabilities: VISION_REASONING_CHAT, thinkProtocol: "openai" },
      { id: "gpt-5.4-mini", capabilities: VISION_REASONING_CHAT, thinkProtocol: "openai" },
      { id: "gpt-5.4-nano", capabilities: VISION_REASONING_CHAT, thinkProtocol: "openai" }
    ] as ProviderModel[]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    // Source: docs.anthropic.com/en/docs/about-claude/models/overview (2026-05).
    // IDs use the dashed dateless form Anthropic returns from /v1/models.
    // claude-sonnet-4 / claude-opus-4 (May 2025) are EOL on 2026-06-15 → omitted.
    models: [
      // ── Current ──
      { id: "claude-opus-4-7", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      { id: "claude-sonnet-4-6", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      { id: "claude-haiku-4-5", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      // ── Still available (older generations) ──
      { id: "claude-opus-4-6", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      { id: "claude-sonnet-4-5", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      { id: "claude-opus-4-5", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" },
      { id: "claude-opus-4-1", capabilities: VISION_REASONING_CHAT, thinkProtocol: "anthropic" }
    ] as ProviderModel[]
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    // Source: ai.google.dev/gemini-api/docs/models + firebase.google.com/docs/ai-logic/models.
    // Gemini reasoning models all accept the same thinkingBudget; -1 = dynamic.
    models: [
      // ── Gemini 3.x (preview + stable) ──
      { id: "gemini-3.1-pro-preview", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" },
      { id: "gemini-3-flash-preview", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" },
      { id: "gemini-3.1-flash-lite", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" },
      // ── Gemini 2.5 (long-term stable) ──
      { id: "gemini-2.5-pro", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" },
      { id: "gemini-2.5-flash", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" },
      { id: "gemini-2.5-flash-lite", capabilities: VISION_REASONING_CHAT, thinkProtocol: "gemini" }
    ] as ProviderModel[]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    // Source: api-docs.deepseek.com (2026-05). Catalog collapsed to v4 — the
    // legacy `deepseek-chat`/`deepseek-reasoner` aliases now just route to
    // v4-flash non-thinking / thinking modes and are scheduled for removal.
    models: [
      { id: "deepseek-v4-pro", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "deepseek-v4-flash", capabilities: REASONING_CHAT, thinkProtocol: "binary" }
    ] as ProviderModel[]
  },
  {
    id: "zhipu",
    name: "智谱AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    // Source: docs.bigmodel.cn/cn/guide/start/model-overview (2026-05).
    // GLM hybrid-reasoning models toggle thinking via `thinking.type=enabled`.
    models: [
      // ── Flagship ──
      { id: "glm-5.1", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-5", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-5-turbo", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-5v-turbo", capabilities: VISION_REASONING_CHAT, thinkProtocol: "binary" },
      // ── 4.x family ──
      { id: "glm-4.7", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-4.7-flashx", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-4.6", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-4.6v", capabilities: VISION_REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-4.5-air", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "glm-4.5-airx", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      // ── Standard (no thinking) ──
      { id: "glm-4-long", capabilities: TEXT_TOOLS }
    ] as ProviderModel[]
  },
  {
    id: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    // Source: platform.kimi.ai/docs/models (2026-05).
    // The original kimi-k2 / k2-0905 / k2-turbo / k2-0711 batch retires on
    // 2026-05-25 — already past their best-by, so they're left out and users
    // are funneled to k2.5 / k2.6 (both natively multi-modal).
    models: [
      { id: "kimi-k2.6", capabilities: VISION_REASONING_CHAT, thinkProtocol: "binary" },
      { id: "kimi-k2.5", capabilities: VISION_REASONING_CHAT, thinkProtocol: "binary" },
      { id: "moonshot-v1-128k", capabilities: TEXT_TOOLS },
      { id: "moonshot-v1-32k", capabilities: TEXT_TOOLS },
      { id: "moonshot-v1-8k", capabilities: TEXT_TOOLS }
    ] as ProviderModel[]
  },
  {
    id: "tongyi",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    // Source: help.aliyun.com/zh/model-studio (2026-05).
    // qwen3.x reasoning models expose `enable_thinking` + `thinking_budget`
    // (low/medium/high). qwen3-coder and the older qwen-plus/qwen-long are
    // plain chat models with tools but no native reasoning.
    models: [
      // ── Reasoning (Qwen "thinking" protocol) ──
      { id: "qwen3-max", capabilities: REASONING_CHAT, thinkProtocol: "qwen" },
      { id: "qwen3.6-plus", capabilities: REASONING_CHAT, thinkProtocol: "qwen" },
      { id: "qwen3.6-flash", capabilities: REASONING_CHAT, thinkProtocol: "qwen" },
      { id: "qwen3.5-plus", capabilities: REASONING_CHAT, thinkProtocol: "qwen" },
      { id: "qwen3.5-flash", capabilities: REASONING_CHAT, thinkProtocol: "qwen" },
      // ── Code (no native thinking budget) ──
      { id: "qwen3-coder-plus", capabilities: TEXT_TOOLS },
      { id: "qwen3-coder-flash", capabilities: TEXT_TOOLS },
      // ── Chat ──
      { id: "qwen-plus", capabilities: TEXT_TOOLS },
      { id: "qwen-long", capabilities: TEXT_TOOLS },
      { id: "qwen-turbo", capabilities: TEXT_TOOLS }
    ] as ProviderModel[]
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    // Source: platform.minimaxi.com/docs/release-notes/models (2026-05).
    // M2.x is always-reasoning (binary toggle); abab/Hailuo are separate
    // product lines (speech/music/video) and not chat models.
    models: [
      { id: "MiniMax-M2.7", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "MiniMax-M2.7-highspeed", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "MiniMax-M2.5", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "MiniMax-M2.5-highspeed", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "MiniMax-M1", capabilities: REASONING_CHAT, thinkProtocol: "binary" }
    ] as ProviderModel[]
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    // Source: siliconflow.cn/models (2026-05). SiliconFlow is an aggregator;
    // we ship a small representative set — users typically paste in whatever
    // exact ID they need via "Add Model".
    models: [
      { id: "deepseek-ai/DeepSeek-V4-Flash", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "Qwen/Qwen3-VL-32B-Instruct", capabilities: VISION_CHAT },
      { id: "zai-org/GLM-5.1", capabilities: REASONING_CHAT, thinkProtocol: "binary" },
      { id: "moonshotai/Kimi-K2.6", capabilities: VISION_REASONING_CHAT, thinkProtocol: "binary" },
      { id: "MiniMaxAI/MiniMax-M2.5", capabilities: REASONING_CHAT, thinkProtocol: "binary" }
    ] as ProviderModel[]
  }
];

export const PROTOCOL_OPTIONS = [
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses API" },
  { id: "anthropic-messages", label: "Anthropic Messages API" },
  { id: "google-gemini", label: "Google Gemini API" },
  { id: "openai-compatible", label: "OpenAI 兼容 (通用第三方 / OpenCode / OpenRouter / DeepSeek 等)" }
];

/** Shape returned by `AddProviderModal` when a user adds a custom provider. */
export interface CustomProvider {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
}

/**
 * Look up the catalog entry for a (provider, model) pair. Returns undefined
 * for custom models or unknown ids. Used by App.tsx / database.ts to seed
 * capabilities + thinkProtocol when a row is missing them.
 */
export function findCatalogModel(providerId: string, modelId: string): ProviderModel | undefined {
  return AI_PROVIDERS_DEFAULT
    .find((p) => p.id === providerId)?.models
    .find((m) => m.id === modelId);
}
