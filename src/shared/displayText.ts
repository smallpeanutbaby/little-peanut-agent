/**
 * Sanitize and normalize user-visible error text from git, HTTP, or LLM streams.
 */

/** Strip control chars / lone surrogates so UI does not show garbage glyphs. */
export function sanitizeDisplayText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .trim();
}

const TERMINAL_REASON_ZH: Record<string, string> = {
  stream_error: "模型请求失败，请检查 API Key、网络或模型名称后重试",
  max_iterations: "已达到最大迭代次数",
  cancelled: "已取消",
  budget_exceeded: "上下文预算已用尽",
  failed: "任务未能正常完成",
  "git-error": "无法读取 Git 变更，请确认项目路径是仓库根目录且已安装 Git",
  "git-not-found": "未找到 git 命令，请安装 Git 并加入 PATH",
  "not-a-repo": "当前项目目录不是 Git 仓库",
  "no-path": "项目路径无效或不存在"
};

const TERMINAL_REASON_EN: Record<string, string> = {
  stream_error: "Model request failed — check API key, network, and model id",
  max_iterations: "Maximum iterations reached",
  cancelled: "Cancelled",
  budget_exceeded: "Context budget exceeded",
  failed: "Task did not complete successfully",
  "git-error": "Could not read Git changes — check the project path and Git install",
  "git-not-found": "git executable not found in PATH",
  "not-a-repo": "Project folder is not a Git repository",
  "no-path": "Project path is missing or invalid"
};

function shellSpawnHint(raw: string, locale: "zh" | "en"): string | null {
  if (!/spawn\s+pwsh|ENOENT.*pwsh|spawn_failed/i.test(raw)) return null;
  return locale === "en"
    ? "Shell command failed: PowerShell 7 (pwsh) is not installed. The app now falls back to Windows PowerShell or cmd — restart the app and try again."
    : "Shell 命令失败：未找到 PowerShell 7 (pwsh)。应用会自动改用 Windows PowerShell 或 cmd，请完全退出后重新打开再试。";
}

/** True when the string looks like compressed/binary noise after sanitization. */
function looksLikeGarbage(text: string): boolean {
  if (!text) return true;
  if (text.length <= 6 && !/[\u4e00-\u9fff]/.test(text) && !/\s/.test(text)) {
    // Very short ASCII fragments (e.g. "eTX!") are almost always corrupt bodies.
    const alnum = (text.match(/[a-zA-Z0-9]/g) ?? []).length;
    if (alnum < text.length * 0.6) return true;
  }
  let printable = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x20 && c <= 0x7e) ||
      c >= 0x4e00 ||
      /[\s.,;:!?'"()[\]{}<>\/\\@#%&*+\-=_]/.test(ch)
    ) {
      printable++;
    }
  }
  return printable / text.length < 0.55;
}

function tryParseApiErrorMessage(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const err = j.error;
    if (err && typeof err === "object" && err !== null) {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
    if (typeof j.message === "string" && j.message.trim()) return j.message.trim();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Turn raw terminal / HTTP / adapter errors into stable UI copy.
 * Falls back to a reason label when the body is empty or binary garbage.
 */
export function formatUserFacingError(
  raw: string | undefined | null,
  reason?: string,
  locale: "zh" | "en" = "zh"
): string {
  const labels = locale === "en" ? TERMINAL_REASON_EN : TERMINAL_REASON_ZH;
  const fallback =
    (reason && labels[reason]) ||
    labels.stream_error;

  if (!raw?.trim()) return fallback;

  const spawnHint = shellSpawnHint(raw, locale);
  if (spawnHint) return spawnHint;

  const parsed = tryParseApiErrorMessage(raw);
  const cleaned = sanitizeDisplayText(parsed ?? raw);
  if (!cleaned || looksLikeGarbage(cleaned)) return fallback;

  if (cleaned.length > 600) return `${cleaned.slice(0, 600)}…`;
  return cleaned;
}

const ERROR_BUBBLE_PREFIX = "⚠️";

/**
 * Normalize persisted assistant error bubbles (`⚠️ …`) for display.
 * Old rows may contain gzip/API binary fragments that render as `eTOX` glyphs.
 */
export function formatStoredErrorBubble(
  content: string,
  locale: "zh" | "en" = "zh"
): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith(ERROR_BUBBLE_PREFIX)) {
    return sanitizeDisplayText(trimmed);
  }
  const body = trimmed.slice(ERROR_BUBBLE_PREFIX.length).trim();
  const formatted = formatUserFacingError(body, "stream_error", locale);
  return `${ERROR_BUBBLE_PREFIX} ${formatted}`;
}

/** Safe text for any message / tool part shown in the UI. */
export function formatMessageForDisplay(
  content: string,
  locale: "zh" | "en" = "zh"
): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(ERROR_BUBBLE_PREFIX)) {
    return formatStoredErrorBubble(trimmed, locale);
  }
  return sanitizeDisplayText(trimmed);
}
