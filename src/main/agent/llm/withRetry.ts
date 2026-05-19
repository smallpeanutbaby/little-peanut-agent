/**
 * Streaming LLM call wrapped with retry + fallback semantics.
 *
 * Failure taxonomy (decided by the canonical `error` event):
 *   - `retryable: true`  → backoff and retry up to MAX_ATTEMPTS times
 *     on the SAME provider/model. Backoff is exponential with full
 *     jitter capped at 8s.
 *   - `retryable: false` → if a `fallback` is configured AND we haven't
 *     emitted any usable text yet, throw `FallbackTriggeredError` so
 *     the caller can re-run with the fallback request. Otherwise
 *     re-yield the `error` event verbatim and end.
 *
 * The wrapper preserves event order. Tokens that already streamed to
 * the caller are NOT replayed on retry; the caller is responsible for
 * resetting any partial state when it sees a fresh `message_start`.
 */

import type { LlmAdapter, LlmRequest, LlmStreamEvent } from "./types.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** If retryable errors keep happening AND a fallback request exists,
   *  throw this so the caller can re-issue with the fallback. */
  fallback?: () => { adapter: LlmAdapter; request: LlmRequest } | null;
}

const DEFAULTS = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000 };

export class FallbackTriggeredError extends Error {
  constructor(public readonly reason: string) {
    super(`fallback triggered: ${reason}`);
    this.name = "FallbackTriggeredError";
  }
}

export async function* withRetry(
  adapter: LlmAdapter,
  request: LlmRequest,
  opts: RetryOptions = {}
): AsyncGenerator<LlmStreamEvent> {
  const o = { ...DEFAULTS, ...opts };
  let attempt = 0;
  let producedAnyText = false;

  while (true) {
    attempt += 1;
    let sawError: { code: string; retryable: boolean; message: string } | null = null;
    try {
      for await (const ev of adapter.stream(request)) {
        if (ev.type === "text_delta" && ev.text.length > 0) producedAnyText = true;
        if (ev.type === "error") {
          sawError = { code: ev.code, retryable: ev.retryable, message: ev.message };
          // Don't yield the error immediately on the last attempt — we
          // either retry, fall back, or re-yield below.
          continue;
        }
        yield ev;
        if (ev.type === "message_stop" && !sawError) {
          return;
        }
      }
    } catch (e) {
      if (request.signal.aborted) {
        yield { type: "error", code: "aborted", retryable: false, message: "aborted" };
        return;
      }
      sawError = { code: "thrown", retryable: true, message: (e as Error).message };
    }

    if (!sawError) {
      // Stream ended cleanly without an error event.
      return;
    }

    // Decide between retry, fallback, or surface.
    if (sawError.retryable && attempt < o.maxAttempts) {
      const delay = backoff(o.baseDelayMs, o.maxDelayMs, attempt);
      await sleep(delay, request.signal);
      if (request.signal.aborted) {
        yield { type: "error", code: "aborted", retryable: false, message: "aborted" };
        return;
      }
      continue;
    }

    const fallback = opts.fallback?.();
    if (fallback && !producedAnyText) {
      throw new FallbackTriggeredError(`${sawError.code}: ${sawError.message}`);
    }

    yield { type: "error", code: sawError.code, retryable: false, message: sawError.message };
    yield { type: "message_stop", stopReason: "error" };
    return;
  }
}

function backoff(baseMs: number, maxMs: number, attempt: number): number {
  const exp = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(maxMs, exp);
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(t);
      resolve();
      return;
    }
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
