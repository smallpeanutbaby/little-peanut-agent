import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatAttachment, ChatMessage, Conversation, ThinkBudget } from "@shared/types";

/** Per-attachment size hard cap (10 MB). Keeps SQLite happy. */
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_PREFIX = "image/";

/**
 * Reasons `readFileAsDataUrl` may reject — emitted as machine-readable codes
 * so the caller (which has the i18n `t` in scope) can translate at the UI
 * boundary instead of forcing this module-level helper to carry a translator.
 */
export type ReadFileReason =
  | { code: "unsupportedType"; type: string }
  | { code: "tooBig"; sizeMb: string }
  | { code: "readError" }
  | { code: "notDataUrl" };

function genAttachmentId(): string {
  return "att_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

/** Read a File → base64 data URL. Rejects when over the size cap or non-image. */
function readFileAsDataUrl(
  file: File
): Promise<{ ok: true; att: ChatAttachment } | { ok: false; reason: ReadFileReason }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith(ACCEPTED_MIME_PREFIX)) {
      resolve({ ok: false, reason: { code: "unsupportedType", type: file.type || "" } });
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      resolve({
        ok: false,
        reason: { code: "tooBig", sizeMb: (file.size / 1024 / 1024).toFixed(1) }
      });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, reason: { code: "readError" } });
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:")) {
        resolve({ ok: false, reason: { code: "notDataUrl" } });
        return;
      }
      resolve({
        ok: true,
        att: {
          id: genAttachmentId(),
          dataUrl,
          mimeType: file.type,
          name: file.name,
          size: file.size
        }
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A live, observable stream state for a single conversation. Owned by App.tsx
 * and passed in here so the IPC subscription survives navigation away from
 * this panel.
 */
export interface ChatStreamSnapshot {
  status: "streaming" | "done" | "error";
  text: string;
  reasoning: string;
  errorMessage?: string;
  /** ID of the assistant placeholder row in DB; matches `messages[i].id`. */
  assistantMessageId: string;
}

interface ChatPanelProps {
  conversation: Conversation | null;
  /** Called once the panel decides it needs a fresh conversation (on first user send). */
  onEnsureConversation: () => Promise<Conversation>;
  /** Notify parent (sidebar / list) to re-fetch conversations + previews. */
  onConversationsChanged?: () => void;
  /** Default model selection used when the conversation hasn't overridden it. */
  defaultProviderId: string;
  defaultModelId: string;
  defaultThinkBudget: ThinkBudget;
  /** Active chat mode id; forwarded to chat:start-stream so the main process can inject systemPrompt. */
  activeModeId: string;
  /** Live snapshot of any in-progress stream for the active conversation. */
  liveStream?: ChatStreamSnapshot;
  /** Called when the user clicks Send. Owner orchestrates the IPC + state. */
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
  /** Cancel an active stream for this conversation. */
  onCancelStream: (conversationId: string) => void;
  /**
   * Re-run the assistant pipeline for a failed message (empty placeholder
   * or ⚠️ error marker). The owner deletes the failed row + spawns a new
   * stream against the existing user message.
   */
  onRetryStream?: (params: { conversation: Conversation; failedAssistantId: string }) => Promise<{ ok: true } | { ok: false; reason: string; message?: string }>;
  /** UI labels (i18n-ready). */
  labels: {
    heroTitle: string;
    heroSubtitle: string;
    inputPlaceholder: string;
    start: string;
    stop: string;
    sending: string;
    apiKeyMissing: string;
    deliveryError: string;
    emptyState: string;
    you: string;
    assistant: string;
    thinking: string;
    retry: string;
    retryFailed: string;
  };
  /** Children rendered above the textarea (typically the model selector / mode menu). */
  toolbar: React.ReactNode;
}

/**
 * A self-contained chat panel:
 * - Renders message list (auto-scrolls)
 * - Delegates streaming + cancellation to the owner via callbacks
 * - Overlays live stream content onto the persisted assistant placeholder
 */
export function ChatPanel({
  conversation,
  onEnsureConversation,
  onConversationsChanged,
  defaultProviderId,
  defaultModelId,
  defaultThinkBudget,
  activeModeId,
  liveStream,
  onStartStream,
  onCancelStream,
  onRetryStream,
  labels,
  toolbar
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Whether to render assistant reasoning. Persisted in app_meta via ui-prefs.
  const [showThinking, setShowThinking] = useState(false);
  /** Image attachments staged for the next send. Cleared after a successful send. */
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  /** Visual highlight while user drags files over the composer. */
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Auto-grow textarea between MIN_H and MAX_H.
   *
   * MIN_H starts as a comfortable single-line composer (matches Cursor /
   * Claude / ChatGPT defaults) — it grows naturally as the user types and
   * caps at MAX_H so it never eats the entire chat view.
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MIN_H = 44;   // ~1 line + comfortable padding
    const MAX_H = 240;  // ~8 lines max
    el.style.height = "auto";
    el.style.height = Math.min(MAX_H, Math.max(MIN_H, el.scrollHeight)) + "px";
  }, [input]);

  /** Append an array of File objects as attachments, surfacing rejections inline. */
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const accepted: ChatAttachment[] = [];
      const reasons: string[] = [];
      for (const f of files) {
        const r = await readFileAsDataUrl(f);
        if (r.ok) {
          accepted.push(r.att);
          continue;
        }
        const reasonText = (() => {
          switch (r.reason.code) {
            case "unsupportedType":
              return t("chatPanel.attachUnsupported", {
                type: r.reason.type || t("chatPanel.attachUnknown")
              });
            case "tooBig":
              return t("chatPanel.attachTooBig", { size: r.reason.sizeMb });
            case "readError":
              return t("chatPanel.attachReadError");
            case "notDataUrl":
              return t("chatPanel.attachReadNotDataUrl");
          }
        })();
        reasons.push(`${f.name}: ${reasonText}`);
      }
      if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
      if (reasons.length > 0) setError(reasons.join("；"));
    },
    [t]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const streaming = liveStream?.status === "streaming";

  // Hydrate showThinking preference from SQLite on mount.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUiPref) return;
    void api.getUiPref("chat.showThinking").then((raw) => {
      if (raw === "true") setShowThinking(true);
    });
  }, []);

  const toggleShowThinking = useCallback(() => {
    setShowThinking((prev) => {
      const next = !prev;
      const api = window.electronAPI;
      if (api?.setUiPref) void api.setUiPref("chat.showThinking", next ? "true" : "false");
      return next;
    });
  }, []);

  // Load persisted messages whenever the active conversation changes. Also
  // re-load when a live stream completes so the final DB content overlays
  // any in-flight UI state cleanly.
  useEffect(() => {
    if (!conversation || !window.electronAPI?.listMessages) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.listMessages(conversation.id).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });
    return () => { cancelled = true; };
  }, [conversation?.id, liveStream?.status]);

  // Auto-scroll to bottom when messages or stream content change.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveStream?.text, liveStream?.reasoning, streaming]);

  /**
   * Merge persisted messages with the live stream snapshot: when a stream is
   * in flight, replace the placeholder assistant's empty content with the
   * accumulated tokens so the user sees progressive output.
   */
  const renderedMessages = useMemo(() => {
    if (!liveStream || !liveStream.assistantMessageId) return messages;
    return messages.map((m) => {
      if (m.id !== liveStream.assistantMessageId) return m;
      return {
        ...m,
        content: liveStream.text || m.content,
        reasoning: liveStream.reasoning || m.reasoning
      };
    });
  }, [messages, liveStream]);

  const send = useCallback(async () => {
    const hasText = !!input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!hasText && !hasAttachments) || streaming) return;
    setError(null);

    // Decide provider/model to use for this send.
    const providerId = conversation?.providerId ?? defaultProviderId;
    const modelId = conversation?.modelId ?? defaultModelId;
    const thinkBudget = conversation?.thinkBudget ?? defaultThinkBudget;
    const thinkEnabled = conversation?.thinkEnabled ?? false;

    // Ensure we have a conversation row in DB.
    let conv = conversation;
    if (!conv) conv = await onEnsureConversation();

    const text = input.trim();
    const sentAttachments = attachments;
    setInput("");
    setAttachments([]);

    const result = await onStartStream({
      conversation: conv,
      userText: text,
      providerId,
      modelId,
      thinkBudget,
      thinkEnabled,
      modeId: activeModeId,
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined
    });
    if (!result.ok) {
      const map: Record<string, string> = {
        "no-api": labels.deliveryError,
        "no-provider": labels.deliveryError,
        "no-key": labels.apiKeyMissing,
        "send-failed": result.message || labels.deliveryError
      };
      setError(map[result.reason] || labels.deliveryError);
      // Restore the input + attachments so the user can retry / edit.
      setInput(text);
      setAttachments(sentAttachments);
      return;
    }
    onConversationsChanged?.();
  }, [input, attachments, streaming, conversation, defaultProviderId, defaultModelId, defaultThinkBudget, activeModeId, onEnsureConversation, onStartStream, onConversationsChanged, labels]);

  const cancel = useCallback(() => {
    if (conversation) onCancelStream(conversation.id);
  }, [conversation, onCancelStream]);

  // Surface stream-level errors into the input bar.
  useEffect(() => {
    if (liveStream?.status === "error" && liveStream.errorMessage) {
      setError(liveStream.errorMessage);
    }
  }, [liveStream?.status, liveStream?.errorMessage]);

  // Don't flash the hero/empty state while a stream is actively producing
  // tokens — even if `conversation` momentarily drops, the user is mid-reply
  // and seeing "开始一段对话" would be confusing. Trace the suspicious cases
  // so we can hunt down upstream null writes.
  const suppressEmptyForStream = streaming || (liveStream?.text?.length ?? 0) > 0;
  const isEmpty = renderedMessages.length === 0 && !suppressEmptyForStream;
  if (suppressEmptyForStream && !conversation) {
    console.warn("[lp/chat-panel] streaming with no conversation prop — upstream desync");
  }

  const groupedMessages = useMemo(() => renderedMessages.filter((m) => m.role !== "system"), [renderedMessages]);

  /**
   * Identify the most recent failed assistant message — i.e. the conversation
   * tail is an assistant row that has either empty content (placeholder that
   * never received any tokens) or starts with the ⚠️ marker the main process
   * writes on error. Only meaningful when no stream is currently in flight.
   */
  const failedAssistantId = useMemo(() => {
    if (streaming || groupedMessages.length === 0) return null;
    const tail = groupedMessages[groupedMessages.length - 1];
    if (tail.role !== "assistant") return null;
    const content = (tail.content ?? "").trim();
    const isEmptyPlaceholder = content.length === 0;
    const isErrorMarker = content.startsWith("⚠️");
    if (!isEmptyPlaceholder && !isErrorMarker) return null;
    return tail.id;
  }, [groupedMessages, streaming]);

  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (!onRetryStream || !conversation || !failedAssistantId || retrying || streaming) return;
    setError(null);
    setRetrying(true);
    try {
      const result = await onRetryStream({ conversation, failedAssistantId });
      if (!result.ok) {
        const map: Record<string, string> = {
          "no-api": labels.deliveryError,
          "no-provider": labels.deliveryError,
          "no-key": labels.apiKeyMissing,
          "send-failed": result.message || labels.retryFailed
        };
        setError(map[result.reason] || labels.retryFailed);
      }
    } finally {
      setRetrying(false);
    }
  }, [onRetryStream, conversation, failedAssistantId, retrying, streaming, labels]);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Message list (or hero). Spacing below is generous enough that
          messages don't visually crash into the composer card. */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
        {isEmpty ? (
          <div className="mx-auto flex h-full max-w-[860px] flex-col items-center justify-center text-center">
            <h1 className="text-[28px] font-semibold text-[var(--lp-text)]">{labels.heroTitle}</h1>
            <p className="mt-2 text-[15px] text-[var(--lp-soft-text)]">{labels.heroSubtitle}</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[860px] flex-col gap-5">
            {groupedMessages.map((m, idx) => {
              const isLastAssistant = idx === groupedMessages.length - 1 && m.role === "assistant";
              const isFailedTail = m.id === failedAssistantId;
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  youLabel={labels.you}
                  assistantLabel={labels.assistant}
                  reasoningLabel={labels.thinking}
                  showThinking={showThinking}
                  isStreaming={streaming && isLastAssistant}
                  isFailed={isFailedTail}
                  retrying={isFailedTail && retrying}
                  retryLabel={labels.retry}
                  onRetry={isFailedTail ? handleRetry : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Composer area — no harsh divider, no overlay fade (a translucent
          fade ended up drawing a visible "strikethrough" band on top of the
          last message). Just clean spacing keeps the empty-state look from
          image 2 consistent when there are messages. */}
      <div className="relative px-6 pb-5 pt-3">
        <div className="mx-auto w-full max-w-[860px]">
          {error ? (
            <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          ) : null}
          <div
            className={`relative overflow-hidden rounded-[20px] border bg-[var(--lp-panel)] shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition focus-within:border-[var(--lp-text)]/30 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.32)] ${
              dragOver ? "border-blue-400/60 ring-2 ring-blue-400/30" : "border-[var(--lp-border)]"
            }`}
            onDragOver={(e) => {
              if (!e.dataTransfer?.types?.includes?.("Files")) return;
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDragOver(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer?.files?.length) return;
              e.preventDefault();
              setDragOver(false);
              void addFiles(Array.from(e.dataTransfer.files));
            }}
            onClick={(e) => {
              // Clicking anywhere on the empty area of the box should focus the
              // textarea — makes the whole box feel like one cohesive control.
              if (e.target === e.currentTarget) textareaRef.current?.focus();
            }}
          >
            {/* Top zone: attachments + textarea — flows seamlessly into the
                toolbar below (no inner divider strip). */}
            <div
              className="px-4 pt-3 pb-1"
              onClick={(e) => {
                if (e.target === e.currentTarget) textareaRef.current?.focus();
              }}
            >
              {/* Attachment thumbnails — inline above the textarea */}
              {attachments.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="group relative h-14 w-14 overflow-hidden rounded-lg border border-[var(--lp-border)] bg-black/30"
                      title={`${att.name ?? "image"}${att.size ? ` · ${(att.size / 1024).toFixed(1)} KB` : ""}`}
                    >
                      <img src={att.dataUrl} alt={att.name ?? "attachment"} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100"
                        title={t("chatPanel.removeAttachment")}
                        aria-label={t("chatPanel.removeAttachmentAria")}
                      >×</button>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Hidden file input — triggered by the paperclip button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void addFiles(files);
                  e.target.value = ""; // allow re-selecting the same file later
                }}
              />

              {/* Auto-growing textarea (1 line min → ~8 lines max) */}
              <textarea
                ref={textareaRef}
                rows={1}
                className="block max-h-[240px] min-h-[44px] w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-6 text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
                placeholder={attachments.length > 0 ? t("chatPanel.inputPlaceholderWithAttach") : labels.inputPlaceholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  // Intercept image paste (screenshots, copied images). Plain
                  // text paste falls through untouched.
                  const items = Array.from(e.clipboardData?.items ?? []);
                  const files: File[] = [];
                  for (const it of items) {
                    if (it.kind === "file") {
                      const f = it.getAsFile();
                      if (f && f.type.startsWith(ACCEPTED_MIME_PREFIX)) files.push(f);
                    }
                  }
                  if (files.length > 0) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                disabled={streaming}
              />
            </div>

            {/* Bottom zone: toolbar — integrated into the same card; no
                contrasting strip, no border line, just shared padding. */}
            <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[var(--lp-text)]/78">
                {/* Attach (paperclip) — same pill size as the toolbar buttons,
                    icon-only so it sits nicely next to the wider 对话/Moonshot pills. */}
                <button
                  type="button"
                  onClick={openFilePicker}
                  title={t("chatPanel.attachImageTitle")}
                  aria-label={t("chatPanel.attachImageAria")}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--lp-soft-text)] transition hover:bg-white/[0.06] hover:text-[var(--lp-text)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto lp-no-scrollbar">
                  {toolbar}
                  <button
                    type="button"
                    onClick={toggleShowThinking}
                    title={showThinking ? t("chatPanel.thinkingShownTitle") : t("chatPanel.thinkingHiddenTitle")}
                    className={`flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${
                      showThinking
                        ? "border-purple-500/40 bg-purple-500/20 text-purple-200"
                        : "border-[var(--lp-border)] bg-white/[0.02] text-[var(--lp-text)]/60 hover:bg-white/[0.06]"
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
                      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
                    </svg>
                    <span>{showThinking ? t("chatPanel.thinkingShownLabel") : t("chatPanel.thinkingHiddenLabel")}</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {streaming ? (
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3.5 text-[13px] font-medium text-red-300 hover:bg-red-500/20"
                  >
                    <span>{labels.stop}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!input.trim() && attachments.length === 0}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-medium text-[#151515] shadow-[0_4px_14px_rgba(255,255,255,0.08)] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                  >
                    <span>{labels.start}</span>
                    <span>→</span>
                  </button>
                )}
              </div>
            </div>

            {/* Drag-over overlay hint */}
            {dragOver ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[20px] bg-blue-500/10 text-[13px] font-medium text-blue-300">
                {t("chatPanel.dropToUpload")}
              </div>
            ) : null}
          </div>
          {/* Keyboard hint — always shown so the composer has a stable
              visual footer (matches the empty-state look from image 2). */}
          <div className="mt-2 text-center text-[11px] text-[var(--lp-soft-text)]">{labels.emptyState}</div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, youLabel, assistantLabel, reasoningLabel, showThinking, isStreaming, isFailed, retrying, retryLabel, onRetry }: {
  message: ChatMessage;
  youLabel: string;
  assistantLabel: string;
  reasoningLabel: string;
  showThinking: boolean;
  isStreaming: boolean;
  isFailed?: boolean;
  retrying?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const hasContent = !!message.content;
  const hasAttachments = !!message.attachments && message.attachments.length > 0;
  const content = (message.content ?? "").trim();
  const isErrorMarker = !isUser && content.startsWith("⚠️");
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div className="mb-1 text-[11px] text-[var(--lp-soft-text)]">{isUser ? youLabel : assistantLabel}</div>
      {showThinking && message.reasoning ? (
        <details className="mb-1 max-w-[760px] rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-[12px] text-[var(--lp-soft-text)]">
          <summary className="cursor-pointer select-none text-[12px] text-[var(--lp-muted)]">{reasoningLabel}</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed">{message.reasoning}</pre>
        </details>
      ) : null}
      {/* Image attachments — rendered above the text bubble */}
      {hasAttachments ? (
        <div className={`mb-1 flex flex-wrap gap-2 max-w-[760px] ${isUser ? "justify-end" : "justify-start"}`}>
          {message.attachments!.map((att) => (
            <a
              key={att.id}
              href={att.dataUrl}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-[var(--lp-border)] bg-black/30"
              title={att.name ?? "image"}
            >
              <img
                src={att.dataUrl}
                alt={att.name ?? "attachment"}
                className="max-h-[280px] max-w-[280px] object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}
      {hasContent || isStreaming || !hasAttachments ? (
        <div
          className={`max-w-[760px] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
            isUser
              ? "bg-[var(--lp-panel-2)] text-[var(--lp-text)]"
              : isErrorMarker || isFailed
                ? "bg-red-500/8 text-[var(--lp-text)] border border-red-500/25"
                : "bg-white/[0.03] text-[var(--lp-text)]"
          }`}
        >
          {hasContent ? (
            <>
              {message.content}
              {isStreaming ? <BlinkingCaret /> : null}
            </>
          ) : isUser ? (
            // Image-only user message: no text bubble needed (image speaks for itself).
            hasAttachments ? null : ""
          ) : isStreaming ? (
            <TypingDots />
          ) : isFailed ? (
            <span className="text-red-300/90">{t("chatPanel.errReplyBadge")}</span>
          ) : (
            <span className="text-[var(--lp-soft-text)]">…</span>
          )}
        </div>
      ) : null}
      {isFailed && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-white/[0.04] px-3 py-1 text-[12px] text-[var(--lp-text)]/85 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={retryLabel}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={retrying ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>{retrying ? t("chatPanel.retrying") : (retryLabel ?? t("chatPanel.retry"))}</span>
        </button>
      ) : null}
    </div>
  );
}

/** Three pulsing dots, shown while the assistant is generating and no text has arrived yet. */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="generating">
      <span className="lp-typing-dot" style={{ animationDelay: "0ms" }} />
      <span className="lp-typing-dot" style={{ animationDelay: "160ms" }} />
      <span className="lp-typing-dot" style={{ animationDelay: "320ms" }} />
    </span>
  );
}

/** A blinking text cursor appended to streaming text, similar to ChatGPT. */
function BlinkingCaret() {
  return <span className="lp-caret" aria-hidden="true" />;
}
