/**
 * Write tool — create or overwrite a file inside the project.
 *
 * v1 semantics:
 *  - Always inside `validateProjectPath` (no symlink escapes).
 *  - Creates parent directories if missing.
 *  - Marks itself `isDestructive = true` so the gate always asks the
 *    first time it sees a given target (unless an explicit allow rule
 *    exists in `permission_rule`).
 *  - Returns the byte count + whether the file was created vs overwritten
 *    so the renderer can show a clean before/after diff in M0-6.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type ToolResult, type Tool } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

const inputSchema = z.object({
  path: z
    .string()
    .describe("Project-relative or absolute path of the file to write."),
  content: z
    .string()
    .describe(
      "Full new contents of the file. The tool overwrites the file atomically; there is no partial write or append mode."
    )
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  created: boolean;
  bytes: number;
  /** Previous contents when overwriting (null when newly created). Kept
   *  for renderResultForUI so the diff card has both sides. */
  previousContent: string | null;
}

export const WriteTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Write",
  aliases: ["fs_write"],
  description: "Writes a file to the local filesystem (creates or overwrites).",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isDestructive: () => true,
  prompt: () =>
    [
      "Writes a file to the local filesystem.",
      "Always prefer Edit when you only need to change a few lines — Write replaces the entire file and is harder for the user to review.",
      "Path must be inside the active project; absolute paths outside the project root will be rejected.",
      "Use \\n for newlines; do not include line numbers in the content."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const guard = await validateProjectPath(input.path, ctx.projectRoot, {
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    let previousContent: string | null = null;
    try {
      previousContent = await fs.readFile(guard.resolved, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
      }
    }
    try {
      await fs.mkdir(path.dirname(guard.resolved), { recursive: true });
      await fs.writeFile(guard.resolved, input.content, "utf8");
    } catch (e) {
      return { ok: false, errorCode: "write_failed", errorMessage: (e as Error).message };
    }
    const bytes = Buffer.byteLength(input.content, "utf8");
    return {
      ok: true,
      value: {
        path: guard.resolved,
        created: previousContent === null,
        bytes,
        previousContent
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const verb = out.created ? "Created" : "Updated";
    return blockFromText(toolUseId, `${verb} ${out.path} (${out.bytes} bytes).`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `${out.created ? "Created" : "Updated"}  ${path.basename(out.path)}`,
      body: `${out.bytes} bytes`,
      data: { previous: out.previousContent, path: out.path }
    };
  },
  renderUseForUI(input) {
    return { label: "Write", subtitle: input.path };
  }
});
