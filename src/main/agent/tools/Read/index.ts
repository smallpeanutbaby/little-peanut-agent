/**
 * Read tool — load a slice of a file into the model's context.
 *
 * Design parallels Claude Code's Read tool but trimmed for v1:
 *  - Numbered lines in the format `LINE_NUMBER|LINE_CONTENT` so the
 *    model can reference exact lines when proposing edits.
 *  - `offset` / `limit` defaults: read the first 2000 lines. Bigger
 *    files require an explicit offset.
 *  - File-size hard cap (default 1MB) — past that we truncate AND
 *    surface a clear message so the model paginates instead.
 *  - No image / PDF / notebook support yet (v1: text only). The
 *    `mapResultToBlock` returns a text payload; the LLM will say "I
 *    can't read that" rather than choke. Easy upgrade in M2.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type ToolResult, type Tool } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

// Many models (DeepSeek, Qwen, Kimi, …) have strong muscle memory for the
// Claude-Code-style `file_path` field name and will use it instead of `path`
// even though our schema documents `path`. We accept both via a preprocess
// step that rewrites `file_path` → `path` before zod validates. The schema
// description still teaches `path` so models that read the JSON schema do
// the right thing first try.
const inputSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      if (o.path === undefined && typeof o.file_path === "string") {
        return { ...o, path: o.file_path };
      }
    }
    return raw;
  },
  z.object({
    path: z
      .string()
      .describe(
        "Absolute or project-relative path of the file to read. The runtime resolves relative paths against the active project root."
      ),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "1-indexed starting line. Defaults to 1. Use this together with `limit` to paginate large files; the tool refuses to read >2000 lines per call without an explicit limit."
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Number of lines to return starting at `offset`. Defaults to 2000.")
  })
);

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  /** Line-numbered slice (LINE_NUMBER|LINE_CONTENT, one per line). */
  body: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

const MAX_BYTES = 1_000_000;
const DEFAULT_LIMIT = 2000;

export const ReadTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Read",
  aliases: ["fs_read"],
  description: "Reads a file from the local filesystem.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Reads a file from the local filesystem.",
      "Always quote returned line numbers verbatim when proposing edits — they pair with the Edit tool's `old_string` argument.",
      "Pass `offset` and `limit` to paginate; do not assume the model knows the file's length.",
      "Returns at most 2000 lines per call by default. Binary files return an error."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const guard = await validateProjectPath(input.path, ctx.projectRoot, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
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
    let buf: Buffer;
    try {
      buf = await fs.readFile(guard.resolved);
    } catch (e) {
      return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
    }
    // Heuristic: if there's a NUL byte in the first 8KB, treat as binary.
    const sniff = buf.subarray(0, Math.min(buf.length, 8192));
    if (sniff.includes(0)) {
      return {
        ok: false,
        errorCode: "binary_file",
        errorMessage:
          "binary content; refusing to dump bytes into the model context. Use a dedicated tool or extract text first."
      };
    }
    let truncated = false;
    if (buf.length > MAX_BYTES) {
      buf = buf.subarray(0, MAX_BYTES);
      truncated = true;
    }
    const text = buf.toString("utf8");
    const allLines = text.split(/\r?\n/);
    const totalLines = allLines.length;
    const offset = input.offset ?? 1;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const startIdx = Math.max(0, offset - 1);
    const endIdx = Math.min(totalLines, startIdx + limit);
    const slice = allLines.slice(startIdx, endIdx);
    // Right-pad line numbers to 6 chars so file diffs align visually.
    const body = slice
      .map((line, i) => `${String(startIdx + i + 1).padStart(6, " ")}|${line}`)
      .join("\n");
    return {
      ok: true,
      value: {
        path: guard.resolved,
        body,
        totalLines,
        startLine: startIdx + 1,
        endLine: endIdx,
        truncated
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `${out.path} (lines ${out.startLine}-${out.endLine} of ${out.totalLines}${out.truncated ? ", truncated" : ""})`;
    return blockFromText(toolUseId, `${header}\n\n${out.body}`);
  },
  renderResultForUI(out) {
    const head = out.body.split("\n").slice(0, 60).join("\n");
    return {
      variant: "ok",
      title: `${out.path}  (${out.startLine}-${out.endLine} / ${out.totalLines})`,
      body: head
    };
  },
  renderUseForUI(input) {
    return {
      label: "Read",
      subtitle: shortPath(input.path)
    };
  }
});

function shortPath(p: string): string {
  return path.basename(p) || p;
}
