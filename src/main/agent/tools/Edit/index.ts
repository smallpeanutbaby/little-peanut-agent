/**
 * Edit tool — exact-string replacement on an existing file.
 *
 * Mirrors Claude Code's Edit tool semantics:
 *  - `old_string` must occur exactly once unless `replace_all=true`.
 *  - When `replace_all=true` every occurrence is replaced.
 *  - The model is expected to include 3-5 lines of surrounding context
 *    in `old_string` so the match is unique.
 *
 * The tool never touches the file when the match is ambiguous; instead
 * it returns an error block listing how many matches were found. The
 * model can retry with more context.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { validateProjectPath } from "../../permissions/pathValidation.js";

const inputSchema = z.object({
  path: z.string().describe("Project-relative or absolute path of the file to edit."),
  old_string: z
    .string()
    .min(1)
    .describe(
      "Exact substring to find. MUST be unique within the file unless `replace_all` is true. Include at least 3-5 lines of context on each side."
    ),
  new_string: z
    .string()
    .describe("Replacement substring. Must differ from `old_string`."),
  replace_all: z
    .boolean()
    .optional()
    .describe("If true, replace every occurrence of `old_string`. Default false.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  replacements: number;
  /** Pre/post snippet around the first replacement for the UI diff. */
  beforeSnippet: string;
  afterSnippet: string;
}

export const EditTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "Edit",
  aliases: ["fs_edit"],
  description: "Performs exact string replacements in files.",
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  prompt: () =>
    [
      "Performs exact string replacements in files.",
      "Include at least 3-5 lines of context BEFORE and AFTER the change so `old_string` matches exactly once.",
      "When you legitimately need to replace every occurrence (e.g. renaming a symbol), set `replace_all: true`.",
      "The tool refuses to edit files that have not been Read in the current session — read first."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    if (input.old_string === input.new_string) {
      return {
        ok: false,
        errorCode: "noop",
        errorMessage: "old_string and new_string are identical; nothing to do."
      };
    }
    const guard = await validateProjectPath(input.path, ctx.projectRoot, {
      mustExist: true,
      additionalWorkingDirectories: ctx.additionalWorkingDirectories
    });
    if (!guard.ok || !guard.resolved) {
      return { ok: false, errorCode: "path_invalid", errorMessage: guard.reason ?? "invalid path" };
    }
    let original: string;
    try {
      original = await fs.readFile(guard.resolved, "utf8");
    } catch (e) {
      return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
    }
    const occurrences = countOccurrences(original, input.old_string);
    if (occurrences === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `old_string not found in ${guard.resolved}. Re-read the file and copy the snippet verbatim.`
      };
    }
    if (occurrences > 1 && !input.replace_all) {
      return {
        ok: false,
        errorCode: "ambiguous",
        errorMessage: `old_string matches ${occurrences} times; either add more context or set replace_all=true.`
      };
    }

    const replaced = input.replace_all
      ? original.split(input.old_string).join(input.new_string)
      : original.replace(input.old_string, input.new_string);

    try {
      await fs.writeFile(guard.resolved, replaced, "utf8");
    } catch (e) {
      return { ok: false, errorCode: "write_failed", errorMessage: (e as Error).message };
    }

    // Build small before/after snippet for the UI card. Take the first
    // replacement site and grab ±2 lines of context on each side.
    const before = snippetAround(original, input.old_string, 2);
    const after = snippetAround(replaced, input.new_string, 2);

    return {
      ok: true,
      value: {
        path: guard.resolved,
        replacements: input.replace_all ? occurrences : 1,
        beforeSnippet: before,
        afterSnippet: after
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    return blockFromText(
      toolUseId,
      `Edited ${out.path} (${out.replacements} replacement${out.replacements === 1 ? "" : "s"}).`
    );
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `Edit  ${path.basename(out.path)}  (${out.replacements} change${out.replacements === 1 ? "" : "s"})`,
      data: { before: out.beforeSnippet, after: out.afterSnippet, path: out.path }
    };
  },
  renderUseForUI(input) {
    return { label: "Edit", subtitle: input.path };
  }
});

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function snippetAround(source: string, marker: string, lines: number): string {
  const idx = source.indexOf(marker);
  if (idx < 0) return marker;
  const startOfMarker = source.lastIndexOf("\n", idx) + 1;
  const endOfMarker = source.indexOf("\n", idx + marker.length);
  // walk `lines` newlines backward / forward
  let s = startOfMarker;
  for (let i = 0; i < lines; i++) {
    const prev = source.lastIndexOf("\n", s - 2);
    if (prev < 0) {
      s = 0;
      break;
    }
    s = prev + 1;
  }
  let e = endOfMarker === -1 ? source.length : endOfMarker;
  for (let i = 0; i < lines; i++) {
    const next = source.indexOf("\n", e + 1);
    if (next < 0) {
      e = source.length;
      break;
    }
    e = next;
  }
  return source.slice(s, e);
}
