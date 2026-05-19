/**
 * MemoryWrite tool — create or update a Markdown memory file under
 * `<projectRoot>/.agent/memory/`.
 *
 * Whole-file replace (matches the read counterpart). The runtime
 * upserts the corresponding `memory_index` row so the prefetch
 * sideQuery can find it next turn.
 *
 * Asks the user the first time (so they know the agent is recording
 * things long-term); per-project allow rules silence it after that.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import {
  memoryDirFor,
  serialiseMemoryFile,
  type MemoryFrontmatter
} from "../../memory/paths.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";
import { AppDatabase } from "../../../db/database.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path relative to `.agent/memory/`. Subdirectories are created as needed."),
  body: z.string().min(1).describe("Markdown body (without the frontmatter header)."),
  type: z
    .enum(["convention", "decision", "note", "reference"])
    .optional()
    .describe("Memory type — used for filtering during prefetch."),
  description: z
    .string()
    .max(280)
    .optional()
    .describe("One-line summary; this is what the prefetch sideQuery scores against."),
  tags: z.array(z.string().min(1)).max(20).optional().describe("Optional tags.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  bytes: number;
  created: boolean;
}

let dbRef: AppDatabase | null = null;
export function bindMemoryWriteDatabase(db: AppDatabase): void {
  dbRef = db;
}

export const MemoryWriteTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "MemoryWrite",
  aliases: ["memory_write"],
  description: "Write a Markdown memory note into `.agent/memory/`.",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  isDestructive: () => false,
  prompt: () =>
    [
      "Record a long-lived note into the project's `.agent/memory/` directory.",
      "Use for: project conventions, decisions you don't want to re-derive, reusable references.",
      "Always include `description`; it's how the agent finds the note next turn."
    ].join("\n"),
  checkPermissions() {
    return {
      behavior: "ask" as const,
      reason: "Save a long-lived memory file under `.agent/memory/`?"
    };
  },
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const memDir = memoryDirFor(ctx.projectRoot);
    const abs = path.isAbsolute(input.path) ? input.path : path.join(memDir, input.path);
    const guard = await validateProjectPath(abs, ctx.projectRoot, {
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
    if (!guard.resolved.endsWith(".md")) {
      return {
        ok: false,
        errorCode: "bad_extension",
        errorMessage: "memory files must end with .md"
      };
    }
    let created = false;
    try {
      await fs.access(guard.resolved);
    } catch {
      created = true;
    }
    const fm: MemoryFrontmatter = {};
    if (input.type) fm.type = input.type;
    if (input.description) fm.description = input.description;
    if (input.tags && input.tags.length > 0) fm.tags = input.tags;
    const serialised = serialiseMemoryFile({ frontmatter: fm, body: input.body });
    try {
      await fs.mkdir(path.dirname(guard.resolved), { recursive: true });
      await fs.writeFile(guard.resolved, serialised, "utf8");
    } catch (e) {
      return { ok: false, errorCode: "write_failed", errorMessage: (e as Error).message };
    }
    const bytes = Buffer.byteLength(serialised, "utf8");
    // Best-effort index refresh — the proper scanner runs in M3-2.
    if (dbRef) {
      try {
        const conv = dbRef.getConversation(ctx.conversationId);
        const projectId = conv?.projectId ?? null;
        if (projectId) {
          dbRef.agent.upsertMemoryIndex({
            projectId,
            relativePath: path.relative(memDir, guard.resolved),
            type: input.type ?? null,
            description: input.description ?? null,
            mtime: Date.now(),
            bytes
          });
        }
      } catch (e) {
        console.warn("[memory] index upsert failed", e);
      }
    }
    return {
      ok: true,
      value: { path: path.relative(memDir, guard.resolved), bytes, created }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const verb = out.created ? "Created" : "Updated";
    return blockFromText(toolUseId, `${verb} memory note ${out.path} (${out.bytes} bytes).`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `${out.created ? "Created" : "Updated"}  ${out.path}`,
      body: `${out.bytes} bytes`
    };
  },
  renderUseForUI(input) {
    return { label: "MemoryWrite", subtitle: input.path };
  }
});
