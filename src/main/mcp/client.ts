import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig, McpTestResult } from "@shared/types.js";

/**
 * Minimal MCP (Model Context Protocol) client implementations focused on the
 * `initialize` handshake — enough to validate that a configured server is
 * reachable and speaks the protocol. We deliberately avoid pulling in the
 * heavyweight @modelcontextprotocol/sdk for this read-only smoke test; full
 * tool invocation can be layered on later.
 *
 * MCP wire format (JSON-RPC 2.0):
 *   request:  { jsonrpc: "2.0", id, method, params }
 *   response: { jsonrpc: "2.0", id, result }    | { jsonrpc, id, error }
 *
 * Initialize params we send:
 *   {
 *     protocolVersion: "2024-11-05",
 *     capabilities: { roots: { listChanged: true }, sampling: {} },
 *     clientInfo: { name: "little-peanut-agent", version: "0.1.0" }
 *   }
 *
 * Server replies with { protocolVersion, serverInfo:{name,version}, capabilities }
 * and we extract those for the UI.
 */

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "little-peanut-agent", version: "0.1.0" };
const INITIALIZE_PARAMS = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { roots: { listChanged: true }, sampling: {} },
  clientInfo: CLIENT_INFO
};
const DEFAULT_TIMEOUT_MS = 12_000;

export async function testMcpServer(cfg: McpServerConfig): Promise<McpTestResult> {
  const started = Date.now();
  try {
    let raw: { protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> };
    if (cfg.transport === "stdio") raw = await testStdio(cfg);
    else if (cfg.transport === "http") raw = await testStreamableHttp(cfg);
    else raw = await testSse(cfg);
    const latency = Date.now() - started;
    return {
      ok: true,
      latencyMs: latency,
      serverInfo: {
        name: raw.serverInfo?.name,
        version: raw.serverInfo?.version,
        protocolVersion: raw.protocolVersion
      },
      capabilities: Object.keys(raw.capabilities ?? {})
    };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: (e as Error).message || "未知错误"
    };
  }
}

/* -------------------------------------------------------------------------- */
/* stdio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Spawn the configured command and exchange newline-delimited JSON-RPC frames
 * over stdin/stdout. We send `initialize`, await its response, then send the
 * `notifications/initialized` notification, then kill the child.
 *
 * Cross-platform note: on Windows, `spawn` won't resolve `cmd.exe`-style PATH
 * lookups for `npx` / `node` / shell builtins unless `shell:true`. We enable
 * `shell` so commands like `npx @modelcontextprotocol/server-filesystem ...`
 * work straight from the form.
 *
 * SECURITY: `shell: true` means `cfg.command` is interpreted by cmd.exe with
 * shell metacharacters (`&`, `|`, `>`, backticks, etc.) honored. Both
 * `cfg.command` and `cfg.args` ultimately originate from the user-facing
 * "Add MCP Server" form. This is acceptable for a desktop app where the user
 * controls their own config, but we MUST NOT add any feature that auto-fills
 * `command` from a remote source (registry / import URL / clipboard auto-add)
 * without first prompting the user to confirm the literal command line. The
 * UI surfaces a "command runs as your local user" warning in the form.
 */
async function testStdio(cfg: McpServerConfig): Promise<{ protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> }> {
  if (!cfg.command.trim()) throw new Error("未配置启动命令");
  const child: ChildProcessWithoutNullStreams = spawn(cfg.command, cfg.args, {
    env: { ...process.env, ...cfg.env },
    shell: process.platform === "win32",
    windowsHide: true
  });

  // Aggregate stderr so we can surface a meaningful failure reason.
  let stderrBuf = "";
  child.stderr.on("data", (d: Buffer) => { stderrBuf += d.toString("utf8"); });

  // We expect line-delimited JSON-RPC on stdout. Some servers do legacy MCP
  // (Content-Length framing), but stdio MCP per spec is line-delimited JSON.
  const stdoutLines = readLines(child.stdout);

  const cleanup = () => {
    try { child.stdin.end(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
  };

  try {
    // Bail early if the child explodes immediately (e.g. command not found).
    const earlyExit = new Promise<never>((_, reject) => {
      child.once("error", (err) => reject(new Error(`启动失败: ${err.message}`)));
      child.once("exit", (code, signal) => {
        if (code !== 0) {
          const tail = stderrBuf.split("\n").slice(-5).join("\n").trim();
          reject(new Error(
            `进程已退出 (code=${code}${signal ? `, signal=${signal}` : ""})` +
            (tail ? `\n${tail}` : "")
          ));
        }
      });
    });

    const handshake = (async () => {
      sendStdio(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS });
      for await (const line of stdoutLines) {
        if (!line.trim()) continue;
        const msg = tryJson(line);
        if (!msg || msg.id !== 1) continue;
        if (msg.error) throw new Error(`MCP 服务器错误: ${msg.error.message ?? JSON.stringify(msg.error)}`);
        // Send initialized notification per spec (best-effort, ignore failures)
        try { sendStdio(child, { jsonrpc: "2.0", method: "notifications/initialized" }); } catch { /* ignore */ }
        return msg.result ?? {};
      }
      throw new Error("未收到 initialize 响应");
    })();

    return await Promise.race([
      handshake,
      earlyExit,
      sleepReject(DEFAULT_TIMEOUT_MS, `${DEFAULT_TIMEOUT_MS / 1000}s 未完成 initialize`)
    ]);
  } finally {
    cleanup();
  }
}

function sendStdio(child: ChildProcessWithoutNullStreams, msg: object) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

/** Convert a Readable stream of bytes into an async iterator of UTF-8 lines. */
async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
    }
  }
  if (buf) yield buf;
}

/* -------------------------------------------------------------------------- */
/* HTTP (streamable)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Streamable HTTP" MCP transport: single endpoint, POST returns either a
 * single JSON-RPC response (Content-Type: application/json) or a text/event-stream.
 * We accept both and parse the first server message with id=1.
 */
async function testStreamableHttp(cfg: McpServerConfig): Promise<{ protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> }> {
  if (!cfg.url.trim()) throw new Error("未配置 URL");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...cfg.headers
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS }),
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeBody(res)}`);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream") && res.body) {
      const result = await readFirstSseRpcResult(res.body, 1);
      return result;
    }
    const json = await res.json();
    if (json.error) throw new Error(`MCP 错误: ${json.error.message ?? JSON.stringify(json.error)}`);
    return json.result ?? {};
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------------------------------------------------- */
/* SSE (legacy two-channel)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Legacy SSE transport: the configured URL is the SSE endpoint that pushes
 * server messages; the first SSE event named `endpoint` reveals the POST URL
 * used for sending. We POST `initialize` there and read the response back from
 * the SSE stream.
 *
 * Servers in the wild also accept "send to same URL" — we try both shapes.
 */
async function testSse(cfg: McpServerConfig): Promise<{ protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> }> {
  if (!cfg.url.trim()) throw new Error("未配置 URL");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const sseRes = await fetch(cfg.url, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...cfg.headers },
      signal: ac.signal
    });
    if (!sseRes.ok || !sseRes.body) throw new Error(`SSE 连接失败 HTTP ${sseRes.status}`);

    // Concurrently: parse SSE for the endpoint announcement + JSON-RPC reply,
    // and POST the initialize request once we know where to send.
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let postSent = false;
    // Track the fire-and-forget POST so that if it fails (e.g. 401) we can
    // surface the error instead of just letting it sit as an unhandled
    // rejection. The SSE reader is the primary signal — but if no JSON-RPC
    // reply ever arrives AND the POST has already errored, we want to know.
    let postError: Error | null = null;

    const sendInitialize = async (postUrl: string) => {
      const target = new URL(postUrl, cfg.url).toString();
      const r = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cfg.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS }),
        signal: ac.signal
      });
      if (!r.ok) throw new Error(`initialize POST 失败 HTTP ${r.status}`);
    };

    let buf = "";
    let currentEvent = "message";
    let currentData = "";
    while (true) {
      // If the POST has failed, surface that immediately rather than waiting
      // out the whole timeout watching an SSE stream that will never reply.
      if (postError) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw postError;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE 流提前关闭");
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          // dispatch event
          if (currentEvent === "endpoint" && currentData && !postSent) {
            postSent = true;
            // Kick off the POST. We can't await it here (the response comes
            // back via the SSE channel, not via this fetch) but we DO need
            // to capture any error so the outer loop can react.
            sendInitialize(currentData).catch((err: Error) => {
              postError = err;
              try {
                void reader.cancel();
              } catch {
                /* ignore */
              }
            });
          } else if (currentData) {
            const msg = tryJson(currentData);
            if (msg && msg.id === 1) {
              if (msg.error) throw new Error(`MCP 错误: ${msg.error.message ?? JSON.stringify(msg.error)}`);
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
              return msg.result ?? {};
            }
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
  } finally {
    clearTimeout(t);
  }
}

/** Read SSE frames from a streamable HTTP response and return the first
 * JSON-RPC result matching the given id. */
async function readFirstSseRpcResult(
  stream: ReadableStream<Uint8Array>,
  id: number
): Promise<{ protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentData = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE 流提前关闭");
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          if (currentData) {
            const msg = tryJson(currentData);
            if (msg && msg.id === id) {
              if (msg.error) throw new Error(`MCP 错误: ${msg.error.message ?? JSON.stringify(msg.error)}`);
              return msg.result ?? {};
            }
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

/* -------------------------------------------------------------------------- */
/* Misc helpers                                                               */
/* -------------------------------------------------------------------------- */

function tryJson(s: string): { id?: number; result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string }; capabilities?: Record<string, unknown> }; error?: { message?: string } } | null {
  try { return JSON.parse(s); } catch { return null; }
}

function sleepReject(ms: number, reason: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
}

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 200); } catch { return ""; }
}
