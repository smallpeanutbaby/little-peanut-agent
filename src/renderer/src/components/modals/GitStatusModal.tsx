import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { GitFileChange, GitFileStatus, GitStatusResult } from "@shared/types";

/**
 * Modal that shows the structured `git status` of a project's working
 * directory. Re-fetches on demand. Read-only — we never mutate the repo
 * from this UI.
 */
export function GitStatusModal({
  projectPath,
  projectName,
  onClose
}: {
  projectPath: string;
  projectName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.getGitStatus) {
      setData({ ok: false, reason: "git-error", message: "git API unavailable" });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await window.electronAPI.getGitStatus(projectPath);
      setData(res);
    } catch (e) {
      setData({ ok: false, reason: "git-error", message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex flex-col">
            <div className="text-[16px] font-semibold text-[var(--lp-text)]">
              {t("projectLanding.gitTitle")}
            </div>
            <div className="text-[11.5px] text-[var(--lp-soft-text)]">{projectName}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3 py-1.5 text-[12.5px] text-[var(--lp-text)]/80 hover:bg-[var(--lp-panel-2)] disabled:opacity-50"
              onClick={() => void refresh()}
              disabled={loading}
              type="button"
            >
              {t("projectLanding.gitRefresh")}
            </button>
            <button
              className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3 py-1.5 text-[12.5px] text-[var(--lp-text)]/80 hover:bg-[var(--lp-panel-2)]"
              onClick={onClose}
              type="button"
            >
              {t("projectLanding.gitCloseBtn")}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-[var(--lp-soft-text)]">
              {t("projectLanding.gitLoading")}
            </div>
          ) : data && !data.ok ? (
            <GitErrorBlock data={data} />
          ) : data && data.ok ? (
            <GitOkBlock data={data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GitErrorBlock({ data }: { data: Extract<GitStatusResult, { ok: false }> }) {
  const { t } = useTranslation();
  const headline = data.reason === "not-a-repo"
    ? t("projectLanding.gitNotARepo")
    : data.reason === "no-path"
      ? t("projectLanding.gitNoPath")
      : data.reason === "git-not-found"
        ? "git executable not found in PATH"
        : `${t("projectLanding.gitErrorPrefix")}: ${data.message ?? "unknown"}`;
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-[14px] text-[var(--lp-text)]">{headline}</div>
      {data.message && data.reason !== "not-a-repo" && data.reason !== "no-path" ? (
        <div className="max-w-[480px] text-[11.5px] text-[var(--lp-soft-text)]">{data.message}</div>
      ) : null}
    </div>
  );
}

function GitOkBlock({ data }: { data: Extract<GitStatusResult, { ok: true }> }) {
  const { t } = useTranslation();
  const staged = data.files.filter((f) => f.staged);
  const unstaged = data.files.filter((f) => !f.staged && f.status !== "untracked" && f.status !== "conflicted");
  const untracked = data.files.filter((f) => f.status === "untracked");
  const conflicted = data.files.filter((f) => f.status === "conflicted");

  return (
    <div className="flex flex-col gap-4">
      {/* Branch summary */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-[var(--lp-text)]/90">
          <span className="text-[var(--lp-soft-text)]">{t("projectLanding.gitBranch")}: </span>
          <span className="font-medium">{data.branch ?? "HEAD"}</span>
        </span>
        {data.upstream ? (
          <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[var(--lp-soft-text)]">
            → {data.upstream}
          </span>
        ) : null}
        {data.ahead > 0 ? (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11.5px] text-emerald-300">
            ↑ {data.ahead} {t("projectLanding.gitAhead")}
          </span>
        ) : null}
        {data.behind > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11.5px] text-amber-300">
            ↓ {data.behind} {t("projectLanding.gitBehind")}
          </span>
        ) : null}
      </div>

      {data.files.length === 0 ? (
        <div className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel)] px-4 py-6 text-center text-[13px] text-[var(--lp-soft-text)]">
          ✓ {t("projectLanding.gitClean")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--lp-soft-text)]">
            {t("projectLanding.gitChangesHeading")}
          </div>
          <FileGroup label={t("projectLanding.gitConflicted")} files={conflicted} accent="rose" />
          <FileGroup label={t("projectLanding.gitStaged")} files={staged} accent="emerald" />
          <FileGroup label={t("projectLanding.gitModified")} files={unstaged} accent="amber" />
          <FileGroup label={t("projectLanding.gitUntracked")} files={untracked} accent="sky" />
        </div>
      )}
    </div>
  );
}

const ACCENT_CLASSES: Record<string, { dot: string; text: string }> = {
  emerald: { dot: "bg-emerald-400", text: "text-emerald-300" },
  amber:   { dot: "bg-amber-400",   text: "text-amber-300" },
  sky:     { dot: "bg-sky-400",     text: "text-sky-300" },
  rose:    { dot: "bg-rose-400",    text: "text-rose-300" }
};

function FileGroup({ label, files, accent }: { label: string; files: GitFileChange[]; accent: string }) {
  if (files.length === 0) return null;
  const cls = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.amber;
  return (
    <div className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel)]">
      <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${cls.dot}`} />
          <span className={`text-[12px] font-medium ${cls.text}`}>{label}</span>
        </div>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--lp-soft-text)]">
          {files.length}
        </span>
      </div>
      <div className="max-h-[200px] overflow-y-auto py-1">
        {files.map((f) => (
          <div key={`${f.path}-${f.raw}`} className="flex items-center gap-2 px-3 py-1 text-[12.5px]">
            <span className="inline-flex w-6 shrink-0 justify-center font-mono text-[10.5px] text-[var(--lp-soft-text)]">
              {statusBadge(f.status)}
            </span>
            <span className="flex-1 truncate font-mono text-[var(--lp-text)]/90" title={f.path}>
              {f.path}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusBadge(s: GitFileStatus): string {
  switch (s) {
    case "modified":   return "M";
    case "added":      return "A";
    case "deleted":    return "D";
    case "renamed":    return "R";
    case "copied":     return "C";
    case "untracked":  return "?";
    case "ignored":    return "!";
    case "conflicted": return "U";
    default:           return "·";
  }
}
