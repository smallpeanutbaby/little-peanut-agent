/**
 * System prompt assembly.
 *
 * Returns the system prompt as an array of segments so providers that
 * support segmented system prompts (Anthropic, with its prompt-caching
 * boundary) can independently cache the static prefix and re-send only
 * the dynamic suffix.
 *
 * Segment 0: mode prompt (sourced from shared/modes.ts).
 * Segment 1: tool usage / interaction style.
 * Segment 2: environment + project context (dynamic — moved below the
 *            cache boundary in adapter implementations).
 */

import type { ChatMode } from "@shared/modes.js";
import type { Tool } from "../tools/Tool.js";
import os from "node:os";
import path from "node:path";

export interface SystemPromptOptions {
  mode: ChatMode;
  projectRoot: string | null;
  projectName?: string | null;
  language: "zh-CN" | "en";
  tools: Tool[];
  /** Optional one-paragraph project context (e.g. `.agent/PROJECT.md`). */
  projectContext?: string;
  /** Recently edited files (relative paths). */
  recentFiles?: string[];
  /** Git branch when available (from `getGitStatus`). */
  gitBranch?: string | null;
  /** Short summaries of relevant memory notes (path + description).
   *  Picked by the prefetch sideQuery from `memory_index`. */
  memoryHints?: Array<{ path: string; type: string | null; description: string | null }>;
  /** Registered skills the model can opt in to via the `Skill` tool. */
  skillHints?: Array<{ name: string; source: "project" | "user"; description: string }>;
}

const TOOL_USAGE_PROMPT = [
  "## Tool usage",
  "",
  "- Prefer the smallest tool that gets the job done. Read before Edit/Write. Glob before Read when the path is unknown.",
  "- Do NOT speculate about file paths — verify with Glob or ListDir first.",
  "- Bash commands go through a risk classifier and may require user approval. Avoid `sudo`, `rm -rf`, `curl | sh`, redirects to raw block devices, and other destructive patterns.",
  "- When proposing edits, include enough surrounding context in `old_string` for a unique match.",
  "- After making changes, summarise what changed in one or two sentences.",
  "- Cite file references using \\`path/to/file\\` (backticks) inline, or as `startLine:endLine:filepath` code blocks when referencing existing code."
].join("\n");

const INTERACTION_STYLE = [
  "## Interaction style",
  "",
  "- Be concise. No filler like \"Certainly!\" or \"Here's what I'll do\". Get to substance.",
  "- When you make a plan with multiple steps, use the `TodoWrite` tool to track progress.",
  "- Surface errors verbatim and explain causes briefly; don't paper over them.",
  "- Use markdown sparingly — code fences for code, backticks for identifiers, plain prose otherwise.",
  "- **IMPORTANT: When you have finished the task (no more tool calls needed), you MUST provide a completion summary.** The summary should briefly cover: (1) what was accomplished, (2) key changes made (files modified, commands run), and (3) any remaining issues or next steps. Keep it concise — 3-8 sentences."
].join("\n");

export function buildSystemPrompt(opts: SystemPromptOptions): string[] {
  const segments: string[] = [];
  segments.push(opts.mode.systemPrompt);
  segments.push([TOOL_USAGE_PROMPT, INTERACTION_STYLE].join("\n\n"));
  segments.push(buildEnvironmentSegment(opts));
  return segments;
}

function buildEnvironmentSegment(opts: SystemPromptOptions): string {
  const lines: string[] = ["## Environment"];
  lines.push(`- Platform: ${process.platform} (${os.release()})`);
  lines.push(`- Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`- Working directory: ${opts.projectRoot ?? "<none>"}`);
  if (opts.projectName) lines.push(`- Project: ${opts.projectName}`);
  if (opts.gitBranch) lines.push(`- Git branch: ${opts.gitBranch}`);
  lines.push(`- Output language: ${opts.language === "zh-CN" ? "Chinese (Simplified)" : "English"}`);

  if (opts.projectContext) {
    lines.push("", "## Project context (from .agent/PROJECT.md)", opts.projectContext.trim());
  }
  if (opts.recentFiles && opts.recentFiles.length > 0) {
    lines.push("", "## Recently edited files");
    for (const f of opts.recentFiles.slice(0, 12)) {
      lines.push(`- \`${f}\``);
    }
  }
  if (opts.memoryHints && opts.memoryHints.length > 0) {
    lines.push(
      "",
      "## Memory notes (preview)",
      "Use the `MemoryRead` tool to read any of these before proceeding."
    );
    for (const m of opts.memoryHints.slice(0, 12)) {
      const desc = m.description ? ` — ${m.description}` : "";
      const t = m.type ? ` [${m.type}]` : "";
      lines.push(`- \`${m.path}\`${t}${desc}`);
    }
  }
  if (opts.skillHints && opts.skillHints.length > 0) {
    lines.push("", "## Skills (load on demand)");
    for (const s of opts.skillHints) {
      lines.push(`- \`${s.name}\` [${s.source}] — ${s.description}`);
    }
    lines.push("Call the `Skill` tool with the skill name to load its full instructions.");
  }
  if (opts.tools.length > 0) {
    lines.push("", "## Available tools");
    for (const t of opts.tools) {
      lines.push(`- **${t.name}** — ${t.description || ""}`.trimEnd());
    }
  }
  return lines.join("\n");
}

/** Convenience: shorten an absolute path into something nice to show
 *  the model. Falls back to the input when `from` is missing. */
export function relPath(absolute: string, from: string | null): string {
  if (!from) return absolute;
  try {
    return path.relative(from, absolute) || absolute;
  } catch {
    return absolute;
  }
}
