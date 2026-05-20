/**
 * Load persisted conversation rows as CanonicalMessages for context budgeting.
 */

import type { AppDatabase } from "../../db/database.js";
import type { AgentStore } from "../../db/agent-store.js";
import type { CanonicalMessage, ContentBlock, ToolResultBlock } from "../llm/types.js";

export function loadCanonicalHistory(
  db: AppDatabase,
  store: AgentStore,
  conversationId: string,
  skipMessageId?: string
): CanonicalMessage[] {
  const messages = db.listMessages(conversationId);
  const out: CanonicalMessage[] = [];
  for (const msg of messages) {
    if (skipMessageId && msg.id === skipMessageId) continue;
    const parts = store.listPartsForMessage(msg.id);
    if (parts.length === 0) {
      const blocks: ContentBlock[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      if (blocks.length > 0) {
        out.push({ role: roleFor(msg.role), blocks });
      }
      continue;
    }
    const blocks: ContentBlock[] = [];
    for (const p of parts) {
      if (p.type === "text" && p.textContent) blocks.push({ type: "text", text: p.textContent });
      else if (p.type === "tool_use" && p.toolCallId) {
        let input: unknown = null;
        try {
          input = p.inputJson ? JSON.parse(p.inputJson) : null;
        } catch {
          input = null;
        }
        blocks.push({
          type: "tool_use",
          id: p.toolCallId,
          name: p.toolName ?? "unknown",
          input: input ?? {}
        });
      } else if (p.type === "tool_result" && p.toolCallId) {
        let output: ContentBlock | null = null;
        try {
          output = p.outputJson ? (JSON.parse(p.outputJson) as ContentBlock) : null;
        } catch {
          output = null;
        }
        const payload =
          output && (output as ToolResultBlock).output
            ? (output as ToolResultBlock).output
            : { kind: "text" as const, text: p.outputPreview ?? "" };
        blocks.push({
          type: "tool_result",
          toolUseId: p.toolCallId,
          output: payload,
          isError: p.isError
        });
      }
    }
    if (blocks.length > 0) {
      out.push({ role: roleFor(msg.role), blocks });
    }
  }
  return out;
}

function roleFor(role: string): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}
