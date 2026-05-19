/**
 * Glob tool — find files matching a glob pattern under the project root.
 *
 * v1 keeps the dependency surface small by shipping a tiny glob matcher
 * built on regex translation of `*` / `**` / `?`. It does not implement
 * brace-expansion or extended POSIX patterns; the model is told to keep
 * patterns simple (e.g. `**\/*.ts`, `src/**\/*.test.tsx`).
 *
 * Output is sorted by mtime descending so the most recently touched files
 * surface first (matches Claude Code's Glob behaviour and tends to be
 * what the model actually wants).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

const inputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe(
      "Glob pattern relative to the project root. Supports `*`, `**`, `?`. Patterns NOT starting with `**/` are auto-prepended with `**/` so callers can write e.g. `*.ts`."
    ),
  target_directory: z
    .string()
    .optional()
    .describe(
      "Optional sub-directory (relative to project root) to scope the search to. Defaults to the project root."
    ),
  head_limit: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe("Cap the number of matches returned. Default 200.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  pattern: string;
  root: string;
  files: Array<{ path: string; mtime: number; bytes: number }>;
  totalMatched: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 200;
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

export const GlobTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Glob",
  aliases: ["fs_glob"],
  description: "Find files by glob pattern under the project.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Find files by glob pattern under the project. Results sorted by recency (mtime desc).",
      "Skips `.git`, `node_modules`, build/dist directories automatically.",
      "Use for 'find me every .tsx file in src/' style queries. For full-text search use Grep."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const root = ctx.projectRoot;
    const targetDir = input.target_directory
      ? path.resolve(root, input.target_directory)
      : root;
    const guard = await validateProjectPath(targetDir, root, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    let normalised = input.pattern;
    if (!normalised.startsWith("**/") && !normalised.startsWith("/") && !normalised.includes("/")) {
      normalised = `**/${normalised}`;
    }
    const matcher = compileGlob(normalised);
    const limit = input.head_limit ?? DEFAULT_LIMIT;
    const results: Array<{ path: string; mtime: number; bytes: number }> = [];
    let totalMatched = 0;
    try {
      for await (const file of walk(guard.resolved, ctx.signal)) {
        const rel = path.relative(root, file.path).split(path.sep).join("/");
        if (matcher(rel)) {
          totalMatched += 1;
          results.push({ path: file.path, mtime: file.mtime, bytes: file.bytes });
        }
      }
    } catch (e) {
      if (ctx.signal.aborted) {
        return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
      }
      return { ok: false, errorCode: "walk_failed", errorMessage: (e as Error).message };
    }
    results.sort((a, b) => b.mtime - a.mtime);
    const truncated = results.length > limit;
    if (truncated) results.length = limit;
    return {
      ok: true,
      value: { pattern: normalised, root, files: results, totalMatched, truncated }
    };
  },
  mapResultToBlock(out, toolUseId) {
    if (out.files.length === 0) {
      return blockFromText(toolUseId, `No files matched ${out.pattern} under ${out.root}.`);
    }
    const lines = out.files.map((f) => path.relative(out.root, f.path)).join("\n");
    const header = `${out.totalMatched} match${out.totalMatched === 1 ? "" : "es"}${out.truncated ? " (truncated)" : ""} for ${out.pattern}`;
    return blockFromText(toolUseId, `${header}\n${lines}`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `Glob  ${out.pattern}  (${out.totalMatched}${out.truncated ? "+" : ""})`,
      body: out.files
        .slice(0, 30)
        .map((f) => path.relative(out.root, f.path))
        .join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "Glob", subtitle: input.pattern };
  }
});

/* -------------------------------------------------------------------------- */
/* Walker + matcher                                                           */
/* -------------------------------------------------------------------------- */

async function* walk(
  root: string,
  signal: AbortSignal
): AsyncGenerator<{ path: string; mtime: number; bytes: number }> {
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
    for (const entry of entries) {
      if (signal.aborted) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          yield { path: full, mtime: stat.mtimeMs, bytes: stat.size };
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Translate a tiny subset of glob syntax into a RegExp matcher. */
export function compileGlob(pattern: string): (relPath: string) => boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches zero or more path segments
        regex += "(?:.*?)";
        i += 1;
        if (pattern[i + 1] === "/") i += 1; // consume separator
      } else {
        // * matches anything except a path separator
        regex += "[^/]*";
      }
    } else if (c === "?") {
      regex += "[^/]";
    } else if (c === ".") {
      regex += "\\.";
    } else if ("()+|^$\\{}[]".includes(c)) {
      regex += "\\" + c;
    } else {
      regex += c;
    }
  }
  regex += "$";
  const re = new RegExp(regex);
  return (relPath: string) => re.test(relPath);
}
