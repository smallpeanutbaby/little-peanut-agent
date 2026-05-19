/**
 * Multi-Model Pipeline — three-stage orchestrator.
 *
 * Stage 1 (Planner):  A planner model analyses the user's task and outputs
 *                     a structured step-by-step plan.  No tools are given.
 * Stage 2 (Executor): An executor model carries out the plan using the full
 *                     tool registry.  This stage delegates to `queryLoop`.
 * Stage 3 (Reviewer): A reviewer model audits the execution result. Outputs
 *                     PASS or FAIL with feedback.  On FAIL the executor is
 *                     re-invoked with the feedback (up to MAX_REVIEW_RETRIES).
 *
 * All three stages share the same conversation & PermissionGate so the user
 * sees a single unified thread with stage markers interleaved.
 */

import type { AppDatabase } from "../../db/database.js";
import type { Tool } from "../tools/Tool.js";
import type { PermissionGate, PermissionScopeRef } from "../permissions/gate.js";
import type { ProviderRef } from "../llm/types.js";
import type { ChatMode } from "@shared/modes.js";
import type { AgentEvent } from "./types.js";
import type { PipelineStageConfig, ThinkBudget } from "@shared/types.js";
import { queryLoop, type AgentRunParams } from "./queryLoop.js";
import {
  buildPipelineCompletionReport,
  emitCompletionReport,
  hasCompletionMarker
} from "./completionReport.js";

const MAX_REVIEW_RETRIES = 2;

export interface PipelineRunParams {
  runId: string;
  conversationId: string;
  projectId: string | null;
  projectRoot: string;
  projectName?: string | null;
  userMessage: string;

  mode: ChatMode;
  language: "zh-CN" | "en";
  tools: Tool[];
  signal: AbortSignal;
  db: AppDatabase;
  gate: PermissionGate;
  additionalWorkingDirectories?: string[];
  skillHints?: Array<{ name: string; source: "project" | "user"; description: string }>;

  stages: {
    planner:  { provider: ProviderRef; model: string; thinkBudget?: ThinkBudget };
    executor: { provider: ProviderRef; model: string; thinkBudget?: ThinkBudget };
    reviewer: { provider: ProviderRef; model: string; thinkBudget?: ThinkBudget };
  };
}

export async function* runPipeline(params: PipelineRunParams): AsyncGenerator<AgentEvent, void> {
  const { stages, db, signal } = params;

  // ──────────────────────── Stage 1: Planner ────────────────────────
  yield { kind: "stage_enter", stage: "planner", model: stages.planner.model };

  const plannerResult = yield* runPlannerStage(params);

  if (signal.aborted) {
    yield { kind: "stage_exit", stage: "planner" };
    yield { kind: "terminal", reason: "cancelled" };
    return;
  }
  yield { kind: "stage_exit", stage: "planner", passed: true };

  // ──────────────────────── Stage 2 + 3 loop ────────────────────────
  let executorFeedback: string | null = null;
  let retries = 0;

  while (true) {
    // ── Stage 2: Executor ──
    yield { kind: "stage_enter", stage: "executor", model: stages.executor.model };

    const executorPrompt = buildExecutorPrompt(plannerResult, executorFeedback);
    yield* runExecutorStage(params, executorPrompt);

    if (signal.aborted) {
      yield { kind: "stage_exit", stage: "executor" };
      yield { kind: "terminal", reason: "cancelled" };
      return;
    }
    yield { kind: "stage_exit", stage: "executor", passed: true };

    // ── Stage 3: Reviewer ──
    yield { kind: "stage_enter", stage: "reviewer", model: stages.reviewer.model };

    const reviewResult = yield* runReviewerStage(params);

    if (signal.aborted) {
      yield { kind: "stage_exit", stage: "reviewer" };
      yield { kind: "terminal", reason: "cancelled" };
      return;
    }

    if (reviewResult.passed) {
      yield { kind: "stage_exit", stage: "reviewer", passed: true };
      yield* finishPipelineRun(params, reviewResult.summary, "completed");
      return;
    }

    // Reviewer said FAIL
    yield { kind: "stage_exit", stage: "reviewer", passed: false };
    retries++;
    if (retries > MAX_REVIEW_RETRIES) {
      yield* finishPipelineRun(
        params,
        `审查未通过，已达最大重试次数 (${MAX_REVIEW_RETRIES})。最后反馈: ${reviewResult.feedback ?? ""}`,
        "max_iterations"
      );
      return;
    }
    executorFeedback = reviewResult.feedback;
  }
}

/* ───────────────────────── Stage implementations ───────────────────────── */

/**
 * Planner: single-turn LLM call with no tools. Returns the plan text.
 */
async function* runPlannerStage(
  params: PipelineRunParams
): AsyncGenerator<AgentEvent, string> {
  const { stages, db, signal } = params;

  const plannerParams: AgentRunParams = {
    runId: params.runId + "-planner",
    conversationId: params.conversationId,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectName: params.projectName,
    userMessage: params.userMessage,
    mode: {
      ...params.mode,
      systemPrompt: buildPlannerSystemPrompt(params.language)
    },
    provider: stages.planner.provider,
    model: stages.planner.model,
    temperature: 0.4,
    thinkBudget: stages.planner.thinkBudget ?? "medium",
    language: params.language,
    tools: [],
    maxIterations: 1,
    signal,
    db,
    gate: params.gate,
    additionalWorkingDirectories: params.additionalWorkingDirectories,
    skillHints: params.skillHints
  };

  let planText = "";
  for await (const ev of queryLoop(plannerParams)) {
    if (ev.kind === "llm" && ev.event.type === "text_delta") {
      planText += ev.event.text;
    }
    if (ev.kind !== "terminal") {
      yield ev;
    }
  }
  return planText;
}

/**
 * Executor: full agent loop with tools.
 */
async function* runExecutorStage(
  params: PipelineRunParams,
  executorPrompt: string
): AsyncGenerator<AgentEvent, void> {
  const { stages, db, signal } = params;

  const executorParams: AgentRunParams = {
    runId: params.runId + "-executor",
    conversationId: params.conversationId,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectName: params.projectName,
    userMessage: executorPrompt,
    mode: {
      ...params.mode,
      systemPrompt: buildExecutorSystemPrompt(params.language)
    },
    provider: stages.executor.provider,
    model: stages.executor.model,
    temperature: 0.3,
    thinkBudget: stages.executor.thinkBudget ?? "medium",
    language: params.language,
    tools: params.tools,
    maxIterations: 50,
    signal,
    db,
    gate: params.gate,
    additionalWorkingDirectories: params.additionalWorkingDirectories,
    skillHints: params.skillHints
  };

  for await (const ev of queryLoop(executorParams)) {
    if (ev.kind !== "terminal") {
      yield ev;
    }
  }
}

/**
 * Reviewer: single-turn LLM call that reads the conversation history and
 * judges PASS or FAIL. Returns `{ passed, summary?, feedback? }`.
 */
async function* runReviewerStage(
  params: PipelineRunParams
): AsyncGenerator<AgentEvent, { passed: boolean; summary?: string; feedback?: string }> {
  const { stages, db, signal } = params;

  const reviewerParams: AgentRunParams = {
    runId: params.runId + "-reviewer",
    conversationId: params.conversationId,
    projectId: params.projectId,
    projectRoot: params.projectRoot,
    projectName: params.projectName,
    userMessage: buildReviewerUserPrompt(params.language),
    mode: {
      ...params.mode,
      systemPrompt: buildReviewerSystemPrompt(params.language)
    },
    provider: stages.reviewer.provider,
    model: stages.reviewer.model,
    temperature: 0.2,
    thinkBudget: stages.reviewer.thinkBudget ?? "medium",
    language: params.language,
    tools: [],
    maxIterations: 1,
    signal,
    db,
    gate: params.gate,
    additionalWorkingDirectories: params.additionalWorkingDirectories
  };

  let reviewText = "";
  for await (const ev of queryLoop(reviewerParams)) {
    if (ev.kind === "llm" && ev.event.type === "text_delta") {
      reviewText += ev.event.text;
    }
    if (ev.kind !== "terminal") {
      yield ev;
    }
  }

  // Reviewer is instructed to put `PASS: ...` / `FAIL: ...` on its own
  // line, optionally preceded by a `## ✅ 审查通过` / `## ❌ 审查驳回`
  // markdown header. The old logic was `trimmed.startsWith("PASS")` which
  // silently broke the moment we added the header — every review was
  // interpreted as FAIL. Scan every line and grab the first verdict.
  const lines = reviewText.split(/\r?\n/);
  let verdict: "PASS" | "FAIL" | null = null;
  let verdictBody = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!verdict && /^PASS\b/i.test(line)) {
      verdict = "PASS";
      verdictBody = line.replace(/^PASS:?\s*/i, "").trim();
      continue;
    }
    if (!verdict && /^FAIL\b/i.test(line)) {
      verdict = "FAIL";
      verdictBody = line.replace(/^FAIL:?\s*/i, "").trim();
      continue;
    }
  }
  if (verdict === "PASS") {
    return { passed: true, summary: verdictBody || undefined };
  }
  if (verdict === "FAIL") {
    return { passed: false, feedback: verdictBody || "审查未通过，请修复问题。" };
  }
  // Reviewer refused to commit to PASS/FAIL — treat as FAIL with the
  // raw text as feedback so the next executor pass at least has context.
  const fallback = reviewText.trim() || "审查未给出明确判定。";
  return { passed: false, feedback: fallback };
}

/* ───────────────────────── Helpers ───────────────────────── */

/**
 * Persist a visible "## ✅ 流水线已完成" block (like Agent's wrap-up)
 * before emitting `terminal`. The reviewer's one-line PASS verdict
 * used to live only on the terminal event and never reached the chat.
 */
async function* finishPipelineRun(
  params: PipelineRunParams,
  reviewLine: string | undefined,
  reason: "completed" | "max_iterations"
): AsyncGenerator<AgentEvent, void> {
  const messages = params.db.listMessages(params.conversationId);
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  const alreadyHasWrapUp = last?.content ? hasCompletionMarker(last.content) : false;

  if (!alreadyHasWrapUp) {
    const toolRuns = params.db.agent.listToolRunsForConversation(params.conversationId);
    const report = buildPipelineCompletionReport(reviewLine, toolRuns);
    yield* emitCompletionReport(params.db, params.conversationId, report);
  }

  yield {
    kind: "terminal",
    reason,
    message: reviewLine
  };
}

function buildExecutorPrompt(plan: string, feedback: string | null): string {
  let prompt =
    "[PLANNER 输出的计划]\n" +
    plan +
    "\n\n现在轮到你（执行者）。请严格按上述计划的步骤编号，**一步一步**执行：" +
    "\n- 每开始一个步骤前，先在文字里宣告 `### ✅ 步骤 N: <步骤名>`，然后再调用工具。" +
    "\n- 一个步骤完成再做下一步，不要把多个步骤的工具调用混在一起。" +
    "\n- 所有步骤完成后，**必须**在最后输出 `## ⚡ 执行总结` 段（见 system prompt 的格式要求），否则会被审查阶段驳回。";
  if (feedback) {
    prompt +=
      "\n\n[REVIEWER FEEDBACK — 上一轮执行被审查驳回]\n" +
      feedback +
      "\n\n请针对反馈逐条修正，再次执行剩余/出错的步骤。修正完依然要补上 `## ⚡ 执行总结`。";
  }
  return prompt;
}

/**
 * Planner system prompt — locks the model into producing a numbered plan
 * with an explicit "计划要点" closing block. Without the structured block
 * the user could not see at a glance "what is going to happen", which is
 * the whole point of the planning stage.
 */
function buildPlannerSystemPrompt(language: "zh-CN" | "en"): string {
  if (language === "en") {
    return [
      "You are the **Planner** in a three-stage pipeline (Plan → Execute → Review).",
      "",
      "Your job:",
      "- Read the user's request and produce a clear, numbered, step-by-step plan.",
      "- You have **no tools** — do not pretend to execute. Just plan.",
      "- Be concrete: each step is one short imperative sentence.",
      "",
      "Output format (must follow exactly):",
      "",
      "## 📋 制定计划",
      "",
      "1. <step 1>",
      "2. <step 2>",
      "3. ...",
      "",
      "**计划要点**",
      "- 目标 (Goal): <final outcome>",
      "- 范围 (Scope): <files / modules / commands involved>",
      "- 验收 (Done when): <how we know it's finished>",
      "",
      "Do not add any prose before `## 📋 制定计划` or after the bullet list."
    ].join("\n");
  }
  return [
    "你是三阶段流水线（制定计划 → 执行工作 → 审查结果）的 **计划者(Planner)**。",
    "",
    "你的职责：",
    "- 读懂用户需求，输出一份清晰、编号、可执行的步骤计划。",
    "- 你 **没有任何工具**，不要假装执行，只负责规划。",
    "- 每个步骤一句话祈使句，具体到能落地的程度。",
    "",
    "输出格式（严格遵守）：",
    "",
    "## 📋 制定计划",
    "",
    "1. <第 1 步>",
    "2. <第 2 步>",
    "3. ...",
    "",
    "**计划要点**",
    "- 目标：<这次任务最终要达到的效果>",
    "- 范围：<涉及的文件 / 模块 / 命令>",
    "- 验收：<怎么算完成（输出 / 行为）>",
    "",
    "不要在 `## 📋 制定计划` 之前或者计划要点之后再写多余的话。"
  ].join("\n");
}

/**
 * Executor system prompt — forces step-by-step pacing (one numbered step
 * announced before each tool burst) and a final `## ⚡ 执行总结` block.
 * Without the announcement the user perceives the executor as a black
 * box; without the summary the reviewer has nothing to diff against the
 * plan.
 */
function buildExecutorSystemPrompt(language: "zh-CN" | "en"): string {
  if (language === "en") {
    return [
      "You are the **Executor** in a three-stage pipeline (Plan → Execute → Review).",
      "",
      "A plan from the planner is in the previous message. Your job:",
      "1. Walk the numbered plan **one step at a time**.",
      "2. Before touching any tool for step N, FIRST write a heading line:",
      "     `### ✅ 步骤 N: <name from the plan>`",
      "   then a one-line description of what you're about to do.",
      "3. Run only the tool calls needed for that step. Do not batch multiple plan steps into one tool burst.",
      "4. After the step completes, write a brief result line (e.g. `已新建 X`, `已修改 Y`, `命令返回 0`).",
      "5. When **all** plan steps are done, output a final block — exactly:",
      "",
      "## ⚡ 执行总结",
      "- 已完成步骤：1, 2, 3, ...",
      "- 关键改动：<files created / modified / deleted, commands run>",
      "- 验证结果：<test output / runtime output if any>",
      "",
      "If a step is impossible, say so explicitly in the summary instead of pretending it succeeded — the reviewer will rely on this honesty."
    ].join("\n");
  }
  return [
    "你是三阶段流水线（制定计划 → 执行工作 → 审查结果）的 **执行者(Executor)**。",
    "",
    "上一条消息里有计划者给的编号计划。你的任务：",
    "1. 严格按编号 **一步一步** 执行，不要跳步。",
    "2. 在动用任何工具之前，先用文字宣告：",
    "     `### ✅ 步骤 N: <计划里的步骤名>`",
    "   再用一句话说明这一步打算做什么。",
    "3. 只调用本步必需的工具；不要把多个计划步骤的工具调用堆在一回合里。",
    "4. 工具执行后，用一行结果说明本步成果（例如 `已新建 foo.py`、`已修改 bar.ts`、`命令 exit 0`）。",
    "5. **所有** 步骤都做完之后，必须在最后输出一段结构化总结，**格式固定**：",
    "",
    "## ⚡ 执行总结",
    "- 已完成步骤：1, 2, 3, ...",
    "- 关键改动：<新建 / 修改 / 删除的文件，执行的命令>",
    "- 验证结果：<测试输出 / 运行输出（如果有）>",
    "",
    "如果某一步做不到，请在总结里如实说明，**不要**假装成功——审查阶段会依赖这一段做对比。"
  ].join("\n");
}

/**
 * Reviewer system + user prompt — keeps the PASS / FAIL machine-readable
 * prefix (the pipelineLoop greps for it) but adds a Markdown header so
 * the user can spot the verdict in the message stream, and forces the
 * reviewer to diff against the plan's step list rather than just rubber-
 * stamping whatever the executor wrote.
 */
function buildReviewerSystemPrompt(language: "zh-CN" | "en"): string {
  if (language === "en") {
    return [
      "You are the **Reviewer** in a three-stage pipeline (Plan → Execute → Review).",
      "",
      "Your job: read the planner's plan and the executor's full execution above, then judge.",
      "- Walk through the planner's numbered list and check each step against what the executor actually did (tool calls + result lines + the final `## ⚡ 执行总结`).",
      "- If a planned step was skipped, partially done, or done wrong, that is a FAIL.",
      "- If the executor invented unrelated work or contradicted the plan, that is also a FAIL.",
      "- Otherwise: PASS.",
      "",
      "You have no tools — judge from the conversation only. Be strict but fair."
    ].join("\n");
  }
  return [
    "你是三阶段流水线（制定计划 → 执行工作 → 审查结果）的 **审查者(Reviewer)**。",
    "",
    "你的工作：阅读上方的「计划」和「执行」全部内容，做对比判定。",
    "- 逐条核对计划里的编号步骤，看执行者实际做的（工具调用 + 结果行 + 最后的 `## ⚡ 执行总结`）是否覆盖。",
    "- 计划里的某一步被跳过、做了一半、或方向跑偏 —— 判 FAIL。",
    "- 执行者擅自做了计划外的事或与计划矛盾 —— 也判 FAIL。",
    "- 否则判 PASS。",
    "",
    "你没有工具，只能依据对话内容做判断。要严谨但公平，不要因鸡毛蒜皮的小问题打回。"
  ].join("\n");
}

function buildReviewerUserPrompt(language: "zh-CN" | "en"): string {
  if (language === "en") {
    return [
      "[REVIEW]",
      "Compare the planner's plan against the executor's actual work above and decide.",
      "",
      "**Output format — strict:**",
      "",
      "If everything in the plan was done correctly:",
      "",
      "    ## ✅ 审查通过",
      "    PASS: <one-line summary of what was accomplished and verified>",
      "",
      "If anything in the plan was skipped, wrong, or contradicted:",
      "",
      "    ## ❌ 审查驳回",
      "    FAIL: <which plan step(s) failed, what went wrong, what must be fixed>",
      "",
      "Important: the very first non-whitespace token of the verdict line MUST be either `PASS:` or `FAIL:` — the pipeline parses it."
    ].join("\n");
  }
  return [
    "[审查]",
    "请把计划者的计划和执行者上方实际做的工作做对照，下判定。",
    "",
    "**输出格式（必须严格遵守）：**",
    "",
    "如果计划里的步骤都被正确完成：",
    "",
    "    ## ✅ 审查通过",
    "    PASS: <一句话概括做了什么、验证了什么>",
    "",
    "如果有任何步骤被跳过、做错或跑偏：",
    "",
    "    ## ❌ 审查驳回",
    "    FAIL: <具体说明哪几步没过关、错在哪里、需要怎么修>",
    "",
    "注意：判定行的第一个非空白 token 必须是 `PASS:` 或 `FAIL:`，流水线靠它解析。"
  ].join("\n");
}
