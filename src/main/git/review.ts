/**
 * Git helpers for Review mode — branches, commits, and unified diffs.
 * Keeps the same safety posture as `status.ts`: bounded output, no shell.
 */

import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitBranchesResponse,
  GitCommitsResponse,
  GitReviewDiffResponse,
  GitStatusErr,
  GitStatusResult,
  ReviewScope
} from "@shared/types.js";
import { getGitStatus } from "./status.js";
import { envWithGitPath, resolveGitExecutable } from "./resolveGit.js";

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 2 * 1024 * 1024;
/** Cap diff injected into the model context (~120k chars ≈ safe for review mode budget). */
const MAX_DIFF_CHARS = 120_000;

async function repoPreflight(projectPath: string): Promise<GitStatusErr | null> {
  if (!projectPath) return { ok: false, reason: "no-path" };
  try {
    await access(projectPath);
  } catch {
    return { ok: false, reason: "no-path", message: `Path not accessible: ${projectPath}` };
  }
  try {
    const gitDir = join(projectPath, ".git");
    const st = await stat(gitDir);
    if (!st.isDirectory() && !st.isFile()) return { ok: false, reason: "not-a-repo" };
  } catch {
    return { ok: false, reason: "not-a-repo" };
  }
  return null;
}

async function runGit(
  projectPath: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: Error }> {
  return new Promise((resolve) => {
    let child;
    try {
      const gitExe = resolveGitExecutable();
      child = spawn(gitExe, args, {
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
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_BUFFER) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
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
        resolve({ code, stdout, stderr, spawnError: new Error("git command timed out") });
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

function mapSpawnError(err: Error): GitStatusErr {
  const msg = err.message;
  if (/ENOENT/.test(msg) || /not found/i.test(msg)) {
    return { ok: false, reason: "git-not-found", message: "git executable not found in PATH" };
  }
  return { ok: false, reason: "git-error", message: msg };
}

/** Normalize branch names from various `git branch` / `for-each-ref` outputs. */
function normalizeBranchName(raw: string): string | null {
  let b = raw.trim();
  if (!b || b === "HEAD" || b.startsWith("HEAD ->")) return null;
  // `git branch -a` lines: "* main", "  remotes/origin/dev"
  b = b.replace(/^\*\s+/, "").replace(/^\+\s+/, "").trim();
  b = b.replace(/^remotes\/origin\//, "").replace(/^origin\//, "");
  // Skip bare remote names and duplicate origin/* entries that aren't branches.
  if (b === "origin" || b.endsWith("/HEAD")) return null;
  return b || null;
}

function parseBranchLines(stdout: string): string[] {
  const out = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const name = normalizeBranchName(line);
    if (name) out.add(name);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

async function readCurrentBranch(projectPath: string): Promise<string | null> {
  const show = await runGit(projectPath, ["branch", "--show-current"]);
  if (show.code === 0 && show.stdout.trim()) return show.stdout.trim();
  const abbrev = await runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (abbrev.code === 0) {
    const name = abbrev.stdout.trim();
    if (name && name !== "HEAD") return name;
  }
  return null;
}

async function readBranchList(projectPath: string): Promise<{ ok: true; branches: string[] } | GitStatusErr> {
  // Preferred: structured output (Git ≥ 2.13).
  const formatted = await runGit(projectPath, ["branch", "-a", "--format=%(refname:short)"]);
  if (formatted.spawnError) return mapSpawnError(formatted.spawnError);
  if (formatted.code === 0) {
    const branches = parseBranchLines(formatted.stdout);
    if (branches.length > 0) return { ok: true, branches };
  }

  // Fallback: classic `git branch -a` text (older Git / odd configs).
  const plain = await runGit(projectPath, ["branch", "-a", "--no-color"]);
  if (plain.spawnError) return mapSpawnError(plain.spawnError);
  if (plain.code !== 0) {
    return {
      ok: false,
      reason: "git-error",
      message: plain.stderr.trim() || formatted.stderr.trim() || "git branch failed"
    };
  }
  const branches = parseBranchLines(plain.stdout);
  if (branches.length === 0) {
    return { ok: false, reason: "git-error", message: "仓库中没有可读的分支（可能尚未有任何提交）" };
  }
  return { ok: true, branches };
}

export async function listGitBranches(projectPath: string): Promise<GitBranchesResponse> {
  const pre = await repoPreflight(projectPath);
  if (pre) return pre;

  const [current, listed] = await Promise.all([
    readCurrentBranch(projectPath),
    readBranchList(projectPath)
  ]);
  if (!listed.ok) return listed;

  let branches = listed.branches;
  if (current && !branches.includes(current)) {
    branches = [current, ...branches].sort((a, b) => a.localeCompare(b));
  }

  return {
    ok: true,
    current,
    branches
  };
}

export async function listGitCommits(
  projectPath: string,
  branch: string,
  limit = 60
): Promise<GitCommitsResponse> {
  const pre = await repoPreflight(projectPath);
  if (pre) return pre;
  if (!branch) return { ok: false, reason: "git-error", message: "branch is required" };

  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const formatArgs = ["log", branch, `-n`, String(safeLimit), `--format=%H%x1f%h%x1f%s%x1f%an%x1f%ai`];
  let res = await runGit(projectPath, formatArgs);
  // If the local branch name doesn't exist (common after normalizing remotes),
  // retry with origin/<branch>.
  if (res.code !== 0 && !branch.startsWith("origin/")) {
    res = await runGit(projectPath, ["log", `origin/${branch}`, `-n`, String(safeLimit), `--format=%H%x1f%h%x1f%s%x1f%an%x1f%ai`]);
  }
  if (res.spawnError) return mapSpawnError(res.spawnError);
  if (res.code !== 0) {
    return { ok: false, reason: "git-error", message: res.stderr.trim() || "git log failed" };
  }

  const commits = res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, author, date] = line.split("\x1f");
      return { hash, shortHash, subject, author, date };
    })
    .filter((c) => c.hash);

  return { ok: true, branch, commits };
}

export async function getReviewDiff(
  projectPath: string,
  scope: ReviewScope
): Promise<GitReviewDiffResponse> {
  const pre = await repoPreflight(projectPath);
  if (pre) return pre;

  if (scope.kind === "manual") {
    const desc = (scope.manualDescription ?? "").trim();
    if (!desc) {
      return { ok: false, reason: "git-error", message: "manual review description is empty" };
    }
    return {
      ok: true,
      diff: "",
      summary: desc.slice(0, 120),
      truncated: false,
      fileCount: 0
    };
  }

  if (scope.kind === "uncommitted") {
    const staged = await runGit(projectPath, ["diff", "--cached", "--no-color"]);
    const unstaged = await runGit(projectPath, ["diff", "--no-color"]);
    if (staged.spawnError) return mapSpawnError(staged.spawnError);
    if (unstaged.spawnError) return mapSpawnError(unstaged.spawnError);

    const status = await getGitStatus(projectPath);
    const fileCount = status.ok ? status.files.filter((f) => f.status !== "ignored").length : 0;

    let diff = "";
    if (staged.stdout.trim()) diff += "=== STAGED (index) ===\n" + staged.stdout.trim() + "\n\n";
    if (unstaged.stdout.trim()) diff += "=== UNSTAGED (working tree) ===\n" + unstaged.stdout.trim();

    if (!diff.trim()) {
      const untracked = status.ok
        ? status.files.filter((f) => f.status === "untracked").map((f) => f.path)
        : [];
      if (untracked.length > 0) {
        diff =
          "=== UNTRACKED FILES (no diff available — use Read tool to inspect) ===\n" +
          untracked.join("\n");
      } else {
        return { ok: false, reason: "git-error", message: "工作区没有可审查的变更" };
      }
    }

    return capDiff(diff, `未提交变更（${fileCount} 个文件）`);
  }

  if (scope.kind === "commits") {
    const ids = (scope.commitIds ?? []).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, reason: "git-error", message: "请至少选择一个提交" };
    }
    const parts: string[] = [];
    for (const id of ids.slice(0, 20)) {
      const show = await runGit(projectPath, ["show", id, "--no-color", "--format=commit %H%nAuthor: %an <%ae>%nDate: %ai%nSubject: %s%n", "-p"]);
      if (show.spawnError) return mapSpawnError(show.spawnError);
      if (show.code !== 0) {
        return { ok: false, reason: "git-error", message: show.stderr.trim() || `invalid commit: ${id}` };
      }
      parts.push(show.stdout.trim());
    }
    const branch = scope.branch ?? "HEAD";
    return capDiff(parts.join("\n\n---\n\n"), `${branch} · ${ids.length} 个提交`);
  }

  return { ok: false, reason: "git-error", message: "unknown review scope" };
}

function capDiff(raw: string, summary: string): GitReviewDiffResponse {
  const truncated = raw.length > MAX_DIFF_CHARS;
  const diff = truncated ? raw.slice(0, MAX_DIFF_CHARS) + "\n\n…(diff truncated — use Read/Grep for full files)" : raw;
  const fileCount = (raw.match(/^diff --git/gm) ?? []).length || (raw.includes("=== UNTRACKED") ? 1 : 0);
  return { ok: true, diff, summary, truncated, fileCount };
}

/** Compose the first user message for a review run. */
export function buildReviewUserMessage(
  userText: string,
  scope: ReviewScope,
  diffResult: GitReviewDiffResult
): string {
  const label =
    scope.label ??
    (scope.kind === "uncommitted"
      ? "未提交变更"
      : scope.kind === "commits"
        ? `分支 ${scope.branch ?? "HEAD"} · ${scope.commitIds?.length ?? 0} 个提交`
        : "手动指定范围");

  const instructions = userText.trim() || "请对以上变更进行全面代码审查，按严重程度列出问题与改进建议。";

  const sections = [
    `【审查范围】${label}`,
    diffResult.summary ? `【摘要】${diffResult.summary}` : null,
    diffResult.diff ? `【Diff】\n${diffResult.diff}` : scope.manualDescription ? `【说明】\n${scope.manualDescription}` : null,
    `【审查要求】\n${instructions}`
  ].filter(Boolean);

  return sections.join("\n\n");
}

export async function resolveReviewScopeLabel(
  projectPath: string,
  scope: ReviewScope
): Promise<string> {
  if (scope.label) return scope.label;
  if (scope.kind === "manual") return scope.manualDescription?.slice(0, 80) ?? "手动审查";
  if (scope.kind === "uncommitted") {
    const st: GitStatusResult = await getGitStatus(projectPath);
    const n = st.ok ? st.files.filter((f) => f.status !== "ignored").length : 0;
    return `未提交变更（${n} 个文件）`;
  }
  return `${scope.branch ?? "HEAD"} · ${scope.commitIds?.length ?? 0} 个提交`;
}
