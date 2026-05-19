/**
 * Agent main loop.
 *
 * One LLM turn = call the model, stream its events to the renderer,
 * collect any `tool_use` blocks, execute them, append the matching
 * `tool_result` blocks to the conversation, and decide whether to loop.
 *
 *  - `needsFollowUp` is decided by "did the stream produce any
 *    tool_use_stop event?" — NOT by stop_reason. Some providers (OpenAI
 *    Chat especially) lie about stop_reason when tool_calls are
 *    streamed.
 *  - The user message + assistant placeholder are persisted BEFORE the
 *    LLM call so a crash mid-stream is still recoverable (Resume in
 *    M4-3 reads `tool_run.status = 'pending|running'` to find them).
 *  - The loop yields `AgentEvent`s as an async generator; the IPC layer
 *    `for await`s them and forwards over `agent:run:{id}`.
 */

import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../../db/database.js";
import type { AgentStore } from "../../db/agent-store.js";
import type { Tool } from "../tools/Tool.js";
import { ToolRegistry } from "../tools/registry.js";
import { getCanonicalAdapter } from "../llm/adapters/index.js";
import { withRetry, FallbackTriggeredError } from "../llm/withRetry.js";
import type {
  CanonicalMessage,
  ContentBlock,
  LlmRequest,
  ProviderRef,
  ToolResultBlock,
  ToolUseBlock
} from "../llm/types.js";
import { StreamingToolExecutor } from "./StreamingToolExecutor.js";
import type { ToolExecutionContext } from "./toolExecution.js";
import type { PermissionGate, PermissionScopeRef } from "../permissions/gate.js";
import { buildSystemPrompt } from "../context/systemPrompt.js";
import type { ChatMode } from "@shared/modes.js";
import type { AgentEvent } from "./types.js";
import { zodToJsonSchema } from "../llm/toolSpec.js";
import { autocompact, applyPtlFallback } from "../context/compaction.js";
import { tokensForHistory } from "../context/tokenizer.js";
import { modelContextFor } from "../context/modelLimits.js";
import { estimateCostUsd } from "../cost/modelCosts.js";

export interface AgentRunParams {
  /** Logical id for this run (used by IPC events). */
  runId: string;
  conversationId: string;
  projectId: string | null;
  projectRoot: string;
  projectName?: string | null;
  /** The new user message to append. May be empty if the caller already
   *  appended it (M0-5 IPC layer always appends). */
  userMessage: string | null;
  /** Optional pre-existing assistant placeholder id; the loop will
   *  finalise its content. */
  assistantMessageId?: string | null;

  mode: ChatMode;
  provider: ProviderRef;
  model: string;
  temperature?: number;
  thinkBudget?: ChatMode["defaultThinkBudget"];
  maxOutputTokens?: number;
  language: "zh-CN" | "en";
  /** Tools available for this run (already filtered for subagent
   *  contexts in M2). */
  tools: Tool[];

  /** Hard cap on loop iterations (i.e. tool_use rounds). Prevents
   *  runaway recursion when a tool keeps echoing the same problem. */
  maxIterations?: number;
  signal: AbortSignal;

  db: AppDatabase;
  gate: PermissionGate;

  /** Project-level additional writable directories (from settings).
   *  Forwarded into every tool's ctx so `validateProjectPath` can
   *  accept them. */
  additionalWorkingDirectories?: string[];

  /** Optional fallback `(provider, model)` used by `withRetry` after
   *  exhausting retries on the primary. The runtime only honors it
   *  when the primary stream produced no text yet — partial output
   *  would otherwise be confusingly interleaved with the fallback's. */
  fallback?: { provider: ProviderRef; model: string } | null;

  /** Optional spend cap (USD) for THIS conversation. When the running
   *  cost crosses the cap we still finish the current turn but skip
   *  starting another, terminating with `reason: "budget_exceeded"`. */
  budgetUsd?: number | null;

  /** Optional registered skills surfaced into the system prompt. The
   *  IPC layer populates this from `loadSkills()` + the bound Skill
   *  catalog so the model knows what it can `Skill(name=…)`. */
  skillHints?: Array<{ name: string; source: "project" | "user"; description: string }>;
}

const DEFAULT_MAX_ITERATIONS = 12;

/**
 * Main async generator. Yields AgentEvents; resolves with no value
 * (the terminal AgentEvent carries the reason).
 */
export async function* queryLoop(params: AgentRunParams): AsyncGenerator<AgentEvent, void> {
  const store = params.db.agent;
  const registry = new ToolRegistry();
  for (const t of params.tools) registry.register(t);

  // Persist the new user message + assistant placeholder up front. This
  // matches Claude Code's "recordTranscript before callModel" pattern.
  let assistantMessageId: string;
  if (params.userMessage !== null && params.userMessage.length > 0) {
    const userMsg = params.db.appendMessage({
      conversationId: params.conversationId,
      role: "user",
      content: params.userMessage
    });
    // Mirror to message_part so the block-based renderer can pick it up.
    store.appendPart({
      messageId: userMsg.id,
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
      textContent: params.userMessage
    });
    yield { kind: "message_persisted", messageId: userMsg.id, role: "user" };
  }
  if (params.assistantMessageId) {
    assistantMessageId = params.assistantMessageId;
  } else {
    const placeholder = params.db.appendMessage({
      conversationId: params.conversationId,
      role: "assistant",
      content: ""
    });
    assistantMessageId = placeholder.id;
  }
  yield { kind: "message_persisted", messageId: assistantMessageId, role: "assistant" };

  // Hydrate prior conversation as CanonicalMessages from the DB.
  let history = loadCanonicalHistory(params.db, store, params.conversationId, assistantMessageId);

  // Kick off a non-blocking memory scan; it'll fill in `memory_index`
  // for future turns. We snapshot the existing index now so this turn's
  // prompt only shows already-indexed entries.
  if (params.projectId) {
    const { scanProjectMemory } = await import("../memory/scanner.js");
    setImmediate(() => {
      scanProjectMemory(params.db, params.projectId!, params.projectRoot).catch((e) => {
        console.warn("[agent] memory scan failed", e);
      });
    });
  }
  const memoryHints = params.projectId
    ? params.db.agent
        .listMemoryIndex(params.projectId)
        .slice(0, 12)
        .map((row) => ({
          path: row.relativePath,
          type: row.type,
          description: row.description
        }))
    : [];

  const systemPrompt = buildSystemPrompt({
    mode: params.mode,
    projectRoot: params.projectRoot,
    projectName: params.projectName ?? null,
    language: params.language,
    tools: params.tools,
    memoryHints,
    skillHints: params.skillHints
  });

  const adapter = getCanonicalAdapter(params.provider);
  const maxIters = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const toolSpecs = await Promise.all(
    params.tools.map(async (t) => ({
      name: t.name,
      description:
        (await t.prompt({
          projectRoot: params.projectRoot,
          modeId: params.mode.id,
          language: params.language
        })) || t.description,
      inputSchema: (t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema)) as unknown as Record<string, unknown>
    }))
  );

  let iter = 0;
  let assistantPartSeq = 0;
  let accumulatedAssistantText = "";
  let accumulatedAssistantReasoning = "";
  // tool_use blocks emitted in the current turn. Reset every iteration.
  let pendingToolUses: ToolUseBlock[] = [];

  while (true) {
    if (params.signal.aborted) {
      yield { kind: "terminal", reason: "cancelled" };
      finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
      return;
    }
    if (iter >= maxIters) {
      yield { kind: "terminal", reason: "max_iterations" };
      finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
      return;
    }
    if (typeof params.budgetUsd === "number" && params.budgetUsd > 0) {
      const sum = params.db.agent.costSumForConversation(params.conversationId);
      if (sum.costUsd >= params.budgetUsd) {
        yield {
          kind: "terminal",
          reason: "budget_exceeded",
          message: `conversation cost $${sum.costUsd.toFixed(4)} ≥ budget $${params.budgetUsd.toFixed(2)}`
        };
        finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
        return;
      }
    }

    // Context budgeting: autocompact when we cross 75% of the model's
    // soft prompt budget; PTL-fallback if even that wouldn't fit under
    // the model's hard context window. Both passes are pure functions
    // that return a fresh `messages` array — the on-disk transcript is
    // never mutated. The renderer keeps showing the full history.
    const ctxInfo = modelContextFor(params.model);
    const beforeTokens = tokensForHistory(history);
    let requestMessages = history;
    let compactionNotes: string[] = [];
    if (beforeTokens > ctxInfo.promptBudget * 0.75) {
      const ac = autocompact(history, ctxInfo.promptBudget);
      requestMessages = ac.messages;
      if (ac.metrics.strategy !== "noop") {
        compactionNotes.push(`autocompact ${ac.metrics.before}→${ac.metrics.after}`);
      }
    }
    const ptl = applyPtlFallback(requestMessages, ctxInfo.contextWindow - (params.maxOutputTokens ?? 4096) - 2000);
    requestMessages = ptl.messages;
    if (ptl.metrics.strategy !== "noop") compactionNotes.push(`ptl ${ptl.metrics.before}→${ptl.metrics.after}`);
    if (compactionNotes.length > 0) {
      yield { kind: "context_compacted", before: beforeTokens, after: tokensForHistory(requestMessages), notes: compactionNotes };
    }

    const request: LlmRequest = {
      provider: params.provider,
      model: params.model,
      system: systemPrompt,
      messages: requestMessages,
      tools: toolSpecs.length > 0 ? toolSpecs : undefined,
      toolChoice: "auto",
      temperature: params.temperature,
      thinkBudget: params.thinkBudget,
      maxOutputTokens: params.maxOutputTokens,
      signal: params.signal
    };

    pendingToolUses = [];
    // Per-turn text/reasoning accumulators (the persisted assistant
    // message is updated incrementally).
    let turnText = "";
    let turnReasoning = "";
    let textPartId: string | null = null;
    let reasoningPartId: string | null = null;
    let toolUsePartByCallId = new Map<string, string>();
    let streamErrored: string | null = null;

    // Wrap the canonical adapter stream with withRetry: transient errors
    // retry with exponential backoff on the same provider; if a
    // `fallback` provider/model was supplied and no text was produced
    // yet, the wrapper throws `FallbackTriggeredError` which we catch
    // below and re-issue the call against the fallback. Existing event
    // handlers in this loop remain unchanged.
    const primaryIter: AsyncIterable<import("../llm/types.js").LlmStreamEvent> = withRetry(
      adapter,
      request,
      params.fallback
        ? {
            fallback: () => ({
              adapter: getCanonicalAdapter(params.fallback!.provider),
              request: { ...request, provider: params.fallback!.provider, model: params.fallback!.model }
            })
          }
        : undefined
    );
    try {
      for await (const ev of primaryIter) {
      yield { kind: "llm", event: ev };
      if (ev.type === "text_delta") {
        turnText += ev.text;
        if (!textPartId) {
          const part = store.appendPart({
            messageId: assistantMessageId,
            seq: assistantPartSeq++,
            type: "text",
            toolCallId: null,
            toolName: null,
            inputJson: null,
            outputJson: null,
            outputPreview: null,
            isError: false,
            outputFilePath: null,
            tokens: null,
            textContent: turnText
          });
          textPartId = part.id;
        } else {
          store.patchPartText(textPartId, turnText);
        }
      } else if (ev.type === "reasoning_delta") {
        turnReasoning += ev.text;
        if (!reasoningPartId) {
          const part = store.appendPart({
            messageId: assistantMessageId,
            seq: assistantPartSeq++,
            type: "reasoning",
            toolCallId: null,
            toolName: null,
            inputJson: null,
            outputJson: null,
            outputPreview: null,
            isError: false,
            outputFilePath: null,
            tokens: null,
            textContent: turnReasoning
          });
          reasoningPartId = part.id;
        } else {
          store.patchPartText(reasoningPartId, turnReasoning);
        }
      } else if (ev.type === "tool_use_stop") {
        const block: ToolUseBlock = {
          type: "tool_use",
          id: ev.id,
          name: lookupToolName(params.tools, ev.id) ?? "unknown",
          input: ev.finalInput
        };
        // We can't reliably recover the tool name from the id alone
        // (OpenAI streams name in `tool_use_start`; we tracked it but
        // forwarded as a raw event). Use the LLM-provided name on the
        // tool_use_start event we already yielded. To keep it simple
        // we record the part with `tool_name` left null when the name
        // wasn't paired and patch it as soon as the executor picks it
        // up.
        // Note: we patch the block.name later from the executor's
        // start callback.
        pendingToolUses.push(block);
        const partId = store.appendPart({
          messageId: assistantMessageId,
          seq: assistantPartSeq++,
          type: "tool_use",
          toolCallId: ev.id,
          toolName: null,
          inputJson: JSON.stringify(ev.finalInput ?? null),
          outputJson: null,
          outputPreview: null,
          isError: false,
          outputFilePath: null,
          tokens: null,
          textContent: null
        }).id;
        toolUsePartByCallId.set(ev.id, partId);
      } else if (ev.type === "tool_use_start") {
        // Patch the tool name onto the most recent pending block with
        // this id (created at tool_use_stop or upcoming).
        for (let i = pendingToolUses.length - 1; i >= 0; i--) {
          if (pendingToolUses[i].id === ev.id) {
            pendingToolUses[i].name = ev.name;
            break;
          }
        }
        // Remember it so when tool_use_stop creates the part we set the name.
        rememberToolName.set(ev.id, ev.name);
      } else if (ev.type === "usage") {
        recordUsage(params, ev.promptTokens, ev.completionTokens, ev.costUsd);
      } else if (ev.type === "error") {
        streamErrored = ev.message;
      }
    }
    } catch (e) {
      // FallbackTriggeredError → restart this turn against the fallback
      // adapter. We bail out of the current turn's inner loop and
      // restart the same iteration index so the run continues cleanly
      // on the fallback model.
      if (e instanceof FallbackTriggeredError && params.fallback) {
        yield {
          kind: "llm",
          event: { type: "error", code: "fallback_triggered", retryable: false, message: e.reason }
        };
        // Re-run this turn against the fallback. Persist nothing from
        // the failed primary attempt — the assistant placeholder is
        // still empty.
        const fbAdapter = getCanonicalAdapter(params.fallback.provider);
        const fbReq = { ...request, provider: params.fallback.provider, model: params.fallback.model };
        for await (const ev of fbAdapter.stream(fbReq)) {
          yield { kind: "llm", event: ev };
          if (ev.type === "text_delta") {
            turnText += ev.text;
            if (!textPartId) {
              const part = store.appendPart({
                messageId: assistantMessageId,
                seq: assistantPartSeq++,
                type: "text",
                toolCallId: null,
                toolName: null,
                inputJson: null,
                outputJson: null,
                outputPreview: null,
                isError: false,
                outputFilePath: null,
                tokens: null,
                textContent: turnText
              });
              textPartId = part.id;
            } else {
              store.patchPartText(textPartId, turnText);
            }
          } else if (ev.type === "reasoning_delta") {
            turnReasoning += ev.text;
            if (!reasoningPartId) {
              const part = store.appendPart({
                messageId: assistantMessageId,
                seq: assistantPartSeq++,
                type: "reasoning",
                toolCallId: null,
                toolName: null,
                inputJson: null,
                outputJson: null,
                outputPreview: null,
                isError: false,
                outputFilePath: null,
                tokens: null,
                textContent: turnReasoning
              });
              reasoningPartId = part.id;
            } else {
              store.patchPartText(reasoningPartId, turnReasoning);
            }
          } else if (ev.type === "tool_use_stop") {
            const block: ToolUseBlock = {
              type: "tool_use",
              id: ev.id,
              name: lookupToolName(params.tools, ev.id) ?? "unknown",
              input: ev.finalInput
            };
            pendingToolUses.push(block);
            const partId = store.appendPart({
              messageId: assistantMessageId,
              seq: assistantPartSeq++,
              type: "tool_use",
              toolCallId: ev.id,
              toolName: null,
              inputJson: JSON.stringify(ev.finalInput ?? null),
              outputJson: null,
              outputPreview: null,
              isError: false,
              outputFilePath: null,
              tokens: null,
              textContent: null
            }).id;
            toolUsePartByCallId.set(ev.id, partId);
          } else if (ev.type === "tool_use_start") {
            for (let i = pendingToolUses.length - 1; i >= 0; i--) {
              if (pendingToolUses[i].id === ev.id) {
                pendingToolUses[i].name = ev.name;
                break;
              }
            }
            rememberToolName.set(ev.id, ev.name);
          } else if (ev.type === "usage") {
            recordUsage(params, ev.promptTokens, ev.completionTokens, ev.costUsd);
          } else if (ev.type === "error") {
            streamErrored = ev.message;
          }
        }
      } else {
        throw e;
      }
    }

    // Patch tool names on parts now that we have them.
    for (const block of pendingToolUses) {
      const remembered = rememberToolName.get(block.id);
      if (remembered) block.name = remembered;
      const partId = toolUsePartByCallId.get(block.id);
      if (partId) {
        params.db
          .rawHandle()
          .prepare(`UPDATE message_part SET tool_name = ? WHERE id = ?`)
          .run(block.name, partId);
      }
    }

    // Append the assistant turn as the next entry in our local history
    // so the next turn (with tool_results appended) sees the same blocks
    // the LLM emitted.
    const assistantBlocksThisTurn: ContentBlock[] = [];
    if (turnReasoning) assistantBlocksThisTurn.push({ type: "reasoning", text: turnReasoning });
    if (turnText) assistantBlocksThisTurn.push({ type: "text", text: turnText });
    for (const tu of pendingToolUses) assistantBlocksThisTurn.push(tu);
    history.push({ role: "assistant", blocks: assistantBlocksThisTurn });

    accumulatedAssistantText += turnText;
    accumulatedAssistantReasoning += turnReasoning;

    if (streamErrored && pendingToolUses.length === 0) {
      // Pure stream error with no tool calls — terminate.
      yield { kind: "terminal", reason: "stream_error", message: streamErrored };
      finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
      return;
    }

    if (pendingToolUses.length === 0) {
      yield { kind: "terminal", reason: "completed" };
      finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
      // Fire-and-forget the post-run extractMemories hook. It self-checks
      // `isExtractMemoriesEnabled()` and returns [] when disabled, so this
      // is essentially free unless the user opts in.
      if (params.projectId) {
        void (async () => {
          try {
            const { extractMemories, isExtractMemoriesEnabled } = await import("../hooks/stopHooks.js");
            if (!isExtractMemoriesEnabled()) return;
            await extractMemories({
              db: params.db,
              projectId: params.projectId!,
              conversationId: params.conversationId,
              provider: params.provider,
              model: params.model,
              signal: AbortSignal.timeout(45_000)
            });
          } catch (e) {
            console.warn("[agent] extractMemories failed", e);
          }
        })();
      }
      return;
    }

    // Run the tools.
    const scope: PermissionScopeRef = {
      projectId: params.projectId,
      conversationId: params.conversationId
    };
    const toolCtx: ToolExecutionContext = {
      projectRoot: params.projectRoot,
      conversationId: params.conversationId,
      messageId: assistantMessageId,
      store,
      gate: params.gate,
      scope,
      signal: params.signal,
      additionalWorkingDirectories: params.additionalWorkingDirectories,
      onProgress: (toolCallId, ev) => {
        // emit via the generator — but we're outside the for-await loop.
        // We use a side-channel here: push to a queue the outer yield
        // can drain. For v0 simplicity we keep progress UI-only and
        // synchronous (the executor handles it).
        progressOutbox.push({
          kind: "tool_run_progress",
          toolCallId,
          message: ev.message,
          data: ev.data
        });
      }
    };
    const progressOutbox: AgentEvent[] = [];

    // Build a fresh executor; emit start/end events as it goes.
    const startEvents: AgentEvent[] = [];
    const endEvents: AgentEvent[] = [];
    const executor = new StreamingToolExecutor({
      registry,
      ctx: toolCtx,
      onStart: (entry) => {
        startEvents.push({
          kind: "tool_run_start",
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          input: entry.input
        });
      },
      onResult: (entry) => {
        endEvents.push({
          kind: "tool_run_end",
          toolCallId: entry.toolCallId,
          status: entry.result.status,
          preview: entry.result.preview,
          isError: entry.result.isError,
          durationMs: entry.result.durationMs
        });
        // Update the persisted tool_use part's preview / output so the
        // renderer can show the result card on reload.
        const partId = toolUsePartByCallId.get(entry.toolCallId);
        if (partId) {
          const json = JSON.stringify(entry.result.block.output);
          store.finalizeToolResultPart(partId, {
            outputJson: json,
            outputPreview: entry.result.preview,
            isError: entry.result.isError
          });
        }
      }
    });
    for (const tu of pendingToolUses) executor.enqueue(tu);

    // Drain, fanning progress events out as they arrive.
    const drainPromise = executor.drain();
    // Drain loop: every 50ms emit any queued tool_run_start/progress/end events.
    while (true) {
      const winner = await Promise.race([
        drainPromise.then(() => "done" as const),
        sleep(50).then(() => "tick" as const)
      ]);
      while (startEvents.length > 0) yield startEvents.shift()!;
      while (progressOutbox.length > 0) yield progressOutbox.shift()!;
      while (endEvents.length > 0) yield endEvents.shift()!;
      if (winner === "done") break;
      if (params.signal.aborted) {
        // Cancel queued work and let in-flight jobs unwind through
        // their child controllers (chained off params.signal in
        // executeTool). Drain still resolves with whatever the running
        // jobs produced (`tool_result` with `cancelled` status for the
        // ones we just yanked).
        executor.cancelAll();
        break;
      }
    }
    const toolResultBlocks: ToolResultBlock[] = await drainPromise;
    // Flush any final events emitted while we were waiting on drain.
    while (startEvents.length > 0) yield startEvents.shift()!;
    while (progressOutbox.length > 0) yield progressOutbox.shift()!;
    while (endEvents.length > 0) yield endEvents.shift()!;

    // Persist the tool_result blocks as a synthetic user message so
    // they survive process restart. Mirrors Anthropic's wire shape.
    const followUpMsgId = recordToolResultsAsUserMessage(
      params.db,
      store,
      params.conversationId,
      toolResultBlocks
    );
    yield { kind: "message_persisted", messageId: followUpMsgId, role: "user" };

    history.push({ role: "user", blocks: toolResultBlocks });
    // Microcompact: shrink any oversize tool_result blocks BEFORE they
    // ride into the next LLM call. The on-disk version is unchanged.
    const micro = (await import("../context/compaction.js")).microcompactLastToolResults(history);
    if (micro.strategy !== "noop") {
      yield {
        kind: "context_compacted",
        before: micro.before,
        after: micro.after,
        notes: [`microcompact ${micro.before}→${micro.after}`]
      };
    }
    iter += 1;

    if (params.signal.aborted) {
      yield { kind: "terminal", reason: "cancelled" };
      finalizeAssistantContent(params.db, assistantMessageId, accumulatedAssistantText, accumulatedAssistantReasoning);
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const rememberToolName = new Map<string, string>();

function lookupToolName(tools: Tool[], _id: string): string | null {
  // We can't look up by id (the id is provider-generated). The caller
  // already patches block.name from the `tool_use_start` event in the
  // outer loop; this stays null until that fires.
  return null;
}

function loadCanonicalHistory(
  db: AppDatabase,
  store: AgentStore,
  conversationId: string,
  assistantPlaceholderId: string
): CanonicalMessage[] {
  const messages = db.listMessages(conversationId);
  const out: CanonicalMessage[] = [];
  for (const msg of messages) {
    if (msg.id === assistantPlaceholderId) continue; // skip the placeholder
    const parts = store.listPartsForMessage(msg.id);
    if (parts.length === 0) {
      // Legacy row without parts. Treat content as a single text block.
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

function roleFor(role: string): "system" | "user" | "assistant" {
  return role === "assistant" ? "assistant" : role === "system" ? "system" : "user";
}

function recordToolResultsAsUserMessage(
  db: AppDatabase,
  store: AgentStore,
  conversationId: string,
  blocks: ToolResultBlock[]
): string {
  const message = db.appendMessage({
    conversationId,
    role: "user",
    content: blocks
      .map((b) => (b.output.kind === "text" ? b.output.text : JSON.stringify(b.output)))
      .join("\n\n")
  });
  let seq = 0;
  for (const b of blocks) {
    const outputJson = JSON.stringify(b);
    const preview =
      b.output.kind === "text"
        ? b.output.text.slice(0, 200)
        : JSON.stringify(b.output).slice(0, 200);
    store.appendPart({
      messageId: message.id,
      seq: seq++,
      type: "tool_result",
      toolCallId: b.toolUseId,
      toolName: null,
      inputJson: null,
      outputJson,
      outputPreview: preview,
      isError: !!b.isError,
      outputFilePath: null,
      tokens: null,
      textContent: null
    });
  }
  return message.id;
}

/**
 * Persist a usage event into `agent_cost_log` so the CostBadge can read
 * the running sum. Cost can come from the provider when known (some
 * Anthropic responses); otherwise we estimate from the per-1M-token
 * table in modelCosts.
 */
function recordUsage(
  params: AgentRunParams,
  promptTokens: number,
  completionTokens: number,
  providerCostUsd?: number
): void {
  const cost = typeof providerCostUsd === "number"
    ? providerCostUsd
    : estimateCostUsd(params.model, promptTokens, completionTokens);
  try {
    params.db.agent.appendCostLog({
      conversationId: params.conversationId,
      provider: params.provider.id,
      model: params.model,
      promptTokens,
      completionTokens,
      costUsd: cost
    });
  } catch (e) {
    console.warn("[agent] cost log insert failed", e);
  }
}

function finalizeAssistantContent(
  db: AppDatabase,
  assistantMessageId: string,
  text: string,
  reasoning: string
): void {
  try {
    db.finalizeMessage(assistantMessageId, text, reasoning || null);
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
