import type { ChatModeId } from "@shared/modes.js";
import type { ProviderConfig } from "@shared/types.js";
import type { AppDatabase } from "../db/database.js";

export type ImMenuKind = "projects" | "conversations" | "modes" | "model-providers" | "model-ids";

/** Numeric menu expires after this many ms (cross-message QQ replies). */
export const IM_MENU_TTL_MS = 10 * 60_000;

export interface ImSession {
  channel: "qq";
  peerId: string;
  activeProjectId: string | null;
  activeConversationId: string | null;
  activeModeId: ChatModeId;
  /** QQ 侧单独指定的服务商/模型（对所有模式含 agent 生效）；null = 跟随桌面聊天窗口 */
  activeProviderId: string | null;
  activeModelId: string | null;
  /** msg_id → next msg_seq for passive replies */
  replySeq: Record<string, number>;
  /** 最近一次列表命令的缓存（内存，列表展示用） */
  _projectList?: import("@shared/types.js").Project[];
  _conversationList?: import("@shared/types.js").Conversation[];
  _modelProviderList?: ProviderConfig[];
  _modelIdList?: string[];
  /** 当前「模型列表」对应的服务商 */
  _modelPickerProviderId?: string;
  /** 用户上次看到的列表类型（持久化到 DB，用于跨消息解析纯数字） */
  _lastMenu?: ImMenuKind;
  _lastMenuAt?: number;
}

function isValidMenuKind(v: string | null | undefined): v is ImMenuKind {
  return (
    v === "projects" ||
    v === "conversations" ||
    v === "modes" ||
    v === "model-providers" ||
    v === "model-ids"
  );
}

/** Restore menu from DB; clear if expired. */
export function hydrateMenuFromDb(session: ImSession, lastMenu: string | null, lastMenuAt: number | null): void {
  if (!lastMenu || !isValidMenuKind(lastMenu) || !lastMenuAt) {
    session._lastMenu = undefined;
    session._lastMenuAt = undefined;
    return;
  }
  if (Date.now() - lastMenuAt > IM_MENU_TTL_MS) {
    session._lastMenu = undefined;
    session._lastMenuAt = undefined;
    return;
  }
  session._lastMenu = lastMenu;
  session._lastMenuAt = lastMenuAt;
}

export function setActiveMenu(session: ImSession, menu: ImMenuKind): void {
  session._lastMenu = menu;
  session._lastMenuAt = Date.now();
}

export function clearActiveMenu(session: ImSession): void {
  session._lastMenu = undefined;
  session._lastMenuAt = undefined;
}

export function isMenuActive(session: ImSession): boolean {
  if (!session._lastMenu || !session._lastMenuAt) return false;
  return Date.now() - session._lastMenuAt <= IM_MENU_TTL_MS;
}

export function loadImSession(db: AppDatabase, channel: "qq", peerId: string): ImSession {
  const row = db.getImSession(channel, peerId);
  if (!row) {
    return {
      channel,
      peerId,
      activeProjectId: null,
      activeConversationId: null,
      activeModeId: "chat",
      activeProviderId: null,
      activeModelId: null,
      replySeq: {}
    };
  }
  const session: ImSession = {
    channel,
    peerId,
    activeProjectId: row.activeProjectId,
    activeConversationId: row.activeConversationId,
    activeModeId: row.activeModeId as ChatModeId,
    activeProviderId: row.activeProviderId ?? null,
    activeModelId: row.activeModelId ?? null,
    replySeq: row.replySeq
  };
  hydrateMenuFromDb(session, row.lastMenu, row.lastMenuAt);
  return session;
}

export function saveImSession(db: AppDatabase, session: ImSession): void {
  db.saveImSession({
    channel: session.channel,
    peerId: session.peerId,
    activeProjectId: session.activeProjectId,
    activeConversationId: session.activeConversationId,
    activeModeId: session.activeModeId,
    activeProviderId: session.activeProviderId,
    activeModelId: session.activeModelId,
    lastMenu: isMenuActive(session) ? (session._lastMenu ?? null) : null,
    lastMenuAt: isMenuActive(session) ? (session._lastMenuAt ?? null) : null,
    replySeqJson: JSON.stringify(session.replySeq)
  });
}

export function nextReplySeq(session: ImSession, msgId: string): number {
  const cur = session.replySeq[msgId] ?? 0;
  const next = cur + 1;
  session.replySeq[msgId] = next;
  return next;
}
