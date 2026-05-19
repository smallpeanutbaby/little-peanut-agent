/**
 * CostBadge — running token + USD total for the active conversation.
 *
 * Refresh:
 *   - On mount.
 *   - Every 2s while there's an active agent run (the parent passes
 *     `activeRunId`).
 *   - On every `usage` event sent over `agent:run:{id}` if a run is
 *     active.
 *
 * Hidden when no spend has been recorded for the conversation.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface CostSummary {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

interface CostBadgeProps {
  conversationId: string;
  activeRunId: string | null;
}

export function CostBadge({ conversationId, activeRunId }: CostBadgeProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CostSummary | null>(null);

  const refresh = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.agentCostSummary) return;
    void api.agentCostSummary(conversationId).then(setSummary).catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeRunId) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [activeRunId, refresh]);

  useEffect(() => {
    if (!activeRunId) return;
    const api = window.electronAPI;
    if (!api?.onAgentRun) return;
    const unsub = api.onAgentRun(activeRunId, (ev) => {
      if (ev.kind === "llm" && ev.event.type === "usage") refresh();
      if (ev.kind === "terminal") refresh();
    });
    return unsub;
  }, [activeRunId, refresh]);

  if (!summary || summary.costUsd === 0) return null;
  const totalTokens = summary.promptTokens + summary.completionTokens;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-white/[0.04] px-2.5 py-0.5 text-[11.5px] text-[var(--lp-soft-text)]"
      title={t("cost.detail", {
        defaultValue: "{{prompt}} in / {{completion}} out tokens",
        prompt: summary.promptTokens,
        completion: summary.completionTokens
      })}
    >
      <span>${summary.costUsd.toFixed(4)}</span>
      <span className="text-[10.5px] text-[var(--lp-muted)]">·</span>
      <span>{formatTokens(totalTokens)}</span>
    </span>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}
