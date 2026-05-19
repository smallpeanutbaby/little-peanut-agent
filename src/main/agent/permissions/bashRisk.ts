/**
 * Bash command risk classifier.
 *
 * Three verdicts:
 *  - "safe"  — passes the safe-verb fast-path (`ls`, `pwd`, `git status`,
 *              ...) and uses no shell metacharacters. The gate may still
 *              choose to ask the first time, but with a clear "this is a
 *              read-only verb" reason in the modal.
 *  - "risky" — known potentially destructive pattern (e.g. `rm -rf`,
 *              `git push --force`). Modal pre-selects "deny" visually; the
 *              user must consciously click allow.
 *  - "deny"  — catastrophic pattern (sudo, fork bomb, raw block device
 *              writes, machine power). Gate rejects without prompting.
 *
 * The classifier is intentionally syntactic — it does not try to parse
 * a full bash AST. The runtime's defense-in-depth is:
 *   1. This classifier on the command string.
 *   2. The permission gate (always asks unless a rule allows).
 *   3. `pathValidation` on file arguments derived from the command.
 *   4. The sandboxed env in `Bash` itself (no npm_* / CURSOR_* leaks).
 */

export interface BashRiskResult {
  verdict: "safe" | "risky" | "deny";
  reason?: string;
  /** Best-effort lowercased "first non-flag token" so the gate can
   *  group repeat asks by command verb ("ls", "git", "npm" …). For
   *  multi-word safe verbs (e.g. "git status") this is just "git" — the
   *  gate uses `safeSubVerb` below to widen the verb match for
   *  read-only git subcommands without auto-allowing all of git. */
  verb: string;
  /** Sub-verb for multi-token safe commands. Only present when
   *  `verdict === 'safe'` and the command was matched against the
   *  multi-token allowlist (e.g. `git status` → "git status"). */
  safeSubVerb?: string;
}

/* -------------------------------------------------------------------------- */
/* Deny patterns                                                              */
/* -------------------------------------------------------------------------- */

const DENY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /(^|[\s;|&(])sudo(\s|$)/,
    reason: "`sudo` is not allowed — the agent runs as the current user only."
  },
  {
    re: /\bdoas\b/,
    reason: "`doas` is not allowed — same constraint as `sudo`."
  },
  {
    re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr|--recursive\s+--force|--force\s+--recursive)\b[^|;&]*(\/|~\/|\$HOME|\.\.|\*)/,
    reason: "destructive `rm -rf` on a broad / root / wildcard path is denied."
  },
  {
    re: /\bcurl\b[^|]*\|\s*(bash|sh|zsh|ksh|fish|python\d?|perl|ruby|node)\b/,
    reason: "`curl | shell` pipe is denied — fetch then read first."
  },
  {
    re: /\bwget\b[^|]*\|\s*(bash|sh|zsh|ksh|fish|python\d?|perl|ruby|node)\b/,
    reason: "`wget | shell` pipe is denied — fetch then read first."
  },
  {
    re: /\b(mkfs|dd)\b[^\n]*\s+of=\/dev\/(sd[a-z]|nvme\d|disk\d|rdisk\d)/i,
    reason: "writing to a raw block device is denied."
  },
  {
    re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "fork bomb pattern detected."
  },
  {
    re: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b|\bsysctl\s+-w\s+kern\.|\binit\s+\d/,
    reason: "machine power / init commands are denied."
  },
  {
    re: /\bchmod\s+(-R\s+)?0?7?77\b/,
    reason: "`chmod 777` opens files to every user on the host — denied."
  },
  {
    re: /\bchown\s+[^\s]*\s+(\/|~\/|\$HOME)/,
    reason: "`chown` against root / home paths is denied."
  },
  {
    re: /\bnc\b[^\n]*-e\s*\/bin\/(bash|sh)\b/,
    reason: "`nc -e /bin/sh` is a remote shell — denied."
  },
  {
    re: /\beval\s*\$?\(\s*echo\s+[A-Za-z0-9+/=]+\s*\|\s*base64\s+(-d|--decode)\b/,
    reason: "base64-decoded `eval` is denied — paste the script you want me to run."
  },
  {
    re: /\binsmod\b|\bmodprobe\b|\brmmod\b/,
    reason: "kernel module operations are denied."
  },
  {
    re: />\s*\/dev\/(sd|nvme|disk|rdisk|hd)/i,
    reason: "redirect to a raw block device is denied."
  },
  {
    re: /\bgit\s+filter-(branch|repo)\b[^|;&]*--force/,
    reason: "`git filter-branch --force` rewrites history irreversibly — denied."
  }
];

/* -------------------------------------------------------------------------- */
/* Risky patterns (allowed only with explicit user confirmation)              */
/* -------------------------------------------------------------------------- */

const RISKY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\b\s+-/, reason: "`rm` with flags — review the path before allowing." },
  { re: />\s*\/dev\//, reason: "redirect to /dev/* — confirm target device." },
  {
    re: /\bgit\s+push\b[^|;&]*--force(?!-with-lease)/,
    reason: "`git push --force` rewrites remote history. Prefer --force-with-lease."
  },
  {
    re: /\bgit\s+push\b[^|;&]*\b(main|master|HEAD)\b[^|;&]*--force/,
    reason: "`git push --force` to a protected branch."
  },
  {
    re: /\bgit\s+reset\b[^|;&]*--hard/,
    reason: "`git reset --hard` discards uncommitted work."
  },
  {
    re: /\bgit\s+clean\b[^|;&]*-[a-z]*[dfx]/,
    reason: "`git clean -fd[x]` deletes untracked files."
  },
  { re: /\bdocker\s+(rm|rmi|prune|system\s+prune)\b/, reason: "Docker cleanup — may delete user-owned resources." },
  { re: /\bnpm\s+(install|i)\s+-g\b|\bnpm\s+install\s+--global\b/, reason: "global npm install — modifies the host." },
  { re: /\bpip\s+install\s+(--user|--global|-U|--upgrade)\b/, reason: "pip install can modify Python environments." },
  { re: /\bbrew\s+(install|reinstall|upgrade|uninstall)\b/, reason: "Homebrew operation — modifies system packages." },
  { re: /\bkill\s+-9\b/, reason: "`kill -9` denies the target process any cleanup." },
  { re: /\bpkill\b|\bkillall\b/, reason: "`pkill` / `killall` can hit unrelated processes." },
  { re: /\bcurl\b[^|;&]*\s-o\s+[^\s]*\/(usr|bin|sbin|etc)\b/, reason: "downloading directly into a system directory." },
  { re: /\beval\b/, reason: "`eval` evaluates arbitrary strings as code." },
  { re: /\bxargs\b[^|;&]*\brm\b/, reason: "`xargs rm` can delete many files in one shot." },
  { re: /\bfind\b[^|;&]*\s+-delete\b/, reason: "`find -delete` removes matched files." },
  { re: /\bfind\b[^|;&]*\s+-exec\s+rm\b/, reason: "`find -exec rm` removes matched files." }
];

/* -------------------------------------------------------------------------- */
/* Safe verb allowlist                                                        */
/* -------------------------------------------------------------------------- */

/** Single-token verbs that, in isolation and without metacharacters,
 *  are read-only. Anything with `;|&><\``, $(, or > redirection is
 *  excluded by the metacharacter check before we even look here. */
const SAFE_VERBS = new Set([
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "file",
  "stat",
  "wc",
  "which",
  "whereis",
  "type",
  "echo",
  "printf",
  "date",
  "uname",
  "hostname",
  "whoami",
  "id",
  "env",
  "true",
  "false",
  "basename",
  "dirname",
  "realpath",
  "tree",
  "du",
  "df",
  "ps",
  "top",
  "uptime",
  "free",
  "history",
  "tput",
  "tty"
]);

/** Two-token safe commands (`git status`, `npm ls`, …). We match on the
 *  first two whitespace-separated tokens. */
const SAFE_SUB_VERBS = new Set([
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
  "git rev-parse",
  "git ls-files",
  "git config --list",
  "npm ls",
  "npm list",
  "npm config get",
  "pip list",
  "pip show",
  "node --version",
  "node -v",
  "python --version",
  "python3 --version",
  "tsc --version",
  "tsc --noEmit",
  "rg --version",
  "rg --help"
]);

/** Shell metacharacters that disable the safe-verb fast-path. If any of
 *  these appears in the command, we treat the whole thing as risky-ish
 *  because the user may be chaining a safe verb into a dangerous one. */
const METACHARS = /[;|&><`$()]/;

export function classifyBashRisk(command: string): BashRiskResult {
  const text = command.trim();
  const verb = (text.match(/^([\w./-]+)/)?.[1] ?? "").toLowerCase();

  for (const { re, reason } of DENY_PATTERNS) {
    if (re.test(text)) return { verdict: "deny", reason, verb };
  }
  for (const { re, reason } of RISKY_PATTERNS) {
    if (re.test(text)) return { verdict: "risky", reason, verb };
  }

  // Safe-verb fast-path: only kicks in when the command has no shell
  // metacharacters (no pipes, redirects, subshells, command substitution).
  if (!METACHARS.test(text)) {
    if (SAFE_VERBS.has(verb)) {
      return { verdict: "safe", verb };
    }
    const twoToken = text.split(/\s+/).slice(0, 2).join(" ").toLowerCase();
    if (SAFE_SUB_VERBS.has(twoToken)) {
      return { verdict: "safe", verb, safeSubVerb: twoToken };
    }
  }

  return { verdict: "safe", verb };
}
