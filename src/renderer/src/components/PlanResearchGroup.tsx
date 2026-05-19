/**
 * Cursor-style collapsed "explored codebase" strip for plan-mode tool runs.
 */

import { useMemo, useState } from "react";
import type { AgentMessagePart, AgentToolRun } from "@shared/types";
import { ToolUseCard } from "./AgentToolCards";

interface PlanResearchGroupProps {
  parts: AgentMessagePart[];
  toolRunsById?: Record<string, AgentToolRun>;
  resultByToolCallId: Record<string, AgentMessagePart>;
  /** When true, start collapsed (typical once the plan panel is visible). */
  defaultCollapsed?: boolean;
  streaming?: boolean;
}

export function PlanResearchGroup({
  parts,
  toolRunsById,
  resultByToolCallId,
  defaultCollapsed = false,
  streaming = false
}: PlanResearchGroupProps) {
  const [open, setOpen] = useState(!defaultCollapsed && !streaming);

  const summary = useMemo(() => {
    const names = parts
      .map((p) => p.toolName)
      .filter((n): n is string => !!n);
    const unique = [...new Set(names)];
    const label = unique.length <= 3 ? unique.join(" · ") : `${unique.slice(0, 2).join(" · ")} 等`;
    return { count: parts.length, label };
  }, [parts]);

  if (parts.length === 0) return null;

  return (
    <div className="w-full rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel)]/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[13px]">
          🔍
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--lp-text)]">
            {streaming ? "正在调研代码库…" : `已探索 ${summary.count} 项`}
          </div>
          {!open && summary.label ? (
            <div className="truncate text-[12px] text-[var(--lp-muted)]">{summary.label}</div>
          ) : null}
        </div>
        <span className="text-[11px] text-[var(--lp-muted)]">{open ? "收起" : "展开"}</span>
        <span className="text-[10px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--lp-border)] px-2 pb-2 pt-1">
          {parts.map((p) => {
            const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
            const result = p.toolCallId ? resultByToolCallId[p.toolCallId] ?? null : null;
            return (
              <ToolUseCard
                key={p.id}
                part={p}
                liveStatus={run?.status}
                resultPart={result}
                variant="plan-compact"
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
