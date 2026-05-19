/**
 * Tool-call cards rendered inside agent message bubbles.
 *
 * `ToolUseCard` — folded preview of the model's tool invocation
 * (name + key argument summary + status badge).
 *
 * `ToolResultCard` — the matching `tool_result` block; success/error
 * variant, with output rendered as a code block. For Edit/Write we
 * surface the path + a small diff when the runtime persisted one.
 */

import { useMemo, useState } from "react";
import type { AgentMessagePart, AgentToolRunStatus } from "@shared/types";

const STATUS_LABEL: Record<AgentToolRunStatus, string> = {
  pending: "排队中",
  permission_pending: "等待批准",
  running: "运行中",
  completed: "已完成",
  denied: "已拒绝",
  errored: "出错",
  cancelled: "已取消"
};

const STATUS_COLOR: Record<AgentToolRunStatus, string> = {
  pending: "bg-white/[0.06] text-[var(--lp-muted)]",
  permission_pending: "bg-amber-500/15 text-amber-300",
  running: "bg-sky-500/15 text-sky-300",
  completed: "bg-emerald-500/15 text-emerald-300",
  denied: "bg-red-500/15 text-red-300",
  errored: "bg-red-500/15 text-red-300",
  cancelled: "bg-white/[0.06] text-[var(--lp-muted)]"
};

export function ToolUseCard({
  part,
  liveStatus
}: {
  part: AgentMessagePart;
  liveStatus?: AgentToolRunStatus;
}) {
  const [open, setOpen] = useState(false);
  const status: AgentToolRunStatus = liveStatus ?? (part.isError ? "errored" : "completed");
  const name = part.toolName ?? "tool";
  const subtitle = useMemo(() => summariseInput(name, part.inputJson), [name, part.inputJson]);

  return (
    <div className="rounded-xl border border-[var(--lp-border)] bg-white/[0.02] overflow-hidden text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.04]"
      >
        <span className="text-[12px] text-[var(--lp-muted)]">→</span>
        <span className="font-medium text-[var(--lp-text)]">{name}</span>
        {subtitle ? (
          <span className="truncate text-[12px] text-[var(--lp-soft-text)]" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--lp-border)] bg-black/20 px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-[var(--lp-soft-text)]">
            {prettyJson(part.inputJson)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function ToolResultCard({ part }: { part: AgentMessagePart }) {
  const [open, setOpen] = useState(false);
  const isError = part.isError;
  const preview = part.outputPreview ?? "";
  const variantClass = isError
    ? "border-red-500/30 bg-red-500/8"
    : "border-[var(--lp-border)] bg-white/[0.02]";
  return (
    <div className={`rounded-xl border overflow-hidden text-[13px] ${variantClass}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.04]"
      >
        <span className={`text-[12px] ${isError ? "text-red-300" : "text-emerald-300/80"}`}>
          {isError ? "✕" : "✓"}
        </span>
        <span className="text-[var(--lp-muted)]">{part.toolName ?? "result"}</span>
        <span className="truncate text-[12px] text-[var(--lp-soft-text)]" title={preview}>
          {preview.split("\n")[0]}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--lp-border)] bg-black/20 px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-[var(--lp-soft-text)]">
            {extractText(part)}
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
    if (toolName === "Glob") return String(v.pattern ?? "");
    // Fallback: first string-valued property
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
      // ToolResultBlock shape: { output: { kind: "text", text } | ... }
      if (v?.output?.kind === "text") return String(v.output.text ?? "");
      if (v?.output?.kind === "json") return JSON.stringify(v.output.value, null, 2);
      if (v?.output?.kind === "mixed") {
        return (v.output.blocks ?? [])
          .map((b: { type: string; text?: string; mediaType?: string }) =>
            b.type === "text" ? String(b.text ?? "") : `[image:${b.mediaType}]`
          )
          .join("\n");
      }
    } catch {
      /* fall through */
    }
  }
  return part.outputPreview ?? "";
}
