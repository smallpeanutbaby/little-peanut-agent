/**
 * Tool-call cards for agent message bubbles — Cursor-inspired style.
 *
 * `ToolUseCard` — shows tool name, key params, status, and inline
 * result preview (auto-expanded for the most recent tool call).
 *
 * `ToolResultCard` — standalone result block for tool_result parts
 * that arrive without a matching tool_use in the same assistant turn.
 */

import { useMemo, useState } from "react";
import type { AgentMessagePart, AgentToolRunStatus } from "@shared/types";

const STATUS_BADGE: Record<AgentToolRunStatus, { label: string; dot: string; bg: string }> = {
  pending:            { label: "排队中", dot: "bg-white/40",      bg: "bg-white/[0.04]" },
  permission_pending: { label: "等待批准", dot: "bg-amber-400",   bg: "bg-amber-500/10" },
  running:            { label: "运行中", dot: "bg-sky-400 animate-pulse", bg: "bg-sky-500/10" },
  completed:          { label: "已完成", dot: "bg-emerald-400",   bg: "bg-emerald-500/10" },
  denied:             { label: "已拒绝", dot: "bg-red-400",       bg: "bg-red-500/10" },
  errored:            { label: "出错",   dot: "bg-red-400",       bg: "bg-red-500/10" },
  cancelled:          { label: "已取消", dot: "bg-white/40",      bg: "bg-white/[0.04]" }
};

const TOOL_ICON: Record<string, string> = {
  Bash: "terminal",
  Read: "file-text",
  Write: "file-plus",
  Edit: "edit-3",
  Delete: "trash-2",
  Glob: "search",
  Grep: "search",
  ListDir: "folder",
  WebFetch: "globe",
  WebSearch: "globe",
  Task: "layers",
  TodoWrite: "check-square",
  Skill: "zap",
  MemoryRead: "database",
  MemoryWrite: "database",
  ReadLints: "alert-circle"
};

function ToolIcon({ name }: { name: string }) {
  const isMcp = name.startsWith("mcp__");
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[12px]">
      {isMcp ? "⚡" : name === "Bash" ? "$" : "→"}
    </span>
  );
}

void TOOL_ICON;

export function ToolUseCard({
  part,
  liveStatus,
  resultPart,
  variant = "default"
}: {
  part: AgentMessagePart;
  liveStatus?: AgentToolRunStatus;
  resultPart?: AgentMessagePart | null;
  variant?: "default" | "plan-compact";
}) {
  const compact = variant === "plan-compact";
  const status: AgentToolRunStatus = liveStatus ?? (part.isError ? "errored" : "completed");
  const badge = STATUS_BADGE[status];
  const name = part.toolName ?? "tool";
  const subtitle = useMemo(() => summariseInput(name, part.inputJson), [name, part.inputJson]);
  const [showInput, setShowInput] = useState(false);
  const hasResult = !!resultPart;
  const resultText = hasResult ? extractText(resultPart!) : "";
  const isError = resultPart?.isError ?? part.isError;

  const isDone = status === "completed" || status === "errored" || status === "denied" || status === "cancelled";
  const showResult = isDone && hasResult && !!resultText && !compact;

  return (
    <div
      className={`group overflow-hidden rounded-xl border transition-all ${
        isError ? "border-red-500/25" : "border-[var(--lp-border)]"
      } ${compact ? "bg-white/[0.02]" : ""}`}
    >
      <div className={`flex items-center gap-2.5 ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
        <ToolIcon name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--lp-text)]">{name}</span>
            {subtitle ? (
              <span className="truncate text-[12px] text-[var(--lp-soft-text)] opacity-70" title={subtitle}>
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${badge.bg}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
          <span className={isError ? "text-red-300" : status === "running" ? "text-sky-300" : "text-[var(--lp-soft-text)]"}>
            {badge.label}
          </span>
        </div>
      </div>

      {!compact && name === "Bash" && subtitle ? (
        <div className="border-t border-[var(--lp-border)] bg-black/25 px-3 py-2">
          <code className="block overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-[var(--lp-text)]/80">
            <span className="text-emerald-400/60">$ </span>{subtitle}
          </code>
        </div>
      ) : null}

      {showResult ? (
        <div className={`border-t px-3 py-2 ${isError ? "border-red-500/20 bg-red-500/[0.04]" : "border-[var(--lp-border)] bg-black/15"}`}>
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--lp-soft-text)]">
            {resultText.length > 2000 ? resultText.slice(0, 2000) + "\n…(truncated)" : resultText}
          </pre>
        </div>
      ) : null}

      {compact && isError && resultText ? (
        <div className="border-t border-red-500/20 px-2 py-1 text-[11px] text-red-300/90 truncate">
          {resultText.split("\n")[0]}
        </div>
      ) : null}

      {!compact && part.inputJson ? (
        <div className="border-t border-[var(--lp-border)]">
          <button
            type="button"
            onClick={() => setShowInput((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)] transition"
          >
            <span className="text-[10px]">{showInput ? "▾" : "▸"}</span>
            <span>{showInput ? "隐藏参数" : "查看参数"}</span>
          </button>
          {showInput ? (
            <pre className="overflow-x-auto border-t border-[var(--lp-border)] bg-black/20 px-3 py-2 font-mono text-[11px] text-[var(--lp-soft-text)]">
              {prettyJson(part.inputJson)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolResultCard({ part }: { part: AgentMessagePart }) {
  const isError = part.isError;
  const text = extractText(part);
  const preview = part.outputPreview ?? "";

  return (
    <div className={`rounded-xl border overflow-hidden text-[13px] ${
      isError ? "border-red-500/25 bg-red-500/[0.03]" : "border-[var(--lp-border)] bg-white/[0.02]"
    }`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`text-[13px] ${isError ? "text-red-400" : "text-emerald-400"}`}>
          {isError ? "✕" : "✓"}
        </span>
        <span className="text-[12px] font-medium text-[var(--lp-soft-text)]">
          {part.toolName ? `result` : "result"}
        </span>
        {!text && preview ? (
          <span className="truncate text-[12px] text-[var(--lp-muted)]">{preview.split("\n")[0]}</span>
        ) : null}
      </div>
      {text ? (
        <div className={`border-t px-3 py-2 ${isError ? "border-red-500/20 bg-red-500/[0.04]" : "border-[var(--lp-border)] bg-black/15"}`}>
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--lp-soft-text)]">
            {text.length > 2000 ? text.slice(0, 2000) + "\n…(truncated)" : text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function summariseInput(toolName: string, inputJson: string | null): string {
  if (!inputJson) return "";
  try {
    const v = JSON.parse(inputJson) as Record<string, unknown>;
    if (toolName === "Bash") return String(v.command ?? "");
    if (toolName === "Read") return String(v.path ?? "");
    if (toolName === "Write") return String(v.path ?? "");
    if (toolName === "Edit") return String(v.path ?? "");
    if (toolName === "Glob") return String(v.pattern ?? v.glob_pattern ?? "");
    if (toolName === "Grep") return String(v.pattern ?? "");
    if (toolName === "ListDir") return String(v.path ?? ".");
    if (toolName === "WebFetch") return String(v.url ?? "");
    if (toolName === "WebSearch") return String(v.query ?? v.search_term ?? "");
    for (const k of Object.keys(v)) {
      if (typeof v[k] === "string") return `${k}=${v[k]}`;
    }
    return "";
  } catch {
    return "";
  }
}

function prettyJson(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function extractText(part: AgentMessagePart): string {
  if (part.outputJson) {
    try {
      const v = JSON.parse(part.outputJson);
      if (v?.output?.kind === "text") return String(v.output.text ?? "");
      if (v?.output?.kind === "json") return JSON.stringify(v.output.value, null, 2);
      if (v?.output?.kind === "mixed") {
        return (v.output.blocks ?? [])
          .map((b: { type: string; text?: string; mediaType?: string }) =>
            b.type === "text" ? String(b.text ?? "") : `[image:${b.mediaType}]`
          )
          .join("\n");
      }
    } catch { /* fall through */ }
  }
  return part.outputPreview ?? "";
}
