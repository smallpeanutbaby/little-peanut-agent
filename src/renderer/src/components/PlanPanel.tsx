/**
 * Dedicated Plan-mode UI (Cursor-inspired): clarification Q&A cards and
 * an editable plan document with a single "Execute as Agent" action.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  extractSection,
  isPlanClarificationOnly,
  isPlanFinalPlan,
  parsePlanClarifyQuestions
} from "@shared/plan-ui";

interface PlanClarifyPanelProps {
  markdown: string;
  hintReply: string;
}

export function PlanClarifyPanel({ markdown, hintReply }: PlanClarifyPanelProps) {
  const summary = extractSection(markdown, "调研摘要");
  const questions = useMemo(() => parsePlanClarifyQuestions(markdown), [markdown]);

  return (
    <div className="w-full max-w-full rounded-xl border border-sky-400/30 bg-sky-500/[0.06] p-4 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]">
      <div className="mb-3 flex items-center gap-2 border-b border-sky-400/20 pb-3">
        <span className="text-lg" aria-hidden>
          📐
        </span>
        <div>
          <div className="text-[14px] font-semibold text-[var(--lp-text)]">计划模式 · 待你确认</div>
          <div className="text-[12px] text-[var(--lp-muted)]">
            先回答下面问题，定稿后才会生成完整实施方案
          </div>
        </div>
      </div>

      {summary ? (
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-sky-300/90">
            调研摘要
          </div>
          <div className="lp-markdown rounded-lg bg-black/[0.15] px-3 py-2 text-[13px] text-[var(--lp-text)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {questions.map((q, idx) => (
            <li
              key={q.id}
              className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)]/60 px-3 py-2.5"
            >
              <div className="text-[13px] font-medium text-[var(--lp-text)]">
                {idx + 1}. {q.title}
              </div>
              {q.prompt ? (
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--lp-muted)]">{q.prompt}</p>
              ) : null}
              {q.options.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {q.options.map((opt, oi) => (
                    <li
                      key={oi}
                      className="rounded-md bg-white/[0.04] px-2 py-1 text-[12px] text-[var(--lp-text)]"
                    >
                      {opt}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="lp-markdown text-[13px] text-[var(--lp-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}

      <p className="mt-4 text-[12px] text-sky-300/80">{hintReply}</p>
    </div>
  );
}

interface PlanDocumentPanelProps {
  markdown: string;
  streamingInProgress?: boolean;
  onExecuteAsAgent?: (planText: string) => void;
  executeLabel: string;
  editHint: string;
}

export function PlanDocumentPanel({
  markdown,
  streamingInProgress,
  onExecuteAsAgent,
  executeLabel,
  editHint
}: PlanDocumentPanelProps) {
  const [draft, setDraft] = useState(markdown);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setDraft(markdown);
  }, [markdown]);

  return (
    <div className="w-full max-w-full rounded-xl border border-sky-400/35 bg-gradient-to-b from-sky-500/[0.08] to-transparent p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-sky-400/20 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            📐
          </span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--lp-text)]">实施方案</div>
            <div className="text-[12px] text-[var(--lp-muted)]">{editHint}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          className="rounded-md border border-[var(--lp-border)] px-2 py-1 text-[11px] text-[var(--lp-muted)] hover:bg-white/[0.04]"
        >
          {preview ? "编辑" : "预览"}
        </button>
      </div>

      {preview ? (
        <div className="lp-markdown max-h-[420px] overflow-auto rounded-lg border border-[var(--lp-border)] bg-black/[0.12] px-3 py-2 text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[280px] w-full resize-y rounded-lg border border-[var(--lp-border)] bg-black/[0.18] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[var(--lp-text)] outline-none focus:border-sky-400/50"
          spellCheck={false}
        />
      )}

      {onExecuteAsAgent ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={streamingInProgress || !draft.trim()}
            onClick={() => onExecuteAsAgent(draft)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-[13px] font-medium text-[var(--lp-text)] transition hover:bg-sky-500/30 disabled:opacity-40"
          >
            <span aria-hidden>⚡</span>
            <span>{executeLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function renderPlanAssistantContent(
  markdown: string,
  opts: {
    streamingInProgress?: boolean;
    onExecuteAsAgent?: (planText: string) => void;
    executeLabel: string;
    editHint: string;
    hintReply: string;
  }
): ReactNode | null {
  const text = markdown.trim();
  if (!text) return null;
  if (isPlanClarificationOnly(text)) {
    return <PlanClarifyPanel markdown={text} hintReply={opts.hintReply} />;
  }
  if (isPlanFinalPlan(text)) {
    return (
      <PlanDocumentPanel
        markdown={text}
        streamingInProgress={opts.streamingInProgress}
        onExecuteAsAgent={opts.onExecuteAsAgent}
        executeLabel={opts.executeLabel}
        editHint={opts.editHint}
      />
    );
  }
  return null;
}
