/**
 * Delete tool — remove a single file.
 *
 * High-risk: marked `isDestructive`, defaults to `ask`. Refuses
 * directories (the agent should never recursively delete on its own);
 * the user must drop directories manually.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validatePathForTool } from "../../permissions/validatePathForTool.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Project-relative or absolute path of the file to delete. Directories are NOT accepted.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  bytes: number;
}

export const DeleteTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Delete",
  aliases: ["fs_delete", "rm"],
  description: "Delete a single file under the project.",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isDestructive: () => true,
  prompt: () =>
    [
      "Delete ONE file (no directories, no globs).",
      "Always shown to the user for explicit approval — the action is irreversible.",
      "Prefer Edit/Write when you can preserve the file with new content; only use Delete when removal is the only correct action."
    ].join("\n"),
  checkPermissions(input: Input) {
    return {
      behavior: "ask" as const,
      reason: `Permanently delete ${input.path}? This is not reversible.`
    };
  },
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const guard = await validatePathForTool(input.path, ctx.projectRoot, {
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
      return {
        ok: false,
        errorCode: "not_a_file",
        errorMessage: `refuses to delete a non-file (use a manual rm for directories): ${guard.resolved}`
      };
    }
    try {
      await fs.unlink(guard.resolved);
    } catch (e) {
      return { ok: false, errorCode: "unlink_failed", errorMessage: (e as Error).message };
    }
    return { ok: true, value: { path: guard.resolved, bytes: stat.size } };
  },
  mapResultToBlock(out, toolUseId) {
    return blockFromText(toolUseId, `Deleted ${out.path} (${out.bytes} bytes).`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `Deleted  ${path.basename(out.path)}`,
      body: out.path
    };
  },
  renderUseForUI(input) {
    return { label: "Delete", subtitle: input.path };
  }
});
