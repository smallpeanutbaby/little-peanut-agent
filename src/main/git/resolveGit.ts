/**
 * Resolve `git` for child_process.spawn inside packaged Electron on Windows,
 * where PATH is often stripped and `spawn("git", …)` fails with ENOENT.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let cached: string | null = null;

export function resolveGitExecutable(): string {
  if (cached) return cached;

  const candidates: string[] = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  if (pf) candidates.push(path.join(pf, "Git", "cmd", "git.exe"));
  if (pf86) candidates.push(path.join(pf86, "Git", "cmd", "git.exe"));
  const localApp = process.env.LOCALAPPDATA;
  if (localApp) candidates.push(path.join(localApp, "Programs", "Git", "cmd", "git.exe"));

  for (const exe of candidates) {
    try {
      if (fs.statSync(exe).isFile()) {
        cached = exe;
        return cached;
      }
    } catch {
      /* try next */
    }
  }

  if (process.platform === "win32") {
    try {
      const out = execFileSync("where", ["git"], { encoding: "utf8", windowsHide: true }).trim();
      const first = out.split(/\r?\n/).find((l) => l.trim().endsWith(".exe") || l.includes("git"));
      if (first?.trim()) {
        cached = first.trim();
        return cached;
      }
    } catch {
      /* fall through */
    }
  } else {
    try {
      execFileSync("which", ["git"], { stdio: "ignore" });
      cached = "git";
      return cached;
    } catch {
      /* fall through */
    }
  }

  cached = "git";
  return cached;
}

/** Enrich PATH so Git-for-Windows shims work when we only have `git` on PATH by name. */
export function envWithGitPath(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  if (process.platform !== "win32") return env;
  const dirs: string[] = [];
  const pf = env.ProgramFiles ?? process.env.ProgramFiles;
  const pf86 = env["ProgramFiles(x86)"] ?? process.env["ProgramFiles(x86)"];
  if (pf) dirs.push(path.join(pf, "Git", "cmd"), path.join(pf, "Git", "bin"));
  if (pf86) dirs.push(path.join(pf86, "Git", "cmd"), path.join(pf86, "Git", "bin"));
  const pathKey = env.Path !== undefined ? "Path" : "PATH";
  const cur = env[pathKey] ?? "";
  env[pathKey] = [...dirs, cur].filter(Boolean).join(path.delimiter);
  return env;
}
