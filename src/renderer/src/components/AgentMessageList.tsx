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
import { ToolRunGroup } from "./AgentToolCards";
import { renderPlanAssistantContent } from "./PlanPanel";
import { PlanResearchGroup } from "./PlanResearchGroup";
import { isPlanClarificationOnly, isPlanFinalPlan } from "@shared/plan-ui";
import { formatMessageForDisplay } from "../utils/displayText";
import { useTranslation } from "react-i18next";

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
  /** Live tokens for the in-flight assistant row (DB parts lag behind IPC). */
  liveAssistantOverlay?: { text: string; reasoning: string };
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
  onPrefillComposer,
  liveAssistantOverlay
}: AgentMessageListProps) {
  const { i18n } = useTranslation();
  const displayLocale = i18n.language === "en" ? "en" : "zh";
  const [partsByMessage, setPartsByMessage] = useState<Record<string, AgentMessagePart[]>>({});

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.listAgentParts || !conversationId) return;
    let cancelled = false;

    const load = () => {
      void api.listAgentParts!(conversationId).then((parts) => {
        if (cancelled) return;
        const grouped: Record<string, AgentMessagePart[]> = {};
        for (const p of parts) {
          if (!grouped[p.messageId]) grouped[p.messageId] = [];
          grouped[p.messageId].push(p);
        }
        setPartsByMessage(grouped);
      });
    };

    load();
    if (!streamingInProgress) return () => { cancelled = true; };

    // Agent tool cards persist as message_part rows without bumping
    // liveStream text — poll while running so the UI (and scroll layout)
    // stays in sync.
    const id = window.setInterval(load, streamingInProgress ? 400 : 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [conversationId, liveSignal, messages.length, streamingInProgress]);

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
          displayLocale={displayLocale}
          liveAssistantOverlay={
            m.id === lastAssistantMessageId && streamingInProgress
              ? liveAssistantOverlay
              : undefined
          }
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
  onPrefillComposer,
  displayLocale,
  liveAssistantOverlay
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
  displayLocale: "zh" | "en";
  liveAssistantOverlay?: { text: string; reasoning: string };
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

  const rawText =
    textParts.length > 0
      ? textParts.map((p) => p.textContent ?? "").join("")
      : message.fallbackContent;
  const text = formatMessageForDisplay(rawText, displayLocale);
  const isErrorBubble = text.trim().startsWith("⚠️");
  const reasoning = formatMessageForDisplay(
    reasoningParts.map((p) => p.textContent ?? "").join(""),
    displayLocale
  );

  // User bubble
  if (isUser) {
    if (!text.trim()) return null;
    if (text.includes("【审查范围】") || text.includes("【Diff】")) {
      return <ReviewScopeUserBubble text={text} displayLocale={displayLocale} />;
    }
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

  const liveText =
    isLastAssistant && liveAssistantOverlay?.text ? liveAssistantOverlay.text : "";
  const liveReasoning =
    isLastAssistant && liveAssistantOverlay?.reasoning ? liveAssistantOverlay.reasoning : "";
  const displayReasoning = formatMessageForDisplay(
    liveReasoning.length > reasoning.length ? liveReasoning : reasoning,
    displayLocale
  );

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
  const displayLiveText = formatMessageForDisplay(liveText, displayLocale);
  const hasPersistedAssistantText = textParts.some((p) => (p.textContent ?? "").trim().length > 0);

  return (
    <div className="flex flex-col items-start gap-2">
      <ReasoningBlock
        label={reasoningLabel}
        text={displayReasoning}
        streaming={Boolean(isLastAssistant && streamingInProgress)}
        displayLocale={displayLocale}
      />

      {orderedParts.length === 0 && !hasAnyTextPart && text.trim() ? (
        <div
          className={`max-w-full rounded-2xl text-[14px] leading-relaxed ${
            isErrorBubble
              ? "border border-red-500/25 bg-red-500/8 px-4 py-3 text-[var(--lp-text)]"
              : "px-1 py-1 text-[var(--lp-text)]"
          }`}
        >
          {isErrorBubble ? (
            <p className="whitespace-pre-wrap">{text}</p>
          ) : (
            <div className="lp-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          )}
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

      {!isPlanMode
        ? segmentOrderedParts(orderedParts).map((seg, i) => {
            if (seg.kind === "text") {
              const t = formatMessageForDisplay(seg.part.textContent ?? "", displayLocale);
              if (!t.trim()) return null;
              const err = t.trim().startsWith("⚠️");
              return (
                <div
                  key={seg.part.id}
                  className={`max-w-full rounded-2xl text-[14px] leading-relaxed ${
                    err
                      ? "border border-red-500/25 bg-red-500/8 px-4 py-3 text-[var(--lp-text)]"
                      : "px-1 py-1 text-[var(--lp-text)]"
                  }`}
                >
                  {err ? (
                    <p className="whitespace-pre-wrap">{t}</p>
                  ) : (
                    <div className="lp-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <ToolRunGroup
                key={`tools-${seg.parts[0]?.id ?? i}`}
                parts={seg.parts}
                toolRunsById={toolRunsById}
                resultByToolCallId={resultByToolCallId}
                defaultCollapsed
                streaming={
                  !!streamingInProgress &&
                  seg.parts.some((p) => {
                    const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
                    return run?.status === "running" || run?.status === "pending";
                  })
                }
              />
            );
          })
        : null}

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

      {displayLiveText.trim() && !hasPersistedAssistantText ? (
        <div className="max-w-full rounded-2xl px-1 py-1 text-[14px] leading-relaxed text-[var(--lp-text)]">
          <div className="lp-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayLiveText}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {isLastAssistant &&
      streamingInProgress &&
      !displayReasoning.trim() &&
      !displayLiveText.trim() &&
      !hasPersistedAssistantText &&
      orderedParts.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-[var(--lp-soft-text)] animate-pulse">
          {displayLocale === "en" ? "Generating review…" : "正在生成审查意见…"}
        </p>
      ) : null}

      {planPanel ? <div className="w-full">{planPanel}</div> : null}
    </div>
  );
}

type OrderedPartSegment =
  | { kind: "text"; part: AgentMessagePart }
  | { kind: "tools"; parts: AgentMessagePart[] };

/** Split ordered parts into text blocks and consecutive tool_use runs. */
function segmentOrderedParts(parts: AgentMessagePart[]): OrderedPartSegment[] {
  const out: OrderedPartSegment[] = [];
  let toolBuf: AgentMessagePart[] = [];

  const flushTools = () => {
    if (toolBuf.length > 0) {
      out.push({ kind: "tools", parts: toolBuf });
      toolBuf = [];
    }
  };

  for (const p of parts) {
    if (p.type === "tool_use") {
      toolBuf.push(p);
    } else if (p.type === "text") {
      flushTools();
      out.push({ kind: "text", part: p });
    }
  }
  flushTools();
  return out;
}

function ReasoningBlock({
  label,
  text,
  streaming,
  displayLocale
}: {
  label: string;
  text: string;
  streaming?: boolean;
  displayLocale: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const hasText = text.trim().length > 0;

  // Hooks must run unconditionally — early return below.
  useEffect(() => {
    if (streaming || hasText) setOpen(true);
  }, [streaming, hasText]);

  if (!hasText && !streaming) return null;

  return (
    <div className="w-full max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-[var(--lp-muted)] hover:bg-white/[0.04] transition"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
        <span>{label}</span>
        {streaming && !hasText ? (
          <span className="text-[11px] text-[var(--lp-soft-text)] animate-pulse">
            {displayLocale === "en" ? "Thinking…" : "正在思考…"}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2">
          {hasText ? (
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--lp-soft-text)]">
              {text}
            </pre>
          ) : streaming ? (
            <p className="text-[11.5px] text-[var(--lp-soft-text)] animate-pulse">
              {displayLocale === "en" ? "Waiting for model reasoning…" : "等待模型输出思考过程…"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Collapsed summary for the large review prompt (scope + diff). */
function ReviewScopeUserBubble({
  text,
  displayLocale
}: {
  text: string;
  displayLocale: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const scopeLine =
    text.match(/【审查范围】[^\n]*/)?.[0] ??
    (displayLocale === "en" ? "Code review scope" : "代码审查范围");
  const diffMatch = text.match(/【Diff】\s*([\s\S]*?)(?=\n【审查要求】|$)/);
  const diffBody = diffMatch?.[1]?.trim() ?? "";
  const diffLines = diffBody ? diffBody.split("\n").length : 0;
  const requirement =
    text.match(/【审查要求】\s*([^\n]+)/)?.[1]?.trim() ??
    (displayLocale === "en"
      ? "Review the changes above and list issues by severity."
      : "请对以上变更进行全面代码审查，按严重程度列出问题与改进建议。");

  return (
    <div className="flex justify-end">
      <div className="max-w-[min(75%,720px)] rounded-2xl bg-[var(--lp-panel-2)] px-4 py-3 text-[14px] text-[var(--lp-text)]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-[13px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
        >
          <span className="text-[10px]">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-[var(--lp-text)]">{scopeLine.replace(/^【审查范围】\s*/, "")}</span>
        </button>
        <p className="mt-2 text-[12px] text-[var(--lp-soft-text)]">
          {displayLocale === "en"
            ? `${diffLines > 0 ? `${diffLines} diff lines` : "Diff attached"} · tap to ${open ? "hide" : "show"}`
            : `${diffLines > 0 ? `${diffLines} 行 diff` : "已附加 diff"} · 点击${open ? "收起" : "展开"}`}
        </p>
        <p className="mt-1 text-[12px] text-[var(--lp-soft-text)]">
          {displayLocale === "en" ? "Requirement: " : "要求："}
          {requirement}
        </p>
        {open ? (
          <pre className="mt-3 max-h-[min(50vh,420px)] overflow-auto rounded-lg border border-[var(--lp-border)] bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-[var(--lp-soft-text)] whitespace-pre-wrap break-words">
            {diffBody || text}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
