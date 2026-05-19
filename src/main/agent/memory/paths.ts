/**
 * Shared helpers for the memory subsystem.
 *
 * Memory files live at `<projectRoot>/.agent/memory/**\/*.md` and use
 * a simple YAML frontmatter header:
 *
 *   ---
 *   type: convention | decision | note | reference
 *   description: short one-liner so prefetch can pick the right ones
 *   tags: [build, security]
 *   ---
 *   Markdown body...
 */

import path from "node:path";

export const MEMORY_DIR_NAME = ".agent/memory";

export function memoryDirFor(projectRoot: string): string {
  return path.join(projectRoot, MEMORY_DIR_NAME);
}

export function memoryFilePath(projectRoot: string, relative: string): string {
  return path.join(memoryDirFor(projectRoot), relative);
}

export interface MemoryFrontmatter {
  type?: string;
  description?: string;
  tags?: string[];
  /** Free-form additional fields are preserved when writing. */
  [key: string]: unknown;
}

export interface ParsedMemory {
  frontmatter: MemoryFrontmatter;
  body: string;
}

/** Parse a Markdown file with optional YAML frontmatter into
 *  `{ frontmatter, body }`. Frontmatter parsing is intentionally
 *  minimal: scalars (`key: value`), arrays of strings on a single line
 *  (`tags: [a, b]`), and that's it. Memory files are author-controlled,
 *  so we don't ship a full YAML parser. */
export function parseMemoryFile(raw: string): ParsedMemory {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, body: raw };
  }
  const endMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!endMatch) return { frontmatter: {}, body: raw };
  const headerText = endMatch[1];
  const body = raw.slice(endMatch[0].length);
  const fm: MemoryFrontmatter = {};
  for (const line of headerText.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    } else {
      // Strip surrounding quotes when present.
      fm[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter: fm, body };
}

/** Inverse of `parseMemoryFile`. Emits the same minimal subset of YAML. */
export function serialiseMemoryFile(parsed: ParsedMemory): string {
  const entries = Object.entries(parsed.frontmatter).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return parsed.body;
  const lines: string[] = ["---"];
  for (const [k, v] of entries) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "string") {
      lines.push(`${k}: ${needsQuote(v) ? JSON.stringify(v) : v}`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n") + parsed.body;
}

function needsQuote(s: string): boolean {
  return /[:#\n"']/.test(s) || s.trim() !== s;
}
