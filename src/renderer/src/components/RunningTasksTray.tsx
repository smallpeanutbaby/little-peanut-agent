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
// Hide completed/failed/killed tasks from the tray once they're older
// than this. Without this, a finished subagent card sticks around
// forever and looks like it's still in flight — confusingly so when
// the age clock keeps ticking from `startedAt`.
const FINISHED_TTL_MS = 60_000;

export function RunningTasksTray({ projectId }: RunningTasksTrayProps) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<AgentTaskItem[]>([]);
  const [open, setOpen] = useState(false);
  /** User dismissed the whole tray; show again when a new subagent starts. */
  const [trayDismissed, setTrayDismissed] = useState(false);
  /** Per-task dismiss for finished rows (still in DB, just hidden in UI). */
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

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

  // Re-open the tray when a new subagent actually starts.
  useEffect(() => {
    if (running.length > 0) {
      setTrayDismissed(false);
    }
  }, [running.length]);

  // Visible set = all active tasks + any finished task that ended in
  // the last FINISHED_TTL_MS. Older completed/failed/killed rows stay
  // in the DB (we still want them for postmortems via a future "task
  // history" view) but disappear from the tray.
  const visible = useMemo(() => {
    const now = Date.now();
    return tasks.filter((t) => {
      if (dismissedIds.has(t.id)) return false;
      if (ACTIVE_STATUSES.has(t.status)) return true;
      if (t.endedAt && now - t.endedAt < FINISHED_TTL_MS) return true;
      return false;
    });
  }, [tasks, dismissedIds]);

  if (trayDismissed || visible.length === 0) return null;

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
          {running.length} / {visible.length}
        </span>
        <span className="ml-1 text-[12px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTrayDismissed(true);
          }}
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--lp-soft-text)] hover:bg-white/[0.08] hover:text-[var(--lp-text)]"
          title={t("tasksTray.dismissTray", { defaultValue: "关闭" })}
          aria-label={t("tasksTray.dismissTray", { defaultValue: "关闭" })}
        >
          ×
        </button>
      </button>
      {open ? (
        <ul className="max-h-[40vh] space-y-1 overflow-y-auto border-t border-white/6 px-3 py-2">
          {visible.map((task) => {
            const payload = safeParse(task.payloadJson) as { description?: string; prompt?: string } | null;
            const result = task.resultJson ? (safeParse(task.resultJson) as { summary?: string; errorMessage?: string } | null) : null;
            const active = ACTIVE_STATUSES.has(task.status);
            // For finished tasks show the run duration ("8s") instead
            // of the wall-clock age since startedAt, otherwise a
            // completed-10-minutes-ago task looks like it's been
            // running for 10 minutes.
            const ageLabel = active
              ? prettyAge(task.startedAt)
              : task.endedAt
                ? `${prettyDuration(task.endedAt - task.startedAt)} · ${labelFor(task.status, t)}`
                : labelFor(task.status, t);
            return (
              <li
                key={task.id}
                className={
                  "rounded-lg border border-[var(--lp-border)] bg-white/[0.025] px-3 py-2 transition " +
                  (active ? "" : "opacity-60")
                }
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={task.status} />
                  <span className="truncate text-[12.5px] text-[var(--lp-text)]">
                    {payload?.description ?? task.type}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--lp-muted)]">{ageLabel}</span>
                  {!active ? (
                    <button
                      type="button"
                      onClick={() => setDismissedIds((prev) => new Set(prev).add(task.id))}
                      className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--lp-soft-text)] hover:bg-white/[0.08] hover:text-[var(--lp-text)]"
                      title={t("tasksTray.dismissItem", { defaultValue: "移除此项" })}
                      aria-label={t("tasksTray.dismissItem", { defaultValue: "移除此项" })}
                    >
                      ×
                    </button>
                  ) : null}
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
  return prettyDuration(Date.now() - ts);
}

function prettyDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function labelFor(status: AgentTaskItem["status"], t: (k: string, opts?: { defaultValue?: string }) => string): string {
  if (status === "completed") return t("tasksTray.completed", { defaultValue: "已完成" });
  if (status === "failed") return t("tasksTray.failed", { defaultValue: "失败" });
  if (status === "killed") return t("tasksTray.killed", { defaultValue: "已取消" });
  return status;
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
