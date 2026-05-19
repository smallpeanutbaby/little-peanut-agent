import type { ThinkBudget, ThinkProtocol } from "@shared/types";

/**
 * Display labels for each {@link ThinkBudget} value, shown in the model
 * selector and the Think config modal.
 */
export const THINK_BUDGET_LABELS: Record<ThinkBudget, string> = {
  none: "关闭",
  dynamic: "动态",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高"
};

/**
 * Canonical reasoning levels exposed by each {@link ThinkProtocol}, following
 * each provider's official API surface 1:1.
 *
 *  - `openai`    : `reasoning_effort` ∈ {minimal, low, medium, high, xhigh}  (5 levels — xhigh added in gpt-5.4/5.5)
 *  - `anthropic` : `budget_tokens`    ∈ {1024, 8192, 24000, 64000}           → low/medium/high/max
 *  - `gemini`    : `thinkingBudget`   ∈ {-1, 256, 1024, 8192, 24576}         → dynamic/minimal/low/medium/high
 *  - `qwen`      : `thinking_budget`  ∈ {low, medium, high}                  (3 levels)
 *  - `binary`    : on/off only (DeepSeek V4 / GLM / Kimi / MiniMax M…)
 *
 * This is the single source of truth for the renderer — `ModelSelector`,
 * `ThinkConfigModal`, and `AddModelModal` all derive their level pickers
 * from this table instead of carrying a per-model `thinkLevels` array.
 */
export const PROTOCOL_LEVELS: Record<ThinkProtocol, ThinkBudget[]> = {
  openai: ["minimal", "low", "medium", "high", "xhigh"],
  anthropic: ["low", "medium", "high", "max"],
  gemini: ["dynamic", "minimal", "low", "medium", "high"],
  qwen: ["low", "medium", "high"],
  binary: []
};

/**
 * Default level for each protocol, used both as the "Add model" default and
 * as a fallback when a model is created without an explicit pick. Chosen to
 * match the providers' own "balanced" recommendations.
 */
export const PROTOCOL_DEFAULT_LEVEL: Record<ThinkProtocol, ThinkBudget> = {
  openai: "medium",
  anthropic: "medium",
  gemini: "medium",
  qwen: "medium",
  // Binary protocols don't have levels — the chat composer just shows an
  // on/off toggle. We still need *some* value for the persisted thinkBudget
  // column; "medium" is a harmless placeholder that mapBudget ignores.
  binary: "medium"
};

/**
 * Identifies the "shape" of reasoning effort a model supports — used in the
 * Add-Model modal so the user can pick a preset instead of typing the levels.
 */
export interface ThinkLevelPreset {
  id: ThinkProtocol;
  label: string;
  description: string;
  /** Empty for binary protocols. */
  levels: ThinkBudget[];
}

export const THINK_LEVEL_PRESETS: ThinkLevelPreset[] = [
  {
    id: "openai",
    label: "OpenAI 5 档",
    description: "minimal / low / medium / high / xhigh — GPT-5.4/5.5",
    levels: PROTOCOL_LEVELS.openai
  },
  {
    id: "anthropic",
    label: "Anthropic 4 档",
    description: "low / medium / high / max — Claude Opus / Sonnet 4.x",
    levels: PROTOCOL_LEVELS.anthropic
  },
  {
    id: "gemini",
    label: "Gemini 4 档 + 动态",
    description: "dynamic / minimal / low / medium / high — Gemini 2.5 / 3.x",
    levels: PROTOCOL_LEVELS.gemini
  },
  {
    id: "qwen",
    label: "Qwen 3 档",
    description: "low / medium / high — Qwen3 系列",
    levels: PROTOCOL_LEVELS.qwen
  },
  {
    id: "binary",
    label: "二元开关（无档位）",
    description: "DeepSeek R1 / GLM / Kimi-thinking / MiniMax M 等",
    levels: PROTOCOL_LEVELS.binary
  }
];
