import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CHANNEL_BOT_KINDS,
  CHANNEL_DEFAULT_MODE_IDS,
  type ChannelBotConfig,
  type ChannelBotKind,
  type ChannelBotRuntimeStatus,
  type ChannelBotSaveInput
} from "@shared/channelBots";
import type { Project } from "@shared/types";
import { CHAT_MODE_MAP } from "@shared/modes";
import { openExternalUrl } from "../utils/openExternal";

const KIND_LABEL_KEYS: Record<ChannelBotKind, string> = {
  qq: "settings.botsKind.qq",
  feishu: "settings.botsKind.feishu",
  dingtalk: "settings.botsKind.dingtalk"
};

const KIND_DOC_URLS: Record<ChannelBotKind, string> = {
  qq: "https://bot.q.qq.com/wiki/develop/api-v2/",
  feishu: "https://open.feishu.cn/document/client-docs/bot-v3/bot-overview",
  dingtalk: "https://open.dingtalk.com/document/dingstart/robot-overview"
};

type Draft = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  token: string;
  allowFromText: string;
  defaultModeId: ChannelBotSaveInput["defaultModeId"];
  defaultProjectId: string | null;
  sandboxMode: boolean;
};

function configToDraft(cfg: ChannelBotConfig): Draft {
  return {
    enabled: cfg.enabled,
    appId: cfg.appId,
    appSecret: "",
    token: "",
    allowFromText: cfg.allowFrom.join("\n"),
    defaultModeId: cfg.defaultModeId,
    defaultProjectId: cfg.defaultProjectId,
    sandboxMode: cfg.sandboxMode
  };
}

function statusBadge(
  t: (k: string) => string,
  st: ChannelBotRuntimeStatus | undefined,
  enabled: boolean
): { label: string; className: string } {
  if (!enabled) {
    return { label: t("settings.botsStatusDisabled"), className: "bg-white/10 text-[var(--lp-soft-text)]" };
  }
  if (!st) {
    return { label: t("settings.botsStatusUnknown"), className: "bg-white/10 text-[var(--lp-soft-text)]" };
  }
  if (st.connected) {
    return { label: t("settings.botsStatusConnected"), className: "bg-emerald-500/15 text-emerald-300" };
  }
  if (st.running) {
    return { label: t("settings.botsStatusPending"), className: "bg-amber-500/15 text-amber-200" };
  }
  return { label: t("settings.botsStatusStopped"), className: "bg-white/10 text-[var(--lp-soft-text)]" };
}

export function ChannelBotsPane() {
  const { t, i18n } = useTranslation();
  const [activeKind, setActiveKind] = useState<ChannelBotKind>("qq");
  const [configs, setConfigs] = useState<ChannelBotConfig[]>([]);
  const [statuses, setStatuses] = useState<ChannelBotRuntimeStatus[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ChannelBotKind, Draft>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listChannelBots) return;
    setLoading(true);
    try {
      const [list, st, projs] = await Promise.all([
        api.listChannelBots(),
        api.getChannelBotsStatus?.() ?? Promise.resolve([]),
        api.listProjects?.() ?? Promise.resolve([])
      ]);
      setConfigs(list);
      setStatuses(st);
      setProjects(projs);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (!next[c.id]) next[c.id] = configToDraft(c);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cfg = configs.find((c) => c.id === activeKind) ?? null;
  const draft = drafts[activeKind] ?? (cfg ? configToDraft(cfg) : null);
  const runtime = statuses.find((s) => s.id === activeKind);

  useEffect(() => {
    if (!draft?.enabled) return;
    const id = window.setInterval(() => {
      void window.electronAPI?.getChannelBotsStatus?.().then((st) => {
        if (st) setStatuses(st);
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [draft?.enabled, activeKind]);

  const modeOptions = useMemo(() => {
    return CHANNEL_DEFAULT_MODE_IDS.map((id) => ({
      id,
      label: i18n.language === "en" ? id : (t(`modes.${id}.name`) || id)
    }));
  }, [t, i18n.language]);

  const patchDraft = (patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [activeKind]: { ...(prev[activeKind] ?? configToDraft(cfg!)), ...patch }
    }));
    setMessage(null);
  };

  const onSave = async () => {
    if (!draft || !cfg) return;
    const api = window.electronAPI;
    if (!api?.saveChannelBot) return;
    setSaving(true);
    setMessage(null);
    try {
      const input: ChannelBotSaveInput = {
        id: activeKind,
        enabled: draft.enabled,
        appId: draft.appId.trim(),
        allowFrom: draft.allowFromText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        defaultModeId: draft.defaultModeId,
        defaultProjectId: draft.defaultProjectId,
        sandboxMode: draft.sandboxMode
      };
      if (draft.appSecret.trim()) input.appSecret = draft.appSecret.trim();
      if (draft.token.trim()) input.token = draft.token.trim();
      const saved = await api.saveChannelBot(input);
      setConfigs((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      setDrafts((prev) => ({ ...prev, [saved.id]: configToDraft(saved) }));
      const st = await api.getChannelBotsStatus?.();
      if (st) setStatuses(st);
      setMessage({ kind: "ok", text: t("settings.botsSaveOk") });
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message || t("settings.botsSaveFail") });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    const api = window.electronAPI;
    if (!api?.testChannelBot) return;
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.testChannelBot(activeKind);
      setMessage({ kind: result.ok ? "ok" : "err", text: result.message });
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const onRestart = async () => {
    const api = window.electronAPI;
    if (!api?.restartChannelBots) return;
    const st = await api.restartChannelBots();
    setStatuses(st);
    setMessage({ kind: "ok", text: t("settings.botsRestartOk") });
  };

  const badge = statusBadge(t, runtime, draft?.enabled ?? false);

  return (
    <div className="relative z-10 mx-auto max-w-[720px] px-8 py-6">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">{t("settings.botsTitle")}</h2>
        <p className="mt-1 text-[12px] leading-snug text-[var(--lp-soft-text)]">{t("settings.botsSubtitle")}</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {CHANNEL_BOT_KINDS.map((kind) => {
          const c = configs.find((x) => x.id === kind);
          const on = c?.enabled;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setActiveKind(kind);
                setMessage(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
                activeKind === kind
                  ? "border-white/25 bg-white/10 text-[var(--lp-text)]"
                  : "border-white/[0.08] bg-white/[0.03] text-[var(--lp-text)]/75 hover:border-white/15"
              }`}
            >
              {t(KIND_LABEL_KEYS[kind])}
              {on ? <span className="ml-1.5 text-[10px] text-emerald-400">●</span> : null}
            </button>
          );
        })}
      </div>

      {loading || !draft || !cfg ? (
        <p className="mt-8 text-[13px] text-[var(--lp-soft-text)]">{t("settings.loading")}</p>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
              {badge.label}
            </span>
            {runtime?.lastError ? (
              <span className="text-[11.5px] text-amber-200/90">{runtime.lastError}</span>
            ) : null}
            <button
              type="button"
              className="relative z-10 ml-auto cursor-pointer rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11.5px] text-sky-300 hover:bg-sky-500/20"
              onClick={() => {
                void openExternalUrl(KIND_DOC_URLS[activeKind]).then((r) => {
                  if (!r.ok) setMessage({ kind: "err", text: r.message });
                });
              }}
            >
              {t("settings.botsOpenDocs")}
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patchDraft({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-white/20"
            />
            <span className="text-[13px]">{t("settings.botsEnabled")}</span>
          </label>

          {activeKind === "qq" ? (
            <p className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3 text-[12px] leading-relaxed text-[var(--lp-soft-text)]">
              {t("settings.botsCredentialsNote")}
            </p>
          ) : null}

          <SavedConfigSummary
            cfg={cfg}
            draft={draft}
            projects={projects}
            modeLabel={modeOptions.find((m) => m.id === cfg.defaultModeId)?.label ?? cfg.defaultModeId}
            t={t}
          />

          <Field label={t("settings.botsAppId")} hint={t("settings.botsAppIdHint")}>
            <input
              value={draft.appId}
              onChange={(e) => patchDraft({ appId: e.target.value })}
              className={inputClass}
              placeholder={t("settings.botsAppIdPh")}
            />
          </Field>

          <Field
            label={
              <span className="inline-flex items-center gap-2">
                {t("settings.botsAppSecret")}
                {cfg.hasAppSecret ? (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-300">
                    {t("settings.botsCfgStored")}
                  </span>
                ) : null}
              </span>
            }
            hint={
              cfg.hasAppSecret && !draft.appSecret
                ? t("settings.botsSecretKept")
                : t("settings.botsAppSecretHint")
            }
          >
            <input
              type="password"
              value={draft.appSecret}
              onChange={(e) => patchDraft({ appSecret: e.target.value })}
              className={inputClass}
              placeholder={cfg.hasAppSecret ? "••••••••" : ""}
              autoComplete="off"
            />
          </Field>

          {activeKind === "qq" ? (
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  {t("settings.botsToken")}
                  {cfg.hasToken ? (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-300">
                      {t("settings.botsCfgStored")}
                    </span>
                  ) : null}
                </span>
              }
              hint={
                cfg.hasToken && !draft.token ? t("settings.botsSecretKept") : t("settings.botsTokenHint")
              }
            >
              <input
                type="password"
                value={draft.token}
                onChange={(e) => patchDraft({ token: e.target.value })}
                className={inputClass}
                placeholder={cfg.hasToken ? "••••••••" : ""}
                autoComplete="off"
              />
            </Field>
          ) : null}

          <Field label={t("settings.botsAllowFrom")} hint={t("settings.botsAllowFromHint")}>
            <textarea
              value={draft.allowFromText}
              onChange={(e) => patchDraft({ allowFromText: e.target.value })}
              rows={4}
              className={`${inputClass} resize-y font-mono text-[12px]`}
              placeholder={t("settings.botsAllowFromPh")}
            />
          </Field>

          {draft.enabled && !draft.allowFromText.trim() ? (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-[var(--lp-soft-text)]">
              {t("settings.botsAllowFromWarn")}
            </p>
          ) : null}

          {draft.enabled ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-[var(--lp-soft-text)]">
              <p className="font-medium text-[var(--lp-text)]/90">{t("settings.botsChecklistTitle")}</p>
              <ul className="mt-2 list-inside list-decimal space-y-1">
                <li>{t("settings.botsCheck1")}</li>
                <li>{t("settings.botsCheck2")}</li>
                <li>{t("settings.botsCheck3")}</li>
                <li>{t("settings.botsCheck4")}</li>
                <li>{t("settings.botsCheck5")}</li>
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.botsDefaultProject")} hint={t("settings.botsDefaultProjectHint")}>
              <select
                value={draft.defaultProjectId ?? ""}
                onChange={(e) => patchDraft({ defaultProjectId: e.target.value || null })}
                className={inputClass}
              >
                <option value="">{t("settings.botsNoDefaultProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.path ? ` — ${p.path}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("settings.botsDefaultMode")} hint={t("settings.botsDefaultModeHint")}>
              <select
                value={draft.defaultModeId}
                onChange={(e) =>
                  patchDraft({ defaultModeId: e.target.value as ChannelBotSaveInput["defaultModeId"] })
                }
                className={inputClass}
              >
                {modeOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {CHAT_MODE_MAP[m.id]?.icon ? `${CHAT_MODE_MAP[m.id].icon} ` : ""}
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-[12.5px] text-[var(--lp-soft-text)]">
            <input
              type="checkbox"
              checked={draft.sandboxMode}
              onChange={(e) => patchDraft({ sandboxMode: e.target.checked })}
              className="h-4 w-4 rounded border-white/20"
            />
            {t("settings.botsSandbox")}
          </label>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-[var(--lp-soft-text)]">
            {t("settings.botsCommandsHint")}
          </div>

          {message ? (
            <p
              className={`text-[12.5px] ${message.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}
            >
              {message.text}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave()}
              className="rounded-lg bg-white px-4 py-2 text-[12.5px] font-medium text-[#151515] disabled:opacity-50"
            >
              {saving ? t("settings.botsSaving") : t("settings.botsSave")}
            </button>
            <button
              type="button"
              disabled={testing || saving}
              onClick={() => void onTest()}
              className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-[12.5px] hover:bg-white/[0.07] disabled:opacity-50"
            >
              {testing ? t("settings.botsTesting") : t("settings.botsTest")}
            </button>
            <button
              type="button"
              onClick={() => void onRestart()}
              className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-[12.5px] hover:bg-white/[0.07]"
            >
              {t("settings.botsRestart")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedConfigSummary({
  cfg,
  draft,
  projects,
  modeLabel,
  t
}: {
  cfg: ChannelBotConfig;
  draft: Draft;
  projects: Project[];
  modeLabel: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const projectName =
    projects.find((p) => p.id === cfg.defaultProjectId)?.name ?? t("settings.botsCfgNone");
  const allowLabel =
    cfg.allowFrom.length === 0
      ? t("settings.botsCfgAllowAll")
      : t("settings.botsCfgAllowCount", { count: cfg.allowFrom.length });
  const updated = new Date(cfg.updatedAt).toLocaleString();

  const row = (label: string, value: string, ok?: boolean) => (
    <div className="flex items-start justify-between gap-4 py-1 text-[12px]">
      <span className="shrink-0 text-[var(--lp-soft-text)]">{label}</span>
      <span
        className={`text-right ${ok === false ? "text-red-300/90" : ok === true ? "text-emerald-300" : "text-[var(--lp-text)]/88"}`}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
      <p className="text-[13px] font-medium text-[var(--lp-text)]">{t("settings.botsSavedSummaryTitle")}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--lp-soft-text)]">
        {t("settings.botsSavedExplain")}
      </p>
      <div className="mt-3 space-y-0.5 border-t border-white/[0.06] pt-3">
        {row(
          t("settings.botsCfgEnabled"),
          draft.enabled ? t("settings.botsCfgYes") : t("settings.botsCfgNo"),
          draft.enabled
        )}
        {row(t("settings.botsCfgAppId"), cfg.appId || "—")}
        {row(
          t("settings.botsCfgAppSecret"),
          cfg.hasAppSecret ? t("settings.botsCfgStored") : t("settings.botsCfgMissing"),
          cfg.hasAppSecret
        )}
        {cfg.id === "qq"
          ? row(
              t("settings.botsCfgBotToken"),
              cfg.hasToken ? t("settings.botsCfgStored") : t("settings.botsCfgMissing"),
              cfg.hasToken
            )
          : null}
        {row(t("settings.botsCfgAllowFrom"), allowLabel)}
        {row(
          t("settings.botsCfgSandbox"),
          draft.sandboxMode ? t("settings.botsCfgYes") : t("settings.botsCfgNo")
        )}
        {draft.sandboxMode ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/90">
            {t("settings.botsSandboxWarn")}
          </p>
        ) : null}
        {row(t("settings.botsCfgDefaultProject"), projectName)}
        {row(t("settings.botsCfgDefaultMode"), modeLabel)}
        {row(t("settings.botsCfgUpdated"), updated)}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[12.5px] font-medium text-[var(--lp-text)]">{label}</div>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none focus:border-white/25";
