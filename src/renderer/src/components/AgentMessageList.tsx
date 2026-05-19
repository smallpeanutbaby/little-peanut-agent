/**
 * Block-based message renderer for agent runs.
 *
 * Reads `message_part` rows persisted by the runtime (one row per
 * content block: text, reasoning, tool_use, tool_result) and groups
 * them by message. Each message becomes either:
 *  - a "user" bubble (text + any tool_result blocks rendered as cards)
 *  - an "assistant" bubble (reasoning + text + tool_use cards)
 *
 * Markdown is rendered via `react-markdown` with GFM.
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

interface AgentMessageListProps {
  conversationId: string;
  /** Persisted message rows for the conversation, in order. The agent
   *  runtime already updates the row in real time; we just need to
   *  re-fetch parts when the stream produces new chunks. */
  messages: ChatMessage[];
  /** When non-null, the renderer reloads parts whenever the value
   *  changes (typically `liveStream.status` / `liveStream.text`). */
  liveSignal?: unknown;
  /** Optional running tool_run snapshots keyed by toolCallId — drives
   *  the spinner on the most recent ToolUseCard before tool_run_end
   *  fires. Not yet wired in M0; left undefined and the cards default
   *  to their persisted status. */
  toolRunsById?: Record<string, AgentToolRun>;
  youLabel: string;
  assistantLabel: string;
  reasoningLabel: string;
}

interface RenderedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: AgentMessagePart[];
  /** Fallback text (legacy rows without parts). */
  fallbackContent: string;
}

export function AgentMessageList({
  conversationId,
  messages,
  liveSignal,
  toolRunsById,
  youLabel,
  assistantLabel,
  reasoningLabel
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
    return () => {
      cancelled = true;
    };
    // re-load on stream tick AND when messages list changes
  }, [conversationId, liveSignal, messages.length]);

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

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      {rendered.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          youLabel={youLabel}
          assistantLabel={assistantLabel}
          reasoningLabel={reasoningLabel}
          toolRunsById={toolRunsById}
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
  toolRunsById
}: {
  message: RenderedMessage;
  youLabel: string;
  assistantLabel: string;
  reasoningLabel: string;
  toolRunsById?: Record<string, AgentToolRun>;
}) {
  const isUser = message.role === "user";
  // User messages with tool_result parts are runtime-synthesized
  // follow-ups; render the tool_result cards inline (no chat bubble).
  const toolResultParts = message.parts.filter((p) => p.type === "tool_result");
  const textParts = message.parts.filter((p) => p.type === "text");
  const reasoningParts = message.parts.filter((p) => p.type === "reasoning");
  const toolUseParts = message.parts.filter((p) => p.type === "tool_use");
  const hasOnlyToolResults =
    toolResultParts.length > 0 && textParts.length === 0 && toolUseParts.length === 0;

  if (hasOnlyToolResults) {
    return (
      <div className="flex flex-col items-start gap-2">
        {toolResultParts.map((p) => (
          <ToolResultCard key={p.id} part={p} />
        ))}
      </div>
    );
  }

  // Body content for the bubble = ordered text parts joined into one
  // markdown string (so e.g. "intro paragraph\n\n```py\n...\n```\n\nnext"
  // renders contiguously).
  const text =
    textParts.length > 0
      ? textParts.map((p) => p.textContent ?? "").join("")
      : message.fallbackContent;
  const reasoning = reasoningParts.map((p) => p.textContent ?? "").join("");

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div className="mb-1 text-[11px] text-[var(--lp-soft-text)]">
        {isUser ? youLabel : assistantLabel}
      </div>
      {reasoning ? (
        <details className="mb-1 max-w-[760px] rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-[12px] text-[var(--lp-soft-text)]">
          <summary className="cursor-pointer select-none text-[12px] text-[var(--lp-muted)]">
            {reasoningLabel}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed">
            {reasoning}
          </pre>
        </details>
      ) : null}
      {text ? (
        <div
          className={`max-w-[760px] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
            isUser
              ? "bg-[var(--lp-panel-2)] text-[var(--lp-text)]"
              : "bg-white/[0.03] text-[var(--lp-text)]"
          }`}
        >
          <div className="lp-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
      ) : null}
      {/* tool_use cards appear after the assistant text (matches the
          model's order of operations: think → say → call tool). */}
      {toolUseParts.length > 0 ? (
        <div className="mt-2 flex w-full max-w-[760px] flex-col gap-2">
          {toolUseParts.map((p) => {
            const run = p.toolCallId ? toolRunsById?.[p.toolCallId] : undefined;
            return <ToolUseCard key={p.id} part={p} liveStatus={run?.status} />;
          })}
        </div>
      ) : null}
    </div>
  );
}
