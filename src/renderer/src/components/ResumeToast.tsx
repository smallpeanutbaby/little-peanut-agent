/**
 * ResumeToast — surfaces conversations whose previous agent run died
 * mid-stream (rows in `conversation` where `last_run_status =
 * 'in_progress'`). The user can either jump to the conversation or
 * discard the marker.
 *
 * v1: discard-only. True resume (re-spawning the loop from the last
 * persisted assistant placeholder) requires persisting provider/model
 * with each run, which we'll do in a follow-up — the marker plumbing
 * here is the prerequisite.
 */

import { useCallback, useEffect, useState } from "react";
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
}

export function ResumeToast({ onOpenConversation }: ResumeToastProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InterruptedRow[]>([]);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listInterruptedConversations) return;
    try {
      const rs = await api.listInterruptedConversations();
      setRows(rs);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Only show on app boot.
    refresh();
  }, [refresh]);

  if (rows.length === 0) return null;
  const first = rows[0];
  const more = rows.length - 1;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[360px] max-w-[80vw] rounded-2xl border border-amber-500/40 bg-[var(--lp-main-bg)]/95 px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">!</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--lp-text)]">
            {t("resumeToast.title", { defaultValue: "A previous agent run was interrupted" })}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--lp-soft-text)]" title={first.name ?? first.id}>
            {first.name ?? first.id}
            {more > 0 ? ` (+${more} more)` : ""}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={async () => {
            await window.electronAPI?.discardInterruptedConversation?.(first.id);
            refresh();
          }}
          className="rounded-full border border-[var(--lp-border)] bg-transparent px-3 py-1 text-[12px] text-[var(--lp-soft-text)] hover:bg-white/[0.04]"
        >
          {t("resumeToast.discard", { defaultValue: "Discard" })}
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenConversation(first.id);
          }}
          className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-[#151515] hover:bg-white/90"
        >
          {t("resumeToast.open", { defaultValue: "Open" })}
        </button>
      </div>
    </div>
  );
}
