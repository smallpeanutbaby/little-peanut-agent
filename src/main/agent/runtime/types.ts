/**
 * Runtime-level event types. The queryLoop yields these so the IPC
 * layer can mirror them straight to the renderer. They are a strict
 * superset of `LlmStreamEvent` — every LLM event is forwarded verbatim
 * with the wrapper `{ kind: "llm", event }`, plus runtime-specific
 * events for tool lifecycle, todo updates, and the terminal state.
 */

import type { LlmStreamEvent } from "../llm/types.js";

export type AgentEvent =
  | { kind: "llm"; event: LlmStreamEvent }
  | {
      kind: "tool_run_start";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      kind: "tool_run_progress";
      toolCallId: string;
      message?: string;
      data?: unknown;
    }
  | {
      kind: "tool_run_end";
      toolCallId: string;
      status:
        | "completed"
        | "errored"
        | "denied"
        | "cancelled";
      preview?: string;
      isError?: boolean;
      durationMs: number;
    }
  | {
      kind: "context_compacted";
      before: number;
      after: number;
      notes: string[];
    }
  | {
      kind: "permission_request";
      toolCallId: string;
      toolName: string;
      input: unknown;
      uiPreview?: { title?: string; subtitle?: string; body?: string };
      toolReason?: string;
    }
  | {
      kind: "message_persisted";
      messageId: string;
      role: "user" | "assistant";
    }
  | {
      kind: "stage_enter";
      stage: "planner" | "executor" | "reviewer";
      model: string;
    }
  | {
      kind: "stage_exit";
      stage: "planner" | "executor" | "reviewer";
      passed?: boolean;
    }
  | { kind: "terminal"; reason: AgentTerminalReason; message?: string };

export type AgentTerminalReason =
  | "completed"
  | "cancelled"
  | "budget_exceeded"
  | "max_iterations"
  | "stream_error";

export interface AgentTerminal {
  reason: AgentTerminalReason;
  message?: string;
}
