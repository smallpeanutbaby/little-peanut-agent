/**
 * Pick a shell executable for the Bash tool (cross-platform).
 *
 * Windows: prefer pwsh → Windows PowerShell → cmd.exe (always present).
 * Unix: /bin/bash
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ResolvedShell {
  /** Executable path or name on PATH. */
  shell: string;
  shellArgs: string[];
  /** Short label for logs / tool errors. */
  label: string;
}

function fileExists(p: string | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function onPath(cmd: string): boolean {
  if (process.platform !== "win32") {
    try {
      execFileSync("which", [cmd], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  try {
    execFileSync("where", [cmd], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function pickFirst(candidates: Array<{ shell: string; shellArgs: string[]; label: string; paths?: string[] }>): ResolvedShell {
  for (const c of candidates) {
    if (c.paths) {
      for (const p of c.paths) {
        if (fileExists(p)) {
          return { shell: p, shellArgs: c.shellArgs, label: c.label };
        }
      }
    }
    if (onPath(c.shell)) {
      return { shell: c.shell, shellArgs: c.shellArgs, label: c.label };
    }
  }
  const last = candidates[candidates.length - 1]!;
  return { shell: last.shell, shellArgs: last.shellArgs, label: last.label };
}

export function resolveShellExecutable(): ResolvedShell {
  if (process.platform !== "win32") {
    if (fileExists("/bin/bash")) {
      return { shell: "/bin/bash", shellArgs: ["-lc"], label: "bash" };
    }
    return { shell: "/bin/sh", shellArgs: ["-lc"], label: "sh" };
  }

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";

  return pickFirst([
    {
      shell: "pwsh",
      label: "PowerShell 7",
      shellArgs: ["-NoLogo", "-NoProfile", "-Command"],
      paths: [
        path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
        path.join(process.env["ProgramFiles(x86)"] ?? "", "PowerShell", "7", "pwsh.exe")
      ]
    },
    {
      shell: "powershell.exe",
      label: "Windows PowerShell",
      shellArgs: ["-NoLogo", "-NoProfile", "-Command"],
      paths: [path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]
    },
    {
      shell: process.env.ComSpec ?? "cmd.exe",
      label: "cmd",
      shellArgs: ["/d", "/s", "/c"],
      paths: [
        process.env.ComSpec,
        path.join(systemRoot, "System32", "cmd.exe")
      ].filter((p): p is string => !!p)
    }
  ]);
}
