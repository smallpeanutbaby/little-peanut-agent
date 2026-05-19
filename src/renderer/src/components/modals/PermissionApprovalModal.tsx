/**
 * PermissionApprovalModal — inline permission card rendered at the
 * bottom of the chat area (above the composer), Cursor-style.
 *
 * Shows tool name, command preview, reason, and action buttons.
 * Processes the front of the queue; remaining items show as a badge.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface PermissionRequest {
  runId: string;
  /**
   * Conversation that originated this permission request. The modal
   * itself doesn't care, but App.tsx uses it to filter the queue so
   * the prompt only renders inside the conversation that actually
   * triggered the tool call — not in sibling conversations under the
   * same project.
   */
  conversationId: string;
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
  queue: PermissionRequest[];
  onDecide: (req: PermissionRequest, decision: PermissionDecisionKind) => void;
  onDenyAll?: () => void;
}

export function PermissionApprovalModal({ queue, onDecide, onDenyAll }: PermissionApprovalModalProps) {
  const { t } = useTranslation();
  const current = queue[0];
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setShowRaw(false);
  }, [current?.toolCallId]);

  const inputJson = useMemo(() => {
    if (!current) return "";
    try { return JSON.stringify(current.input, null, 2); } catch { return String(current.input); }
  }, [current]);

  if (!current) return null;

  const remaining = queue.length - 1;
  const isBash = current.toolName === "Bash";
  const command = isBash && typeof (current.input as { command?: unknown })?.command === "string"
    ? String((current.input as { command: string }).command)
    : null;
  const reasonLine = current.toolReason || defaultReasonFor(current.toolName);

  return (
    <div className="mx-auto w-full max-w-[860px] px-2 pb-3">
      <div className="rounded-2xl border border-amber-500/30 bg-[var(--lp-main-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.3)] overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/20 text-[11px] text-amber-300">⚠</span>
          <span className="text-[13px] font-medium text-[var(--lp-text)]">
            {current.uiPreview?.title ?? current.toolName}
          </span>
          {current.uiPreview?.subtitle ? (
            <span className="truncate text-[12px] text-[var(--lp-soft-text)]">
              {current.uiPreview.subtitle}
            </span>
          ) : null}
          <span className="ml-auto rounded-md border border-[var(--lp-border)] bg-[var(--lp-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--lp-muted)]">
            {current.toolName}
          </span>
          {remaining > 0 ? (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              +{remaining}
            </span>
          ) : null}
        </div>

        {/* Reason + command */}
        <div className="px-4 py-3">
          <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 text-[12.5px] text-amber-200/90">
            {reasonLine}
          </div>
          {command ? (
            <div className="mt-2 rounded-lg border border-[var(--lp-border)] bg-black/30 px-3 py-2">
              <code className="block overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-[var(--lp-text)]/80">
                <span className="text-emerald-400/60">$ </span>{command}
              </code>
            </div>
          ) : null}

          {/* Raw params toggle */}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)] transition"
          >
            <span className="text-[10px]">{showRaw ? "▾" : "▸"}</span>
            <span>{showRaw ? "隐藏原始参数" : "查看原始参数"}</span>
          </button>
          {showRaw ? (
            <pre className="mt-1.5 max-h-[200px] overflow-auto rounded-lg border border-[var(--lp-border)] bg-black/20 px-3 py-2 font-mono text-[11px] text-[var(--lp-soft-text)]">
              {inputJson}
            </pre>
          ) : null}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
          {onDenyAll && queue.length > 1 ? (
            <button
              type="button"
              onClick={onDenyAll}
              className="text-[11px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)] transition"
            >
              全部拒绝
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecide(current, "deny")}
              className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/20 transition"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => onDecide(current, "allow_once")}
              className="rounded-full border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04] transition"
            >
              本次允许
            </button>
            <button
              type="button"
              onClick={() => onDecide(current, "allow_session")}
              className="rounded-full border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04] transition"
            >
              本会话允许
            </button>
            <button
              type="button"
              onClick={() => onDecide(current, "allow_project")}
              className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#151515] hover:bg-white/90 transition"
            >
              本项目允许
            </button>
          </div>
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
