/**
 * ResumeToast — surfaces conversations whose previous agent run died
 * mid-stream. Each interrupted conversation gets its own Resume / Discard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface InterruptedRow {
  id: string;
  name: string | null;
  projectId: string | null;
  lastRunId: string | null;
  lastRunStartedAt: number | null;
}

interface ResumeToastProps {
  onOpenConversation: (conversationId: string) => void;
  onResumeRun?: (conversationId: string, runId: string) => void;
}

export function ResumeToast({ onOpenConversation, onResumeRun }: ResumeToastProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InterruptedRow[]>([]);
  const [resumingIds, setResumingIds] = useState<Set<string>>(new Set());
  const [discardingIds, setDiscardingIds] = useState<Set<string>>(new Set());
  /** Conversations the user already resumed/discarded — hide until DB catches up. */
  const handledIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listInterruptedConversations) return;
    try {
      const rs = await api.listInterruptedConversations();
      const hidden = handledIdsRef.current;
      setRows(rs.filter((r) => !hidden.has(r.id)));
    } catch {
      /* ignore */
    }
  }, []);

  const markHandled = (conversationId: string) => {
    handledIdsRef.current.add(conversationId);
    setRows((prev) => prev.filter((r) => r.id !== conversationId));
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleResume = async (row: InterruptedRow) => {
    if (resumingIds.has(row.id)) return;
    setResumingIds((prev) => new Set(prev).add(row.id));
    try {
      const api = window.electronAPI;
      if (api?.resumeAgentRun && onResumeRun) {
        const { runId } = await api.resumeAgentRun(row.id);
        onResumeRun(row.id, runId);
      } else {
        onOpenConversation(row.id);
      }
      markHandled(row.id);
    } catch (e) {
      console.error("[ResumeToast] resume failed", e);
      onOpenConversation(row.id);
      markHandled(row.id);
    } finally {
      setResumingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleDiscard = async (row: InterruptedRow) => {
    if (discardingIds.has(row.id)) return;
    setDiscardingIds((prev) => new Set(prev).add(row.id));
    try {
      await window.electronAPI?.discardInterruptedConversation?.(row.id);
      markHandled(row.id);
    } finally {
      setDiscardingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleResumeAll = async () => {
    const snapshot = [...rows];
    await Promise.all(snapshot.map((row) => handleResume(row)));
  };

  const handleDiscardAll = async () => {
    for (const row of [...rows]) {
      await handleDiscard(row);
    }
  };

  if (rows.length === 0) return null;

  const anyBusy = resumingIds.size > 0 || discardingIds.size > 0;

  return (
    <div
      className="fixed bottom-4 left-4 z-40 w-[380px] max-w-[90vw] rounded-2xl border border-amber-500/40 bg-[var(--lp-main-bg)]/95 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <div className="flex items-start gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
          !
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--lp-text)]">
            {t("resumeToast.title", { defaultValue: "有未完成的 Agent 任务" })}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--lp-soft-text)]">
            {t("resumeToast.subtitle", {
              defaultValue: "共 {{count}} 个对话可恢复",
              count: rows.length
            })}
          </div>
        </div>
      </div>

      <ul className="max-h-[40vh] overflow-y-auto px-2 py-2">
        {rows.map((row) => {
          const isResuming = resumingIds.has(row.id);
          const isDiscarding = discardingIds.has(row.id);
          const busy = isResuming || isDiscarding;
          return (
            <li
              key={row.id}
              className="mb-1 flex items-center gap-2 rounded-xl border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 last:mb-0"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[12.5px] text-[var(--lp-text)] hover:underline"
                title={row.name ?? row.id}
                onClick={() => onOpenConversation(row.id)}
              >
                {row.name ?? row.id}
              </button>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDiscard(row)}
                  className="rounded-full border border-[var(--lp-border)] bg-transparent px-2.5 py-0.5 text-[11px] text-[var(--lp-soft-text)] hover:bg-white/[0.04] disabled:opacity-40"
                >
                  {isDiscarding
                    ? t("resumeToast.discarding", { defaultValue: "…" })
                    : t("resumeToast.discard", { defaultValue: "放弃" })}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResume(row)}
                  className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#151515] hover:bg-white/90 disabled:opacity-40"
                >
                  {isResuming
                    ? t("resumeToast.resuming", { defaultValue: "恢复中…" })
                    : t("resumeToast.resume", { defaultValue: "恢复" })}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length > 1 ? (
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <button
            type="button"
            disabled={anyBusy}
            onClick={() => void handleDiscardAll()}
            className="rounded-full border border-[var(--lp-border)] bg-transparent px-3 py-1 text-[12px] text-[var(--lp-soft-text)] hover:bg-white/[0.04] disabled:opacity-40"
          >
            {t("resumeToast.discardAll", { defaultValue: "全部放弃" })}
          </button>
          <button
            type="button"
            disabled={anyBusy}
            onClick={() => void handleResumeAll()}
            className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-[#151515] hover:bg-white/90 disabled:opacity-40"
          >
            {t("resumeToast.resumeAll", { defaultValue: "全部恢复" })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
