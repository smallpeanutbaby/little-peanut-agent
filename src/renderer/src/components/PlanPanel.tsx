/**
 * Plan-mode UI aligned with Cursor Plan: clarify → research (collapsed) → plan doc → Build.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  extractPlanEditableBody,
  extractSection,
  getPlanUiPhase,
  isPlanClarificationOnly,
  isPlanFinalPlan,
  parsePlanClarifyQuestions,
  parsePlanFilePaths,
  parsePlanSteps
} from "@shared/plan-ui";

const PLAN_CONTEXT_HEADINGS = ["任务理解", "现有架构分析"] as const;

const PHASE_LABEL: Record<ReturnType<typeof getPlanUiPhase>, string> = {
  investigating: "调研中",
  clarifying: "待确认",
  plan_ready: "方案已定"
};

interface PlanClarifyPanelProps {
  markdown: string;
  hintReply: string;
  onPrefillComposer?: (text: string) => void;
}

export function PlanClarifyPanel({ markdown, hintReply, onPrefillComposer }: PlanClarifyPanelProps) {
  const summary = extractSection(markdown, "调研摘要");
  const questions = useMemo(() => parsePlanClarifyQuestions(markdown), [markdown]);

  return (
    <div className="w-full max-w-full overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--lp-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px]" aria-hidden>
            📐
          </span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--lp-text)]">需要先确认几件事</div>
            <div className="text-[12px] text-[var(--lp-muted)]">回答后才会生成完整实施方案</div>
          </div>
        </div>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200">
          {PHASE_LABEL.clarifying}
        </span>
      </div>

      {summary ? (
        <div className="border-b border-[var(--lp-border)] px-4 py-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--lp-muted)]">
            调研摘要
          </div>
          <div className="lp-markdown text-[13px] text-[var(--lp-text)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <ol className="flex flex-col gap-2 px-4 py-3">
          {questions.map((q, idx) => (
            <li
              key={q.id}
              className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="text-[13px] font-medium text-[var(--lp-text)]">
                {idx + 1}. {q.title}
              </div>
              {q.prompt ? (
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--lp-muted)]">{q.prompt}</p>
              ) : null}
              {q.options.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.options.map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => onPrefillComposer?.(`${q.title}：${opt}`)}
                      className="rounded-md border border-[var(--lp-border)] bg-white/[0.04] px-2 py-1 text-[12px] text-[var(--lp-text)] hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="lp-markdown px-4 py-3 text-[13px] text-[var(--lp-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--lp-border)] bg-white/[0.02] px-4 py-2.5">
        <p className="text-[12px] text-[var(--lp-muted)]">{hintReply}</p>
        {onPrefillComposer ? (
          <button
            type="button"
            onClick={() => onPrefillComposer("直接出方案")}
            className="rounded-md border border-[var(--lp-border)] px-2.5 py-1 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.06]"
          >
            跳过，直接出方案
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PlanContextSection({ heading, body }: { heading: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-[var(--lp-text)] hover:bg-white/[0.03]"
      >
        <span className="text-[10px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
        <span>{heading}</span>
      </button>
      {open ? (
        <div className="lp-markdown border-t border-[var(--lp-border)] px-3 py-2 text-[12.5px] text-[var(--lp-soft-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      ) : null}
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
  const [editing, setEditing] = useState(false);
  const phase = getPlanUiPhase(markdown, !!streamingInProgress);

  useEffect(() => {
    setDraft(markdown);
  }, [markdown]);

  const contextSections = useMemo(
    () =>
      PLAN_CONTEXT_HEADINGS.map((heading) => ({
        heading,
        body: extractSection(markdown, heading)
      })).filter((s): s is { heading: string; body: string } => !!s.body),
    [markdown]
  );

  const steps = useMemo(() => parsePlanSteps(markdown), [markdown]);
  const filePaths = useMemo(() => parsePlanFilePaths(markdown), [markdown]);
  const editableBody = useMemo(() => extractPlanEditableBody(markdown), [markdown]);
  const previewSource = editing ? draft : draft;

  return (
    <div className="w-full max-w-full overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel)] shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--lp-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px]" aria-hidden>
            📐
          </span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--lp-text)]">实施方案</div>
            <div className="text-[12px] text-[var(--lp-muted)]">{editHint}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
            {PHASE_LABEL[phase]}
          </span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-[var(--lp-border)] px-2 py-1 text-[11px] text-[var(--lp-muted)] hover:bg-white/[0.04]"
          >
            {editing ? "预览" : "编辑"}
          </button>
        </div>
      </div>

      <div className="max-h-[min(52vh,520px)] overflow-y-auto px-4 py-3">
        {contextSections.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2">
            {contextSections.map((s) => (
              <PlanContextSection key={s.heading} heading={s.heading} body={s.body} />
            ))}
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className="mb-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--lp-muted)]">
              执行步骤
            </div>
            <ol className="flex flex-col gap-1.5">
              {steps.map((step, i) => (
                <li
                  key={step.id}
                  className="flex gap-2.5 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-[13px] text-[var(--lp-text)]"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] text-[var(--lp-muted)]">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step.text}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {filePaths.length > 0 ? (
          <div className="mb-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--lp-muted)]">
              涉及文件
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filePaths.map((p) => (
                <span
                  key={p}
                  className="max-w-full truncate rounded-md border border-[var(--lp-border)] bg-black/20 px-2 py-0.5 font-mono text-[11px] text-[var(--lp-soft-text)]"
                  title={p}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[200px] w-full resize-y rounded-lg border border-[var(--lp-border)] bg-black/[0.18] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[var(--lp-text)] outline-none focus:border-white/25"
            spellCheck={false}
          />
        ) : (
          <div className="lp-markdown rounded-lg border border-[var(--lp-border)] bg-black/[0.12] px-3 py-2 text-[13px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {editableBody || previewSource}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {onExecuteAsAgent ? (
        <div className="border-t border-[var(--lp-border)] bg-[var(--lp-panel-2)]/80 px-4 py-3">
          <button
            type="button"
            disabled={streamingInProgress || !draft.trim()}
            onClick={() => onExecuteAsAgent(draft)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--lp-text)] px-4 py-2.5 text-[14px] font-semibold text-[#151515] transition hover:bg-white/90 disabled:opacity-40"
          >
            <span aria-hidden>⚡</span>
            <span>{executeLabel}</span>
          </button>
          <p className="mt-2 text-center text-[11px] text-[var(--lp-muted)]">
            将切换到 Agent 模式并按此方案修改项目文件
          </p>
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
    onPrefillComposer?: (text: string) => void;
  }
): ReactNode | null {
  const text = markdown.trim();
  if (!text) return null;
  if (isPlanClarificationOnly(text)) {
    return (
      <PlanClarifyPanel
        markdown={text}
        hintReply={opts.hintReply}
        onPrefillComposer={opts.onPrefillComposer}
      />
    );
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
