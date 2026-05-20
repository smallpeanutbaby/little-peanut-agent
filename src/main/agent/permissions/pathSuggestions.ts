/**
 * When a tool receives a non-existent path, enrich the error with
 * actionable hints so the model retries via Glob/Grep instead of
 * guessing another wrong absolute path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { relPath } from "../context/systemPrompt.js";

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
  "release",
  "bin",
  "obj"
]);

const MAX_WALK_FILES = 4000;
const MAX_SUGGESTIONS = 5;

export interface PathSuggestionOptions {
  maxSuggestions?: number;
}

/**
 * Build a multi-line error the model can act on: base reason + "did you
 * mean" candidates + explicit next-step tool guidance.
 */
export async function enrichFileNotFoundReason(
  projectRoot: string,
  inputPath: string,
  absolute: string,
  options: PathSuggestionOptions = {}
): Promise<string> {
  const max = options.maxSuggestions ?? MAX_SUGGESTIONS;
  const suggestions = await suggestSimilarPaths(projectRoot, absolute, max);
  const basename = path.basename(absolute);
  const lines = [`file does not exist: ${absolute}`, ""];

  if (suggestions.length > 0) {
    lines.push("Did you mean one of these?");
    for (const s of suggestions) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }

  lines.push(
    "Do NOT guess another path. Locate the file first:",
    `  - Glob: pattern "**/${escapeGlob(basename)}"`,
    basename.length >= 4
      ? `  - Grep: search for a unique class/method/symbol you expect in the file`
      : `  - ListDir: inspect parent directories when the folder name may be wrong`
  );

  if (inputPath !== absolute) {
    lines.push("", `You passed: ${inputPath}`);
  }

  return lines.join("\n");
}

/**
 * Find likely alternatives when the model shortens a folder name
 * (e.g. `OpsAdminApi` vs `OpsAdminApi.Application`) or picks the
 * wrong basename.
 */
export async function suggestSimilarPaths(
  projectRoot: string,
  absolute: string,
  maxSuggestions = MAX_SUGGESTIONS
): Promise<string[]> {
  const rootReal = await safeRealpath(projectRoot);
  const scored = new Map<string, number>();

  await suggestFromMissingSegment(rootReal, absolute, scored);
  await suggestByBasename(rootReal, path.basename(absolute), scored);

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSuggestions)
    .map(([p]) => relPath(p, rootReal));
}

/** Walk path segments from project root; when one is missing, score siblings. */
async function suggestFromMissingSegment(
  projectRoot: string,
  absolute: string,
  scored: Map<string, number>
): Promise<void> {
  const rel = path.relative(projectRoot, absolute);
  if (!rel || rel.startsWith("..")) return;

  const segments = rel.split(path.sep);
  let current = projectRoot;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = path.join(current, seg);
    const isLast = i === segments.length - 1;

    try {
      const st = await fs.stat(next);
      if (isLast && st.isFile()) return;
      if (!isLast && st.isDirectory()) {
        current = next;
        continue;
      }
      if (isLast && st.isDirectory()) {
        // Path points at a directory, not the intended file — suggest files inside.
        await scoreDirectoryEntries(next, segments.slice(i + 1).join(path.sep), scored, 70);
        return;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return;
    }

    // `seg` (or `next`) does not exist — fuzzy-match siblings in `current`.
    let siblings: string[];
    try {
      siblings = await fs.readdir(current);
    } catch {
      return;
    }

    const tail = segments.slice(i + 1).join(path.sep);
    for (const name of siblings) {
      if (IGNORE_DIRS.has(name)) continue;
      const score = nameSimilarity(seg, name);
      if (score <= 0) continue;
      const candidate = tail ? path.join(current, name, tail) : path.join(current, name);
      bump(scored, candidate, score + (tail ? 10 : 0));
    }
    return;
  }
}

async function suggestByBasename(
  projectRoot: string,
  basename: string,
  scored: Map<string, number>
): Promise<void> {
  if (!basename || basename === "." || basename === "..") return;

  const target = basename.toLowerCase();
  const stem = basename.includes(".") ? basename.slice(0, basename.lastIndexOf(".")).toLowerCase() : target;
  let walked = 0;

  const stack: string[] = [projectRoot];
  while (stack.length > 0 && walked < MAX_WALK_FILES) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        walked += 1;
        const lower = entry.name.toLowerCase();
        if (lower === target) {
          bump(scored, full, 100);
        } else if (stem.length >= 4 && lower.includes(stem)) {
          bump(scored, full, 55);
        }
      }
      if (walked >= MAX_WALK_FILES) break;
    }
  }
}

async function scoreDirectoryEntries(
  dir: string,
  tail: string,
  scored: Map<string, number>,
  baseScore: number
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = tail ? path.join(dir, name, tail) : path.join(dir, name);
    bump(scored, full, baseScore);
  }
}

function nameSimilarity(wanted: string, candidate: string): number {
  const a = wanted.toLowerCase();
  const b = candidate.toLowerCase();
  if (a === b) return 90;
  if (b.startsWith(a) || a.startsWith(b)) return 85;
  if (b.includes(a) || a.includes(b)) return 75;
  return 0;
}

function bump(scored: Map<string, number>, p: string, score: number): void {
  const prev = scored.get(p) ?? 0;
  if (score > prev) scored.set(p, score);
}

function escapeGlob(name: string): string {
  return name.replace(/[\[\]{}()?*+\\^$|]/g, "\\$&");
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.normalize(p);
  }
}

/** Top-level + one nested directory listing for the system prompt. */
export async function listProjectLayout(projectRoot: string, maxEntries = 40): Promise<string[]> {
  const lines: string[] = [];
  let count = 0;

  async function listDir(dir: string, prefix: string, depth: number): Promise<void> {
    if (count >= maxEntries || depth > 2) return;
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

    for (const entry of entries) {
      if (count >= maxEntries) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        count += 1;
        await listDir(path.join(dir, entry.name), rel, depth + 1);
      } else if (depth <= 1) {
        lines.push(rel);
        count += 1;
      }
    }
  }

  await listDir(projectRoot, "", 0);
  return lines;
}
