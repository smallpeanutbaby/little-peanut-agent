/**
 * Permission approval strip — Cursor-style compact card above the composer.
 *
 * One tool per card: name + input preview on the left, Run / Deny on the right.
 * Session / project allow live in a small scope menu (like Cursor's chevron).
 */

import { useEffect, useMemo, useRef, useState } from "react";

export interface PermissionRequest {
  runId: string;
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
  const current = queue[0];
  const [showRaw, setShowRaw] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowRaw(false);
    setScopeOpen(false);
  }, [current?.toolCallId]);

  useEffect(() => {
    if (!scopeOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (scopeRef.current && !scopeRef.current.contains(e.target as Node)) {
        setScopeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [scopeOpen]);

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
  const toolName = current.toolName;
  const title = current.uiPreview?.title ?? toolName;
  const subtitle =
    current.uiPreview?.subtitle ?? summariseInput(toolName, current.input);
  const command =
    toolName === "Bash" && typeof (current.input as { command?: unknown })?.command === "string"
      ? String((current.input as { command: string }).command)
      : null;
  const hint =
    current.uiPreview?.body ??
    current.toolReason ??
    shortReasonFor(toolName);

  const decide = (kind: PermissionDecisionKind) => {
    setScopeOpen(false);
    onDecide(current, kind);
  };

  return (
    <div className="mx-auto w-full max-w-[860px] px-2 pb-2">
      <div className="overflow-hidden rounded-lg border border-amber-500/20 bg-white/[0.02]">
        {/* Tool preview row — matches AgentToolCards density */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <span
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400/90"
            title="等待授权"
            aria-hidden
          />
          <span className="shrink-0 text-[12px] font-medium text-[var(--lp-text)]/90">{title}</span>
          {subtitle ? (
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--lp-muted)]"
              title={subtitle}
            >
              {subtitle}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {remaining > 0 ? (
            <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[var(--lp-muted)]">
              +{remaining}
            </span>
          ) : null}
        </div>

        {command && command !== subtitle ? (
          <div className="border-t border-white/[0.06] bg-black/20 px-3 py-1.5">
            <code className="block overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-[var(--lp-text)]/75">
              <span className="text-emerald-400/50">$ </span>
              {command}
            </code>
          </div>
        ) : null}

        {hint ? (
          <p className="border-t border-white/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-[var(--lp-muted)]">
            {hint}
          </p>
        ) : null}

        {inputJson && inputJson !== "{}" ? (
          <div className="border-t border-white/[0.06] px-2.5 py-1">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 text-[10.5px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)]"
            >
              <span className="text-[10px]">{showRaw ? "▾" : "▸"}</span>
              <span>{showRaw ? "隐藏参数" : "参数"}</span>
            </button>
            {showRaw ? (
              <pre className="mt-1 max-h-[160px] overflow-auto rounded border border-white/[0.06] bg-black/20 px-2 py-1.5 font-mono text-[10.5px] text-[var(--lp-soft-text)]">
                {inputJson}
              </pre>
            ) : null}
          </div>
        ) : null}

        {/* Actions — Cursor-like: Deny + primary Run + scope chevron */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-2.5 py-1.5">
          {onDenyAll && queue.length > 1 ? (
            <button
              type="button"
              onClick={onDenyAll}
              className="mr-auto text-[11px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)]"
            >
              全部拒绝
            </button>
          ) : (
            <span className="mr-auto" />
          )}

          <button
            type="button"
            onClick={() => decide("deny")}
            className="rounded-md px-2 py-1 text-[11.5px] text-[var(--lp-muted)] hover:bg-white/[0.04] hover:text-[var(--lp-text)]"
          >
            拒绝
          </button>

          <button
            type="button"
            onClick={() => decide("allow_once")}
            className="rounded-md bg-white px-2.5 py-1 text-[11.5px] font-medium text-[#151515] hover:bg-white/90"
          >
            允许
          </button>

          <div ref={scopeRef} className="relative flex">
            <button
              type="button"
              onClick={() => setScopeOpen((v) => !v)}
              className="flex items-center rounded-md border border-white/[0.1] px-1.5 py-1 text-[11px] text-[var(--lp-muted)] hover:bg-white/[0.04] hover:text-[var(--lp-text)]"
              title="始终允许"
              aria-expanded={scopeOpen}
              aria-haspopup="menu"
            >
              ▾
            </button>
            {scopeOpen ? (
              <div
                role="menu"
                className="absolute bottom-full right-0 z-20 mb-1 min-w-[128px] overflow-hidden rounded-lg border border-white/[0.1] bg-[var(--lp-panel)] py-0.5 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => decide("allow_session")}
                  className="block w-full px-3 py-1.5 text-left text-[11.5px] text-[var(--lp-text)] hover:bg-white/[0.06]"
                >
                  本会话允许
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => decide("allow_project")}
                  className="block w-full px-3 py-1.5 text-left text-[11.5px] text-[var(--lp-text)] hover:bg-white/[0.06]"
                >
                  本项目允许
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function summariseInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const v = input as Record<string, unknown>;
  if (toolName === "Bash") return String(v.command ?? "");
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") return String(v.path ?? "");
  if (toolName === "Glob") return String(v.pattern ?? v.glob_pattern ?? "");
  if (toolName === "Grep") return String(v.pattern ?? "");
  if (toolName === "ListDir") return String(v.path ?? ".");
  if (toolName === "WebFetch") return String(v.url ?? "");
  if (toolName === "WebSearch") return String(v.query ?? v.search_term ?? "");
  for (const k of Object.keys(v)) {
    if (typeof v[k] === "string") return String(v[k]);
  }
  return "";
}

function shortReasonFor(toolName: string): string {
  switch (toolName) {
    case "Bash":
      return "需要授权才能在项目中运行命令";
    case "Write":
    case "Edit":
      return "需要授权才能修改文件";
    case "Delete":
      return "需要授权才能删除文件";
    case "WebFetch":
    case "WebSearch":
      return "需要授权才能访问网络";
    default:
      return "需要你的授权才能继续";
  }
}
