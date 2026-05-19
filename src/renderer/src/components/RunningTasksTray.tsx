/**
 * RunningTasksTray — compact tray surfacing in-flight + recent
 * subagent tasks for the active project.
 *
 * Polls `electronAPI.listAgentTasks` every 1.5 s while there is a
 * running task and once on focus events. Cheap because the query is a
 * single-project, indexed SELECT capped at 20 rows.
 *
 * The tray hides itself when no tasks exist for the project.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentTaskItem } from "@shared/types";

interface RunningTasksTrayProps {
  projectId: string;
}

const POLL_MS = 1500;
const ACTIVE_STATUSES = new Set<AgentTaskItem["status"]>(["pending", "running"]);

export function RunningTasksTray({ projectId }: RunningTasksTrayProps) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<AgentTaskItem[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listAgentTasks) return;
    try {
      const rows = await api.listAgentTasks(projectId, 20);
      setTasks(rows);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while at least one task is active.
  useEffect(() => {
    const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
    if (!hasActive) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [tasks, refresh]);

  const running = useMemo(() => tasks.filter((t) => ACTIVE_STATUSES.has(t.status)), [tasks]);

  if (tasks.length === 0) return null;

  const cancel = async (id: string) => {
    await window.electronAPI?.cancelAgentTask?.(id);
    refresh();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[320px] max-w-[80vw] rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-main-bg)]/95 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${running.length > 0 ? "animate-pulse bg-sky-400" : "bg-zinc-500"}`} />
        <span className="text-[13px] font-medium text-[var(--lp-text)]">
          {t("tasksTray.title", { defaultValue: "Subagents" })}
        </span>
        <span className="ml-auto text-[12px] text-[var(--lp-soft-text)]">
          {running.length} / {tasks.length}
        </span>
        <span className="ml-1 text-[12px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ul className="max-h-[40vh] space-y-1 overflow-y-auto border-t border-white/6 px-3 py-2">
          {tasks.map((task) => {
            const payload = safeParse(task.payloadJson) as { description?: string; prompt?: string } | null;
            const result = task.resultJson ? (safeParse(task.resultJson) as { summary?: string; errorMessage?: string } | null) : null;
            return (
              <li
                key={task.id}
                className="rounded-lg border border-[var(--lp-border)] bg-white/[0.025] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={task.status} />
                  <span className="truncate text-[12.5px] text-[var(--lp-text)]">
                    {payload?.description ?? task.type}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--lp-muted)]">{prettyAge(task.startedAt)}</span>
                </div>
                {payload?.prompt ? (
                  <div className="mt-1 truncate text-[11.5px] text-[var(--lp-soft-text)]" title={payload.prompt}>
                    {payload.prompt}
                  </div>
                ) : null}
                {result?.errorMessage ? (
                  <div className="mt-1 truncate text-[11.5px] text-red-400" title={result.errorMessage}>
                    {result.errorMessage}
                  </div>
                ) : null}
                {ACTIVE_STATUSES.has(task.status) ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => cancel(task.id)}
                      className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/20"
                    >
                      {t("tasksTray.cancel", { defaultValue: "Cancel" })}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function StatusDot({ status }: { status: AgentTaskItem["status"] }) {
  const color =
    status === "running" || status === "pending"
      ? "bg-sky-400"
      : status === "completed"
        ? "bg-emerald-400"
        : status === "failed"
          ? "bg-red-400"
          : "bg-zinc-500";
  return <span className={`h-2 w-2 rounded-full ${color} ${status === "running" || status === "pending" ? "animate-pulse" : ""}`} />;
}

function prettyAge(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
