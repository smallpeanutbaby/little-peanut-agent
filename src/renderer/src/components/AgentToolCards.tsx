/**
 * Tool-call UI for agent messages — Cursor-style compact rows.
 *
 * - Default: one-line summary per tool; click to expand result / params.
 * - `ToolRunGroup`: collapsible strip when several tools run in a row.
 */

import { useMemo, useState } from "react";
import type { AgentMessagePart, AgentToolRun, AgentToolRunStatus } from "@shared/types";
import { sanitizeDisplayText } from "../utils/displayText";

const ACTIVE = new Set<AgentToolRunStatus>(["pending", "permission_pending", "running"]);

export function ToolRunGroup({
  parts,
  toolRunsById,
  resultByToolCallId,
  defaultCollapsed = true,
  streaming = false,
  headerRunning = "正在执行工具…",
  headerDone
}: {
  parts: AgentMessagePart[];
  toolRunsById?: Record<string, AgentToolRun>;
  resultByToolCallId: Record<string, AgentMessagePart>;
  defaultCollapsed?: boolean;
  streaming?: boolean;
  headerRunning?: string;
  headerDone?: (count: number, toolLabel: string) => string;
}) {
  const [open, setOpen] = useState(!defaultCollapsed && !streaming);

  const summary = useMemo(() => {
    const names = [...new Set(parts.map((p) => p.toolName).filter(Boolean))] as string[];
    const label = names.length <= 3 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} 等`;
    return { count: parts.length, label };
  }, [parts]);

  if (parts.length === 0) return null;

  if (parts.length === 1) {
    const p = parts[0]!;
    const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
    const result = p.toolCallId ? resultByToolCallId[p.toolCallId] ?? null : null;
    return (
      <ToolUseCard
        part={p}
        liveStatus={run?.status}
        resultPart={result}
        defaultExpanded={streaming || ACTIVE.has(run?.status ?? "completed")}
      />
    );
  }

  const title = streaming
    ? headerRunning
    : (headerDone?.(summary.count, summary.label) ?? `已执行 ${summary.count} 项`);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-white/[0.03]"
      >
        <span className="text-[10px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${streaming ? "animate-pulse bg-sky-400" : "bg-emerald-400/80"}`} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--lp-text)]/90">{title}</span>
        {!open && summary.label ? (
          <span className="max-w-[45%] truncate text-[11px] text-[var(--lp-muted)]">{summary.label}</span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t border-white/[0.06]">
          {parts.map((p) => {
            const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
            const result = p.toolCallId ? resultByToolCallId[p.toolCallId] ?? null : null;
            return (
              <ToolUseCard
                key={p.id}
                part={p}
                liveStatus={run?.status}
                resultPart={result}
                nested
                defaultExpanded={false}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ToolUseCard({
  part,
  liveStatus,
  resultPart,
  nested = false,
  defaultExpanded = false
}: {
  part: AgentMessagePart;
  liveStatus?: AgentToolRunStatus;
  resultPart?: AgentMessagePart | null;
  /** Inside `ToolRunGroup` — no outer card border. */
  nested?: boolean;
  defaultExpanded?: boolean;
}) {
  const status: AgentToolRunStatus = liveStatus ?? (part.isError ? "errored" : "completed");
  const name = part.toolName ?? "tool";
  const subtitle = useMemo(() => summariseInput(name, part.inputJson), [name, part.inputJson]);
  const [open, setOpen] = useState(defaultExpanded || ACTIVE.has(status));
  const [showParams, setShowParams] = useState(false);

  const hasResult = !!resultPart;
  const resultText = hasResult ? extractText(resultPart!) : "";
  const isError = resultPart?.isError ?? part.isError;
  const canExpand = !!(resultText || part.inputJson || (name === "Bash" && subtitle));

  const errorPreview = isError && resultText ? resultText.split("\n")[0] : "";

  return (
    <div
      className={
        nested
          ? "border-b border-white/[0.05] last:border-b-0"
          : `overflow-hidden rounded-lg border ${isError ? "border-red-500/20 bg-red-500/[0.02]" : "border-white/[0.08] bg-white/[0.02]"}`
      }
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${canExpand ? "hover:bg-white/[0.03] cursor-pointer" : "cursor-default"}`}
      >
        <span className="w-3 shrink-0 text-[10px] text-[var(--lp-muted)]">
          {canExpand ? (open ? "▾" : "▸") : " "}
        </span>
        <StatusGlyph status={status} isError={isError} />
        <span className="shrink-0 text-[12px] font-medium text-[var(--lp-text)]/90">{name}</span>
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
        {!open && errorPreview ? (
          <span className="max-w-[42%] truncate text-[11px] text-red-400/90" title={errorPreview}>
            {errorPreview}
          </span>
        ) : null}
        {!open && !errorPreview && status === "running" ? (
          <span className="text-[11px] text-sky-300/80">…</span>
        ) : null}
      </button>

      {open && name === "Bash" && subtitle ? (
        <div className="border-t border-white/[0.06] bg-black/20 px-3 py-1.5">
          <code className="block overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-[var(--lp-text)]/75">
            <span className="text-emerald-400/50">$ </span>
            {subtitle}
          </code>
        </div>
      ) : null}

      {open && resultText ? (
        <div
          className={`border-t px-3 py-2 ${isError ? "border-red-500/15 bg-red-500/[0.03]" : "border-white/[0.06] bg-black/15"}`}
        >
          <pre className="max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--lp-soft-text)]">
            {resultText.length > 4000 ? `${resultText.slice(0, 4000)}\n…(truncated)` : resultText}
          </pre>
        </div>
      ) : null}

      {open && part.inputJson ? (
        <div className="border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setShowParams((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1 text-[10.5px] text-[var(--lp-muted)] hover:text-[var(--lp-soft-text)]"
          >
            <span>{showParams ? "▾" : "▸"}</span>
            <span>{showParams ? "隐藏参数" : "参数"}</span>
          </button>
          {showParams ? (
            <pre className="overflow-x-auto border-t border-white/[0.06] bg-black/20 px-3 py-1.5 font-mono text-[10.5px] text-[var(--lp-soft-text)]">
              {prettyJson(part.inputJson)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolResultCard({ part }: { part: AgentMessagePart }) {
  return (
    <ToolUseCard
      part={{
        ...part,
        type: "tool_use",
        toolName: part.toolName ?? "result",
        inputJson: null
      }}
      resultPart={part}
      defaultExpanded={!!part.isError}
    />
  );
}

function StatusGlyph({ status, isError }: { status: AgentToolRunStatus; isError: boolean }) {
  if (status === "permission_pending") {
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400/90"
        aria-hidden
      />
    );
  }
  if (ACTIVE.has(status)) {
    return (
      <span
        className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-sky-400/30 border-t-sky-400"
        aria-hidden
      />
    );
  }
  if (isError || status === "errored" || status === "denied") {
    return <span className="shrink-0 text-[11px] leading-none text-red-400" aria-hidden>✕</span>;
  }
  return <span className="shrink-0 text-[11px] leading-none text-emerald-400/75" aria-hidden>✓</span>;
}

function summariseInput(toolName: string, inputJson: string | null): string {
  if (!inputJson) return "";
  try {
    const v = JSON.parse(inputJson) as Record<string, unknown>;
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
  let raw = "";
  if (part.outputJson) {
    try {
      const v = JSON.parse(part.outputJson) as {
        output?: { kind: string; text?: string; value?: unknown; blocks?: Array<{ type: string; text?: string; mediaType?: string }> };
      };
      if (v?.output?.kind === "text") raw = String(v.output.text ?? "");
      else if (v?.output?.kind === "json") raw = JSON.stringify(v.output.value, null, 2);
      else if (v?.output?.kind === "mixed") {
        raw = (v.output.blocks ?? [])
          .map((b) => (b.type === "text" ? String(b.text ?? "") : `[image:${b.mediaType}]`))
          .join("\n");
      }
    } catch {
      /* fall through */
    }
  }
  if (!raw) raw = part.outputPreview ?? "";
  return sanitizeDisplayText(raw);
}
