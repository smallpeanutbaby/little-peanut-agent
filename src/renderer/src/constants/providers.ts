import type { ThinkBudget } from "@shared/types";

/** Lightweight model descriptor used by the provider catalog UI. */
export interface ProviderModel {
  id: string;
  /** Whether the model supports any form of reasoning/thinking. */
  think?: boolean;
  /**
   * Reasoning effort levels supported by this model.
   * - If omitted while `think` is true → binary on/off (no granular budget)
   * - If provided → only these levels are exposed in the UI
   */
  thinkLevels?: ThinkBudget[];
}

// ── Reasoning effort presets per provider API ──
// OpenAI       reasoning_effort:     minimal | low | medium | high
// Anthropic    budget_tokens:        low(1024) | medium(8192) | high(24000) | max(64000)
// Gemini       thinkingBudget:       minimal | low | medium | high (or dynamic / off)
// DeepSeek R1  no granular budget    → binary on/off
// Zhipu GLM    thinking.type:        enabled | disabled → binary
// Moonshot K2  thinking:             enabled | disabled → binary
// Qwen3        thinking_budget:      low | medium | high (token-budget mapped)
// Ernie        thinking:             enabled | disabled → binary
// MiniMax M    always-on reasoning   → binary on/off
export const OPENAI_LEVELS: ThinkBudget[] = ["minimal", "low", "medium", "high"];
export const ANTHROPIC_LEVELS: ThinkBudget[] = ["low", "medium", "high", "max"];
export const GEMINI_LEVELS: ThinkBudget[] = ["minimal", "low", "medium", "high"];
export const QWEN_LEVELS: ThinkBudget[] = ["low", "medium", "high"];

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
      // ── GPT-5.x (reasoning models, support reasoning_effort) ──
      { id: "gpt-5.5", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.5-pro", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.5-mini", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.5-nano", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.3", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.3-pro", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.3-mini", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.2", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.2-pro", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.1", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5.1-codex", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5-pro", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5-mini", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "gpt-5-nano", think: true, thinkLevels: OPENAI_LEVELS },
      // ── o-series (reasoning models, support reasoning_effort) ──
      { id: "o4-mini", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "o3", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "o3-mini", think: true, thinkLevels: OPENAI_LEVELS },
      { id: "o1", think: true, thinkLevels: OPENAI_LEVELS },
      // ── GPT-4.x (non-reasoning chat models) ──
      { id: "gpt-4.1" },
      { id: "gpt-4.1-mini" },
      { id: "gpt-4.1-nano" },
      { id: "gpt-4o" },
      { id: "gpt-4o-mini" },
      { id: "gpt-4-turbo" },
      // ── Legacy ──
      { id: "gpt-3.5-turbo" }
    ] as ProviderModel[]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      // ── Extended Thinking (budget_tokens) ──
      { id: "claude-opus-4.7", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-opus-4.7-fast", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-opus-4.6", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-opus-4.5", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-opus-4.1", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-opus-4", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-sonnet-4.6", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-sonnet-4.5", think: true, thinkLevels: ANTHROPIC_LEVELS },
      { id: "claude-sonnet-4", think: true, thinkLevels: ANTHROPIC_LEVELS },
      // ── Standard (no extended thinking) ──
      { id: "claude-haiku-4.5" },
      { id: "claude-3.5-haiku" },
      { id: "claude-3-haiku" }
    ] as ProviderModel[]
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      // ── Thinking (thinkingBudget) ──
      { id: "gemini-3.1-pro-preview", think: true, thinkLevels: GEMINI_LEVELS },
      { id: "gemini-3-flash-preview", think: true, thinkLevels: GEMINI_LEVELS },
      { id: "gemini-2.5-pro", think: true, thinkLevels: GEMINI_LEVELS },
      { id: "gemini-2.5-flash", think: true, thinkLevels: GEMINI_LEVELS },
      { id: "gemini-2.5-flash-lite", think: true, thinkLevels: GEMINI_LEVELS },
      // ── Standard (no thinking) ──
      { id: "gemini-3.1-flash-lite" },
      { id: "gemini-2.0-flash-001" },
      { id: "gemini-2.0-flash-lite-001" }
    ] as ProviderModel[]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      // ── Reasoning (R1 — always-on, no budget) ──
      { id: "deepseek-r1", think: true },
      { id: "deepseek-r1-0528", think: true },
      // ── Hybrid Reasoning (V3.1+ — thinking can be toggled) ──
      { id: "deepseek-v4-pro", think: true },
      { id: "deepseek-v4-flash", think: true },
      { id: "deepseek-v3.2", think: true },
      { id: "deepseek-v3.1-terminus", think: true },
      { id: "deepseek-chat-v3.1", think: true },
      // ── Chat (no thinking) ──
      { id: "deepseek-chat-v3-0324" },
      { id: "deepseek-chat" }
    ] as ProviderModel[]
  },
  {
    id: "zhipu",
    name: "智谱AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      // ── Thinking (hybrid reasoning, binary enabled/disabled) ──
      { id: "glm-5.1", think: true },
      { id: "glm-5", think: true },
      { id: "glm-5-turbo", think: true },
      { id: "glm-5v-turbo", think: true },
      { id: "glm-4.7", think: true },
      { id: "glm-4.7-flash", think: true },
      { id: "glm-4.6", think: true },
      { id: "glm-4.6v", think: true },
      { id: "glm-4.5", think: true },
      { id: "glm-4.5-air", think: true },
      { id: "glm-4.5v", think: true },
      // ── Standard (no thinking) ──
      { id: "glm-4-32b" }
    ] as ProviderModel[]
  },
  {
    id: "moonshot",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      // ── Reasoning (binary on/off) ──
      { id: "kimi-k2.6", think: true },
      { id: "kimi-k2.5", think: true },
      { id: "kimi-k2-thinking", think: true },
      { id: "kimi-k2-0905", think: true },
      { id: "kimi-k2", think: true },
      // ── Chat ──
      { id: "moonshot-v1-128k" },
      { id: "moonshot-v1-32k" },
      { id: "moonshot-v1-8k" }
    ] as ProviderModel[]
  },
  {
    id: "tongyi",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      // ── Reasoning / Thinking (thinking_budget) ──
      { id: "qwen3.6-max-preview", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3.6-plus", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3.6-flash", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3.5-plus-02-15", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3.5-flash-02-23", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-max", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-max-thinking", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-235b-a22b", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-30b-a3b", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-32b", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-14b", think: true, thinkLevels: QWEN_LEVELS },
      { id: "qwen3-8b", think: true, thinkLevels: QWEN_LEVELS },
      // ── Code (qwen3-coder series are NOT reasoning models) ──
      { id: "qwen3-coder" },
      { id: "qwen3-coder-plus" },
      // ── Chat ──
      { id: "qwen-plus" },
      { id: "qwen-long" }
    ] as ProviderModel[]
  },
  {
    id: "baidu",
    name: "百度智能云",
    baseUrl: "https://qianfan.baidubce.com/v2",
    models: [
      // ── Reasoning (binary on/off) ──
      { id: "ernie-4.5-300b-a47b", think: true },
      { id: "ernie-4.5-21b-a3b-thinking", think: true },
      // ── Chat ──
      { id: "ernie-4.5-21b-a3b" },
      { id: "ernie-4.5-vl-424b-a47b" },
      { id: "ernie-4.5-vl-28b-a3b" }
    ] as ProviderModel[]
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    models: [
      // ── Reasoning (always-on / binary) ──
      { id: "minimax-m2.7", think: true },
      { id: "minimax-m2.5", think: true },
      { id: "minimax-m2.1", think: true },
      { id: "minimax-m2", think: true },
      { id: "minimax-m1", think: true },
      // ── Chat ──
      { id: "minimax-01" }
    ] as ProviderModel[]
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      // ── Reasoning (Qwen3 supports granular budget; DeepSeek-R1 is binary) ──
      { id: "Qwen/Qwen3-235B-A22B", think: true, thinkLevels: QWEN_LEVELS },
      { id: "Qwen/Qwen3-30B-A3B", think: true, thinkLevels: QWEN_LEVELS },
      { id: "deepseek-ai/DeepSeek-R1", think: true },
      { id: "deepseek-ai/DeepSeek-R1-0528", think: true },
      // ── Chat ──
      { id: "deepseek-ai/DeepSeek-V3-0324" },
      { id: "Qwen/Qwen2.5-72B-Instruct" },
      { id: "THUDM/GLM-4-9B-Chat" }
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
