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

function NavRow({ icon, label, trailing }: { icon: string; label: string; trailing?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[14px] text-[var(--lp-text)]/82 transition hover:bg-white/[0.04]"
    >
      <span className="flex items-center gap-3">
        <span className="inline-flex h-5 w-5 items-center justify-center text-[15px] text-[var(--lp-text)]/72">{icon}</span>
        <span>{label}</span>
      </span>
      {trailing ?? null}
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
  const { t } = useTranslation();
  if (!open) return null;

  const items = [
    t("modeMenu.addPhotos"),
    t("modeMenu.commands"),
    t("modeMenu.skills"),
    t("modeMenu.mcpServers")
  ];

  return (
    <div className="absolute bottom-24 left-0 z-30 w-[360px] rounded-[24px] border border-[var(--lp-border)] bg-[rgba(52,49,48,0.96)] py-3 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="px-5 pb-3 text-[14px] font-medium text-[var(--lp-text)]">{t("modeMenu.title")}</div>
      {items.map((item, index) => (
        <button
          key={item}
          className={`flex w-full items-center justify-between px-5 py-4 text-left text-[15px] text-[var(--lp-text)]/88 hover:bg-white/[0.05] ${
            index !== 0 ? "border-t border-white/6" : ""
          }`}
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
                <span className="h-8 w-8 rounded-full border border-white/10" style={{ backgroundColor: backgroundClassMap[background].base }} />
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
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm font-semibold" style={{ color: textClassMap[text].main }}>
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

const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", icon: "🤖" },
  { id: "anthropic", name: "Anthropic", icon: "🅰" },
  { id: "google", name: "Google Gemini", icon: "🔷" },
  { id: "deepseek", name: "DeepSeek", icon: "🔍" },
  { id: "openrouter", name: "OpenRouter", icon: "🔀" },
  { id: "ollama", name: "Ollama", icon: "🦙" },
  { id: "azure", name: "Azure OpenAI", icon: "☁" },
  { id: "moonshot", name: "Moonshot（官方）", icon: "🌙" },
  { id: "tongyi", name: "通义千问（官方）", icon: "💬" },
  { id: "baidu", name: "百度智能云（官方）", icon: "🐾" },
  { id: "minimax", name: "MiniMax（官方）", icon: "📡" },
  { id: "siliconflow", name: "硅基流动", icon: "⚡" },
  { id: "gitee", name: "Gitee AI", icon: "🌐" },
  { id: "codex", name: "Codex (OAuth)", icon: "📝" },
  { id: "xiaomi", name: "小米", icon: "📱" },
  { id: "zhipu", name: "智谱AI（官方）", icon: "🧠" },
  { id: "longcat", name: "LongCat", icon: "🐱" },
  { id: "github-copilot", name: "GitHub Copilot (OAuth)", icon: "🐙" }
];

function ModelConfigPage() {
  const { t } = useTranslation();
  const [selectedProvider, setSelectedProvider] = useState(AI_PROVIDERS[0].id);
  const [navWidth, setNavWidth] = useState(220);
  const [providerWidth, setProviderWidth] = useState(240);

  const provider = AI_PROVIDERS.find((p) => p.id === selectedProvider) ?? AI_PROVIDERS[0];

  function handleResize(setter: (w: number) => void, min: number, max: number) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = setter === setNavWidth ? navWidth : providerWidth;
      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        setter(Math.min(max, Math.max(min, startW + delta)));
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Settings Nav */}
      <div className="flex-shrink-0 overflow-y-auto px-4 py-5" style={{ width: navWidth }}>
        <div className="text-[18px] font-semibold text-[var(--lp-text)]">{t("sidebar.modelConfig")}</div>
        <div className="mt-1 text-[12px] text-[var(--lp-soft-text)]">{t("modelConfig.subtitle")}</div>

        <div className="mt-6 text-[11px] uppercase tracking-[0.16em] text-[var(--lp-soft-text)]">{t("modelConfig.aiCapabilities")}</div>
        <nav className="mt-2 flex flex-col gap-0.5">
          <button type="button" className="flex items-center gap-2.5 rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] text-[var(--lp-text)]">
            <span>🖥</span> {t("modelConfig.aiProvider")}
          </button>
          <button type="button" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]">
            <span>📋</span> {t("modelConfig.modelManage")}
          </button>
          <button type="button" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]">
            <span>⚙</span> {t("modelConfig.modelSettings")}
          </button>
        </nav>
      </div>

      {/* Resize handle 1 */}
      <div
        className="w-px flex-shrink-0 cursor-col-resize bg-[var(--lp-border)] transition hover:bg-white/20"
        onMouseDown={handleResize(setNavWidth, 160, 320)}
      />

      {/* Provider List */}
      <div className="flex flex-shrink-0 flex-col overflow-hidden" style={{ width: providerWidth }}>
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("modelConfig.searchProvider")}
            />
            <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-text)]/80 hover:bg-white/[0.04]" type="button">＋</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-1">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition ${
                selectedProvider === p.id
                  ? "bg-white/[0.08] text-[var(--lp-text)]"
                  : "text-[var(--lp-text)]/78 hover:bg-white/[0.04]"
              }`}
              onClick={() => setSelectedProvider(p.id)}
            >
              <span className="text-[16px]">{p.icon}</span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Resize handle 2 */}
      <div
        className="w-px flex-shrink-0 cursor-col-resize bg-[var(--lp-border)] transition hover:bg-white/20"
        onMouseDown={handleResize(setProviderWidth, 180, 400)}
      />

      {/* Provider Config */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[24px]">{provider.icon}</span>
            <div className="text-[20px] font-semibold text-[var(--lp-text)]">{provider.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--lp-soft-text)]">OpenAI Chat Completions 兼容</span>
            <div className="h-5 w-10 rounded-full bg-white/10" />
          </div>
        </div>
        <div className="mt-1 text-[13px] text-[var(--lp-muted)]">{t("modelConfig.aiProviderDesc")}</div>

        {/* API Key */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.apiKey")}</div>
            <button className="text-[12px] text-[var(--lp-soft-text)] hover:text-[var(--lp-text)]" type="button">↗ {t("modelConfig.getApiKey")}</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder="sk-..."
            />
            <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-soft-text)] hover:bg-white/[0.04]" type="button">👁</button>
          </div>
        </div>

        {/* API Proxy */}
        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.apiProxy")}</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder="https://api.example.com/v1"
          />
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("modelConfig.apiProxyHint")}</div>
        </div>

        {/* Connection Test */}
        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.connectTest")}</div>
          <div className="mt-2 flex items-center gap-3">
            <select className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none">
              <option>Kimi K2.5</option>
            </select>
            <button className="rounded-lg border border-[var(--lp-border)] px-4 py-2 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]" type="button">{t("modelConfig.check")}</button>
          </div>
        </div>

        {/* Model List */}
        <div className="mt-6 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-panel)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.modelList")}</div>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--lp-soft-text)]">0</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("modelConfig.searchModel")}
            />
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]" type="button">{t("modelConfig.enableAll")}</button>
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]" type="button">{t("modelConfig.disableAll")}</button>
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04]" type="button">↻ {t("modelConfig.fetchModels")}</button>
          </div>
          <div className="mt-4 text-center text-[13px] text-[var(--lp-soft-text)]">{t("modelConfig.comingSoon")}</div>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = useState<"chat" | "modelConfig">("chat");

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
      const saved = await window.electronAPI.setAppearanceSettings(next);
      if (saved) {
        setTheme(saved.theme);
        setBackground(saved.background);
        setText(saved.text);
        setLanguage(saved.language);
      }
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
    <div
      className="min-h-screen bg-[var(--lp-bg)] text-[var(--lp-text)] [font-family:'PingFang_SC','HarmonyOS_Sans_SC','Helvetica_Neue',Inter,system-ui,sans-serif] [font-feature-settings:'ss01','cv11'] antialiased"
      style={shellStyle}
    >
      <div className="flex min-h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[280px] flex-col border-r border-[var(--lp-border)] bg-[var(--lp-side-bg)] px-3 pb-3 pt-0 backdrop-blur-xl">
          {/* macOS traffic-light spacer + header (draggable) */}
          <div
            className="flex h-[52px] items-center justify-center px-2"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="text-[15px] font-semibold tracking-tight text-[var(--lp-text)]">
              Little Peanut
            </div>
          </div>

          {/* Top nav */}
          <nav className="mt-2 flex flex-col gap-0.5">
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition hover:bg-white/[0.04] ${activePage === "chat" ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"}`}
              onClick={() => setActivePage("chat")}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center text-[15px] text-[var(--lp-text)]/72">✎</span>
              <span>{t("sidebar.chatMode")}</span>
            </button>
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition hover:bg-white/[0.04] ${activePage === "modelConfig" ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"}`}
              onClick={() => setActivePage("modelConfig")}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center text-[15px] text-[var(--lp-text)]/72">✦</span>
              <span>{t("sidebar.modelConfig")}</span>
            </button>
          </nav>

          {/* Projects */}
          <div className="mt-5 flex items-center justify-between px-3">
            <div className="flex items-center gap-2 text-[12px] text-[var(--lp-soft-text)]">
              <span>{t("sidebar.projects")}</span>
              <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] leading-[18px] text-[var(--lp-soft-text)]">1</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--lp-soft-text)]">
              <button className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05]" title="导入">⤴</button>
              <button className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05]" title="新建项目">＋</button>
            </div>
          </div>

          <div className="mt-2 px-1">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-3 text-[14px] text-[var(--lp-text)]/88">
                <span className="text-[15px] text-[var(--lp-text)]/72">▤</span>
                <span className="font-medium">{t("sidebar.newProject")}</span>
              </span>
              <span className="flex items-center gap-1 text-[12px] text-[var(--lp-soft-text)]">
                {t("sidebar.localOne")}
                <span>⌄</span>
              </span>
            </button>
            <button
              type="button"
              className="mt-0.5 flex w-full items-center justify-between rounded-xl px-9 py-2 text-left text-[13px] text-[var(--lp-text)]/82 hover:bg-white/[0.04]"
            >
              <span>{t("sidebar.newConversation")}</span>
              <span className="text-[12px] text-[var(--lp-soft-text)]">{t("sidebar.agoOneHour")}</span>
            </button>
          </div>

          {/* Divider */}
          <div className="mx-3 my-4 border-t border-white/[0.06]" />

          {/* Conversations */}
          <div className="flex items-center justify-between px-3">
            <div className="flex items-center gap-2 text-[12px] text-[var(--lp-soft-text)]">
              <span>{t("sidebar.conversations")}</span>
              <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] leading-[18px]">0</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--lp-soft-text)]">
              <button className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05]">···</button>
              <button className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05]">＋</button>
            </div>
          </div>
          <div className="mt-2 px-3 text-[12px] text-[var(--lp-soft-text)]">{t("sidebar.emptyConversations")}</div>

          {/* Footer */}
          <div className="mt-auto flex items-center gap-2 px-2 pt-4">
            <div className="group relative">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] text-[14px] text-[var(--lp-text)]/80 hover:bg-[var(--lp-panel-2)]"
                onClick={() => setThemeModalOpen(true)}
                title={t("sidebar.themeSettings")}
                aria-label={t("sidebar.themeSettings")}
                type="button"
              >
                {theme === "dark" ? "☾" : "☀"}
              </button>
              <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition delay-100 duration-150 group-hover:opacity-100">
                {t("sidebar.themeSettings")}
              </span>
            </div>
            <div className="group relative">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] text-[14px] text-[var(--lp-text)]/80 hover:bg-[var(--lp-panel-2)]"
                onClick={() => setSettingsOpen(true)}
                title={t("sidebar.settings")}
                aria-label={t("sidebar.settings")}
                type="button"
              >
                ⚙
              </button>
              <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition delay-100 duration-150 group-hover:opacity-100">
                {t("sidebar.settings")}
              </span>
            </div>
            <div className="group relative">
              <button
                className="flex h-9 min-w-[44px] items-center justify-center rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3 text-[12px] font-medium text-[var(--lp-text)]/82 hover:bg-[var(--lp-panel-2)]"
                onClick={() => void toggleLanguage()}
                title={language.startsWith("zh") ? t("sidebar.switchToEnglish") : t("sidebar.switchToChinese")}
                aria-label={language.startsWith("zh") ? t("sidebar.switchToEnglish") : t("sidebar.switchToChinese")}
                type="button"
              >
                {language.startsWith("zh") ? "EN" : "中"}
              </button>
              <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition delay-100 duration-150 group-hover:opacity-100">
                {language.startsWith("zh") ? t("sidebar.switchToEnglish") : t("sidebar.switchToChinese")}
              </span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-hidden bg-[var(--lp-main-bg)]">
          {/* Top bar (draggable) */}
          <header
            className="flex h-[52px] items-center justify-between px-6"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="text-[14px] font-medium text-[var(--lp-text)]/86">
              {activePage === "chat" ? t("home.pageTitle") : t("sidebar.modelConfig")}
            </div>
            <div
              className="flex items-center gap-2 text-[var(--lp-soft-text)]"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <button className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.05]" title="安全">🛡</button>
              <button className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.05]" title={t("sidebar.help")}>?</button>
            </div>
          </header>

          {activePage === "chat" ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10">
              <div className="text-center">
                <div className="text-[44px] font-semibold leading-tight tracking-tight text-[var(--lp-text)]">
                  {t("home.heroTitle")}
                </div>
                <div className="mt-3 text-[15px] font-normal text-[var(--lp-muted)]">
                  {t("home.heroSubtitle")}
                </div>
              </div>

              <div className="mt-10 w-full max-w-[860px]">
                <div
                  className="rounded-[20px] border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-5 py-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-colors"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); /* TODO: handle dropped files */ }}
                >
                  <textarea
                    className="h-[88px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
                    placeholder={t("home.inputPlaceholder")}
                  />

                  <div className="mt-3 flex items-center justify-between">
                    <div className="relative flex items-center gap-2 text-[13px] text-[var(--lp-text)]/78">
                      <button
                        className="flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-white/[0.03] px-3 py-1.5 hover:bg-white/[0.06]"
                        onClick={() => setModeMenuOpen((value) => !value)}
                        type="button"
                      >
                        <span className="text-[13px]">✈</span>
                        <span>{t("home.modeChat")}</span>
                        <span className="text-[var(--lp-soft-text)]">⌄</span>
                      </button>
                      <ModeMenu open={modeMenuOpen} onClose={() => setModeMenuOpen(false)} />
                      <button className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[#f0b95e] hover:bg-white/[0.04]" type="button">
                        <span>✦</span>
                        <span className="text-[13px]">Auto</span>
                      </button>
                      <button className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.04]" type="button">⇆</button>
                      <button className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.04]" type="button">＋</button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[var(--lp-soft-text)]">0%</span>
                      <button className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.04]" type="button">✎</button>
                      <button className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#151515] shadow-[0_4px_14px_rgba(255,255,255,0.08)]" type="button">
                        <span>{t("home.start")}</span>
                        <span>➤</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <SuggestionChip label={t("home.suggestions.async")} />
                  <SuggestionChip label={t("home.suggestions.rest")} />
                  <SuggestionChip label={t("home.suggestions.regex")} />
                </div>
              </div>
            </div>
          ) : (
            <ModelConfigPage />
          )}
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

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={() => setSettingsOpen(false)}>
          <div
            className="w-full max-w-md rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 text-[var(--lp-text)] shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-lg font-semibold">{t("sidebar.settings")}</div>
            <div className="text-sm text-[var(--lp-muted)]">设置面板占位（待实现）</div>
            <div className="mt-5 flex justify-end">
              <button
                className="rounded-full bg-white px-5 py-2 text-sm font-medium text-[#151515]"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                {t("appearance.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
