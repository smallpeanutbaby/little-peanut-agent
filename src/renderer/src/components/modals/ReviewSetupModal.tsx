import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { GitCommitSummary, GitStatusResult, ReviewScope, ReviewScopeKind } from "@shared/types";

type Step = "choose" | "uncommitted" | "commits" | "manual";

/** Opaque surfaces for form controls (avoid translucent `--lp-panel` + native white widgets). */

const FIELD_BG = "bg-[#1a1a1a]";

const LIST_BG = "bg-[#141414]";

export function ReviewSetupModal({
  projectPath,

  projectName,

  initialScope,

  onConfirm,

  onClose
}: {
  projectPath: string;

  projectName: string;

  initialScope?: ReviewScope | null;

  onConfirm: (scope: ReviewScope) => void | Promise<void>;

  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);

  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("choose");

  const [branches, setBranches] = useState<string[]>([]);

  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  const [selectedBranch, setSelectedBranch] = useState("");

  const [commits, setCommits] = useState<GitCommitSummary[]>([]);

  const [selectedCommits, setSelectedCommits] = useState<Set<string>>(new Set());

  const [manualText, setManualText] = useState(initialScope?.manualDescription ?? "");

  const [commitsLoading, setCommitsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const hasGit = gitStatus?.ok === true;

  const refreshGit = useCallback(async () => {
    const api = window.electronAPI;

    if (!api?.getGitStatus) {
      setGitStatus({ ok: false, reason: "git-error", message: "git API unavailable" });

      setLoading(false);

      return;
    }

    setLoading(true);

    setError(null);

    try {
      const st = await api.getGitStatus(projectPath);

      setGitStatus(st);

      if (!st.ok) return;

      if (!api.listGitBranches) {
        setError(t("review.setup.errorBranches"));
        return;
      }

      const br = await api.listGitBranches(projectPath);

      if (!br.ok) {
        setBranches([]);
        setCurrentBranch(null);
        setError(br.message ?? t("review.setup.errorBranches"));
        return;
      }

      setBranches(br.branches);
      setCurrentBranch(br.current);
      setSelectedBranch((prev) => {
        if (prev && br.branches.includes(prev)) return prev;
        if (br.current && br.branches.includes(br.current)) return br.current;
        return br.branches[0] ?? "";
      });
    } catch (e) {
      setGitStatus({ ok: false, reason: "git-error", message: (e as Error).message });
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectPath, t]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  useEffect(() => {
    if (initialScope?.kind === "manual") {
      setStep("manual");
    } else if (initialScope?.kind === "uncommitted") {
      setStep("uncommitted");
    } else if (initialScope?.kind === "commits") {
      // Restore prior selection, but stay on the chooser until branches are loaded
      // so we never land on an empty branch picker ("—").
      if (initialScope.branch) setSelectedBranch(initialScope.branch);
      if (initialScope.commitIds) setSelectedCommits(new Set(initialScope.commitIds));
      if (!loading && hasGit && branches.length > 0) setStep("commits");
    } else if (!loading && !hasGit) {
      setStep("manual");
    }
  }, [initialScope, loading, hasGit, branches.length]);

  const loadCommits = useCallback(
    async (branch: string) => {
      const api = window.electronAPI;

      if (!api?.listGitCommits || !branch) return;

      setCommitsLoading(true);

      setError(null);

      try {
        const res = await api.listGitCommits(projectPath, branch, 80);

        if (!res.ok) {
          setError(res.message ?? t("review.setup.errorCommits"));

          setCommits([]);
        } else {
          setCommits(res.commits);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCommitsLoading(false);
      }
    },
    [projectPath, t]
  );

  useEffect(() => {
    if (step === "commits" && selectedBranch) {
      void loadCommits(selectedBranch);
    }
  }, [step, selectedBranch, loadCommits]);

  const changedFiles = useMemo(() => {
    if (!gitStatus?.ok) return [];

    return gitStatus.files.filter((f) => f.status !== "ignored");
  }, [gitStatus]);

  function pickKind(kind: ReviewScopeKind) {
    setError(null);

    if (kind === "uncommitted") setStep("uncommitted");
    else if (kind === "commits") {
      if (branches.length === 0) {
        setError(t("review.setup.errorBranches"));
        void refreshGit();
        return;
      }
      if (!selectedBranch) {
        setSelectedBranch(currentBranch ?? branches[0] ?? "");
      }
      setStep("commits");
    } else setStep("manual");
  }

  function toggleCommit(hash: string) {
    setSelectedCommits((prev) => {
      const next = new Set(prev);

      if (next.has(hash)) next.delete(hash);
      else next.add(hash);

      return next;
    });
  }

  async function confirmScope(scope: ReviewScope) {
    setConfirming(true);
    setError(null);
    try {
      await onConfirm(scope);
      onClose();
    } catch (e) {
      setError((e as Error).message || t("review.setup.launchFailed"));
    } finally {
      setConfirming(false);
    }
  }

  function handleConfirm() {
    if (confirming) return;
    setError(null);

    if (step === "uncommitted") {
      if (changedFiles.length === 0) {
        setError(t("review.setup.noChanges"));

        return;
      }

      void confirmScope({
        kind: "uncommitted",

        label: t("review.scope.uncommitted", { count: changedFiles.length })
      });

      return;
    }

    if (step === "commits") {
      const ids = [...selectedCommits];

      if (ids.length === 0) {
        setError(t("review.setup.pickCommit"));

        return;
      }

      void confirmScope({
        kind: "commits",

        branch: selectedBranch,

        commitIds: ids,

        label: t("review.scope.commits", { branch: selectedBranch, count: ids.length })
      });

      return;
    }

    const desc = manualText.trim();

    if (!desc) {
      setError(t("review.setup.manualRequired"));

      return;
    }

    void confirmScope({
      kind: "manual",

      manualDescription: desc,

      label: desc.slice(0, 72) + (desc.length > 72 ? "…" : "")
    });
  }

  /* Stay in the React tree (no portal) so theme CSS variables + color-scheme apply. */

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="lp-review-modal flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-[20px] border border-[var(--lp-border)] bg-[var(--lp-bg-2)] shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-setup-title"
      >
        <div className="border-b border-white/[0.06] px-5 py-4">
          <div id="review-setup-title" className="text-[16px] font-semibold text-[var(--lp-text)]">
            {t("review.setup.title")}
          </div>

          <div className="mt-0.5 text-[12px] text-[var(--lp-soft-text)]">{projectName}</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-[13px] text-[var(--lp-soft-text)]">{t("review.setup.loading")}</div>
          ) : step === "choose" && hasGit ? (
            <div className="flex flex-col gap-2">
              <p className="mb-2 text-[13px] text-[var(--lp-soft-text)]">{t("review.setup.chooseHint")}</p>

              <ChoiceCard
                title={t("review.setup.uncommittedTitle")}
                desc={t("review.setup.uncommittedDesc")}
                meta={t("review.setup.uncommittedMeta", { count: changedFiles.length })}
                onClick={() => pickKind("uncommitted")}
              />

              <ChoiceCard
                title={t("review.setup.commitsTitle")}
                desc={t("review.setup.commitsDesc")}
                meta={currentBranch ? t("review.setup.currentBranch", { branch: currentBranch }) : undefined}
                onClick={() => pickKind("commits")}
              />
            </div>
          ) : step === "uncommitted" ? (
            <div>
              <button
                type="button"
                className="mb-3 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
                onClick={() => setStep(hasGit ? "choose" : "manual")}
              >
                ← {t("review.setup.back")}
              </button>

              <p className="mb-3 text-[13px] text-[var(--lp-soft-text)]">{t("review.setup.uncommittedPreview")}</p>

              <ul
                className={`max-h-[280px] overflow-y-auto rounded-lg border border-[var(--lp-border)] ${LIST_BG} px-3 py-2 text-[12px] font-mono text-[var(--lp-text)]/85`}
              >
                {changedFiles.length === 0 ? (
                  <li className="py-4 text-center text-[var(--lp-muted)]">{t("review.setup.noChanges")}</li>
                ) : (
                  changedFiles.map((f) => (
                    <li key={f.path} className="border-b border-white/[0.04] py-1.5 last:border-0">
                      <span className="text-[var(--lp-muted)]">{f.staged ? "S" : "W"}</span> {f.path}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : step === "commits" ? (
            <div>
              <button
                type="button"
                className="mb-3 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
                onClick={() => setStep("choose")}
              >
                ← {t("review.setup.back")}
              </button>

              <label className="mb-1 block text-[12px] text-[var(--lp-muted)]">{t("review.setup.branchLabel")}</label>

              <BranchPicker branches={branches} value={selectedBranch} onChange={setSelectedBranch} />

              {branches.length === 0 ? (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">
                  <span>{t("review.setup.errorBranches")}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[11px] hover:bg-white/[0.06]"
                    onClick={() => void refreshGit()}
                  >
                    {t("review.setup.retry")}
                  </button>
                </div>
              ) : null}

              <p className="mb-2 mt-4 text-[12px] text-[var(--lp-soft-text)]">{t("review.setup.commitsHint")}</p>

              {commitsLoading ? (
                <div
                  className={`rounded-lg border border-[var(--lp-border)] ${LIST_BG} py-8 text-center text-[13px] text-[var(--lp-muted)]`}
                >
                  {t("review.setup.loadingCommits")}
                </div>
              ) : commits.length === 0 ? (
                <div
                  className={`rounded-lg border border-[var(--lp-border)] ${LIST_BG} py-8 text-center text-[13px] text-[var(--lp-muted)]`}
                >
                  {t("review.setup.noCommits")}
                </div>
              ) : (
                <ul className={`max-h-[260px] overflow-y-auto rounded-lg border border-[var(--lp-border)] ${LIST_BG}`}>
                  {commits.map((c) => {
                    const checked = selectedCommits.has(c.hash);

                    return (
                      <li key={c.hash}>
                        <label className="flex cursor-pointer items-start gap-2.5 border-b border-white/[0.04] px-3 py-2.5 last:border-0 hover:bg-white/[0.04]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCommit(c.hash)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-white/25 bg-[#1a1a1a] accent-violet-500"
                          />

                          <span className="min-w-0 flex-1">
                            <span className="font-mono text-[11px] text-violet-300/90">{c.shortHash}</span>

                            <span className="ml-2 text-[12.5px] text-[var(--lp-text)]">{c.subject}</span>

                            <span className="mt-0.5 block text-[10.5px] text-[var(--lp-muted)]">
                              {c.author} · {c.date.slice(0, 10)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div>
              {hasGit ? (
                <button
                  type="button"
                  className="mb-3 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
                  onClick={() => setStep("choose")}
                >
                  ← {t("review.setup.back")}
                </button>
              ) : (
                <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">
                  {t("review.setup.noGitHint")}
                </p>
              )}

              <label className="mb-1 block text-[12px] text-[var(--lp-muted)]">{t("review.setup.manualLabel")}</label>

              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                rows={6}
                placeholder={t("review.setup.manualPlaceholder")}
                className={`w-full resize-none rounded-lg border border-[var(--lp-border)] ${FIELD_BG} px-3 py-2 text-[13px] leading-relaxed text-[var(--lp-text)] outline-none focus:border-white/25`}
              />
            </div>
          )}

          {error ? (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3">
          {!hasGit && step === "choose" ? (
            <button
              type="button"
              className="text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
              onClick={() => setStep("manual")}
            >
              {t("review.setup.manualLink")}
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--lp-border)] px-4 py-2 text-[13px] text-[var(--lp-text)]/80 hover:bg-white/[0.04]"
            >
              {t("review.setup.cancel")}
            </button>

            {step !== "choose" ? (
              <button
                type="button"
                disabled={confirming}
                onClick={() => void handleConfirm()}
                className="rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-[#151515] hover:bg-white/90 disabled:opacity-60"
              >
                {confirming ? t("review.setup.launching") : t("review.setup.confirm")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchPicker({
  branches,

  value,

  onChange
}: {
  branches: string[];

  value: string;

  onChange: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("mousedown", onDoc);

    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-lg border border-[var(--lp-border)] ${FIELD_BG} px-3 py-2 text-left text-[13px] text-[var(--lp-text)] hover:border-white/20`}
      >
        <span className="truncate font-mono">{value || "—"}</span>

        <span className="ml-2 text-[10px] text-[var(--lp-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && branches.length > 0 ? (
        <ul
          className={`absolute left-0 right-0 z-10 mt-1 max-h-[200px] overflow-y-auto rounded-lg border border-[var(--lp-border)] ${LIST_BG} py-1 shadow-lg`}
        >
          {branches.map((b) => (
            <li key={b}>
              <button
                type="button"
                onClick={() => {
                  onChange(b);

                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left font-mono text-[12.5px] hover:bg-white/[0.06] ${
                  b === value ? "bg-violet-500/15 text-violet-200" : "text-[var(--lp-text)]"
                }`}
              >
                {b}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChoiceCard({
  title,
  desc,
  meta,
  onClick
}: {
  title: string;
  desc: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border border-[var(--lp-border)] ${LIST_BG} px-4 py-3 text-left transition hover:border-violet-400/30 hover:bg-violet-500/[0.08]`}
    >
      <div className="text-[14px] font-medium text-[var(--lp-text)]">{title}</div>

      <div className="mt-1 text-[12px] leading-snug text-[var(--lp-muted)]">{desc}</div>

      {meta ? <div className="mt-2 text-[11px] text-violet-300/80">{meta}</div> : null}
    </button>
  );
}
