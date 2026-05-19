/**
 * ListDir tool — bounded, scoped directory listing.
 *
 * Always-allowed read-only tool. Bounded by:
 *  - max depth (default 2, max 4)
 *  - max entries (default 200)
 *  - same ignore set as Glob/Grep (.git, node_modules, dist, ...)
 *
 * Output is a `tree`-style indented listing, easy for the model to
 * skim before issuing a targeted Read or Glob call.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Directory relative to project root. Defaults to the project root."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Maximum recursion depth. Defaults to 2."),
  show_hidden: z
    .boolean()
    .optional()
    .describe("Include dot-files. Default false."),
  max_entries: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe("Cap on number of listed entries. Default 200.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  root: string;
  text: string;
  total: number;
  truncated: boolean;
}

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

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX = 200;

export const ListDirTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "ListDir",
  aliases: ["ls", "list_dir"],
  description: "List directory contents up to a bounded depth.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "List files and folders under a directory (bounded depth, ignores `.git`/`node_modules`/dist).",
      "Use this to orient yourself in an unfamiliar repo before issuing Read/Glob/Grep calls.",
      "Default depth is 2; pass `depth` up to 4 when you need more."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const absRoot = input.path ? path.resolve(ctx.projectRoot, input.path) : ctx.projectRoot;
    const guard = await validateProjectPath(absRoot, ctx.projectRoot, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    const depth = input.depth ?? DEFAULT_DEPTH;
    const showHidden = input.show_hidden ?? false;
    const max = input.max_entries ?? DEFAULT_MAX;
    const lines: string[] = [];
    let total = 0;
    let truncated = false;

    async function walk(dir: string, level: number, prefix: string): Promise<void> {
      if (level > depth || truncated || ctx.signal.aborted) return;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const e of entries) {
        if (truncated || ctx.signal.aborted) return;
        if (!showHidden && e.name.startsWith(".")) continue;
        if (e.isDirectory() && IGNORE_DIRS.has(e.name)) continue;
        const label = `${prefix}${e.isDirectory() ? e.name + "/" : e.name}`;
        lines.push(label);
        total += 1;
        if (total >= max) {
          truncated = true;
          return;
        }
        if (e.isDirectory()) {
          await walk(path.join(dir, e.name), level + 1, prefix + "  ");
        }
      }
    }

    await walk(guard.resolved, 1, "");
    return {
      ok: true,
      value: {
        root: guard.resolved,
        text: lines.join("\n"),
        total,
        truncated
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `${out.root} (${out.total} entries${out.truncated ? ", truncated" : ""})`;
    return blockFromText(toolUseId, `${header}\n${out.text}`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `ListDir  ${path.basename(out.root) || out.root}  (${out.total}${out.truncated ? "+" : ""})`,
      body: out.text.split("\n").slice(0, 80).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "ListDir", subtitle: input.path ?? "." };
  }
});
