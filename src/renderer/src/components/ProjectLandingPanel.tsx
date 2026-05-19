import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatAttachment, Conversation, Project, ThinkBudget } from "@shared/types";
import { GitStatusModal } from "./modals/GitStatusModal";

interface ProjectLandingPanelProps {
  project: Project;
  /**
   * The conversation to attach the first message to. When `null`, the panel
   * will create a fresh conversation under `project` on first send. When
   * non-null (e.g. the user clicked an existing empty conversation under
   * this project), the panel reuses that conversation.
   */
  draftConversation: Conversation | null;
  /** Returns a usable Conversation; creates one if `draftConversation` is null. */
  onEnsureConversation: () => Promise<Conversation>;
  /** Owner orchestrates the IPC + state, same shape ChatPanel uses. */
  onStartStream: (params: {
    conversation: Conversation;
    userText: string;
    providerId: string;
    modelId: string;
    thinkBudget: ThinkBudget;
    thinkEnabled: boolean;
    modeId: string;
    attachments?: ChatAttachment[];
  }) => Promise<{ ok: true } | { ok: false; reason: string; message?: string }>;
  /** Notify owner that we just turned an empty draft into a real chat. */
  onConversationStarted: (conversation: Conversation) => void;
  /** Default model selection inherited from the App-level chat config. */
  defaultProviderId: string;
  defaultModelId: string;
  defaultThinkBudget: ThinkBudget;
  /** Fallback for `thinkEnabled` when the draft conversation row didn't
   *  capture an explicit value yet (see same prop on ChatPanel). */
  defaultThinkEnabled: boolean;
  activeModeId: string;
  /**
   * Rendered above the input — usually the same ModeSelector / ModelSelector
   * the ChatPanel uses, so the project page feels continuous with chat mode.
   */
  toolbar?: React.ReactNode;
}

/**
 * Project landing page — replaces the chat panel when the user opens a
 * project (clicks the project name in the sidebar) or opens an empty
 * conversation that lives under a project.
 *
 * Design intent:
 *   - The page is "project-first": top hero shows the project name + path,
 *     a short description explains we're scoped to that working directory.
 *   - A composer at the bottom lets the user start the first message; on
 *     submit we create (or reuse) a conversation under this project and
 *     hand control back to the parent, which will switch to ChatPanel.
 *   - Action chips ("项目档案 / 聊天频道 / Git") are placeholders for now;
 *     they're discoverable so we can wire them up incrementally without
 *     redoing the page layout.
 */
export function ProjectLandingPanel({
  project,
  draftConversation,
  onEnsureConversation,
  onStartStream,
  onConversationStarted,
  defaultProviderId,
  defaultModelId,
  defaultThinkBudget,
  defaultThinkEnabled,
  activeModeId,
  toolbar
}: ProjectLandingPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErrorMessage(null);
    try {
      const conv = draftConversation ?? (await onEnsureConversation());
      const res = await onStartStream({
        conversation: conv,
        userText: text,
        providerId: conv.providerId ?? defaultProviderId,
        modelId: conv.modelId ?? defaultModelId,
        thinkBudget: (conv.thinkBudget as ThinkBudget) ?? defaultThinkBudget,
        thinkEnabled: conv.thinkEnabled ?? defaultThinkEnabled,
        modeId: (conv.modeId as string) ?? activeModeId
      });
      if (!res.ok) {
        setErrorMessage(res.message ?? res.reason);
        setSending(false);
        return;
      }
      setDraft("");
      onConversationStarted(conv);
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleOpenFiles() {
    if (!project.path || !window.electronAPI?.openPath) return;
    const err = await window.electronAPI.openPath(project.path);
    if (err) setErrorMessage(err);
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Hero — minimal: just a centered description, like image 2.
          The project name already lives in the top header bar. */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-[720px] flex flex-col items-center">
          <div className="max-w-[480px] text-center text-[13px] leading-relaxed text-[var(--lp-soft-text)]">
            {t("projectLanding.hero")}
          </div>

          {/* Composer */}
          <div className="mt-6 w-full rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-panel)] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              className="block w-full resize-none bg-transparent px-2 py-2 text-[14px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("projectLanding.inputPlaceholder")}
              disabled={sending}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {toolbar}
                {/* Attachment placeholder (icon-only, like image 2). */}
                <ComposerIconButton
                  title={t("projectLanding.composerAttach")}
                  ariaLabel={t("projectLanding.composerAttach")}
                  disabled
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </ComposerIconButton>
                {/* Open project directory in OS file manager. */}
                <ComposerIconButton
                  title={t("projectLanding.composerOpenDir")}
                  ariaLabel={t("projectLanding.composerOpenDir")}
                  onClick={() => void handleOpenFiles()}
                  disabled={!project.path}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </ComposerIconButton>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="rounded-full bg-white/[0.04] px-2 py-1 text-[10.5px] font-medium text-[var(--lp-soft-text)] tabular-nums"
                  title={t("projectLanding.composerContextHint")}
                >
                  0%
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-[#151515] transition disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleSend()}
                  disabled={!draft.trim() || sending}
                >
                  {sending ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : null}
                  {t("projectLanding.start")}
                  {!sending ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  ) : null}
                </button>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-3 text-[12px] text-red-400">
              {errorMessage}
            </div>
          ) : null}

          {/* Action chips — Git only, per UX. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <ActionChip
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M6 21V9a9 9 0 0 0 9 9" />
                </svg>
              }
              label={t("projectLanding.actionGit")}
              title={t("projectLanding.actionGitHint")}
              onClick={() => setGitModalOpen(true)}
            />
          </div>
        </div>
      </div>

      {gitModalOpen ? (
        <GitStatusModal
          projectPath={project.path}
          projectName={project.name}
          onClose={() => setGitModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ComposerIconButton({
  children,
  title,
  ariaLabel,
  onClick,
  disabled
}: {
  children: React.ReactNode;
  title: string;
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lp-soft-text)] transition hover:bg-white/[0.06] hover:text-[var(--lp-text)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function ActionChip({
  icon,
  label,
  title,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3 py-1.5 text-[12.5px] text-[var(--lp-text)] transition hover:bg-[var(--lp-panel-2)]"
    >
      <span className="inline-flex h-4 w-4 items-center justify-center text-[var(--lp-soft-text)]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
