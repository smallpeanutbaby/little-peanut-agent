import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppearanceSettings, BackgroundColor, TextColor } from "@shared/types";
import { useUiStore } from "./store/useUiStore";

const backgroundClassMap: Record<
  BackgroundColor,
  { base: string; top: string; side: string; main: string; panel: string; panel2: string; border: string }
> = {
  roast: { base: "#1a120c", top: "#22170f", side: "rgba(18,13,9,0.84)", main: "rgba(24,18,12,0.76)", panel: "rgba(242,185,63,0.05)", panel2: "rgba(242,185,63,0.08)", border: "rgba(242,185,63,0.16)" },
  "peanut-dark": { base: "#20180f", top: "#281e13", side: "rgba(20,16,11,0.82)", main: "rgba(28,23,17,0.76)", panel: "rgba(242,185,63,0.055)", panel2: "rgba(242,185,63,0.08)", border: "rgba(242,185,63,0.16)" },
  walnut: { base: "#191511", top: "#211b15", side: "rgba(17,14,10,0.82)", main: "rgba(24,20,15,0.76)", panel: "rgba(197,168,114,0.05)", panel2: "rgba(197,168,114,0.08)", border: "rgba(197,168,114,0.16)" },
  cocoa: { base: "#241914", top: "#2d2018", side: "rgba(25,18,14,0.82)", main: "rgba(36,27,21,0.76)", panel: "rgba(204,142,104,0.05)", panel2: "rgba(204,142,104,0.08)", border: "rgba(204,142,104,0.16)" },
  latte: { base: "#ede4d4", top: "#f5eee2", side: "rgba(255,251,244,0.86)", main: "rgba(247,241,231,0.92)", panel: "rgba(91,76,57,0.06)", panel2: "rgba(91,76,57,0.08)", border: "rgba(191,169,139,0.26)" },
  espresso: { base: "#160f0b", top: "#1d1510", side: "rgba(16,12,9,0.84)", main: "rgba(22,17,13,0.78)", panel: "rgba(139,95,74,0.05)", panel2: "rgba(139,95,74,0.08)", border: "rgba(139,95,74,0.16)" },
  sand: { base: "#f1e6d2", top: "#f7efe1", side: "rgba(255,251,244,0.9)", main: "rgba(248,242,232,0.94)", panel: "rgba(147,124,88,0.06)", panel2: "rgba(147,124,88,0.08)", border: "rgba(199,176,139,0.24)" },
  caramel: { base: "#2b1d12", top: "#342315", side: "rgba(33,23,16,0.84)", main: "rgba(41,29,20,0.78)", panel: "rgba(215,145,70,0.05)", panel2: "rgba(215,145,70,0.08)", border: "rgba(215,145,70,0.16)" },
  honey: { base: "#24180a", top: "#2e1f0d", side: "rgba(28,20,10,0.84)", main: "rgba(35,25,14,0.78)", panel: "rgba(242,187,80,0.06)", panel2: "rgba(242,187,80,0.1)", border: "rgba(242,187,80,0.18)" },
  toffee: { base: "#2a1a12", top: "#321f15", side: "rgba(31,20,14,0.84)", main: "rgba(40,28,20,0.78)", panel: "rgba(190,119,71,0.05)", panel2: "rgba(190,119,71,0.08)", border: "rgba(190,119,71,0.17)" },
  almond: { base: "#efe3d2", top: "#f7ecdf", side: "rgba(255,250,243,0.9)", main: "rgba(248,242,232,0.94)", panel: "rgba(125,104,75,0.06)", panel2: "rgba(125,104,75,0.08)", border: "rgba(186,164,135,0.22)" },
  bronze: { base: "#23160f", top: "#2d1c12", side: "rgba(27,18,12,0.84)", main: "rgba(35,24,17,0.78)", panel: "rgba(168,110,62,0.05)", panel2: "rgba(168,110,62,0.08)", border: "rgba(168,110,62,0.16)" },
  clay: { base: "#2a1712", top: "#331c15", side: "rgba(31,18,14,0.84)", main: "rgba(40,25,20,0.78)", panel: "rgba(184,102,84,0.05)", panel2: "rgba(184,102,84,0.08)", border: "rgba(184,102,84,0.17)" },
  stone: { base: "#1a1917", top: "#22201e", side: "rgba(21,20,18,0.84)", main: "rgba(27,25,23,0.78)", panel: "rgba(175,164,150,0.05)", panel2: "rgba(175,164,150,0.08)", border: "rgba(175,164,150,0.16)" },
  moss: { base: "#1a1c14", top: "#23261a", side: "rgba(20,22,16,0.84)", main: "rgba(28,31,21,0.78)", panel: "rgba(146,158,96,0.05)", panel2: "rgba(146,158,96,0.08)", border: "rgba(146,158,96,0.16)" },
  forest: { base: "#121812", top: "#182018", side: "rgba(15,20,15,0.84)", main: "rgba(20,26,20,0.78)", panel: "rgba(92,135,92,0.05)", panel2: "rgba(92,135,92,0.08)", border: "rgba(92,135,92,0.16)" },
  night: { base: "#101217", top: "#151922", side: "rgba(13,16,20,0.84)", main: "rgba(18,22,28,0.78)", panel: "rgba(109,129,173,0.05)", panel2: "rgba(109,129,173,0.08)", border: "rgba(109,129,173,0.16)" },
  midnight: { base: "#0b0c10", top: "#101218", side: "rgba(10,12,16,0.84)", main: "rgba(14,16,22,0.78)", panel: "rgba(95,112,151,0.05)", panel2: "rgba(95,112,151,0.08)", border: "rgba(95,112,151,0.16)" },
  obsidian: { base: "#080808", top: "#101010", side: "rgba(11,11,11,0.86)", main: "rgba(15,15,15,0.8)", panel: "rgba(160,160,160,0.05)", panel2: "rgba(160,160,160,0.08)", border: "rgba(160,160,160,0.14)" }
};

const textClassMap: Record<TextColor, { main: string; muted: string; soft: string }> = {
  ivory: { main: "rgba(255,246,233,0.94)", muted: "rgba(255,232,193,0.46)", soft: "rgba(255,255,255,0.28)" },
  "warm-white": { main: "rgba(255,250,244,0.96)", muted: "rgba(255,241,222,0.48)", soft: "rgba(255,255,255,0.3)" },
  cream: { main: "rgba(250,242,229,0.95)", muted: "rgba(244,229,204,0.46)", soft: "rgba(255,250,242,0.28)" },
  "soft-gold": { main: "rgba(244,225,180,0.96)", muted: "rgba(234,205,145,0.52)", soft: "rgba(244,225,180,0.24)" },
  charcoal: { main: "rgba(43,35,27,0.95)", muted: "rgba(91,76,57,0.62)", soft: "rgba(78,65,49,0.35)" },
  snow: { main: "rgba(255,255,255,0.96)", muted: "rgba(234,234,234,0.54)", soft: "rgba(255,255,255,0.28)" },
  linen: { main: "rgba(245,238,228,0.95)", muted: "rgba(220,207,190,0.54)", soft: "rgba(245,238,228,0.26)" },
  pearl: { main: "rgba(236,239,245,0.95)", muted: "rgba(198,203,214,0.54)", soft: "rgba(236,239,245,0.24)" },
  "sand-ink": { main: "rgba(117,93,63,0.96)", muted: "rgba(148,121,88,0.62)", soft: "rgba(117,93,63,0.24)" },
  hazel: { main: "rgba(124,93,59,0.96)", muted: "rgba(150,121,88,0.62)", soft: "rgba(124,93,59,0.24)" },
  coffee: { main: "rgba(86,58,35,0.96)", muted: "rgba(120,89,60,0.62)", soft: "rgba(86,58,35,0.24)" },
  ember: { main: "rgba(160,91,65,0.96)", muted: "rgba(184,123,98,0.62)", soft: "rgba(160,91,65,0.24)" },
  graphite: { main: "rgba(70,73,79,0.96)", muted: "rgba(108,111,118,0.62)", soft: "rgba(70,73,79,0.24)" },
  slate: { main: "rgba(83,96,112,0.96)", muted: "rgba(116,129,146,0.62)", soft: "rgba(83,96,112,0.24)" },
  sage: { main: "rgba(112,128,102,0.96)", muted: "rgba(140,156,131,0.62)", soft: "rgba(112,128,102,0.24)" },
  "olive-ink": { main: "rgba(104,112,53,0.96)", muted: "rgba(133,140,80,0.62)", soft: "rgba(104,112,53,0.24)" },
  "teal-ink": { main: "rgba(65,110,110,0.96)", muted: "rgba(95,139,139,0.62)", soft: "rgba(65,110,110,0.24)" },
  "midnight-ink": { main: "rgba(49,63,93,0.96)", muted: "rgba(80,95,126,0.62)", soft: "rgba(49,63,93,0.24)" },
  "plum-ink": { main: "rgba(97,65,101,0.96)", muted: "rgba(128,95,132,0.62)", soft: "rgba(97,65,101,0.24)" }
};

function NavIcon({ children }: { children: string }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.04] text-[15px] text-white/90">
      {children}
    </span>
  );
}

function ListIcon({ children }: { children: string }) {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.035] text-[15px] text-white/84">
      {children}
    </span>
  );
}

function SidebarItem({
  icon,
  label,
  trailing,
  active = false
}: {
  icon: string;
  label: string;
  trailing?: string;
  active?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
        active
          ? "bg-[var(--lp-panel-2)] text-[var(--lp-text)] shadow-[0_0_0_1px_var(--lp-border)_inset]"
          : "text-[var(--lp-text)]/84 hover:bg-[var(--lp-panel)]"
      }`}
      type="button"
    >
      <NavIcon>{icon}</NavIcon>
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      {trailing ? <span className="text-sm text-[var(--lp-soft-text)]">{trailing}</span> : null}
    </button>
  );
}

function SuggestionChip({ label }: { label: string }) {
  return (
    <button
      className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-4 py-2.5 text-[13px] text-[var(--lp-muted)] transition hover:border-[var(--lp-border)] hover:bg-[var(--lp-panel-2)] hover:text-[var(--lp-text)]"
      type="button"
    >
      {label}
    </button>
  );
}

function ModeMenu({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="absolute bottom-24 left-0 z-30 w-[360px] rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] py-3 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="px-5 pb-3 text-[14px] font-medium text-[var(--lp-text)]">添加到对话</div>
      {[
        "Add photos and files",
        "命令",
        "技能",
        "MCP 服务器"
      ].map((item) => (
        <button
          key={item}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-[15px] text-[var(--lp-text)]/88 hover:bg-[var(--lp-panel)]"
          onClick={onClose}
          type="button"
        >
          <span>{item}</span>
          <span className="text-[var(--lp-soft-text)]">›</span>
        </button>
      ))}
    </div>
  );
}

function ThemeModal({
  current,
  onClose,
  onSave
}: {
  current: AppearanceSettings;
  onClose: () => void;
  onSave: (settings: AppearanceSettings) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(current);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-6 py-5">
          <div className="text-2xl font-semibold text-[var(--lp-text)]">{t("appearance.title")}</div>
          <button className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-4 py-2 text-sm text-[var(--lp-text)]" onClick={onClose} type="button">
            {t("appearance.close")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 text-sm uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">{t("appearance.mode")}</div>
          <div className="mb-8 grid grid-cols-2 gap-3">
            {(["dark", "light"] as const).map((mode) => (
              <button
                key={mode}
                className={`rounded-2xl border px-4 py-4 text-left text-[var(--lp-text)] ${draft.theme === mode ? "border-[var(--lp-border)] bg-[var(--lp-panel-2)]" : "border-white/8 bg-[var(--lp-panel)]"}`}
                onClick={() => setDraft({ ...draft, theme: mode })}
                type="button"
              >
                {t(`appearance.${mode}`)}
              </button>
            ))}
          </div>

          <div className="mb-4 text-sm uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">{t("appearance.background")}</div>
          <div className="mb-8 grid grid-cols-5 gap-3">
            {(Object.keys(backgroundClassMap) as BackgroundColor[]).map((background) => (
              <button
                key={background}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 ${
                  draft.background === background ? "border-[var(--lp-border)] bg-[var(--lp-panel-2)]" : "border-white/8 bg-[var(--lp-panel)]"
                }`}
                onClick={() => setDraft({ ...draft, background })}
                type="button"
              >
                <span
                  className="h-8 w-8 rounded-full border border-white/10"
                  style={{ backgroundColor: backgroundClassMap[background].base }}
                />
                <span className="text-center text-xs text-[var(--lp-text)]/70">{t(`appearance.colors.${background}`)}</span>
              </button>
            ))}
          </div>

          <div className="mb-4 text-sm uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">{t("appearance.text")}</div>
          <div className="grid grid-cols-5 gap-3">
            {(Object.keys(textClassMap) as TextColor[]).map((text) => (
              <button
                key={text}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 ${
                  draft.text === text ? "border-[var(--lp-border)] bg-[var(--lp-panel-2)]" : "border-white/8 bg-[var(--lp-panel)]"
                }`}
                onClick={() => setDraft({ ...draft, text })}
                type="button"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm font-semibold"
                  style={{ color: textClassMap[text].main }}
                >
                  A
                </span>
                <span className="text-center text-xs text-[var(--lp-text)]/70">{t(`appearance.colors.${text}`)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-white/6 px-6 py-5">
          <button className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#151515]" onClick={() => onSave(draft)} type="button">
            {t("appearance.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const {
    setAppInfo,
    theme,
    background,
    text,
    language,
    setTheme,
    setBackground,
    setText,
    setLanguage
  } = useUiStore();
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.getAppInfo) {
      return;
    }

    void window.electronAPI.getAppInfo().then(setAppInfo).catch(() => {});
    void window.electronAPI.getAppearanceSettings().then((settings) => {
      setTheme(settings.theme);
      setBackground(settings.background);
      setText(settings.text);
      setLanguage(settings.language);
      void i18n.changeLanguage(settings.language);
    }).catch(() => {});
  }, [i18n, setAppInfo, setBackground, setLanguage, setText, setTheme]);

  const shellStyle = useMemo(() => {
    const selectedBackground = backgroundClassMap[background];
    const selectedText = textClassMap[text];
    return {
      ["--lp-bg" as string]: selectedBackground.base,
      ["--lp-bg-2" as string]: selectedBackground.top,
      ["--lp-side-bg" as string]: selectedBackground.side,
      ["--lp-main-bg" as string]: selectedBackground.main,
      ["--lp-panel" as string]: selectedBackground.panel,
      ["--lp-panel-2" as string]: selectedBackground.panel2,
      ["--lp-border" as string]: selectedBackground.border,
      ["--lp-text" as string]: selectedText.main,
      ["--lp-muted" as string]: selectedText.muted,
      ["--lp-soft-text" as string]: selectedText.soft
    };
  }, [background, text]);

  async function saveAppearance(next: AppearanceSettings) {
    setTheme(next.theme);
    setBackground(next.background);
    setText(next.text);
    setLanguage(next.language);
    await i18n.changeLanguage(next.language);
    if (window.electronAPI?.setAppearanceSettings) {
      await window.electronAPI.setAppearanceSettings(next);
    }
  }

  async function toggleLanguage() {
    const next = language === "zh-CN" ? "en" : "zh-CN";
    await saveAppearance({
      theme,
      background,
      text,
      language: next
    });
  }

  return (
    <div className="min-h-screen bg-[var(--lp-bg)] text-[var(--lp-text)]" style={shellStyle}>
      <div className="flex min-h-screen overflow-hidden">
        <aside className="flex w-[286px] flex-col border-r border-[var(--lp-border)] bg-[var(--lp-side-bg)] px-3 py-3 backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-2.5 px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <span className="h-[11px] w-[11px] rounded-full bg-[#ff5f57]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#febc2e]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#28c840]" />
            </div>
          </div>

          <div className="mt-7 flex items-center justify-between px-2">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--lp-soft-text)]">{t("sidebar.projects")}</div>
            <div className="rounded-full bg-[var(--lp-panel)] px-2 py-1 text-xs text-[var(--lp-soft-text)]">1</div>
          </div>

          <div className="mt-3 rounded-[20px] border border-[var(--lp-border)] bg-[rgba(255,255,255,0.02)] p-3">
            <div className="flex items-center justify-between rounded-2xl px-1.5 py-1 text-[var(--lp-text)]/80">
              <div className="flex items-center gap-3">
                <ListIcon>📁</ListIcon>
                <div className="text-[15px] font-semibold">New Project</div>
              </div>
              <div className="text-[12px] text-[var(--lp-soft-text)]">{t("sidebar.localOne")}</div>
            </div>
            <div className="mt-2 rounded-[16px] bg-white/[0.04] px-4 py-3">
              <div className="flex items-center justify-between text-[var(--lp-text)]/80">
                <span className="text-[13px] font-medium">New Conversation</span>
                <span className="text-[12px] text-[var(--lp-soft-text)]">34分钟前</span>
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-white/6 pt-4">
            <div className="flex items-center justify-between px-2">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--lp-soft-text)]">{t("sidebar.conversations")}</div>
              <div className="text-xs text-[var(--lp-soft-text)]">0</div>
            </div>
            <div className="mt-3 px-2 text-[12px] text-[var(--lp-soft-text)]">{t("sidebar.emptyConversations")}</div>
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden bg-[var(--lp-main-bg)]">
          <div className="flex flex-1 flex-col overflow-hidden px-5 py-4">
            <div className="mb-1 text-[1.6rem] font-semibold tracking-tight text-[var(--lp-text)]">{t("home.pageTitle")}</div>

            <div className="flex flex-1 flex-col items-center justify-center">
              <div className="text-center">
                <div className="text-[3.65rem] font-semibold leading-none tracking-tight text-[var(--lp-text)]">
                  {t("home.heroTitle")}
                </div>
                <div className="mt-4 text-[1.55rem] font-normal text-[var(--lp-soft-text)]">
                  {t("home.heroSubtitle")}
                </div>
              </div>

              <div className="mt-10 w-full max-w-[940px]">
                <div className="rounded-[28px] border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-6 py-6 backdrop-blur-xl shadow-[0_12px_34px_rgba(0,0,0,0.20)]">
                  <textarea
                    className="h-20 w-full resize-none bg-transparent text-[1.45rem] leading-relaxed text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
                    placeholder={t("home.inputPlaceholder")}
                  />

                  <div className="mt-6 flex items-center justify-between">
                    <div className="relative flex items-center gap-3.5 text-[0.98rem] text-[var(--lp-text)]/72">
                      <button
                        className="flex items-center gap-2 rounded-full border border-[var(--lp-border)] bg-black/10 px-4 py-2"
                        onClick={() => setModeMenuOpen((value) => !value)}
                        type="button"
                      >
                        <span>✈</span>
                        <span>{t("home.modeChat")}</span>
                        <span className="text-[var(--lp-soft-text)]">⌄</span>
                      </button>
                      <ModeMenu open={modeMenuOpen} onClose={() => setModeMenuOpen(false)} />
                      <span className="h-5 w-px bg-white/8" />
                      <button className="flex items-center gap-2 text-[var(--lp-text)]/72">
                        <span>✣</span>
                        <span>Auto</span>
                      </button>
                      <button className="text-[var(--lp-soft-text)]">⌘</button>
                      <button className="text-[var(--lp-text)]/72">＋</button>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="rounded-full border border-[var(--lp-border)] bg-black/12 px-3.5 py-1.5 text-[12px] text-[var(--lp-soft-text)]">
                        0%
                      </div>
                      <button className="text-[var(--lp-soft-text)]">⌘</button>
                      <button className="rounded-full bg-white px-5 py-3 text-[1.45rem] font-medium text-[#151515] shadow-[0_8px_24px_rgba(255,255,255,0.06)]">
                        {t("home.start")}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <SuggestionChip label={t("home.suggestions.async")} />
                  <SuggestionChip label={t("home.suggestions.rest")} />
                  <SuggestionChip label={t("home.suggestions.regex")} />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {themeModalOpen ? (
        <ThemeModal
          current={{ theme, background, text, language }}
          onClose={() => setThemeModalOpen(false)}
          onSave={async (settings) => {
            await saveAppearance(settings);
            setThemeModalOpen(false);
          }}
        />
      ) : null}

      {settingsOpen ? <SettingsPlaceholder onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
