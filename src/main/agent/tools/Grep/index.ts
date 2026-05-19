/**
 * Grep tool — full-text search over project files.
 *
 * Implementation strategy:
 *  - Prefer `rg` (ripgrep) via `child_process.spawn` when it is on PATH.
 *    `which rg` is checked once per process and cached.
 *  - Fall back to a tiny JS walker reusing Glob's `walk` ignore set;
 *    we read each file (skip binaries via NUL-byte sniff) and run a
 *    compiled RegExp against the content. This is slower but works on
 *    minimal sandboxes where `rg` isn't installed.
 *
 * Three output modes match the rg semantics the model is most likely
 * to want:
 *   - "content"            — `path:line:column:text` rows (default)
 *   - "files_with_matches" — one path per line
 *   - "count"              — `path:matches` per file
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";
import { compileGlob } from "../Glob/index.js";

const inputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe("Regular expression to search for. Use ripgrep syntax (no /…/ delimiters)."),
  path: z
    .string()
    .optional()
    .describe("Directory or file (relative to project root) to scope the search to. Defaults to the project root."),
  glob: z
    .string()
    .optional()
    .describe("Restrict matches to files whose project-relative path matches this glob (e.g. `**/*.ts`)."),
  type: z
    .enum(["js", "ts", "tsx", "jsx", "py", "rust", "go", "java", "md", "json", "yaml", "html", "css"])
    .optional()
    .describe("Restrict to a common file type. Mapped to `rg --type` when ripgrep is available."),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe("'content' (default) shows matching lines; 'files_with_matches' lists matched files; 'count' shows match counts per file."),
  "-i": z.boolean().optional().describe("Case-insensitive."),
  "-A": z.number().int().min(0).max(50).optional().describe("Lines of context AFTER each match (content mode only)."),
  "-B": z.number().int().min(0).max(50).optional().describe("Lines of context BEFORE each match (content mode only)."),
  "-C": z.number().int().min(0).max(50).optional().describe("Lines of context BEFORE and AFTER each match (content mode only)."),
  multiline: z.boolean().optional().describe("Allow patterns to span lines (rg -U --multiline-dotall)."),
  head_limit: z.number().int().min(1).max(10000).optional().describe("Cap the number of result lines/files. Default 200.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  pattern: string;
  outputMode: "content" | "files_with_matches" | "count";
  text: string;
  matchCount: number;
  truncated: boolean;
  engine: "rg" | "fallback";
}

const DEFAULT_LIMIT = 200;
const MAX_TEXT_BYTES = 1_000_000; // 1 MB cap on total output text
const RG_TYPE_MAP: Record<string, string> = {
  js: "js",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  py: "py",
  rust: "rust",
  go: "go",
  java: "java",
  md: "md",
  json: "json",
  yaml: "yaml",
  html: "html",
  css: "css"
};

const FALLBACK_EXT_MAP: Record<string, string[]> = {
  js: [".js", ".mjs", ".cjs"],
  ts: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  jsx: [".jsx"],
  py: [".py", ".pyi"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  md: [".md", ".markdown"],
  json: [".json"],
  yaml: [".yml", ".yaml"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass"]
};

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "dist-electron",
  "build",
  ".cache",
  ".pnpm-store",
  "coverage",
  "release"
]);

let rgAvailable: boolean | null = null;
async function checkRg(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;
  rgAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn("rg", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  return rgAvailable;
}

export const GrepTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Grep",
  aliases: ["rg", "fs_grep"],
  description: "Full-text search inside the project.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Search file contents for a regex pattern (ripgrep syntax). Uses `rg` when available.",
      "Pick `output_mode='files_with_matches'` when you just need a path list (faster + smaller).",
      "Use `glob` or `type` to scope the search; don't pass unscoped patterns over a huge tree.",
      "Skips `.git`, `node_modules`, build/dist directories automatically."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const root = ctx.projectRoot;
    const searchPath = input.path
      ? path.resolve(root, input.path)
      : root;
    const guard = await validateProjectPath(searchPath, root, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    const outputMode = input.output_mode ?? "content";
    const limit = input.head_limit ?? DEFAULT_LIMIT;

    if (await checkRg()) {
      return runWithRg(input, guard.resolved, root, outputMode, limit, ctx.signal);
    }
    return runFallback(input, guard.resolved, root, outputMode, limit, ctx.signal);
  },
  mapResultToBlock(out, toolUseId) {
    const header = `Grep (${out.engine}) — ${out.matchCount} match${out.matchCount === 1 ? "" : "es"}${
      out.truncated ? ", truncated" : ""
    } for /${out.pattern}/`;
    return blockFromText(toolUseId, `${header}\n${out.text || "(no matches)"}`);
  },
  renderResultForUI(out) {
    return {
      variant: out.matchCount > 0 ? "ok" : "warning",
      title: `Grep  /${out.pattern}/  (${out.matchCount}${out.truncated ? "+" : ""})`,
      body: out.text.split("\n").slice(0, 80).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "Grep", subtitle: input.pattern };
  }
});

/* -------------------------------------------------------------------------- */
/* rg backend                                                                 */
/* -------------------------------------------------------------------------- */

async function runWithRg(
  input: Input,
  searchPath: string,
  root: string,
  outputMode: Output["outputMode"],
  limit: number,
  signal: AbortSignal
): Promise<ToolResult<Output>> {
  const args: string[] = ["--color", "never", "--no-heading"];
  if (input["-i"]) args.push("-i");
  if (input.multiline) args.push("-U", "--multiline-dotall");
  if (input.type) {
    const t = RG_TYPE_MAP[input.type];
    if (t) args.push("--type", t);
  }
  if (input.glob) args.push("-g", input.glob);
  if (outputMode === "files_with_matches") args.push("-l");
  else if (outputMode === "count") args.push("-c");
  else {
    args.push("-n");
    args.push("--column");
    if (typeof input["-C"] === "number") args.push("-C", String(input["-C"]));
    else {
      if (typeof input["-A"] === "number") args.push("-A", String(input["-A"]));
      if (typeof input["-B"] === "number") args.push("-B", String(input["-B"]));
    }
  }
  args.push("-e", input.pattern);
  args.push(searchPath);

  const child = spawn("rg", args, { cwd: root });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let stdoutBytes = 0;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (stdoutBytes < MAX_TEXT_BYTES) {
      const remaining = MAX_TEXT_BYTES - stdoutBytes;
      const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      stdout += slice;
      stdoutBytes += Buffer.byteLength(slice, "utf8");
      if (chunk.length > slice.length) truncated = true;
    } else {
      truncated = true;
    }
  });
  child.stderr?.on("data", (c: string) => {
    stderr += c;
  });

  const onAbort = () => child.kill("SIGTERM");
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  signal.removeEventListener("abort", onAbort);

  // rg exit codes: 0 = matches, 1 = no matches, 2 = error.
  if (exitCode === 2) {
    return { ok: false, errorCode: "rg_failed", errorMessage: stderr.trim() || "rg failed" };
  }
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  const headed = lines.slice(0, limit);
  const text = headed.map((l) => makeRelative(l, root)).join("\n");
  const matchCount = exitCode === 1 ? 0 : countMatches(lines, outputMode);
  return {
    ok: true,
    value: {
      pattern: input.pattern,
      outputMode,
      text,
      matchCount,
      truncated: truncated || lines.length > headed.length,
      engine: "rg"
    }
  };
}

function makeRelative(line: string, root: string): string {
  // rg lines either start with the absolute path or — when relative — the same. Normalise.
  const idx = line.indexOf(":");
  if (idx <= 0) return line;
  const head = line.slice(0, idx);
  const rest = line.slice(idx);
  const rel = path.isAbsolute(head) ? path.relative(root, head) : head;
  return rel + rest;
}

function countMatches(lines: string[], mode: Output["outputMode"]): number {
  if (mode === "files_with_matches") return lines.length;
  if (mode === "count") {
    let n = 0;
    for (const l of lines) {
      const m = l.match(/:(\d+)\s*$/);
      if (m) n += Number(m[1]) || 0;
    }
    return n;
  }
  return lines.filter((l) => /^[^:]+:\d+/.test(l)).length;
}

/* -------------------------------------------------------------------------- */
/* JS fallback                                                                */
/* -------------------------------------------------------------------------- */

async function runFallback(
  input: Input,
  searchPath: string,
  root: string,
  outputMode: Output["outputMode"],
  limit: number,
  signal: AbortSignal
): Promise<ToolResult<Output>> {
  let regex: RegExp;
  try {
    const flags = (input["-i"] ? "i" : "") + (input.multiline ? "ms" : "g");
    regex = new RegExp(input.pattern, flags.includes("g") ? flags : flags + "g");
  } catch (e) {
    return { ok: false, errorCode: "bad_regex", errorMessage: (e as Error).message };
  }
  const globMatcher = input.glob ? compileGlob(input.glob.startsWith("**/") ? input.glob : `**/${input.glob}`) : null;
  const allowedExts = input.type ? FALLBACK_EXT_MAP[input.type] : null;

  const filesWithMatches: string[] = [];
  const countLines: string[] = [];
  const contentLines: string[] = [];
  let total = 0;
  let truncated = false;

  for await (const file of walk(searchPath, signal)) {
    if (signal.aborted) break;
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (globMatcher && !globMatcher(rel)) continue;
    if (allowedExts && !allowedExts.some((e) => file.endsWith(e))) continue;
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue; // binary
    const text = buf.toString("utf8");
    let count = 0;
    if (outputMode === "content") {
      const fileLines = text.split(/\r?\n/);
      for (let i = 0; i < fileLines.length; i++) {
        if (regex.test(fileLines[i])) {
          contentLines.push(`${rel}:${i + 1}:${fileLines[i]}`);
          count += 1;
          total += 1;
          if (total >= limit) {
            truncated = true;
            break;
          }
        }
        regex.lastIndex = 0;
      }
      if (truncated) break;
    } else {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        count += 1;
        if (m.index === regex.lastIndex) regex.lastIndex += 1;
      }
      regex.lastIndex = 0;
      if (count > 0) {
        filesWithMatches.push(rel);
        countLines.push(`${rel}:${count}`);
        total += outputMode === "files_with_matches" ? 1 : count;
        if (outputMode === "files_with_matches" && filesWithMatches.length >= limit) {
          truncated = true;
          break;
        }
        if (outputMode === "count" && countLines.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }

  if (signal.aborted) {
    return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
  }

  let text: string;
  let matchCount: number;
  if (outputMode === "files_with_matches") {
    text = filesWithMatches.join("\n");
    matchCount = filesWithMatches.length;
  } else if (outputMode === "count") {
    text = countLines.join("\n");
    matchCount = countLines.reduce((acc, l) => acc + (Number(l.split(":").pop()) || 0), 0);
  } else {
    text = contentLines.join("\n");
    matchCount = contentLines.length;
  }
  return {
    ok: true,
    value: {
      pattern: input.pattern,
      outputMode,
      text,
      matchCount,
      truncated,
      engine: "fallback"
    }
  };
}

async function* walk(root: string, signal: AbortSignal): AsyncGenerator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal.aborted) return;
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (signal.aborted) return;
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) yield full;
    }
  }
}
