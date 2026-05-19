/**
 * Shared "task finished" reports for agent / pipeline / plan modes.
 *
 * Users expect a clear wrap-up (like Agent's local summary) instead of
 * the stream ending on a bare tool card or a one-line PASS verdict that
 * never reaches the UI. This module persists a markdown block onto the
 * latest assistant message and optionally yields a text_delta so the
 * live renderer picks it up before terminal.
 */

import type { AppDatabase } from "../../db/database.js";
import type { AgentStore } from "../../db/agent-store.js";
import type { ToolRun } from "../../db/agent-store.js";
import type { AgentEvent } from "./types.js";
import {
  isPlanClarificationOnly,
  isPlanFinalPlan,
  userSkippedPlanClarify
} from "@shared/plan-ui.js";

export { isPlanClarificationOnly, isPlanFinalPlan, userSkippedPlanClarify };

export interface ToolLogEntry {
  name: string;
  input: unknown;
  ok: boolean;
  preview: string;
}

/* -------------------------------------------------------------------------- */
/* Marker detection                                                           */
/* -------------------------------------------------------------------------- */

export function hasCompletionMarker(text: string): boolean {
  const t = text;
  return (
    t.includes("任务已完成") ||
    t.includes("流水线已完成") ||
    t.includes("计划已定稿") ||
    t.includes("## ⚡ 执行总结") ||
    t.includes("执行总结") ||
    t.includes("审阅无误后，点击下方按钮")
  );
}

/** Hard gate: first-turn plan must clarify before ## 实施方案 (Cursor-style). */
export function shouldForcePlanClarification(
  db: AppDatabase,
  conversationId: string,
  currentUserMessage: string | null,
  assistantOutput: string,
  modeId: string
): boolean {
  if (modeId !== "plan") return false;
  if (!isPlanFinalPlan(assistantOutput) || isPlanClarificationOnly(assistantOutput)) return false;
  if (userSkippedPlanClarify(currentUserMessage ?? "")) return false;

  const userMsgs = db.listMessages(conversationId).filter((m) => m.role === "user");
  if (userMsgs.length > 1) return false;

  const store = db.agent;
  for (const m of db.listMessages(conversationId)) {
    if (m.role !== "assistant") continue;
    if ((m.content ?? "").includes("## 需要先确认")) return false;
    for (const p of store.listPartsForMessage(m.id)) {
      if (p.type === "text" && (p.textContent ?? "").includes("## 需要先确认")) {
        return false;
      }
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Report builders                                                            */
/* -------------------------------------------------------------------------- */

export function buildPlanCompletionFooter(): string {
  return [
    "## ✅ 计划已定稿",
    "",
    "以上是实施方案。请审阅步骤与涉及文件；确认无误后，点击下方 **「让 Agent 按此计划执行」** 按钮开始落地。",
    "若需调整，直接回复修改意见，我会更新计划。"
  ].join("\n");
}

export function buildPipelineCompletionReport(
  reviewSummary: string | undefined,
  toolRuns: ToolRun[]
): string {
  const lines: string[] = ["## ✅ 流水线已完成", ""];

  if (reviewSummary?.trim()) {
    lines.push("**审查结论：**", reviewSummary.trim(), "");
  }

  if (toolRuns.length > 0) {
    const ok = toolRuns.filter((r) => r.status === "completed").length;
    const failed = toolRuns.filter((r) => r.status === "errored" || r.status === "denied").length;
    const cancelled = toolRuns.filter((r) => r.status === "cancelled").length;
    lines.push("**本流水线工具调用：**");
    const byName = new Map<string, number>();
    for (const r of toolRuns) {
      byName.set(r.toolName, (byName.get(r.toolName) ?? 0) + 1);
    }
    for (const [name, count] of byName) {
      lines.push(`- \`${name}\` × ${count}`);
    }
    lines.push(
      "",
      `**统计：** 共 ${toolRuns.length} 次调用，成功 ${ok}，失败 ${failed}${cancelled ? `，取消 ${cancelled}` : ""}。`
    );
  }

  lines.push(
    "",
    "_三阶段（制定计划 → 执行工作 → 审查结果）已结束。如需继续修改，请直接发消息。_"
  );
  return lines.join("\n");
}

export function buildLocalSummary(
  log: ToolLogEntry[],
  failReason: string | null,
  title = "✅ **任务已完成**"
): string {
  if (log.length === 0) return "";
  const lines: string[] = [title, ""];

  lines.push("**📋 我做了什么：**");
  log.forEach((entry, idx) => {
    const mark = entry.ok ? "✓" : "✗";
    const argHint = formatToolArgHint(entry.name, entry.input);
    lines.push(`${idx + 1}. ${mark} \`${entry.name}\`${argHint ? " — " + argHint : ""}`);
  });

  const failed = log.filter((e) => !e.ok);
  if (failed.length > 0) {
    lines.push("", "**⚠️ 失败的步骤：**");
    for (const e of failed) {
      const argHint = formatToolArgHint(e.name, e.input);
      const detail = (e.preview || "").slice(0, 240).replace(/\s+/g, " ").trim();
      lines.push(`- \`${e.name}\`${argHint ? " " + argHint : ""}${detail ? "：" + detail : ""}`);
    }
  }

  const ok = log.filter((e) => e.ok).length;
  lines.push(
    "",
    `**📊 统计：** 共 ${log.length} 个工具调用，成功 ${ok}，失败 ${failed.length}。`
  );

  lines.push(
    "",
    failReason
      ? `_（注：模型未能给出自然语言总结（${failReason.slice(0, 120)}），以上为本地兜底总结。）_`
      : "_（本地兜底总结：模型未输出完整说明，以下为基于工具调用历史的自动汇总。）_"
  );
  return lines.join("\n");
}

export function formatToolArgHint(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const shortStr = (v: unknown, max = 80) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (!s) return "";
    return s.length > max ? s.slice(0, max) + "…" : s;
  };
  switch (toolName) {
    case "Bash":
      return obj.command ? "`" + shortStr(obj.command) + "`" : "";
    case "Read":
    case "Write":
    case "Edit":
    case "StrReplace":
    case "EditNotebook":
    case "ReadLints":
      return obj.path ? "`" + shortStr(obj.path, 120) + "`" : "";
    case "Grep":
      return obj.pattern ? "搜索 `" + shortStr(obj.pattern, 60) + "`" : "";
    case "Glob":
      return obj.glob_pattern ? "`" + shortStr(obj.glob_pattern, 80) + "`" : "";
    case "Task":
      return obj.description ? shortStr(obj.description, 80) : "";
    case "TodoWrite":
      return "更新 todo 列表";
    case "WebFetch":
    case "WebSearch":
      return obj.url
        ? shortStr(obj.url, 80)
        : obj.search_term
          ? "搜索 `" + shortStr(obj.search_term, 60) + "`"
          : "";
    case "ListDir":
      return obj.path ? "`" + shortStr(obj.path, 120) + "`" : "";
    default: {
      const keys = Object.keys(obj).slice(0, 2);
      if (keys.length === 0) return "";
      return keys.map((k) => `${k}=${shortStr(obj[k], 40)}`).join(", ");
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence + live stream                                                    */
/* -------------------------------------------------------------------------- */

export function persistCompletionAppend(
  db: AppDatabase,
  conversationId: string,
  markdown: string
): { messageId: string } | null {
  const store: AgentStore = db.agent;
  const trimmed = markdown.trim();
  if (!trimmed) return null;

  const messages = db.listMessages(conversationId);
  let lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  if (!lastAssistant) {
    lastAssistant = db.appendMessage({
      conversationId,
      role: "assistant",
      content: trimmed
    });
    store.appendPart({
      messageId: lastAssistant.id,
      seq: 0,
      type: "text",
      toolCallId: null,
      toolName: null,
      inputJson: null,
      outputJson: null,
      outputPreview: null,
      isError: false,
      outputFilePath: null,
      tokens: null,
      textContent: trimmed
    });
    return { messageId: lastAssistant.id };
  }

  const parts = store.listPartsForMessage(lastAssistant.id);
  const textParts = parts.filter((p) => p.type === "text");
  const appendBlock = `\n\n---\n\n${trimmed}`;

  if (textParts.length > 0) {
    const lastPart = textParts[textParts.length - 1];
    const composed = (lastPart.textContent ?? "") + appendBlock;
    store.patchPartText(lastPart.id, composed);
    db.finalizeMessage(lastAssistant.id, composed, null);
  } else {
    const seq = parts.length > 0 ? Math.max(...parts.map((p) => p.seq)) + 1 : 0;
    store.appendPart({
      messageId: lastAssistant.id,
      seq,
      type: "text",
      toolCallId: null,
      toolName: null,
      inputJson: null,
      outputJson: null,
      outputPreview: null,
      isError: false,
      outputFilePath: null,
      tokens: null,
      textContent: trimmed
    });
    db.finalizeMessage(lastAssistant.id, (lastAssistant.content ?? "") + appendBlock, null);
  }

  return { messageId: lastAssistant.id };
}

/** Persist + push to the live agent stream before `terminal`. */
export async function* emitCompletionReport(
  db: AppDatabase,
  conversationId: string,
  markdown: string
): AsyncGenerator<AgentEvent, void> {
  const existing = db.listMessages(conversationId);
  const last = [...existing].reverse().find((m) => m.role === "assistant");
  if (last?.content?.includes(markdown.slice(0, 24))) {
    return;
  }

  const result = persistCompletionAppend(db, conversationId, markdown);
  if (!result) return;

  yield { kind: "llm", event: { type: "text_delta", text: `\n\n---\n\n${markdown.trim()}` } };
  yield { kind: "message_persisted", messageId: result.messageId, role: "assistant" };
}
