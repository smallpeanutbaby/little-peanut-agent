/**
 * Block-based message renderer for agent runs — Cursor-inspired layout.
 *
 * Reads `message_part` rows and groups them by message. Each message:
 *  - "user" → right-aligned bubble
 *  - "assistant" → reasoning → tool cards → markdown (plan mode: tools then plan panel)
 *
 * Tool cards pair tool_use with their matching tool_result for inline display.
 */

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AgentMessagePart,
  AgentToolRun,
  ChatMessage
} from "@shared/types";
import { ToolUseCard, ToolResultCard } from "./AgentToolCards";
import { renderPlanAssistantContent } from "./PlanPanel";
import { PlanResearchGroup } from "./PlanResearchGroup";
import { isPlanClarificationOnly, isPlanFinalPlan } from "@shared/plan-ui";

interface AgentMessageListProps {
  conversationId: string;
  messages: ChatMessage[];
  liveSignal?: unknown;
  toolRunsById?: Record<string, AgentToolRun>;
  youLabel: string;
  assistantLabel: string;
  reasoningLabel: string;
  /**
   * Conversation's current mode. Drives whether the "Execute as Agent"
   * handoff button is shown after the last assistant reply. Only "plan"
   * triggers the button.
   */
  currentModeId?: string;
  /** Called with the final plan markdown when the user clicks "Execute as Agent". */
  onExecuteAsAgent?: (planText: string) => void;
  /**
   * When true, the live stream is still in progress for the active
   * conversation. The handoff button is hidden until the stream
   * finishes so the user can't dispatch a partial plan.
   */
  streamingInProgress?: boolean;
  planExecuteLabel?: string;
  planEditHint?: string;
  planClarifyHint?: string;
  onPrefillComposer?: (text: string) => void;
}

interface RenderedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: AgentMessagePart[];
  fallbackContent: string;
}

export function AgentMessageList({
  conversationId,
  messages,
  liveSignal,
  toolRunsById,
  youLabel,
  assistantLabel,
  reasoningLabel,
  currentModeId,
  onExecuteAsAgent,
  streamingInProgress,
  planExecuteLabel = "让 Agent 按此计划执行",
  planEditHint = "可直接编辑下方方案，确认后交给 Agent 执行",
  planClarifyHint = "在下方输入框回复你的选择，或发送「直接出方案」跳过确认",
  onPrefillComposer
}: AgentMessageListProps) {
  const [partsByMessage, setPartsByMessage] = useState<Record<string, AgentMessagePart[]>>({});

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.listAgentParts || !conversationId) return;
    let cancelled = false;
    void api.listAgentParts(conversationId).then((parts) => {
      if (cancelled) return;
      const grouped: Record<string, AgentMessagePart[]> = {};
      for (const p of parts) {
        if (!grouped[p.messageId]) grouped[p.messageId] = [];
        grouped[p.messageId].push(p);
      }
      setPartsByMessage(grouped);
    });
    return () => { cancelled = true; };
  }, [conversationId, liveSignal, messages.length]);

  // Build a global map: toolCallId → tool_result part (across all messages)
  const resultByToolCallId = useMemo(() => {
    const map: Record<string, AgentMessagePart> = {};
    for (const parts of Object.values(partsByMessage)) {
      for (const p of parts) {
        if (p.type === "tool_result" && p.toolCallId) {
          map[p.toolCallId] = p;
        }
      }
    }
    return map;
  }, [partsByMessage]);

  const rendered = useMemo<RenderedMessage[]>(() => {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: partsByMessage[m.id] ?? [],
        fallbackContent: m.content ?? ""
      }));
  }, [messages, partsByMessage]);

  // Identify the very last assistant message — that's the only one that
  // gets the "Execute as Agent" button when we're in plan mode. Older
  // assistant turns in the same conversation stay button-less so the
  // user doesn't accidentally re-dispatch a stale plan.
  const lastAssistantMessageId = useMemo(() => {
    for (let i = rendered.length - 1; i >= 0; i--) {
      if (rendered[i].role === "assistant") return rendered[i].id;
    }
    return null;
  }, [rendered]);

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 pb-4">
      {rendered.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          youLabel={youLabel}
          assistantLabel={assistantLabel}
          reasoningLabel={reasoningLabel}
          toolRunsById={toolRunsById}
          resultByToolCallId={resultByToolCallId}
          currentModeId={currentModeId}
          isLastAssistant={m.id === lastAssistantMessageId}
          onExecuteAsAgent={onExecuteAsAgent}
          streamingInProgress={streamingInProgress}
          planExecuteLabel={planExecuteLabel}
          planEditHint={planEditHint}
          planClarifyHint={planClarifyHint}
          onPrefillComposer={onPrefillComposer}
        />
      ))}
    </div>
  );
}

function MessageRow({
  message,
  youLabel,
  assistantLabel,
  reasoningLabel,
  toolRunsById,
  resultByToolCallId,
  currentModeId,
  isLastAssistant,
  onExecuteAsAgent,
  streamingInProgress,
  planExecuteLabel,
  planEditHint,
  planClarifyHint,
  onPrefillComposer
}: {
  message: RenderedMessage;
  youLabel: string;
  assistantLabel: string;
  reasoningLabel: string;
  toolRunsById?: Record<string, AgentToolRun>;
  resultByToolCallId: Record<string, AgentMessagePart>;
  currentModeId?: string;
  isLastAssistant?: boolean;
  onExecuteAsAgent?: (planText: string) => void;
  streamingInProgress?: boolean;
  planExecuteLabel?: string;
  planEditHint?: string;
  planClarifyHint?: string;
  onPrefillComposer?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const isPlanMode = currentModeId === "plan";
  const toolResultParts = message.parts.filter((p) => p.type === "tool_result");
  const textParts = message.parts.filter((p) => p.type === "text");
  const reasoningParts = message.parts.filter((p) => p.type === "reasoning");
  const toolUseParts = message.parts.filter((p) => p.type === "tool_use");

  // Messages containing ONLY tool_results (no text/tool_use) are
  // runtime-synthesised follow-ups. We skip rendering them since
  // results are now shown inline within the preceding ToolUseCard.
  const hasOnlyToolResults =
    toolResultParts.length > 0 && textParts.length === 0 && toolUseParts.length === 0;
  if (hasOnlyToolResults) return null;

  const text =
    textParts.length > 0
      ? textParts.map((p) => p.textContent ?? "").join("")
      : message.fallbackContent;
  const reasoning = reasoningParts.map((p) => p.textContent ?? "").join("");

  // User bubble
  if (isUser) {
    if (!text.trim()) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-[var(--lp-panel-2)] px-4 py-3 text-[14px] leading-relaxed text-[var(--lp-text)]">
          <div className="lp-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // Assistant bubble.
  //
  // IMPORTANT: render parts in their actual `seq` order, interleaving
  // text and tool_use blocks. The old implementation grouped them
  // ("all text first, then all tools"), which made the wrap-up summary
  // appear ABOVE tool cards that ran BEFORE it — i.e. it looked like
  // the agent "kept executing after declaring done". The DB already
  // returns parts ordered by seq ASC.
  //
  // We still:
  //  - collect reasoning into a single collapsible block at the top
  //  - skip tool_result parts (rendered inline inside ToolUseCard)
  //  - fall back to `message.fallbackContent` if no text parts exist
  const orderedParts = message.parts.filter(
    (p) => p.type !== "reasoning" && p.type !== "tool_result"
  );
  const hasAnyTextPart = textParts.length > 0;

  const planPanel =
    currentModeId === "plan" && text.trim()
      ? renderPlanAssistantContent(text, {
          streamingInProgress: isLastAssistant ? streamingInProgress : true,
          onExecuteAsAgent:
            isLastAssistant && onExecuteAsAgent ? onExecuteAsAgent : undefined,
          executeLabel: planExecuteLabel ?? "让 Agent 按此计划执行",
          editHint: planEditHint ?? "",
          hintReply: planClarifyHint ?? "",
          onPrefillComposer
        })
      : null;
  const showPlanAtEnd =
    planPanel !== null && (isPlanFinalPlan(text) || isPlanClarificationOnly(text));
  const toolParts = orderedParts.filter((p) => p.type === "tool_use");
  const planResearchStreaming =
    isPlanMode && isLastAssistant && streamingInProgress && !showPlanAtEnd;

  return (
    <div className="flex flex-col items-start gap-2">
      {reasoning ? <ReasoningBlock label={reasoningLabel} text={reasoning} /> : null}

      {orderedParts.length === 0 && !hasAnyTextPart && message.fallbackContent.trim() ? (
        <div className="max-w-full rounded-2xl px-1 py-1 text-[14px] leading-relaxed text-[var(--lp-text)]">
          <div className="lp-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.fallbackContent}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {isPlanMode && toolParts.length > 0 ? (
        <PlanResearchGroup
          parts={toolParts}
          toolRunsById={toolRunsById}
          resultByToolCallId={resultByToolCallId}
          defaultCollapsed={showPlanAtEnd}
          streaming={planResearchStreaming}
        />
      ) : null}

      {!isPlanMode ? orderedParts.map((p) => {
        if (p.type === "text") {
          const t = (p.textContent ?? "").trim();
          if (!t) return null;
          return (
            <div
              key={p.id}
              className="max-w-full rounded-2xl px-1 py-1 text-[14px] leading-relaxed text-[var(--lp-text)]"
            >
              <div className="lp-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.textContent ?? ""}</ReactMarkdown>
              </div>
            </div>
          );
        }
        if (p.type === "tool_use") {
          const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
          const result = p.toolCallId ? resultByToolCallId[p.toolCallId] ?? null : null;
          return (
            <ToolUseCard
              key={p.id}
              part={p}
              liveStatus={run?.status}
              resultPart={result}
            />
          );
        }
        return null;
      }) : null}

      {isPlanMode && !showPlanAtEnd
        ? orderedParts.map((p) => {
            if (p.type !== "text") return null;
            const t = (p.textContent ?? "").trim();
            if (!t) return null;
            return (
              <div
                key={p.id}
                className="max-w-full rounded-2xl px-1 py-1 text-[14px] leading-relaxed text-[var(--lp-text)]"
              >
                <div className="lp-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.textContent ?? ""}</ReactMarkdown>
                </div>
              </div>
            );
          })
        : null}

      {planPanel ? <div className="w-full">{planPanel}</div> : null}
    </div>
  );
}

function ReasoningBlock({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-[var(--lp-muted)] hover:bg-white/[0.04] transition"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
        <span>{label}</span>
      </button>
      {open ? (
        <div className="mt-1 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2">
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--lp-soft-text)]">
            {text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
