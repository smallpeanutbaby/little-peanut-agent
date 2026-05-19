/**
 * Memory directory scanner.
 *
 * Walks `<projectRoot>/.agent/memory/` and upserts a `memory_index`
 * row per file. Cheap incremental scan: we skip files whose
 * `mtime` matches the existing row.
 *
 * Called:
 *   - At startup of every agent run (non-blocking; via setImmediate).
 *   - After every MemoryWrite (best-effort, see tool).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { memoryDirFor, parseMemoryFile } from "./paths.js";
import { AppDatabase } from "../../db/database.js";

const MAX_BYTES_PER_FILE = 100_000;

export async function scanProjectMemory(db: AppDatabase, projectId: string, projectRoot: string): Promise<{
  scanned: number;
  upserted: number;
}> {
  const memDir = memoryDirFor(projectRoot);
  let exists = false;
  try {
    const s = await fs.stat(memDir);
    exists = s.isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { scanned: 0, upserted: 0 };

  const indexed = new Map<string, { mtime: number; bytes: number }>();
  for (const row of db.agent.listMemoryIndex(projectId)) {
    indexed.set(row.relativePath, { mtime: row.mtime, bytes: row.bytes });
  }

  let scanned = 0;
  let upserted = 0;
  for await (const file of walk(memDir)) {
    if (!file.endsWith(".md")) continue;
    scanned += 1;
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    const rel = path.relative(memDir, file);
    const existing = indexed.get(rel);
    if (existing && existing.mtime === stat.mtimeMs && existing.bytes === stat.size) continue;
    const raw = await safeRead(file);
    if (raw === null) continue;
    const parsed = parseMemoryFile(raw);
    db.agent.upsertMemoryIndex({
      projectId,
      relativePath: rel,
      type: typeof parsed.frontmatter.type === "string" ? parsed.frontmatter.type : null,
      description: typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : null,
      mtime: stat.mtimeMs,
      bytes: stat.size
    });
    upserted += 1;
  }
  return { scanned, upserted };
}

async function safeRead(file: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(file);
    if (buf.length > MAX_BYTES_PER_FILE) return buf.subarray(0, MAX_BYTES_PER_FILE).toString("utf8");
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}
