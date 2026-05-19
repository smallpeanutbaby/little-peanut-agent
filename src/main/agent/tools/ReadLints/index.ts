/**
 * ReadLints tool — surface lint / typecheck diagnostics to the model.
 *
 * v1 strategy: shell out to `tsc --noEmit --pretty false` for type
 * errors and `eslint --format json --no-error-on-unmatched-pattern` for
 * style errors. We scope both to the requested paths (default: project
 * root) and parse their outputs into a uniform list of
 * `{ file, line, column, code, severity, message }`.
 *
 * The tool prefers locally-installed binaries via `npx --no-install`
 * (so we never silently download anything during an agent run); when a
 * tool is unavailable we skip it and add a note rather than failing.
 *
 * Output is intentionally compact — agents waste context on lint
 * tables; the formatted text block shows up to 80 diagnostics with a
 * trailing "+N more" hint.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

const inputSchema = z.object({
  paths: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe("Files or directories (relative to project root) to scope linting to. Defaults to the whole project."),
  include: z
    .array(z.enum(["tsc", "eslint"]))
    .optional()
    .describe("Which checkers to run. Defaults to both when their binaries are available.")
});

type Input = z.infer<typeof inputSchema>;

interface Diagnostic {
  source: "tsc" | "eslint";
  file: string;
  line: number;
  column: number;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
}

interface Output {
  diagnostics: Diagnostic[];
  ran: string[];
  skipped: string[];
  truncated: boolean;
}

const DEFAULT_INCLUDE: ReadonlyArray<"tsc" | "eslint"> = ["tsc", "eslint"];
const HARD_LIMIT = 1000;
const PREVIEW_LIMIT = 80;
const TIMEOUT_MS = 60_000;

export const ReadLintsTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "ReadLints",
  aliases: ["read_lints", "diagnostics"],
  description: "Run tsc + eslint and return parsed diagnostics for the given paths.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Get type and lint diagnostics for the given files/dirs. Wraps `tsc --noEmit` and `eslint --format json`.",
      "Use this after Edit/Write to confirm you haven't broken the build.",
      "Returns up to 1000 diagnostics; output text shows the first 80."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const root = ctx.projectRoot;
    const requested = input.paths && input.paths.length > 0 ? input.paths : ["."];
    const resolved: string[] = [];
    for (const p of requested) {
      const guard = await validateProjectPath(p, root, {
        mustExist: true,
        additionalWorkingDirectories: ctx.additionalWorkingDirectories
      });
      if (!guard.ok || !guard.resolved) {
        return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? `invalid path ${p}` };
      }
      resolved.push(guard.resolved);
    }
    const include = input.include ?? DEFAULT_INCLUDE;
    const diagnostics: Diagnostic[] = [];
    const ran: string[] = [];
    const skipped: string[] = [];

    if (include.includes("tsc")) {
      const r = await runTsc(root, ctx.signal);
      if (r.kind === "ok") {
        diagnostics.push(...r.diagnostics);
        ran.push("tsc");
      } else {
        skipped.push(`tsc: ${r.reason}`);
      }
    }
    if (include.includes("eslint")) {
      const r = await runEslint(root, resolved, ctx.signal);
      if (r.kind === "ok") {
        diagnostics.push(...r.diagnostics);
        ran.push("eslint");
      } else {
        skipped.push(`eslint: ${r.reason}`);
      }
    }

    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }

    const filtered = diagnostics.filter((d) =>
      resolved.some((root) => d.file === root || d.file.startsWith(root + path.sep))
    );
    const truncated = filtered.length > HARD_LIMIT;
    return {
      ok: true,
      value: {
        diagnostics: filtered.slice(0, HARD_LIMIT),
        ran,
        skipped,
        truncated
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    if (out.diagnostics.length === 0) {
      const note = out.skipped.length > 0 ? `\n(skipped: ${out.skipped.join("; ")})` : "";
      return blockFromText(toolUseId, `No diagnostics from ${out.ran.join(" + ") || "(none)"}${note}.`);
    }
    const head = out.diagnostics.slice(0, PREVIEW_LIMIT);
    const tail = out.diagnostics.length - head.length;
    const lines = head.map(
      (d) => `[${d.severity[0].toUpperCase()}] ${d.file}:${d.line}:${d.column}  ${d.code}  ${d.message}`
    );
    if (tail > 0) lines.push(`… +${tail} more`);
    const skippedNote = out.skipped.length > 0 ? `\n(skipped: ${out.skipped.join("; ")})` : "";
    return blockFromText(toolUseId, `${out.diagnostics.length} diagnostics from ${out.ran.join(" + ") || "(none)"}${skippedNote}:\n\n${lines.join("\n")}`);
  },
  renderResultForUI(out) {
    return {
      variant: out.diagnostics.length === 0 ? "ok" : "warning",
      title: `Lints  ${out.diagnostics.length}  (${out.ran.join(" + ") || "skipped"})`
    };
  },
  renderUseForUI(input) {
    return { label: "ReadLints", subtitle: (input.paths ?? ["."]).join(", ") };
  }
});

/* -------------------------------------------------------------------------- */
/* tsc                                                                        */
/* -------------------------------------------------------------------------- */

type RunResult = { kind: "ok"; diagnostics: Diagnostic[] } | { kind: "skipped"; reason: string };

async function runTsc(cwd: string, signal: AbortSignal): Promise<RunResult> {
  const out = await spawnCmd("npx", ["--no-install", "tsc", "--noEmit", "--pretty", "false"], cwd, signal);
  if (out.kind === "missing") return { kind: "skipped", reason: "tsc not installed" };
  if (out.kind === "error") return { kind: "skipped", reason: out.message };
  const diagnostics: Diagnostic[] = [];
  // tsc lines: "src/main/index.ts(12,5): error TS1234: Cannot find name 'foo'."
  const re = /^([^:\r\n]+?)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out.stdout)) !== null) {
    const sev: Diagnostic["severity"] = m[4] === "warning" ? "warning" : m[4] === "message" ? "info" : "error";
    diagnostics.push({
      source: "tsc",
      file: path.isAbsolute(m[1]) ? m[1] : path.resolve(cwd, m[1]),
      line: Number(m[2]),
      column: Number(m[3]),
      code: m[5],
      severity: sev,
      message: m[6].trim()
    });
  }
  return { kind: "ok", diagnostics };
}

/* -------------------------------------------------------------------------- */
/* eslint                                                                     */
/* -------------------------------------------------------------------------- */

async function runEslint(cwd: string, scope: string[], signal: AbortSignal): Promise<RunResult> {
  const args = [
    "--no-install",
    "eslint",
    "--format",
    "json",
    "--no-error-on-unmatched-pattern",
    ...scope
  ];
  const out = await spawnCmd("npx", args, cwd, signal);
  if (out.kind === "missing") return { kind: "skipped", reason: "eslint not installed" };
  if (out.kind === "error") return { kind: "skipped", reason: out.message };
  const text = (out.stdout || "").trim();
  if (!text || (!text.startsWith("[") && !text.startsWith("{"))) {
    return { kind: "ok", diagnostics: [] };
  }
  let parsed: Array<{
    filePath: string;
    messages: Array<{ ruleId: string | null; severity: number; line: number; column: number; message: string }>;
  }>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "skipped", reason: "could not parse eslint output" };
  }
  const diagnostics: Diagnostic[] = [];
  for (const file of parsed) {
    for (const msg of file.messages) {
      diagnostics.push({
        source: "eslint",
        file: file.filePath,
        line: msg.line,
        column: msg.column,
        code: msg.ruleId ?? "eslint",
        severity: msg.severity === 2 ? "error" : "warning",
        message: msg.message
      });
    }
  }
  return { kind: "ok", diagnostics };
}

/* -------------------------------------------------------------------------- */
/* spawn helper                                                               */
/* -------------------------------------------------------------------------- */

type SpawnOut =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: number | null }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function spawnCmd(cmd: string, args: string[], cwd: string, signal: AbortSignal): Promise<SpawnOut> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { cwd, env: process.env });
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => child.kill("SIGTERM");
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr?.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (err.code === "ENOENT") resolve({ kind: "missing" });
      else resolve({ kind: "error", message: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ kind: "ok", stdout, stderr, exitCode: code });
    });
  });
}
