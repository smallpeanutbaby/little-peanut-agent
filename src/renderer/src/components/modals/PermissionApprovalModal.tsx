/**
 * PermissionApprovalModal — single-modal queue for `permission_request`
 * events emitted by the agent runtime.
 *
 * Why one modal for the whole queue and not one per request?
 *  - A `queryLoop` round can produce several concurrent tool_use blocks
 *    (the StreamingToolExecutor drains them all). If we mounted a modal
 *    per request, the user would face a stack of competing dialogs.
 *  - Instead we show the FRONT of the queue with a "next N awaiting"
 *    badge so the user can blast through them one at a time.
 *
 * Decision shape (mirrors `AgentPermissionResponse`):
 *   - "拒绝"            → `deny`
 *   - "本次允许"        → `allow_once`
 *   - "本会话允许"      → `allow_session`
 *   - "本项目允许"      → `allow_project`
 *
 * For Bash the model receives "verb-scoped" rules — clicking "本会话允许"
 * on `ls -la` means the gate will auto-allow `ls foo/bar` later in the
 * same session. The runtime gate handles the pattern derivation; this
 * UI only chooses scope.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface PermissionRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  uiPreview?: { title?: string; subtitle?: string; body?: string };
  toolReason?: string;
}

export type PermissionDecisionKind =
  | "deny"
  | "allow_once"
  | "allow_session"
  | "allow_project";

interface PermissionApprovalModalProps {
  /** FIFO queue of pending requests. Always rendered front-of-queue; the
   *  modal hides itself when this is empty. */
  queue: PermissionRequest[];
  onDecide: (req: PermissionRequest, decision: PermissionDecisionKind) => void;
  /** User clicked "全部拒绝" — drains the queue with `deny`. */
  onDenyAll?: () => void;
}

export function PermissionApprovalModal({ queue, onDecide, onDenyAll }: PermissionApprovalModalProps) {
  const { t } = useTranslation();
  const current = queue[0];
  // Auto-collapse the "view raw JSON" body when the request changes so
  // the next prompt feels fresh.
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    setShowRaw(false);
  }, [current?.toolCallId]);

  const inputJson = useMemo(() => {
    if (!current) return "";
    try {
      return JSON.stringify(current.input, null, 2);
    } catch {
      return String(current.input);
    }
  }, [current]);

  if (!current) return null;

  const remaining = queue.length - 1;
  const isBash = current.toolName === "Bash";
  // Reason wording uses the tool-provided reason when present (e.g. Bash
  // risk classifier output), otherwise a sensible default per tool.
  const reasonLine = current.toolReason
    ? current.toolReason
    : defaultReasonFor(current.toolName);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-6">
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/6 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                {t("permission.title", { defaultValue: "需要批准" })}
              </span>
              {remaining > 0 ? (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--lp-soft-text)]">
                  {t("permission.queueRemaining", {
                    defaultValue: "+{{count}} 个待处理",
                    count: remaining
                  })}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 truncate text-[15px] font-semibold text-[var(--lp-text)]">
              {current.uiPreview?.title ?? current.toolName}
            </div>
            {current.uiPreview?.subtitle ? (
              <div className="mt-0.5 truncate text-[12.5px] text-[var(--lp-soft-text)]" title={current.uiPreview.subtitle}>
                {current.uiPreview.subtitle}
              </div>
            ) : null}
          </div>
          <span className="rounded-md border border-[var(--lp-border)] bg-[var(--lp-panel)] px-2 py-1 font-mono text-[11px] text-[var(--lp-muted)]">
            {current.toolName}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[12.5px] text-amber-200">
            {reasonLine}
          </div>

          {isBash && typeof (current.input as { command?: unknown })?.command === "string" ? (
            <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--lp-border)] bg-black/30 px-3 py-2 font-mono text-[12.5px] text-[var(--lp-text)]">
              $ {String((current.input as { command: string }).command)}
            </pre>
          ) : null}

          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
          >
            <span>{showRaw ? "▾" : "▸"}</span>
            <span>
              {t("permission.showRaw", {
                defaultValue: showRaw ? "隐藏原始参数" : "查看原始参数"
              })}
            </span>
          </button>
          {showRaw ? (
            <pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--lp-border)] bg-black/30 px-3 py-2 font-mono text-[11.5px] text-[var(--lp-soft-text)]">
              {inputJson}
            </pre>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/6 px-6 py-4">
          {onDenyAll && queue.length > 1 ? (
            <button
              type="button"
              onClick={onDenyAll}
              className="mr-auto rounded-full border border-[var(--lp-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--lp-soft-text)] hover:bg-white/[0.04]"
            >
              {t("permission.denyAll", { defaultValue: "全部拒绝" })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDecide(current, "deny")}
            className="rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-[12.5px] font-medium text-red-300 hover:bg-red-500/20"
          >
            {t("permission.deny", { defaultValue: "拒绝" })}
          </button>
          <button
            type="button"
            onClick={() => onDecide(current, "allow_once")}
            className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3.5 py-1.5 text-[12.5px] text-[var(--lp-text)] hover:bg-[var(--lp-panel-2)]"
          >
            {t("permission.allowOnce", { defaultValue: "本次允许" })}
          </button>
          <button
            type="button"
            onClick={() => onDecide(current, "allow_session")}
            className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3.5 py-1.5 text-[12.5px] text-[var(--lp-text)] hover:bg-[var(--lp-panel-2)]"
          >
            {t("permission.allowSession", { defaultValue: "本会话允许" })}
          </button>
          <button
            type="button"
            onClick={() => onDecide(current, "allow_project")}
            className="rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-[#151515] hover:bg-white/90"
          >
            {t("permission.allowProject", { defaultValue: "本项目允许" })}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultReasonFor(toolName: string): string {
  switch (toolName) {
    case "Bash":
      return "Agent 想在你的项目里执行一条 shell 命令。";
    case "Write":
      return "Agent 想新建或覆盖一个文件。";
    case "Edit":
      return "Agent 想编辑现有文件。";
    case "Delete":
      return "Agent 想删除一个文件。该操作不可撤销。";
    case "WebFetch":
      return "Agent 想从互联网拉取一个网页。";
    case "WebSearch":
      return "Agent 想发起一次网络搜索。";
    default:
      return `Agent 想执行工具 "${toolName}"。`;
  }
}
