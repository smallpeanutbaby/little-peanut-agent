/**
 * Streaming tool executor.
 *
 * Receives `tool_use` blocks as they finalize during a streaming model
 * turn. Schedules them according to each tool's `isConcurrencySafe()`
 * policy:
 *
 *  - Concurrency-safe tools run in parallel (bounded by `maxConcurrency`).
 *  - Non-safe tools (Bash, Write, Edit, …) run strictly serially after
 *    all sibling work has drained.
 *  - When a non-safe tool errors / is denied, sibling jobs that have
 *    not started yet are cancelled (Claude Code's cascade-cancel
 *    behaviour) — running ones complete naturally.
 *
 * The executor preserves enqueue order in the returned results so the
 * runtime can build the next user message with tool_result blocks in
 * the same order the model emitted them.
 */

import type { ToolRegistry } from "../tools/registry.js";
import { executeTool, toolResultErrorBlock, type ToolExecutionContext, type ExecutionResult } from "./toolExecution.js";
import type { ToolUseBlock, ToolResultBlock } from "../llm/types.js";

interface QueueEntry {
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** Set when the job completes (or is cancelled). */
  result?: ExecutionResult;
  /** Whether the job has actually started executing. Used by
   *  cascade-cancel to skip pending work. */
  started: boolean;
  promise?: Promise<void>;
}

export interface StreamingToolExecutorOptions {
  maxConcurrency?: number;
  registry: ToolRegistry;
  ctx: ToolExecutionContext;
  /** Called whenever a job completes — used by the queryLoop to emit
   *  `tool_run_end` events. */
  onResult?: (entry: { toolCallId: string; toolName: string; input: unknown; result: ExecutionResult }) => void;
  /** Called when a job is about to start. */
  onStart?: (entry: { toolCallId: string; toolName: string; input: unknown }) => void;
}

export class StreamingToolExecutor {
  private readonly queue: QueueEntry[] = [];
  private readonly maxConcurrency: number;
  private cascadeCancelled = false;

  constructor(private readonly opts: StreamingToolExecutorOptions) {
    this.maxConcurrency = opts.maxConcurrency ?? 4;
  }

  /** Enqueue a tool_use block. Returns immediately; the actual work
   *  starts in the background and finalises during `drain()`. */
  enqueue(block: ToolUseBlock): void {
    this.queue.push({
      toolCallId: block.id,
      toolName: block.name,
      input: block.input,
      started: false
    });
    this.kick();
  }

  /** Immediately mark every pending job as cancelled and stop kicking
   *  off new ones. Running jobs unwind through their own AbortSignal
   *  child (chained off the parent in `executeTool`); we just need to
   *  prevent dispatch of anything still queued. Called by `queryLoop`
   *  when it observes `signal.aborted` mid-drain. */
  cancelAll(): void {
    this.cascadeCancelled = true;
    this.kick();
  }

  /** Resolve once every enqueued job has either run or been cancelled.
   *  Returns the canonical `tool_result` blocks in enqueue order. */
  async drain(): Promise<ToolResultBlock[]> {
    while (this.queue.some((e) => !e.result)) {
      const pending = this.queue.filter((e) => e.promise && !e.result);
      if (pending.length === 0) {
        this.kick();
        if (!this.queue.some((e) => e.promise && !e.result)) break;
        continue;
      }
      await Promise.race(pending.map((e) => e.promise!));
    }
    return this.queue.map((e) => e.result?.block ?? unknownResultBlock(e.toolCallId, e.toolName));
  }

  /** Try to start more jobs honouring the concurrency policy. */
  private kick(): void {
    if (this.cascadeCancelled) {
      // Mark every remaining job as cancelled.
      for (const entry of this.queue) {
        if (!entry.started && !entry.result) {
          entry.started = true;
          entry.result = {
            block: toolResultErrorBlock(entry.toolCallId, "cancelled (sibling failure)"),
            status: "cancelled",
            durationMs: 0,
            preview: "cancelled",
            isError: true
          };
          this.opts.onResult?.({
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            input: entry.input,
            result: entry.result
          });
        }
      }
      return;
    }
    const running = this.queue.filter((e) => e.started && !e.result);
    const hasNonSafeRunning = running.some((e) => !this.isConcurrencySafe(e));
    if (hasNonSafeRunning) return; // wait it out

    for (const entry of this.queue) {
      if (entry.started || entry.result) continue;
      if (running.length >= this.maxConcurrency) break;
      const safe = this.isConcurrencySafe(entry);
      if (!safe) {
        // serialise — wait for everything before to finish
        if (running.length > 0) break;
        entry.started = true;
        entry.promise = this.runOne(entry);
        return; // only one non-safe at a time
      }
      entry.started = true;
      entry.promise = this.runOne(entry);
      running.push(entry);
    }
  }

  private isConcurrencySafe(entry: QueueEntry): boolean {
    const tool = this.opts.registry.get(entry.toolName);
    if (!tool) return true; // unknown tool — the error block is cheap; let it run with the others
    try {
      const fn = tool.isConcurrencySafe;
      return fn ? fn(entry.input as never) : tool.isReadOnly(entry.input as never);
    } catch {
      return false;
    }
  }

  private async runOne(entry: QueueEntry): Promise<void> {
    const tool = this.opts.registry.get(entry.toolName);
    this.opts.onStart?.({ toolCallId: entry.toolCallId, toolName: entry.toolName, input: entry.input });
    if (!tool) {
      const block = toolResultErrorBlock(entry.toolCallId, `unknown tool: ${entry.toolName}`);
      entry.result = { block, status: "errored", durationMs: 0, preview: block.output.kind === "text" ? block.output.text : "", isError: true };
      this.opts.onResult?.({ toolCallId: entry.toolCallId, toolName: entry.toolName, input: entry.input, result: entry.result });
      this.kick();
      return;
    }
    const res = await executeTool(tool, entry.input, entry.toolCallId, this.opts.ctx);
    entry.result = res;
    this.opts.onResult?.({ toolCallId: entry.toolCallId, toolName: entry.toolName, input: entry.input, result: res });
    // If a non-safe tool failed, cascade-cancel pending siblings (matches
    // Claude Code semantics — when Bash bails, don't run subsequent
    // queued writes against a broken state).
    if (!this.isConcurrencySafe(entry) && (res.status === "errored" || res.status === "denied")) {
      this.cascadeCancelled = true;
    }
    this.kick();
  }
}

function unknownResultBlock(toolCallId: string, toolName: string): ToolResultBlock {
  return {
    type: "tool_result",
    toolUseId: toolCallId,
    output: { kind: "text", text: `tool ${toolName} produced no result (likely cancelled)` },
    isError: true
  };
}
