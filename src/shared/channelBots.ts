import type { ChatModeId } from "./modes.js";

/** IM channel kinds supported by the channel bridge (extensible). */
export type ChannelBotKind = "qq" | "feishu" | "dingtalk";

export const CHANNEL_BOT_KINDS: readonly ChannelBotKind[] = ["qq", "feishu", "dingtalk"] as const;

/** Modes that can be selected as the default when chatting via a bot on a project. */
export const CHANNEL_DEFAULT_MODE_IDS: readonly ChatModeId[] = [
  "chat",
  "agent",
  "plan",
  "pipeline",
  "review"
] as const;

/**
 * Bot configuration returned to the renderer. Secrets are never included —
 * only flags indicating whether a value is stored.
 */
export interface ChannelBotConfig {
  id: ChannelBotKind;
  enabled: boolean;
  appId: string;
  hasAppSecret: boolean;
  hasToken: boolean;
  /** One allow-list entry per line in UI (QQ 号 / 飞书 open_id / 钉钉 userId). */
  allowFrom: string[];
  defaultModeId: ChatModeId;
  defaultProjectId: string | null;
  /** Prefer sandbox / test endpoints when the channel supports it. */
  sandboxMode: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Persisted from the settings UI. Leave secret fields empty to keep existing ciphertext. */
export interface ChannelBotSaveInput {
  id: ChannelBotKind;
  enabled: boolean;
  appId: string;
  appSecret?: string;
  token?: string;
  allowFrom: string[];
  defaultModeId: ChatModeId;
  defaultProjectId: string | null;
  sandboxMode: boolean;
}

export interface ChannelBotRuntimeStatus {
  id: ChannelBotKind;
  running: boolean;
  connected: boolean;
  lastError: string | null;
  lastStartedAt: number | null;
}

export interface ChannelBotTestResult {
  ok: boolean;
  message: string;
}
