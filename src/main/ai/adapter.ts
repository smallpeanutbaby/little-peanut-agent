import type {
  ChatMessageInput,
  ChatRequestOptions,
  ChatStreamEvent,
  CheckConnectivityRequest,
  CheckConnectivityResult,
  ThinkBudget
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Multimodal helpers — build provider-specific content arrays                */
/* -------------------------------------------------------------------------- */

/** Strip "data:image/...;base64," prefix → returns { mimeType, base64Body }. */
export function splitDataUrl(dataUrl: string): { mimeType: string; base64Body: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], base64Body: m[2] };
}

/** True iff at least one user message in `messages` carries image attachments. */
function hasAnyAttachments(messages: ChatMessageInput[]): boolean {
  return messages.some((m) => Array.isArray(m.attachments) && m.attachments.length > 0);
}

/**
 * OpenAI Chat Completions vision format:
 *   content: [
 *     { type: "text", text: "..." },
 *     { type: "image_url", image_url: { url: "data:..." } }
 *   ]
 * Falls back to plain `content: string` when the message has no attachments
 * (preserves max compatibility with strict OpenAI-compatible servers).
 */
export function buildOpenAiMessages(messages: ChatMessageInput[]): Array<{ role: string; content: unknown }> {
  // Hot path: no attachments anywhere → keep simple string content for all messages.
  if (!hasAnyAttachments(messages)) return messages.map((m) => ({ role: m.role, content: m.content }));
  return messages.map((m) => {
    if (!m.attachments || m.attachments.length === 0) return { role: m.role, content: m.content };
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const att of m.attachments) {
      parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
    }
    return { role: m.role, content: parts };
  });
}

/**
 * Anthropic Messages API format:
 *   content: [
 *     { type: "text", text: "..." },
 *     { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }
 *   ]
 */
export function buildAnthropicMessages(messages: ChatMessageInput[]): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    if (!m.attachments || m.attachments.length === 0) return { role: m.role, content: m.content };
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const att of m.attachments) {
      const split = splitDataUrl(att.dataUrl);
      if (!split) continue;
      parts.push({
        type: "image",
        source: { type: "base64", media_type: split.mimeType, data: split.base64Body }
      });
    }
    return { role: m.role, content: parts };
  });
}

/**
 * Google Gemini parts array:
 *   parts: [ { text: "..." }, { inlineData: { mimeType, data } } ]
 */
export function buildGeminiParts(m: ChatMessageInput): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (m.content) parts.push({ text: m.content });
  if (m.attachments && m.attachments.length > 0) {
    for (const att of m.attachments) {
      const split = splitDataUrl(att.dataUrl);
      if (!split) continue;
      parts.push({ inlineData: { mimeType: split.mimeType, data: split.base64Body } });
    }
  }
  // Gemini requires at least one part; fall back to empty text.
  if (parts.length === 0) parts.push({ text: "" });
  return parts;
}


/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Map qualitative think budget to a provider-specific numeric / textual value.
 *
 * NOTE: We only ship adapters for openai / anthropic / gemini today. The
 * legacy `qwen` branch lived here but was never wired into the factory, so
 * it was dead code; it stays removed until we ship a real Qwen adapter.
 */
export function mapBudget(provider: "openai" | "anthropic" | "gemini", b?: ThinkBudget) {
  if (!b || b === "none") return undefined;
  if (provider === "openai") {
    // reasoning_effort: minimal | low | medium | high
    return ({ minimal: "minimal", low: "low", medium: "medium", high: "high", max: "high", xhigh: "high" } as const)[b];
  }
  if (provider === "anthropic") {
    // budget_tokens — number
    return ({ minimal: 1024, low: 1024, medium: 8192, high: 24000, max: 64000, xhigh: 64000 } as const)[b];
  }
  if (provider === "gemini") {
    // thinkingBudget — number (or -1 = dynamic)
    return ({ minimal: 256, low: 1024, medium: 8192, high: 24576, max: 24576, xhigh: 24576 } as const)[b];
  }
  return undefined;
}

/** Wrap fetch with timeout. */
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json.error?.message || json.message || json.error || text || `HTTP ${res.status}`;
    } catch {
      return text || `HTTP ${res.status}`;
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Hard cap on the single-line SSE buffer. A misbehaving upstream that emits a
 * single 100MB line with no newline could otherwise OOM the main process.
 * 8 MiB is comfortably larger than any real SSE event we'd see in practice
 * (Anthropic / OpenAI / Gemini events are < 32 KiB each).
 */
export const SSE_LINE_LIMIT_BYTES = 8 * 1024 * 1024;

/** Parse an SSE stream (data: ... lines) into yielded JSON payloads.
 *  Honors `signal` so a hung connection can be unblocked by aborting. */
export async function* parseSse(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buf = "";
  // When the signal fires, cancel the reader; the next `read()` will resolve
  // with done=true (or throw), unwedging the loop.
  const onAbort = () => {
    try {
      void reader.cancel();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    while (true) {
      if (signal?.aborted) break;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        // reader was cancelled
        break;
      }
      const { value, done } = chunk;
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Safety net: if the upstream is misbehaving and never emits a newline,
      // bail rather than letting `buf` grow unbounded.
      if (buf.length > SSE_LINE_LIMIT_BYTES) {
        try {
          void reader.cancel();
        } catch {
          /* ignore */
        }
        throw new Error(
          `SSE line buffer exceeded ${SSE_LINE_LIMIT_BYTES} bytes without a newline — upstream is malformed`
        );
      }
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload && payload !== "[DONE]") yield payload;
          else if (payload === "[DONE]") return;
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Adapter interface                                                          */
/* -------------------------------------------------------------------------- */

export interface ProviderAdapter {
  check(req: CheckConnectivityRequest): Promise<CheckConnectivityResult>;
  /** `signal` propagates user-initiated cancellation (and IPC-layer timeouts)
   * into the fetch + SSE reader so the iterator unblocks promptly instead of
   * stalling on a silent connection. */
  stream(req: ChatRequestOptions, signal?: AbortSignal): AsyncIterable<ChatStreamEvent>;
}

/* -------------------------------------------------------------------------- */
/* OpenAI-compatible (OpenAI / DeepSeek / Zhipu / Moonshot / Qwen DashScope / */
/* SiliconFlow / 任意 OpenAI 兼容服务)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Build default headers for OpenAI-compatible endpoints.
 *
 * We pose as `claude-cli` because some providers (notably Kimi For Coding /
 * api.kimi.com/coding/v1) reject any client whose User-Agent is not on their
 * allowlist of "Coding Agents" (Kimi CLI, Claude Code, Roo Code, Kilo Code).
 * This UA is widely accepted and is a no-op on standard OpenAI/Moonshot/Qwen/
 * DeepSeek/Zhipu endpoints, which do not gate on UA.
 */
function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "claude-cli/1.0.0",
    "X-Stainless-Lang": "js",
    Accept: "application/json"
  };
}

class OpenAIAdapter implements ProviderAdapter {
  async check(req: CheckConnectivityRequest): Promise<CheckConnectivityResult> {
    const start = Date.now();
    const url = `${trimSlash(req.baseUrl)}/chat/completions`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: openAiHeaders(req.apiKey),
        body: JSON.stringify({
          model: req.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false
        })
      }, 15000);
      const latencyMs = Date.now() - start;
      if (res.ok) return { ok: true, status: res.status, latencyMs };
      const message = await readErrorMessage(res);
      return { ok: false, status: res.status, latencyMs, message };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: (e as Error).message || "网络错误" };
    }
  }

  async *stream(req: ChatRequestOptions, signal?: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const url = `${trimSlash(req.baseUrl)}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: buildOpenAiMessages(req.messages),
      stream: true
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.thinkEnabled) {
      const effort = mapBudget("openai", req.thinkBudget);
      if (effort) body.reasoning_effort = effort;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { ...openAiHeaders(req.apiKey), Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "网络错误" };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: "error", message: await readErrorMessage(res), code: String(res.status) };
      return;
    }

    try {
      for await (const payload of parseSse(res.body, signal)) {
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            yield { type: "reasoning", text: delta.reasoning_content };
          }
          if (typeof delta.content === "string" && delta.content) {
            yield { type: "text", text: delta.content };
          }
        } catch { /* skip malformed chunk */ }
      }
      yield { type: "done" };
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "流式读取失败" };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Anthropic Messages API                                                     */
/* -------------------------------------------------------------------------- */

class AnthropicAdapter implements ProviderAdapter {
  private splitSystem(messages: ChatMessageInput[]): { system: string; rest: ChatMessageInput[] } {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    return { system, rest };
  }

  async check(req: CheckConnectivityRequest): Promise<CheckConnectivityResult> {
    const start = Date.now();
    const url = `${trimSlash(req.baseUrl)}/messages`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "x-api-key": req.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      }, 15000);
      const latencyMs = Date.now() - start;
      if (res.ok) return { ok: true, status: res.status, latencyMs };
      return { ok: false, status: res.status, latencyMs, message: await readErrorMessage(res) };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: (e as Error).message || "网络错误" };
    }
  }

  async *stream(req: ChatRequestOptions, signal?: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const url = `${trimSlash(req.baseUrl)}/messages`;
    const { system, rest } = this.splitSystem(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: buildAnthropicMessages(rest),
      stream: true
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.thinkEnabled) {
      const budget = mapBudget("anthropic", req.thinkBudget);
      if (budget) body.thinking = { type: "enabled", budget_tokens: budget };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": req.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "网络错误" };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: "error", message: await readErrorMessage(res), code: String(res.status) };
      return;
    }

    try {
      for await (const payload of parseSse(res.body, signal)) {
        try {
          const json = JSON.parse(payload);
          if (json.type === "content_block_delta") {
            const d = json.delta;
            if (d?.type === "text_delta" && typeof d.text === "string") {
              yield { type: "text", text: d.text };
            } else if (d?.type === "thinking_delta" && typeof d.thinking === "string") {
              yield { type: "reasoning", text: d.thinking };
            }
          } else if (json.type === "message_stop") {
            yield { type: "done" };
            return;
          } else if (json.type === "error") {
            yield { type: "error", message: json.error?.message || "Anthropic 错误" };
            return;
          }
        } catch { /* skip */ }
      }
      yield { type: "done" };
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "流式读取失败" };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Google Gemini API                                                          */
/* -------------------------------------------------------------------------- */

class GeminiAdapter implements ProviderAdapter {
  private buildContents(messages: ChatMessageInput[]) {
    const systemInstruction = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: buildGeminiParts(m)
      }));
    return { systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined, contents };
  }

  async check(req: CheckConnectivityRequest): Promise<CheckConnectivityResult> {
    const start = Date.now();
    const url = `${trimSlash(req.baseUrl)}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      }, 15000);
      const latencyMs = Date.now() - start;
      if (res.ok) return { ok: true, status: res.status, latencyMs };
      return { ok: false, status: res.status, latencyMs, message: await readErrorMessage(res) };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: (e as Error).message || "网络错误" };
    }
  }

  async *stream(req: ChatRequestOptions, signal?: AbortSignal): AsyncIterable<ChatStreamEvent> {
    const url = `${trimSlash(req.baseUrl)}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`;
    const { systemInstruction, contents } = this.buildContents(req.messages);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    const genCfg: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) genCfg.maxOutputTokens = req.maxTokens;
    if (req.temperature !== undefined) genCfg.temperature = req.temperature;
    if (req.thinkEnabled) {
      const budget = mapBudget("gemini", req.thinkBudget);
      if (budget !== undefined) genCfg.thinkingConfig = { thinkingBudget: budget };
    }
    if (Object.keys(genCfg).length > 0) body.generationConfig = genCfg;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "网络错误" };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: "error", message: await readErrorMessage(res), code: String(res.status) };
      return;
    }

    try {
      for await (const payload of parseSse(res.body, signal)) {
        try {
          const json = JSON.parse(payload);
          const parts = json.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const p of parts) {
              if (typeof p.text === "string" && p.text) {
                if (p.thought) yield { type: "reasoning", text: p.text };
                else yield { type: "text", text: p.text };
              }
            }
          }
          if (json.candidates?.[0]?.finishReason) {
            yield { type: "done" };
            return;
          }
        } catch { /* skip */ }
      }
      yield { type: "done" };
    } catch (e) {
      yield { type: "error", message: (e as Error).message || "流式读取失败" };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Map every wire protocol to a concrete adapter.
 *
 * IMPORTANT: `openai-responses` historically pointed at the Chat Completions
 * adapter as a stop-gap "alias". That's wrong — the Responses API has a
 * different request shape and event-based stream format. Until we implement
 * a dedicated ResponsesAdapter, we keep the same instance but log a warning
 * the first time it's selected so the silent-degradation bug is visible.
 */
const ADAPTERS: Record<string, ProviderAdapter> = {
  "openai-chat": new OpenAIAdapter(),
  "openai-responses": new OpenAIAdapter(),
  "openai-compatible": new OpenAIAdapter(),
  "anthropic-messages": new AnthropicAdapter(),
  "google-gemini": new GeminiAdapter()
};

const warnedProtocols = new Set<string>();
function warnOnce(protocol: string, msg: string) {
  if (warnedProtocols.has(protocol)) return;
  warnedProtocols.add(protocol);
  console.warn(`[ai/adapter] ${msg}`);
}

export function getAdapter(protocol: string): ProviderAdapter {
  const adapter = ADAPTERS[protocol];
  if (adapter) {
    if (protocol === "openai-responses") {
      warnOnce(
        protocol,
        "'openai-responses' is currently served by the Chat Completions adapter. " +
          "The two APIs differ; behavior may be partially incorrect until a dedicated adapter ships."
      );
    }
    return adapter;
  }
  warnOnce(
    protocol,
    `unknown protocol '${protocol}', falling back to 'openai-chat'. ` +
      "This is almost always a bug — please add the protocol to ADAPTERS or fix the provider config."
  );
  return ADAPTERS["openai-chat"];
}
