export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export type ThemeMode = "dark" | "light";

export type BackgroundColor =
  | "roast"
  | "peanut-dark"
  | "walnut"
  | "cocoa"
  | "latte"
  | "espresso"
  | "sand"
  | "caramel"
  | "honey"
  | "toffee"
  | "almond"
  | "bronze"
  | "clay"
  | "stone"
  | "moss"
  | "forest"
  | "night"
  | "midnight"
  | "obsidian";

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
  protocol: string;
  isCustom: boolean;
}
