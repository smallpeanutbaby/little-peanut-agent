/**
 * TodoPanel — compact in-place plan tracker shown above the agent
 * message list. Subscribes to `agent_todo` rows for the active
 * (project, conversation) pair and re-fetches on every
 * `tool_run_end` for `toolName === "TodoWrite"`.
 *
 * Hidden when:
 *  - There are no todos yet.
 *  - The active conversation is not in `agent` mode.
 *
 * The model owns the list; this panel is read-only.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AgentRunEvent, AgentTodoItem } from "@shared/types";

interface TodoPanelProps {
  projectId: string;
  conversationId: string;
  /** runId of the currently-active agent run, when any. Used to
   *  subscribe to tool_run_end notifications and refresh in real
   *  time. Pass `null` when no run is in flight; the panel still
   *  hydrates once on mount. */
  activeRunId: string | null;
}

export function TodoPanel({ projectId, conversationId, activeRunId }: TodoPanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AgentTodoItem[]>([]);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.listAgentTodos) return;
    void api.listAgentTodos(projectId, conversationId).then((rows) => {
      setItems(rows);
      // bump a tick so children that depend on `items` reference re-render
      setTick((n) => n + 1);
    });
  }, [projectId, conversationId]);

  // Hydrate on mount + whenever the conversation changes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates: when the active run reports `tool_run_end` for TodoWrite,
  // re-fetch. We also refresh on `terminal` so any final state lands.
  useEffect(() => {
    if (!activeRunId) return;
    const api = window.electronAPI;
    if (!api?.onAgentRun) return;
    const unsubscribe = api.onAgentRun(activeRunId, (ev: AgentRunEvent) => {
      if (ev.kind === "tool_run_end" && ev.toolName === "TodoWrite") refresh();
      if (ev.kind === "terminal") refresh();
    });
    return unsubscribe;
  }, [activeRunId, refresh]);

  if (items.length === 0) return null;

  const inProgress = items.find((i) => i.status === "in_progress");
  const completedCount = items.filter((i) => i.status === "completed").length;

  return (
    <details className="mx-auto mb-3 w-full max-w-[860px] rounded-2xl border border-[var(--lp-border)] bg-white/[0.025]" open>
      <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-2.5">
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
          {t("todoPanel.label", { defaultValue: "Plan" })}
        </span>
        <span className="text-[12.5px] text-[var(--lp-text)]">
          {completedCount}/{items.length}
        </span>
        {inProgress ? (
          <span className="truncate text-[12.5px] text-[var(--lp-soft-text)]" title={inProgress.content}>
            · {inProgress.content}
          </span>
        ) : null}
      </summary>
      <ul className="space-y-1 px-4 pb-3 pt-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-[13px]">
            <StatusGlyph status={it.status} />
            <span
              className={
                it.status === "completed"
                  ? "text-[var(--lp-soft-text)] line-through"
                  : it.status === "in_progress"
                    ? "text-[var(--lp-text)]"
                    : "text-[var(--lp-text)]/85"
              }
            >
              {it.content}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function StatusGlyph({ status }: { status: AgentTodoItem["status"] }) {
  if (status === "completed") {
    return <span className="mt-[1px] text-[13px] text-emerald-400">✓</span>;
  }
  if (status === "in_progress") {
    return (
      <span className="mt-[3px] inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-sky-400/40 border-t-sky-400" />
    );
  }
  return <span className="mt-[3px] inline-block h-3 w-3 flex-shrink-0 rounded-full border border-[var(--lp-border)]" />;
}
