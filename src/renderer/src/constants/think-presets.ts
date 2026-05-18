import type { ThinkBudget } from "@shared/types";

/** Display labels for each ThinkBudget value, shown in the Think config modal. */
export const THINK_BUDGET_LABELS: Record<ThinkBudget, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  max: "超高",
  xhigh: "极高"
};

/**
 * Identifies the "shape" of reasoning effort a model supports — used in the
 * Add-Model modal so the user can pick a preset instead of typing the levels.
 */
export type ThinkLevelPresetId = "binary" | "openai" | "anthropic" | "gemini" | "qwen";

export interface ThinkLevelPreset {
  id: ThinkLevelPresetId;
  label: string;
  description: string;
  /** When omitted, the model has binary on/off and no granular levels. */
  levels?: ThinkBudget[];
}

export const THINK_LEVEL_PRESETS: ThinkLevelPreset[] = [
  { id: "binary", label: "无档位（仅开/关）", description: "DeepSeek R1 / GLM / Kimi-thinking / Ernie / MiniMax M 等" },
  {
    id: "openai",
    label: "OpenAI 4 档",
    description: "minimal / low / medium / high — GPT-5、o-series",
    levels: ["minimal", "low", "medium", "high"]
  },
  {
    id: "anthropic",
    label: "Anthropic 4 档",
    description: "low / medium / high / max — Claude Opus / Sonnet 4.x",
    levels: ["low", "medium", "high", "max"]
  },
  {
    id: "gemini",
    label: "Gemini 4 档",
    description: "minimal / low / medium / high — Gemini 2.5 / 3.x",
    levels: ["minimal", "low", "medium", "high"]
  },
  { id: "qwen", label: "Qwen 3 档", description: "low / medium / high — Qwen3 系列", levels: ["low", "medium", "high"] }
];
