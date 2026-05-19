/**
 * Long-lived MCP client connection with pluggable transports.
 *
 * Supports three wire formats:
 *  - **stdio**: JSON-RPC over newline-delimited stdin/stdout (child process).
 *  - **http** (streamable): single-endpoint POST returning JSON or SSE.
 *  - **sse** (legacy two-channel): GET SSE for server→client, POST to
 *    discovered endpoint for client→server.
 *
 * The `McpTransportLayer` interface abstracts the send/receive plumbing so
 * `McpConnection` itself only cares about JSON-RPC request/response matching,
 * the `initialize` handshake, and `tools/list` / `tools/call`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { McpServerConfig } from "@shared/types.js";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "little-peanut-agent", version: "0.1.0" };

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  content: Array<{ type: string; [k: string]: unknown }>;
  isError: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/* ========================================================================== */
/* Transport layer interface                                                   */
/* ========================================================================== */

export interface McpTransportLayer {
  connect(): Promise<void>;
  send(payload: Record<string, unknown>): void;
  onMessage(handler: (msg: Record<string, unknown>) => void): void;
  close(): void;
  readonly connected: boolean;
}

/* ========================================================================== */
/* StdioTransport                                                              */
/* ========================================================================== */

export class StdioTransport implements McpTransportLayer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private handler: ((msg: Record<string, unknown>) => void) | null = null;
  private _connected = false;

  constructor(private readonly cfg: McpServerConfig) {}

  get connected(): boolean {
    return this._connected;
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this._connected && this.child && !this.child.killed) return;
    await this.spawnChild();
    this._connected = true;
  }

  send(payload: Record<string, unknown>): void {
    if (!this.child || this.child.killed) throw new Error("transport_closed");
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  close(): void {
    this._connected = false;
    if (!this.child) return;
    try { this.child.kill("SIGTERM"); } catch { /* ignore */ }
    this.child = null;
  }

  private async spawnChild(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.child = spawn(this.cfg.command, this.cfg.args, {
          env: { ...process.env, ...(this.cfg.env || {}) },
          stdio: "pipe",
          shell: true
        }) as ChildProcessWithoutNullStreams;
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.child.stdout.setEncoding("utf8");
      this.child.stderr?.setEncoding("utf8");
      this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
      this.child.stderr?.on("data", (c: string) => {
        console.warn(`[mcp:${this.cfg.id}] ${c.trim()}`);
      });
      this.child.on("error", (err) => {
        if (!settled) { settled = true; reject(err); }
      });
      this.child.on("close", () => {
        this._connected = false;
      });
      queueMicrotask(() => {
        if (!settled) { settled = true; resolve(); }
      });
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const nl = this.stdoutBuffer.indexOf("\n");
      if (nl < 0) break;
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line); } catch { continue; }
      this.handler?.(msg);
    }
  }
}

/* ========================================================================== */
/* HttpTransport (streamable HTTP)                                             */
/* ========================================================================== */

export class HttpTransport implements McpTransportLayer {
  private handler: ((msg: Record<string, unknown>) => void) | null = null;
  private _connected = false;
  private sessionId: string | null = null;
  private sseController: AbortController | null = null;

  constructor(private readonly cfg: McpServerConfig) {}

  get connected(): boolean {
    return this._connected;
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connected = true;
  }

  /**
   * POST a JSON-RPC frame. If the response is `application/json`, parse and
   * dispatch. If `text/event-stream`, consume SSE frames and dispatch.
   */
  send(payload: Record<string, unknown>): void {
    void this.doPost(payload);
  }

  close(): void {
    this._connected = false;
    this.sessionId = null;
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
    }
  }

  private async doPost(payload: Record<string, unknown>): Promise<void> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60_000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.cfg.headers
      };
      if (this.sessionId) {
        headers["Mcp-Session-Id"] = this.sessionId;
      }
      const res = await fetch(this.cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal
      });
      if (!res.ok) {
        const body = await safeBody(res);
        this.handler?.({ id: payload.id, error: { code: res.status, message: `HTTP ${res.status}: ${body}` } });
        return;
      }
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/event-stream") && res.body) {
        await this.readSseFrames(res.body);
      } else {
        const json = await res.json();
        if (json && typeof json === "object") {
          this.handler?.(json as Record<string, unknown>);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this.handler?.({ id: payload.id, error: { code: -1, message: (e as Error).message } });
      }
    } finally {
      clearTimeout(t);
    }
  }

  private async readSseFrames(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let currentData = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (line === "") {
            if (currentData) {
              try {
                const msg = JSON.parse(currentData);
                if (msg && typeof msg === "object") this.handler?.(msg);
              } catch { /* malformed */ }
              currentData = "";
            }
          } else if (line.startsWith("data:")) {
            currentData += (currentData ? "\n" : "") + line.slice(5).trim();
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }
}

/* ========================================================================== */
/* SseTransport (legacy two-channel)                                           */
/* ========================================================================== */

export class SseTransport implements McpTransportLayer {
  private handler: ((msg: Record<string, unknown>) => void) | null = null;
  private _connected = false;
  private postUrl: string | null = null;
  private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sseAbort: AbortController | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly cfg: McpServerConfig) {}

  get connected(): boolean {
    return this._connected;
  }

  onMessage(handler: (msg: Record<string, unknown>) => void): void {
    this.handler = handler;
  }

  /**
   * Open the GET SSE stream and wait for the `event: endpoint` frame that
   * reveals the POST URL for client→server messages.
   */
  async connect(): Promise<void> {
    if (this._connected && this.postUrl) return;
    this.sseAbort = new AbortController();
    const res = await fetch(this.cfg.url, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...this.cfg.headers },
      signal: this.sseAbort.signal
    });
    if (!res.ok || !res.body) {
      throw new Error(`SSE connect failed HTTP ${res.status}`);
    }
    this.sseReader = res.body.getReader();
    this.postUrl = await this.waitForEndpoint(this.sseReader);
    this._connected = true;
    this.reconnectAttempt = 0;
    void this.sseLoop(this.sseReader);
  }

  send(payload: Record<string, unknown>): void {
    if (!this.postUrl) throw new Error("transport_closed");
    void this.doPost(payload);
  }

  close(): void {
    this._connected = false;
    this.postUrl = null;
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = null;
    }
    if (this.sseReader) {
      try { this.sseReader.cancel(); } catch { /* ignore */ }
      this.sseReader = null;
    }
  }

  /**
   * Read SSE frames until we see `event: endpoint` and extract its data
   * as the POST URL. Remaining lines stay in the reader for `sseLoop`.
   */
  private async waitForEndpoint(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<string> {
    const decoder = new TextDecoder();
    let buf = "";
    let currentEvent = "message";
    let currentData = "";
    const timeoutMs = 15_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE stream closed before endpoint event");
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          if (currentEvent === "endpoint" && currentData) {
            return new URL(currentData, this.cfg.url).toString();
          }
          if (currentData) {
            try {
              const msg = JSON.parse(currentData);
              if (msg && typeof msg === "object") this.handler?.(msg);
            } catch { /* ignore */ }
          }
          currentEvent = "message";
          currentData = "";
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData += (currentData ? "\n" : "") + line.slice(5).trim();
        }
      }
    }
    throw new Error("SSE endpoint not discovered within timeout");
  }

  /**
   * Continuously read the SSE channel after endpoint discovery, dispatching
   * incoming JSON-RPC messages to the handler.
   */
  private async sseLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    let currentData = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (line === "") {
            if (currentData) {
              try {
                const msg = JSON.parse(currentData);
                if (msg && typeof msg === "object") this.handler?.(msg);
              } catch { /* malformed */ }
              currentData = "";
            }
          } else if (line.startsWith("data:")) {
            currentData += (currentData ? "\n" : "") + line.slice(5).trim();
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.warn(`[mcp:${this.cfg.id}] SSE loop error`, e);
    } finally {
      this._connected = false;
      if (this.reconnectAttempt < 4) {
        this.reconnectAttempt += 1;
        const delay = Math.min(8000, 250 * Math.pow(2, this.reconnectAttempt));
        setTimeout(() => {
          this.connect().catch((e) =>
            console.warn(`[mcp:${this.cfg.id}] SSE reconnect failed`, e)
          );
        }, delay);
      }
    }
  }

  private async doPost(payload: Record<string, unknown>): Promise<void> {
    if (!this.postUrl) return;
    try {
      const res = await fetch(this.postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.cfg.headers },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await safeBody(res);
        this.handler?.({
          id: payload.id,
          error: { code: res.status, message: `POST failed HTTP ${res.status}: ${body}` }
        });
      }
      // For SSE transport, the response comes back via the SSE channel,
      // not the POST response body — so we don't parse the body.
    } catch (e) {
      this.handler?.({
        id: payload.id,
        error: { code: -1, message: (e as Error).message }
      });
    }
  }
}

/* ========================================================================== */
/* McpConnection (transport-agnostic)                                          */
/* ========================================================================== */

function createTransport(cfg: McpServerConfig): McpTransportLayer {
  switch (cfg.transport) {
    case "stdio":
      return new StdioTransport(cfg);
    case "http":
      return new HttpTransport(cfg);
    case "sse":
      return new SseTransport(cfg);
    default:
      throw new Error(`unsupported MCP transport: ${cfg.transport}`);
  }
}

export class McpConnection {
  private transport: McpTransportLayer;
  private pending = new Map<string | number, PendingRequest>();
  private initialised = false;
  private cachedTools: McpToolDescriptor[] | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly cfg: McpServerConfig) {
    this.transport = createTransport(cfg);
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  async connect(): Promise<void> {
    if (this.initialised && this.transport.connected) return;
    await this.transport.connect();

    if (this.cfg.transport === "stdio") {
      this.transport.onMessage((msg) => this.handleMessage(msg));
    }

    await this.rpcRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: CLIENT_INFO
    });
    this.writeNotification("notifications/initialized");
    this.initialised = true;
    this.reconnectAttempt = 0;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.cachedTools) return this.cachedTools;
    await this.connect();
    const result = (await this.rpcRequest("tools/list", {})) as {
      tools?: McpToolDescriptor[];
    };
    this.cachedTools = result.tools ?? [];
    return this.cachedTools;
  }

  async callTool(
    name: string,
    args: unknown,
    signal: AbortSignal
  ): Promise<McpCallResult> {
    await this.connect();
    const payload = {
      name,
      arguments: (args && typeof args === "object" ? args : {}) as Record<string, unknown>
    };
    const id = randomUUID();
    const promise = new Promise<McpCallResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v: unknown) => {
          const r = v as {
            content?: Array<{ type: string; [k: string]: unknown }>;
            isError?: boolean;
          };
          resolve({ content: r.content ?? [], isError: !!r.isError });
        },
        reject
      });
    });
    this.transport.send({ jsonrpc: "2.0", id, method: "tools/call", params: payload });
    if (signal.aborted) {
      this.pending.delete(id);
      throw new Error("aborted");
    }
    const onAbort = () => {
      this.pending.delete(id);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  close(): void {
    this.transport.close();
    this.initialised = false;
    this.cachedTools = null;
    this.failPending(new Error("transport_closed"));
  }

  /* ------------------------------ internals ------------------------------- */

  private rpcRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.transport.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private writeNotification(method: string): void {
    try {
      this.transport.send({ jsonrpc: "2.0", method });
    } catch { /* best-effort */ }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.id === undefined || msg.id === null) return;
    const id = msg.id as string | number;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (msg.error) {
      const err = msg.error as { code?: number; message?: string };
      p.reject(new Error(err.message || `MCP error ${err.code ?? "?"}`));
      return;
    }
    p.resolve(msg.result);
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}
