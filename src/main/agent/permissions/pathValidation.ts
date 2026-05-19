/**
 * Path safety helpers for tools that touch the filesystem.
 *
 * Goal: every Read/Write/Edit/Delete/Bash invocation MUST be confined
 * to the active project's root (or an explicitly allow-listed
 * additional working directory). We resolve symlinks before checking
 * containment so a tool can't escape by editing a symlink target.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface PathValidationResult {
  ok: boolean;
  /** Absolute, normalized, symlink-resolved path (when ok). */
  resolved?: string;
  /** Human reason on failure. */
  reason?: string;
}

/**
 * System paths that are ALWAYS off-limits, even when the user adds `~`
 * or `/` to `additionalWorkingDirectories`. The blocklist exists
 * precisely because users do sometimes add overly-broad allow entries
 * and we want a hard backstop for credential dirs and OS installs.
 */
function systemBlocklist(): string[] {
  const home = os.homedir();
  return [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/var/log",
    "/System",
    "/Library/Keychains",
    "/Library/Application Support/com.apple.TCC",
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
    path.join(home, ".kube"),
    path.join(home, ".docker"),
    path.join(home, ".npmrc"),
    path.join(home, ".netrc"),
    path.join(home, ".config", "gh"),
    path.join(home, ".config", "git", "credentials"),
    path.join(home, "Library", "Keychains")
  ];
}

/**
 * Resolve `inputPath` to an absolute path inside `projectRoot`.
 *  - Relative paths are joined against the project root.
 *  - Symlinks are followed; the final realpath must still be inside
 *    the root (or an additional working directory).
 *  - Files that do not yet exist (e.g. for Write) are resolved by
 *    realpath-ing their parent directory and rejoining the basename.
 */
export async function validateProjectPath(
  inputPath: string,
  projectRoot: string,
  options: { additionalWorkingDirectories?: string[]; mustExist?: boolean } = {}
): Promise<PathValidationResult> {
  if (!inputPath || typeof inputPath !== "string") {
    return { ok: false, reason: "path is required" };
  }
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, reason: "project root is not configured" };
  }

  let absolute: string;
  if (path.isAbsolute(inputPath)) {
    absolute = path.normalize(inputPath);
  } else {
    absolute = path.normalize(path.join(projectRoot, inputPath));
  }

  // Try to realpath the file itself; if it does not exist, fall back to
  // realpath-ing the parent dir and reattaching the basename. We do this
  // even when `mustExist=true` so we get a precise error message later.
  let resolved: string;
  try {
    resolved = await fs.realpath(absolute);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, reason: `realpath failed: ${(e as Error).message}` };
    }
    if (options.mustExist) {
      return { ok: false, reason: `file does not exist: ${absolute}` };
    }
    try {
      const parentReal = await fs.realpath(path.dirname(absolute));
      resolved = path.join(parentReal, path.basename(absolute));
    } catch {
      // Parent also missing — fall back to the normalized path. This
      // lets a tool create nested directories under the project root.
      resolved = absolute;
    }
  }

  const rootReal = (await safeRealpath(projectRoot)).normalize("NFC");
  const additional = await Promise.all(
    (options.additionalWorkingDirectories ?? []).map(async (d) => (await safeRealpath(d)).normalize("NFC"))
  );
  resolved = resolved.normalize("NFC");

  const allowedRoots = [rootReal, ...additional].filter(Boolean) as string[];
  const inside = allowedRoots.some((root) => isInsideRoot(resolved, root));
  if (!inside) {
    return {
      ok: false,
      resolved,
      reason: `path escapes project root: ${resolved}`
    };
  }

  // Hard backstop: even when contained, refuse credential / system
  // paths the user shouldn't be writing through an agent. This catches
  // the "user added `~` as an additional working directory" foot-gun.
  for (const block of systemBlocklist()) {
    if (isInsideRoot(resolved, block) || resolved === block) {
      return {
        ok: false,
        resolved,
        reason: `path is in a system-protected location: ${block}`
      };
    }
  }
  return { ok: true, resolved };
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.normalize(p);
  }
}

/**
 * Containment check. Normalizes Unicode (NFC) to handle macOS NFD paths
 * with CJK characters, then checks prefix containment.
 */
export function isInsideRoot(target: string, root: string): boolean {
  if (!target || !root) return false;
  const t = target.normalize("NFC");
  const r = root.normalize("NFC");
  const normRoot = r.endsWith(path.sep) ? r : r + path.sep;
  if (t + path.sep === normRoot) return true;
  if (t === r) return true;
  return t.startsWith(normRoot);
}
