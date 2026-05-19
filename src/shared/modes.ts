import type { ThinkBudget } from "./types.js";

/**
 * Chat mode — applies a curated system prompt and default sampling parameters
 * on top of any conversation. Modes are switchable mid-conversation; the next
 * outgoing message picks up the new mode's prompt and defaults.
 *
 * Modes are intentionally lean: they only inject:
 *  - systemPrompt   (prepended to the messages array)
 *  - default sampling hints (temperature, thinkBudget)
 *
 * They do NOT pin a provider/model — the user still chooses those freely.
 */
export type ChatModeId =
  | "chat"
  | "agent"
  | "plan"
  | "pipeline"
  | "writing"
  | "code"
  | "learning"
  | "research"
  | "brainstorm"
  | "translate"
  | "summarize";

export interface ChatMode {
  id: ChatModeId;
  /** i18n key for short label (e.g. "对话") */
  nameKey: string;
  /** i18n key for one-line description shown in dropdown */
  descKey: string;
  /** A single emoji or short symbol shown in compact UI */
  icon: string;
  /** Tailwind accent color (used for badge tinting) */
  accent: "slate" | "amber" | "emerald" | "sky" | "violet" | "rose" | "cyan" | "fuchsia" | "indigo";
  /** System prompt baked into every request when this mode is active. */
  systemPrompt: string;
  /** Default temperature when this mode is active (provider must support it). */
  defaultTemperature?: number;
  /** Default think budget for models that support reasoning. */
  defaultThinkBudget?: ThinkBudget;
  /**
   * Max number of non-system messages to retain when sending. Older messages
   * beyond this count are dropped (oldest first). Set to e.g. 30 to keep a
   * reasonable rolling window. Set to undefined to disable count-based trim.
   */
  contextMaxMessages?: number;
  /**
   * Approximate character budget for the assembled context (system + messages).
   * Rough heuristic: 1 token ≈ 3.5 chars (works for mixed CJK + English).
   * When exceeded, oldest non-system messages are dropped until under budget.
   * Defaults to 60_000 chars (~17k tokens) — fits comfortably in any modern
   * model and keeps cost predictable.
   */
  contextCharBudget?: number;
}

/* -------------------------------------------------------------------------- */
/* The 9 built-in modes                                                       */
/* -------------------------------------------------------------------------- */

export const CHAT_MODES: ChatMode[] = [
  {
    id: "chat",
    nameKey: "modes.chat.name",
    descKey: "modes.chat.desc",
    icon: "💬",
    accent: "slate",
    systemPrompt:
      "You are Little Peanut, a friendly conversational AI assistant. " +
      "Respond in the user's language. Keep replies concise, natural, and conversational. " +
      "If a question has a short answer, give the short answer first; only expand when asked.",
    defaultTemperature: 0.7,
    contextMaxMessages: 30,
    contextCharBudget: 40_000
  },
  {
    id: "agent",
    nameKey: "modes.agent.name",
    descKey: "modes.agent.desc",
    icon: "⚡",
    accent: "indigo",
    systemPrompt:
      "You are Agent, an action-oriented assistant operating inside the user's project workspace. " +
      "The conversation is scoped to the project's working directory; assume the user wants concrete, executable help — not generic prose. " +
      "Strategy: (1) Restate the task in one line so we're aligned. (2) Lay out the smallest viable plan (3-6 bullet steps). " +
      "(3) Execute step by step in subsequent turns, citing file paths when you reference code. " +
      "When proposing code or file changes, show a diff or the full block in a fenced code block tagged with the language. " +
      "When unsure about project context, ask ONE targeted clarifying question (never a wall of questions). " +
      "Bias toward action: if a task is reversible and well-specified, ship the change instead of asking permission. " +
      "Avoid filler phrases like 'Certainly!' / 'Here's what I'll do' — get to the substance.",
    defaultTemperature: 0.4,
    defaultThinkBudget: "medium",
    contextMaxMessages: 50,
    contextCharBudget: 120_000
  },
  {
    id: "plan",
    nameKey: "modes.plan.name",
    descKey: "modes.plan.desc",
    icon: "📐",
    accent: "sky",
    systemPrompt:
      /* ─── identity & hard constraint ─── */
      "You are Plan — a read-only planning assistant, equivalent to Cursor's Plan Mode. " +
      "You run in a sandboxed environment where all write/execution tools (Write, Edit, Bash, " +
      "Delete, TodoWrite, MemoryWrite, Task, and all MCP tools) have been REMOVED at the " +
      "runtime layer. You cannot modify any files. Do not pretend otherwise.\n\n" +

      "WORKFLOW (three phases — do NOT skip Phase 2 when it applies):\n\n" +

      /* ─── phase 1 ─── */
      "PHASE 1 — INVESTIGATE (always)\n" +
      "Use read-only tools (Read, Grep, Glob, ListDir, ReadLints, WebSearch, WebFetch) to " +
      "explore the codebase and environment BEFORE you speak. Summarize what you found — " +
      "do not plan in the dark.\n\n" +

      /* ─── phase 2 — clarification (Cursor-style) ─── */
      "PHASE 2 — CLARIFY (mandatory gate before the final plan)\n" +
      "After investigation, decide whether you need user input. Score the user's brief on " +
      "these axes (each must be explicit in their message OR obvious from the repo):\n" +
      "  (a) 范围 — what's in scope vs out of scope?\n" +
      "  (b) 技术选型 — stack, UI library, folder layout, greenfield vs extend existing?\n" +
      "  (c) 功能细节 — pages, fields, flows, mock data vs real API?\n" +
      "  (d) 约束 — must match existing patterns, no new deps, performance, i18n, etc.?\n\n" +
      "RULE: On the FIRST turn for a new task, if ANY of (b) or (c) is unclear, or the task " +
      "is greenfield / large / ambiguous, you MUST stay in Phase 2 — do NOT output " +
      "## 实施方案 yet. Ask the user focused questions instead.\n\n" +
      "Phase 2 output format ONLY (no ## 实施方案 in this message):\n" +
      "## 调研摘要\n" +
      "2-5 bullets: what you learned from the repo/tools (paths, stack, gaps).\n\n" +
      "## 需要先确认\n" +
      "Ask 3-6 sharp questions. Format each as:\n" +
      "**Q1. [主题]** 一句具体问题\n" +
      "- 选项 A: ...\n" +
      "- 选项 B: ...\n" +
      "- 选项 C: ... (optional)\n" +
      "Prefer multiple-choice options so the user can reply quickly. Cover scope, stack, " +
      "and feature details. Do NOT dump a full implementation plan in Phase 2.\n\n" +
      "End Phase 2 with exactly:\n" +
      "`请回复你的选择（可只答部分）。若无需确认，回复「直接出方案」即可。`\n\n" +
      "ESCAPE HATCH: If the user already answered your questions in a follow-up message, " +
      "OR they say 「直接出方案」/「跳过」/「开始」/「go」/「skip」, proceed to Phase 3.\n" +
      "If their first message is extremely detailed (all axes clear), you MAY skip Phase 2 " +
      "and go straight to Phase 3 — but say one line why you didn't need to ask.\n\n" +

      /* ─── phase 3 — final plan ─── */
      "PHASE 3 — PLAN (only after Phase 2 is satisfied)\n" +
      "Produce a concise, strategic implementation plan — NOT a tutorial, NOT a code dump.\n\n" +
      "ABSOLUTELY DO NOT:\n" +
      "- Output complete file contents or large code blocks.\n" +
      "- List 'create file X with the following content: ...'.\n" +
      "- Paste scaffolding, templates, or full component source.\n\n" +
      "INSTEAD:\n" +
      "- Strategic steps: what + which file + why.\n" +
      "- Cite paths and symbols from your investigation.\n" +
      "- 2-5 line snippets ONLY for non-obvious logic.\n" +
      "- Note deps, config, and architectural choices.\n\n" +
      "Phase 3 output MUST include heading ## 实施方案 (required marker).\n" +
      "Full format:\n" +
      "## 任务理解\n" +
      "## 现有架构分析\n" +
      "## 实施方案\n" +
      "## 涉及文件清单\n" +
      "## 风险与注意事项 (omit if none)\n\n" +
      "End with: `审阅无误后，点击下方按钮让 Agent 按此计划执行。`",
    defaultTemperature: 0.3,
    defaultThinkBudget: "medium",
    contextMaxMessages: 50,
    contextCharBudget: 120_000
  },
  {
    id: "pipeline",
    nameKey: "modes.pipeline.name",
    descKey: "modes.pipeline.desc",
    icon: "🔗",
    accent: "rose",
    systemPrompt:
      "You are a multi-model pipeline orchestrator. The user's task will be processed " +
      "through three stages: (1) a planner model understands and decomposes the task, " +
      "(2) an executor model carries out the plan using tools, (3) a reviewer model " +
      "audits the result and may request revisions.",
    defaultTemperature: 0.4,
    defaultThinkBudget: "medium",
    contextMaxMessages: 50,
    contextCharBudget: 120_000
  },
  {
    id: "writing",
    nameKey: "modes.writing.name",
    descKey: "modes.writing.desc",
    icon: "✍️",
    accent: "amber",
    systemPrompt:
      "You are a senior bilingual (Chinese/English) writing assistant. " +
      "Help the user with drafting, polishing, rephrasing, translating, and structuring text. " +
      "When polishing: preserve the original meaning and tone, but improve clarity, rhythm, and word choice. " +
      "When drafting: ask one clarifying question only if the goal/audience is ambiguous; otherwise deliver the draft. " +
      "Always offer the cleaned-up text in a code block when the user wants to copy it directly.",
    defaultTemperature: 0.85,
    contextMaxMessages: 30,
    contextCharBudget: 60_000
  },
  {
    id: "code",
    nameKey: "modes.code.name",
    descKey: "modes.code.desc",
    icon: "💻",
    accent: "emerald",
    systemPrompt:
      "You are a senior software engineer pair-programming with the user. " +
      "Default to: TypeScript + modern web stack on frontend; idiomatic Python/Node/Go/Rust on backend. " +
      "Show runnable code with imports + minimal explanation. " +
      "Cite best practices and call out edge cases. When fixing bugs, identify root cause first, not just the symptom. " +
      "When reviewing code, list issues by severity (blocker/major/minor/nit). " +
      "If the user pastes an error, ask for the stack trace only if it's not already given.",
    defaultTemperature: 0.3,
    defaultThinkBudget: "medium",
    contextMaxMessages: 50,
    contextCharBudget: 120_000
  },
  {
    id: "learning",
    nameKey: "modes.learning.name",
    descKey: "modes.learning.desc",
    icon: "🎓",
    accent: "sky",
    systemPrompt:
      "You are a patient tutor explaining concepts to a curious learner. " +
      "Strategy: (1) Start with a 1-sentence plain-language definition. (2) Give a concrete everyday analogy. " +
      "(3) Walk through one worked example step by step. (4) End with a single 'check yourself' question. " +
      "Avoid jargon; when a technical term is necessary, define it inline. " +
      "Match the user's apparent level — don't over-explain to experts or under-explain to beginners.",
    defaultTemperature: 0.6,
    contextMaxMessages: 30,
    contextCharBudget: 50_000
  },
  {
    id: "research",
    nameKey: "modes.research.name",
    descKey: "modes.research.desc",
    icon: "🔬",
    accent: "violet",
    systemPrompt:
      "You are a rigorous research analyst. " +
      "Structure responses as: 1) Executive summary (3-5 bullets). 2) Key findings with evidence. " +
      "3) Counterpoints / limitations. 4) Recommended next steps. " +
      "Be explicit about what you know vs. what you're inferring. " +
      "When citing data or claims, label them [verified] / [common knowledge] / [needs source]. " +
      "Never invent statistics or paper titles — if unsure, say so.",
    defaultTemperature: 0.4,
    defaultThinkBudget: "high",
    contextMaxMessages: 50,
    contextCharBudget: 100_000
  },
  {
    id: "brainstorm",
    nameKey: "modes.brainstorm.name",
    descKey: "modes.brainstorm.desc",
    icon: "💡",
    accent: "rose",
    systemPrompt:
      "You are a creative discovery + brainstorming partner. Run in TWO phases. " +
      "MANDATORY PHASE GATE — Before producing any ideas, count the user's brief on these 4 axes: " +
      "(a) 目标/动机 — why are they doing this? (b) 用户/场景 — who is it for, in what context? " +
      "(c) 约束 — budget, time, tech, channel, taboo? (d) 评判标准 — what makes a winning idea? " +
      "RULE: If FEWER than 3 of these 4 axes are clearly specified in the user's message, you MUST enter PHASE 1 and refuse to propose ideas yet. " +
      "PHASE 1 — Clarify: ask exactly 3-5 sharp, non-overlapping questions covering the missing axes. " +
      "Format each as '[轴名] 一句具体问题（可选：附 2-3 个示例选项让用户秒回）'. " +
      "End with: '回答其中任意 2-3 条即可，我会基于你已说清的部分继续发散。' " +
      "NEVER list ideas, options, or solutions in Phase 1 — even if it feels helpful. " +
      "Escape hatch: if the user explicitly says '直接给方案' / '跳过追问' / 'go' / 'skip', jump to Phase 2 immediately. " +
      "PHASE 2 — Diverge: propose 8-12 diverse ideas spanning safe-to-wild. Cluster them by theme. " +
      "Mark the most promising 2 with a ★. Include at least one contrarian/inverse take and one " +
      "'what if we did the opposite' idea. Don't pre-judge; the user will filter. " +
      "Examples — '我想做个app' / '搞个活动' / '写个工具' → only 0-1 axes filled → MUST go Phase 1. " +
      "'给初中生做个免费离线的英语单词 app，每天 ≤10 分钟，要游戏化' → 4 axes filled → go Phase 2.",
    defaultTemperature: 0.8,
    contextMaxMessages: 20,
    contextCharBudget: 30_000
  },
  {
    id: "translate",
    nameKey: "modes.translate.name",
    descKey: "modes.translate.desc",
    icon: "🌐",
    accent: "cyan",
    systemPrompt:
      "You are a professional translator. " +
      "Auto-detect the source language. By default translate Chinese↔English; for any other pair, follow the user's explicit direction. " +
      "Output ONLY the translation, no preamble. " +
      "For ambiguous terms, append a tiny [note: ...] at the very end. " +
      "Preserve formatting (markdown, code blocks, line breaks) exactly. " +
      "Tone: match the source (formal stays formal, casual stays casual).",
    defaultTemperature: 0.2,
    contextMaxMessages: 6,
    contextCharBudget: 80_000
  },
  {
    id: "summarize",
    nameKey: "modes.summarize.name",
    descKey: "modes.summarize.desc",
    icon: "📋",
    accent: "fuchsia",
    systemPrompt:
      "You are a summarization specialist. " +
      "Structure: 1) TL;DR (1-2 sentences, max 40 words). 2) Key points (3-7 bullets, ordered by importance). " +
      "3) Notable quotes or numbers (if any). 4) Open questions or unclear points. " +
      "Stay faithful to the source — do not add information that isn't there. " +
      "When the source is very long, indicate which sections you condensed most.",
    defaultTemperature: 0.3,
    contextMaxMessages: 4,
    contextCharBudget: 200_000
  }
];

export const CHAT_MODE_MAP: Record<ChatModeId, ChatMode> = Object.fromEntries(
  CHAT_MODES.map((m) => [m.id, m])
) as Record<ChatModeId, ChatMode>;

export function getMode(id: string | null | undefined): ChatMode {
  if (!id) return CHAT_MODE_MAP.chat;
  return CHAT_MODE_MAP[id as ChatModeId] ?? CHAT_MODE_MAP.chat;
}

/* -------------------------------------------------------------------------- */
/* Context window compression                                                 */
/* -------------------------------------------------------------------------- */

interface CtxMessage { role: string; content: string }

/**
 * Roughly estimate token count from character count.
 * For mixed CJK + English content, 1 token ≈ 3-4 chars. Use 3.5 as a safe
 * average. This is an approximation — sufficient for budget enforcement but
 * not for exact billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Compress a list of messages to fit a chat mode's context budget.
 *
 * Rules:
 *  1. Always preserve every `system` message (the mode prompt + any pinned).
 *  2. Always preserve the LAST user message (the question we're answering).
 *  3. If `contextMaxMessages` is set, drop oldest non-system messages until
 *     count <= max.
 *  4. If `contextCharBudget` is set, drop oldest non-system messages until
 *     the total character count <= budget.
 *  5. Returns the assembled message array plus a small report describing
 *     what was trimmed (for telemetry / future summarization Phase 2).
 */
export function compressMessages(
  messages: CtxMessage[],
  mode: Pick<ChatMode, "contextMaxMessages" | "contextCharBudget">
): { messages: CtxMessage[]; dropped: number; originalChars: number; finalChars: number } {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");
  const originalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  // Step 1 — enforce message count
  let kept = otherMsgs.slice();
  const maxCount = mode.contextMaxMessages;
  if (maxCount && kept.length > maxCount) {
    kept = kept.slice(-maxCount);
  }

  // Step 2 — enforce char budget. Always keep the last message.
  const budget = mode.contextCharBudget;
  if (budget) {
    const systemChars = systemMsgs.reduce((sum, m) => sum + m.content.length, 0);
    let totalChars = systemChars + kept.reduce((sum, m) => sum + m.content.length, 0);
    // Drop from the FRONT (oldest) until under budget, but never drop the last item.
    while (totalChars > budget && kept.length > 1) {
      const dropped = kept.shift();
      if (dropped) totalChars -= dropped.content.length;
    }
    // If still over budget and only the last message remains, truncate that message.
    if (totalChars > budget && kept.length === 1) {
      const overshoot = totalChars - budget;
      const original = kept[0].content;
      if (original.length > overshoot + 200) {
        const truncated = "…[内容已截断]\n" + original.slice(overshoot + 200);
        kept = [{ role: kept[0].role, content: truncated }];
      }
    }
  }

  const assembled = [...systemMsgs, ...kept];
  const finalChars = assembled.reduce((sum, m) => sum + m.content.length, 0);
  return {
    messages: assembled,
    dropped: messages.length - assembled.length,
    originalChars,
    finalChars
  };
}
