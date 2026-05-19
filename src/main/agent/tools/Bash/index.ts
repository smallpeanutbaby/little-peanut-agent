/**
 * Bash tool — run a shell command inside the project root.
 *
 * v1 safety stance:
 *  - Default decision is `ask` for every command (the gate will collapse
 *    repeat asks into a one-click "always allow this command" in M1).
 *  - A basic risk classifier flags catastrophic patterns (sudo, rm -rf,
 *    curl|sh, dd to /dev/sd*, fork bombs) and downgrades to `deny`. The
 *    full classifier lands in M1-2; this v0 list catches the common bad
 *    cases.
 *  - Output is streamed via `onProgress` so the renderer can show stdout
 *    live; we cap captured output at 100 KB to keep model context sane
 *    and spill the full log to a file (returned in `output.logPath`)
 *    when truncation kicks in.
 *  - Default timeout is 120 s; long-running commands abort cleanly via
 *    the run AbortSignal.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { classifyBashRisk } from "../../permissions/bashRisk.js";

const inputSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "The shell command to execute. Quote paths that contain spaces. Avoid backgrounding; use the runtime's task system for long-running processes."
    ),
  description: z
    .string()
    .max(120)
    .optional()
    .describe("Short human description (5-10 words) of what this command does."),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe("Override the default 120s timeout. Capped at 10 minutes.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  truncated: boolean;
  /** Absolute path to the spilled full log when output was truncated. */
  logPath: string | null;
}

const MAX_CAPTURE_BYTES = 100 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export const BashTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Bash",
  aliases: ["shell"],
  description: "Run a shell command in the project root.",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isDestructive: () => true,
  prompt: () =>
    [
      "Run a shell command in the project root.",
      "Default cwd is the active project; default shell is bash -lc (macOS/Linux) or pwsh -c (Windows).",
      "Output is streamed; up to 100 KB is captured for the model. Longer logs spill to a file you can ask the user to inspect.",
      "Every command goes through a risk classifier. Avoid `sudo`, `rm -rf /`, `curl … | sh`, redirects to raw block devices."
    ].join("\n"),
  checkPermissions(input: Input) {
    const risk = classifyBashRisk(input.command);
    if (risk.verdict === "deny") {
      return { behavior: "deny" as const, reason: risk.reason ?? "denied by risk classifier" };
    }
    // Even "safe" commands go to the gate so the user can install a
    // session-wide allow rule once and stop being prompted.
    return { behavior: "ask" as const, reason: risk.reason };
  },
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const isWin = process.platform === "win32";
    // Use an absolute path for the POSIX shell so we don't depend on the
    // electron-spawned process inheriting a usable PATH. macOS/Linux ship
    // bash at /bin/bash; if a user's distro really lacks it they can
    // symlink. On Windows we still rely on PATH for `pwsh`.
    const shell = isWin ? "pwsh" : "/bin/bash";
    const shellArgs = isWin ? ["-NoLogo", "-Command"] : ["-lc"];
    const cwd = ctx.projectRoot;

    // Validate cwd up-front. Without this check, spawn fails inside Node's
    // chdir() and the error message comes back as `spawn bash ENOENT`,
    // which is wildly misleading — users (rightfully) start hunting for a
    // missing bash binary when the real cause is "the project folder no
    // longer exists on disk". Catch it early with a useful message.
    try {
      const stat = await fs.stat(cwd);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          errorCode: "cwd_not_a_dir",
          errorMessage: `project root is not a directory: ${cwd}`
        };
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return {
          ok: false,
          errorCode: "cwd_missing",
          errorMessage:
            `项目目录不存在，无法执行命令: ${cwd}\n` +
            "请检查项目绑定的本地路径——文件夹可能已被删除、重命名或移动。"
        };
      }
      return {
        ok: false,
        errorCode: "cwd_unreadable",
        errorMessage: `cannot stat project root ${cwd}: ${(e as Error).message}`
      };
    }

    const startedAt = Date.now();
    const env = sanitiseEnv(process.env);

    const child = spawn(shell, [...shellArgs, input.command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      if (stdoutBytes < MAX_CAPTURE_BYTES) {
        const remaining = MAX_CAPTURE_BYTES - stdoutBytes;
        const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        stdout += slice;
        stdoutBytes += Buffer.byteLength(slice, "utf8");
        if (chunk.length > slice.length) truncated = true;
      } else {
        truncated = true;
      }
      ctx.onProgress?.({ message: "stdout", data: { stream: "stdout", chunk } });
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderrBytes < MAX_CAPTURE_BYTES) {
        const remaining = MAX_CAPTURE_BYTES - stderrBytes;
        const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        stderr += slice;
        stderrBytes += Buffer.byteLength(slice, "utf8");
        if (chunk.length > slice.length) truncated = true;
      } else {
        truncated = true;
      }
      ctx.onProgress?.({ message: "stderr", data: { stream: "stderr", chunk } });
    });

    // Wire ctx.signal -> SIGTERM (then SIGKILL after a grace period).
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000).unref();
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });

    // Timeout watchdog.
    const timeoutHandle = setTimeout(() => {
      ctx.onProgress?.({ message: `timeout after ${timeoutMs}ms — sending SIGTERM` });
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    timeoutHandle.unref();

    let exitCode: number | null = null;
    let signalName: NodeJS.Signals | null = null;
    let spawnError: Error | null = null;

    try {
      await new Promise<void>((resolve) => {
        child.on("error", (err) => {
          spawnError = err;
          resolve();
        });
        child.on("close", (code, signal) => {
          exitCode = code;
          signalName = signal;
          resolve();
        });
      });
    } finally {
      clearTimeout(timeoutHandle);
      ctx.signal.removeEventListener("abort", onAbort);
    }

    if (spawnError) {
      return { ok: false, errorCode: "spawn_failed", errorMessage: (spawnError as Error).message };
    }

    let logPath: string | null = null;
    if (truncated) {
      try {
        const file = path.join(tmpdir(), `agent-bash-${Date.now()}-${process.pid}.log`);
        await fs.writeFile(
          file,
          `# command:\n${input.command}\n\n# stdout (truncated to ${MAX_CAPTURE_BYTES} bytes captured):\n${stdout}\n\n# stderr:\n${stderr}\n`,
          "utf8"
        );
        logPath = file;
      } catch {
        /* best-effort */
      }
    }

    return {
      ok: true,
      value: {
        command: input.command,
        stdout,
        stderr,
        exitCode,
        signal: signalName,
        durationMs: Date.now() - startedAt,
        truncated,
        logPath
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const lines: string[] = [];
    lines.push(`$ ${out.command}`);
    if (out.stdout) lines.push("--- stdout ---", out.stdout.trimEnd());
    if (out.stderr) lines.push("--- stderr ---", out.stderr.trimEnd());
    if (out.exitCode !== 0 && out.exitCode !== null) {
      lines.push(`(exit code ${out.exitCode})`);
    } else if (out.signal) {
      lines.push(`(killed by ${out.signal})`);
    } else if (out.exitCode === 0) {
      lines.push(`(exit code 0)`);
    }
    if (out.truncated) {
      lines.push(`(output truncated; full log: ${out.logPath ?? "<unavailable>"})`);
    }
    const isError = out.exitCode !== null && out.exitCode !== 0;
    return blockFromText(toolUseId, lines.join("\n"), isError);
  },
  renderResultForUI(out) {
    const isError = out.exitCode !== null && out.exitCode !== 0;
    return {
      variant: isError ? "error" : "ok",
      title: `$ ${out.command}  (exit ${out.exitCode ?? out.signal ?? "?"})`,
      body: (out.stdout || "") + (out.stderr ? `\n${out.stderr}` : ""),
      data: { durationMs: out.durationMs, truncated: out.truncated, logPath: out.logPath }
    };
  },
  renderUseForUI(input) {
    return { label: "Bash", subtitle: input.command };
  }
});

/** Strip env vars that leak host context (npm_*, CURSOR_*, CI runner
 *  state) or carry credentials we shouldn't expose to spawned shells. */
function sanitiseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k.startsWith("npm_")) continue;
    if (k.startsWith("CURSOR_")) continue;
    out[k] = v;
  }
  return out;
}
