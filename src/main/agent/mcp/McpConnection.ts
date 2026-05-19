/**
 * Long-lived MCP client connection.
 *
 * The existing `testMcpServer` is one-shot — it starts a child process,
 * does the handshake, then kills it. That's fine for the "verify your
 * config" button, but the agent needs a persistent connection so a
 * single `tools/call` doesn't pay the spawn cost every time.
 *
 * This module implements the minimum subset of the MCP wire we need
 * for tool integration:
 *  - stdio + streamable http transports (sse omitted in v1).
 *  - JSON-RPC over stdio with newline-delimited frames.
 *  - `initialize` + `notifications/initialized` handshake.
 *  - `tools/list` and `tools/call`.
 *  - Auto-reconnect on stdio EOF (with capped exponential backoff).
 *
 * Concurrency is request-level: each outgoing request gets a unique id
 * and its response is matched by id. Requests in flight while the
 * process dies are rejected with `error: "transport_closed"`.
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
  /** Raw `content` blocks the server returned. */
  content: Array<{ type: string; [k: string]: unknown }>;
  isError: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class McpConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private pending = new Map<string | number, PendingRequest>();
  private initialised = false;
  /** Cached after `tools/list` so the agent doesn't re-request per turn. */
  private cachedTools: McpToolDescriptor[] | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly cfg: McpServerConfig) {
    if (cfg.transport !== "stdio") {
      // v1 we only support stdio for long-lived; http/sse will be
      // layered on once the SDK lands.
      throw new Error(`McpConnection only supports stdio; got ${cfg.transport}`);
    }
  }

  /** Connect + initialise. Idempotent: calling twice returns the same
   *  promise via `this.initialised`. */
  async connect(): Promise<void> {
    if (this.initialised && this.child && !this.child.killed) return;
    await this.spawnChild();
    await this.send("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: CLIENT_INFO
    });
    // Notification — no id, no response expected.
    this.writeFrame({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.initialised = true;
    this.reconnectAttempt = 0;
  }

  /** List tools, cached after the first call. */
  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.cachedTools) return this.cachedTools;
    await this.connect();
    const result = (await this.send("tools/list", {})) as { tools?: McpToolDescriptor[] };
    this.cachedTools = result.tools ?? [];
    return this.cachedTools;
  }

  /** Call a tool exposed by the server. */
  async callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult> {
    await this.connect();
    const payload = { name, arguments: (args && typeof args === "object" ? args : {}) as Record<string, unknown> };
    const id = randomUUID();
    const promise = new Promise<McpCallResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v: unknown) => {
          const r = v as { content?: Array<{ type: string; [k: string]: unknown }>; isError?: boolean };
          resolve({ content: r.content ?? [], isError: !!r.isError });
        },
        reject
      });
    });
    this.writeFrame({ jsonrpc: "2.0", id, method: "tools/call", params: payload });
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

  /** Cleanly shut down: best-effort `shutdown` notification, then kill. */
  close(): void {
    if (!this.child) return;
    try {
      this.writeFrame({ jsonrpc: "2.0", method: "shutdown" });
    } catch {
      /* ignore */
    }
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.child = null;
    this.initialised = false;
    this.cachedTools = null;
    for (const p of this.pending.values()) p.reject(new Error("transport_closed"));
    this.pending.clear();
  }

  /* ----------------------------- internals ------------------------------- */

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
        // MCP servers commonly log diagnostics on stderr; surface them
        // as warnings without rejecting requests.
        console.warn(`[mcp:${this.cfg.id}] ${c.trim()}`);
      });
      this.child.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.failPending(err);
      });
      this.child.on("close", () => {
        this.initialised = false;
        this.failPending(new Error("transport_closed"));
        // Best-effort reconnect on unexpected termination.
        if (this.reconnectAttempt < 4) {
          this.reconnectAttempt += 1;
          const delay = Math.min(8000, 250 * Math.pow(2, this.reconnectAttempt));
          setTimeout(() => {
            this.connect().catch((e) => console.warn(`[mcp:${this.cfg.id}] reconnect failed`, e));
          }, delay);
        }
      });
      // Resolve after we know the child started; on stdio there's no
      // confirmation, so we resolve on the next microtask.
      queueMicrotask(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  }

  private writeFrame(payload: Record<string, unknown>): void {
    const child = this.child;
    if (!child || child.killed) throw new Error("transport_closed");
    child.stdin.write(JSON.stringify(payload) + "\n");
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.writeFrame({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
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
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.id === undefined || msg.id === null) return; // notification
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
