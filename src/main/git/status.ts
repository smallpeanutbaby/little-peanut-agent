import { spawn } from "node:child_process";
import { envWithGitPath, resolveGitExecutable } from "./resolveGit.js";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitFileChange, GitFileStatus, GitStatusResult } from "@shared/types.js";

/** Hard ceilings so a runaway `git status` can never starve the main process. */
const STATUS_TIMEOUT_MS = 10_000;
const STATUS_MAX_BUFFER = 8 * 1024 * 1024; // 8 MB

/**
 * Run `git status --porcelain=v1 -b -z` in the project's working directory
 * and return a structured status payload. We use the NUL-separated (`-z`)
 * porcelain to handle filenames with whitespace / newlines safely.
 *
 * NOTE: We deliberately do NOT shell out for things like `git diff` or
 * `git log` from here — anything beyond status belongs in its own handler
 * so the surface stays auditable.
 */
export async function getGitStatus(projectPath: string): Promise<GitStatusResult> {
  if (!projectPath) return { ok: false, reason: "no-path" };

  try {
    await access(projectPath);
  } catch {
    return { ok: false, reason: "no-path", message: `Path not accessible: ${projectPath}` };
  }

  // Fast preflight: a directory without `.git` is almost certainly not a repo.
  // Git's own detection walks up the parent chain, but for projects in this
  // app we treat the bound folder itself as the boundary — clearer UX.
  try {
    const gitDir = join(projectPath, ".git");
    const st = await stat(gitDir);
    if (!st.isDirectory() && !st.isFile()) {
      return { ok: false, reason: "not-a-repo" };
    }
  } catch {
    return { ok: false, reason: "not-a-repo" };
  }

  const args = ["status", "--porcelain=v1", "-b", "-z"];

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: Error }>(
    (resolve) => {
      let child;
      try {
        child = spawn(resolveGitExecutable(), args, {
          cwd: projectPath,
          env: envWithGitPath(),
          windowsHide: true,
          shell: false
        });
      } catch (err) {
        resolve({ code: null, stdout: "", stderr: "", spawnError: err as Error });
        return;
      }

      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, STATUS_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > STATUS_MAX_BUFFER) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr, spawnError: err });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killed) {
          resolve({ code, stdout, stderr, spawnError: new Error("git status timed out") });
        } else {
          resolve({ code, stdout, stderr });
        }
      });
    }
  );

  if (result.spawnError) {
    const msg = result.spawnError.message;
    if (/ENOENT/.test(msg) || /not found/i.test(msg)) {
      return { ok: false, reason: "git-not-found", message: "git executable not found in PATH" };
    }
    return { ok: false, reason: "git-error", message: msg };
  }
  if (result.code !== 0) {
    const trimmed = result.stderr.trim();
    if (/not a git repository/i.test(trimmed)) {
      return { ok: false, reason: "not-a-repo" };
    }
    return { ok: false, reason: "git-error", message: trimmed || `git exited with code ${result.code}` };
  }

  return parsePorcelainV1(result.stdout);
}

/**
 * Parse the NUL-delimited porcelain v1 output. Format reference:
 * https://git-scm.com/docs/git-status#_porcelain_format_version_1
 *
 * First record is the branch header (`## name...upstream [ahead N, behind M]`).
 * Each subsequent record is `XY path\0`, where rename/copy entries are
 * followed by an extra `origPath\0` record. We collapse that second record
 * back into the rename entry.
 */
function parsePorcelainV1(raw: string): GitStatusResult {
  // Each "entry" is NUL-terminated. Splitting and ignoring the trailing
  // empty string gives the list of records.
  const records = raw.split("\0").filter((s) => s.length > 0);

  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileChange[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.startsWith("## ")) {
      const header = rec.slice(3);
      const match = header.match(/^([^.\s]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?$/);
      if (match) {
        branch = match[1] === "HEAD" ? null : match[1];
        upstream = match[2] ?? null;
        const bracket = match[3];
        if (bracket) {
          const aheadM = bracket.match(/ahead\s+(\d+)/);
          const behindM = bracket.match(/behind\s+(\d+)/);
          if (aheadM) ahead = Number(aheadM[1]);
          if (behindM) behind = Number(behindM[1]);
        }
      } else if (/^No commits yet on (.+)$/.test(header)) {
        const m = header.match(/^No commits yet on (.+)$/);
        if (m) branch = m[1];
      } else {
        branch = header;
      }
      continue;
    }

    // Status records: 2 chars + space + path
    if (rec.length < 3) continue;
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    const isRenameOrCopy = xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C";
    if (isRenameOrCopy && i + 1 < records.length) {
      // The original (source) path is the next record. We surface the new path.
      i++;
    }
    files.push(parseStatusLine(xy, path));
  }

  return { ok: true, branch, upstream, ahead, behind, files };
}

function parseStatusLine(xy: string, path: string): GitFileChange {
  const x = xy[0];
  const y = xy[1];
  let status: GitFileStatus;
  let staged = false;

  if (x === "?" && y === "?") {
    status = "untracked";
  } else if (x === "!" && y === "!") {
    status = "ignored";
  } else if (
    x === "U" || y === "U" ||
    (x === "A" && y === "A") ||
    (x === "D" && y === "D")
  ) {
    status = "conflicted";
  } else {
    // Either the index or working tree carries the change. Prefer the
    // index ("staged") bucket if X is set; otherwise the working tree.
    const indexChar = x !== " " && x !== "?" ? x : null;
    const workChar = y !== " " && y !== "?" ? y : null;
    const ch = indexChar ?? workChar ?? " ";
    staged = indexChar !== null && (workChar === null);
    status = letterToStatus(ch);
  }

  return { path, status, staged, raw: xy };
}

function letterToStatus(ch: string): GitFileStatus {
  switch (ch) {
    case "M":
    case "T":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}
