/**
 * MemoryRead tool — load a Markdown memory file from
 * `<projectRoot>/.agent/memory/`.
 *
 * Always read-only; no permission prompt. The tool returns the parsed
 * frontmatter (so the model can decide whether a file is still
 * relevant) and the body text.
 *
 * Inputs:
 *   - `path`: relative to the memory dir, e.g. `decisions/build.md`.
 *     Leading `./` and `../` are rejected; absolute paths inside the
 *     memory dir are accepted for convenience.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { memoryDirFor, parseMemoryFile, type MemoryFrontmatter } from "../../memory/paths.js";
import { validatePathForTool } from "../../permissions/validatePathForTool.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path relative to `.agent/memory/` (e.g. `decisions/build.md`). Absolute paths must point inside the memory dir.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  bytes: number;
  mtime: number;
}

export const MemoryReadTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "MemoryRead",
  aliases: ["memory_read"],
  description: "Read a Markdown memory note from `.agent/memory/`.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Read a Markdown memory file from `<project>/.agent/memory/`.",
      "Each memory has YAML frontmatter (type, description, tags) and a Markdown body.",
      "Use this when the system prompt's memory index suggested a relevant file."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const memDir = memoryDirFor(ctx.projectRoot);
    const abs = path.isAbsolute(input.path) ? input.path : path.join(memDir, input.path);
    const guard = await validatePathForTool(abs, ctx.projectRoot, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    if (!guard.resolved.startsWith(memDir + path.sep) && guard.resolved !== memDir) {
      return {
        ok: false,
        errorCode: "outside_memory",
        errorMessage: `path is not under .agent/memory/: ${guard.resolved}`
      };
    }
    let stat;
    try {
      stat = await fs.stat(guard.resolved);
    } catch (e) {
      return { ok: false, errorCode: "not_found", errorMessage: (e as Error).message };
    }
    if (!stat.isFile()) {
      return { ok: false, errorCode: "not_a_file", errorMessage: `not a file: ${guard.resolved}` };
    }
    let raw: string;
    try {
      raw = await fs.readFile(guard.resolved, "utf8");
    } catch (e) {
      return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
    }
    const parsed = parseMemoryFile(raw);
    return {
      ok: true,
      value: {
        path: path.relative(memDir, guard.resolved),
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        bytes: Buffer.byteLength(raw, "utf8"),
        mtime: stat.mtimeMs
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `Memory: ${out.path} (${out.bytes} bytes, updated ${formatAgo(out.mtime)})`;
    const fm = JSON.stringify(out.frontmatter, null, 2);
    return blockFromText(toolUseId, `${header}\n\n--- frontmatter ---\n${fm}\n--- body ---\n${out.body}`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `MemoryRead  ${out.path}`,
      body: out.body.split("\n").slice(0, 40).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "MemoryRead", subtitle: input.path };
  }
});

function formatAgo(mtime: number): string {
  const ms = Date.now() - mtime;
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
