import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppearanceSettings, BackgroundColor, ModelConfig, ProviderConfig, TextColor, ThinkBudget } from "@shared/types";
import { useUiStore } from "./store/useUiStore";
import { PROVIDER_ICON_MAP } from "./components/ProviderIcons";

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

interface ProviderModel {
  id: string;
  think?: boolean;
}

const AI_PROVIDERS_DEFAULT = [
  {
    id: "openai", name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5.5" },
      { id: "o3", think: true },
      { id: "o3-mini", think: true },
      { id: "o4-mini", think: true },
      { id: "gpt-4.1" },
      { id: "gpt-4.1-mini" },
      { id: "gpt-4.1-nano" },
      { id: "gpt-4o" },
      { id: "gpt-4o-mini" }
    ] as ProviderModel[]
  },
  {
    id: "anthropic", name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-sonnet-4-20250514", think: true },
      { id: "claude-opus-4-20250514", think: true },
      { id: "claude-3.7-sonnet", think: true },
      { id: "claude-3.5-sonnet" },
      { id: "claude-3.5-haiku" }
    ] as ProviderModel[]
  },
  {
    id: "google", name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-2.5-pro", think: true },
      { id: "gemini-2.5-flash", think: true },
      { id: "gemini-2.0-flash" },
      { id: "gemini-2.0-flash-lite" },
      { id: "gemini-1.5-pro" },
      { id: "gemini-1.5-flash" }
    ] as ProviderModel[]
  },
  {
    id: "deepseek", name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat" },
      { id: "deepseek-reasoner", think: true }
    ] as ProviderModel[]
  },
  {
    id: "zhipu", name: "智谱AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-plus" },
      { id: "glm-4-long" },
      { id: "glm-4-flash" },
      { id: "glm-4-flashx" },
      { id: "glm-4v-plus" },
      { id: "glm-z1-air", think: true },
      { id: "glm-z1-flash", think: true }
    ] as ProviderModel[]
  },
  {
    id: "moonshot", name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      { id: "kimi-k2" },
      { id: "k1.5-long-think", think: true },
      { id: "moonshot-v1-128k" },
      { id: "moonshot-v1-32k" },
      { id: "moonshot-v1-8k" }
    ] as ProviderModel[]
  },
  {
    id: "tongyi", name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen3-235b-a22b", think: true },
      { id: "qwen3-32b", think: true },
      { id: "qwq-plus", think: true },
      { id: "qwen-max" },
      { id: "qwen-plus" },
      { id: "qwen-turbo" },
      { id: "qwen-long" },
      { id: "qwen-vl-max" }
    ] as ProviderModel[]
  },
  {
    id: "baidu", name: "百度智能云",
    baseUrl: "https://qianfan.baidubce.com/v2",
    models: [
      { id: "ernie-4.5-8k" },
      { id: "ernie-4.5-turbo-8k" },
      { id: "ernie-x1-turbo-32k", think: true },
      { id: "ernie-4.0-8k" },
      { id: "ernie-3.5-8k" },
      { id: "ernie-speed-128k" }
    ] as ProviderModel[]
  },
  {
    id: "minimax", name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    models: [
      { id: "MiniMax-M1", think: true },
      { id: "MiniMax-T1", think: true },
      { id: "abab7-chat" },
      { id: "abab6.5s-chat" }
    ] as ProviderModel[]
  },
  {
    id: "siliconflow", name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      { id: "Qwen/Qwen3-235B-A22B", think: true },
      { id: "deepseek-ai/DeepSeek-R1", think: true },
      { id: "deepseek-ai/DeepSeek-V3" },
      { id: "Pro/Qwen/Qwen2.5-72B-Instruct" },
      { id: "THUDM/GLM-4-9B-Chat" }
    ] as ProviderModel[]
  }
];

const PROTOCOL_OPTIONS = [
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses API" },
  { id: "anthropic-messages", label: "Anthropic Messages API" },
  { id: "google-gemini", label: "Google Gemini API" },
  { id: "openai-compatible", label: "OpenAI 兼容 (第三方)" }
];

interface CustomProvider {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
}

function AddProviderModal({ onClose, onAdd }: { onClose: () => void; onAdd: (p: CustomProvider) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState(PROTOCOL_OPTIONS[0].id);
  const [baseUrl, setBaseUrl] = useState("");

  function handleAdd() {
    if (!name.trim()) return;
    onAdd({
      id: `custom-${Date.now()}`,
      name: name.trim(),
      protocol,
      baseUrl: baseUrl.trim()
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-[var(--lp-text)]">添加自定义服务商</div>
            <div className="mt-1 text-[13px] text-[var(--lp-muted)]">添加一个 OpenAI 兼容或 Anthropic 协议的自定义 AI 服务商</div>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]" onClick={onClose} type="button">✕</button>
        </div>

        <div className="mt-6">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">服务商名称</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder="我的服务商"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">协议类型</div>
          <select
            className="mt-2 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
          >
            {PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">Base URL</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder="https://api.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">API 接口的基础地址</div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button className="rounded-lg border border-[var(--lp-border)] px-4 py-2.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]" onClick={onClose} type="button">取消</button>
          <button
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-[#151515] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!name.trim()}
            type="button"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

function ThinkConfigModal({ modelId, providerId, config, onClose, onSave }: {
  modelId: string;
  providerId: string;
  config: ModelConfig | undefined;
  onClose: () => void;
  onSave: (c: ModelConfig) => void;
}) {
  const BUDGETS: ThinkBudget[] = ["none", "minimal", "low", "medium", "high", "max", "xhigh"];
  const [thinkEnabled, setThinkEnabled] = useState(config?.thinkEnabled ?? false);
  const [budget, setBudget] = useState<ThinkBudget>(config?.thinkBudget ?? "medium");
  const [bodyOn, setBodyOn] = useState(config?.thinkBodyOn ?? "{\n}");
  const [bodyOff, setBodyOff] = useState(config?.thinkBodyOff ?? "");
  const [forceTemp, setForceTemp] = useState(config?.forceTemperature ?? "");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-[var(--lp-text)]">配置 Think 支持</div>
            <div className="mt-1 text-[13px] text-[var(--lp-muted)]">为模型 {modelId} 配置深度思考参数</div>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]" onClick={onClose} type="button">✕</button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">启用 Think 支持</div>
          <button type="button" className={`h-6 w-11 rounded-full transition ${thinkEnabled ? "bg-[#10A37F]" : "bg-white/10"}`} onClick={() => setThinkEnabled(!thinkEnabled)}>
            <div className={`h-5 w-5 rounded-full bg-white shadow transition ${thinkEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
          </button>
        </div>

        {thinkEnabled ? (
          <>
            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">启用时 Body 参数 (JSON)</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">启用 Think 时合并到请求 body 的额外参数</div>
              <textarea className="mt-2 h-24 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none font-mono" value={bodyOn} onChange={(e) => setBodyOn(e.target.value)} />
            </div>

            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">关闭时 Body 参数 (JSON，可选)</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">关闭 Think 时合并到请求 body 的参数，留空则不发送</div>
              <textarea className="mt-2 h-24 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none font-mono" placeholder="留空" value={bodyOff} onChange={(e) => setBodyOff(e.target.value)} />
            </div>

            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">推理强度档位</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">选中后，聊天栏会显示档位切换；不选则仅显示 Think 开关</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {BUDGETS.map((b) => (
                  <button key={b} type="button" className={`rounded-lg border px-3 py-1.5 text-[12px] ${budget === b ? "border-[#10A37F] bg-[#10A37F]/10 text-[#10A37F]" : "border-[var(--lp-border)] text-[var(--lp-text)]/78 hover:bg-white/[0.04]"}`} onClick={() => setBudget(b)}>{b}</button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">强制 Temperature (可选)</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">Anthropic 要求 temperature=1，留空则不覆盖</div>
              <input className="mt-2 w-40 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none" placeholder="留空" value={forceTemp} onChange={(e) => setForceTemp(e.target.value)} />
            </div>
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button className="rounded-lg border border-[var(--lp-border)] px-4 py-2.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]" onClick={onClose} type="button">取消</button>
          <button className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-[#151515]" type="button" onClick={() => {
            onSave({ providerId, modelId, enabled: config?.enabled ?? true, thinkEnabled, thinkBudget: budget, thinkBodyOn: bodyOn, thinkBodyOff: bodyOff, forceTemperature: forceTemp });
            onClose();
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}

function ModelConfigPage() {
  const { t } = useTranslation();
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(AI_PROVIDERS_DEFAULT[0].id);
  const [navWidth, setNavWidth] = useState(220);
  const [providerWidth, setProviderWidth] = useState(240);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [thinkModalModel, setThinkModalModel] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerEnabled, setProviderEnabled] = useState(true);
  const [connectStatus, setConnectStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectModel, setConnectModel] = useState("");

  const allProviders = [...AI_PROVIDERS_DEFAULT, ...customProviders.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl, models: [] as ProviderModel[] }))];
  const filteredProviders = providerSearch
    ? allProviders.filter((p) => p.name.toLowerCase().includes(providerSearch.toLowerCase()) || p.id.toLowerCase().includes(providerSearch.toLowerCase()))
    : allProviders;
  const provider = allProviders.find((p) => p.id === selectedProvider) ?? allProviders[0];

  // Load provider config from DB when selected provider changes
  useEffect(() => {
    if (!window.electronAPI?.getProviderConfig) return;
    void window.electronAPI.getProviderConfig(provider.id).then((cfg) => {
      if (cfg) {
        setApiKey(cfg.apiKey);
        setBaseUrl(cfg.baseUrl);
        setProviderEnabled(cfg.enabled);
      } else {
        setApiKey("");
        setBaseUrl(provider.baseUrl);
        setProviderEnabled(true);
      }
    });
    setConnectStatus("idle");
    setModelSearch("");
    setShowApiKey(false);
  }, [provider.id, provider.baseUrl]);

  // Load custom providers from DB on mount
  useEffect(() => {
    if (!window.electronAPI?.getAllProviderConfigs) return;
    void window.electronAPI.getAllProviderConfigs().then((configs) => {
      const customs = configs.filter((c) => c.isCustom);
      setCustomProviders(customs.map((c) => ({ id: c.id, name: c.name, protocol: c.protocol, baseUrl: c.baseUrl })));
    });
  }, []);

  useEffect(() => {
    // Init models in DB and load configs
    if (!window.electronAPI?.bulkInitModels) return;
    const ids = provider.models.map((m) => m.id);
    void window.electronAPI.bulkInitModels(provider.id, ids).then(setModelConfigs);
    if (provider.models.length > 0) {
      setConnectModel(provider.models[0].id);
    }
  }, [provider.id, provider.models]);

  const saveProviderToDb = useCallback(async (key: string, url: string, enabled: boolean) => {
    if (!window.electronAPI?.saveProviderConfig) return;
    const isCustom = !AI_PROVIDERS_DEFAULT.some((p) => p.id === provider.id);
    await window.electronAPI.saveProviderConfig({
      id: provider.id,
      name: provider.name,
      apiKey: key,
      baseUrl: url,
      enabled,
      protocol: "openai-chat",
      isCustom
    });
  }, [provider.id, provider.name]);

  function handleApiKeyBlur() {
    void saveProviderToDb(apiKey, baseUrl, providerEnabled);
  }

  function handleBaseUrlBlur() {
    void saveProviderToDb(apiKey, baseUrl, providerEnabled);
  }

  function handleProviderToggle() {
    const next = !providerEnabled;
    setProviderEnabled(next);
    void saveProviderToDb(apiKey, baseUrl, next);
  }

  async function handleConnectTest() {
    if (!apiKey.trim()) {
      setConnectStatus("error");
      return;
    }
    setConnectStatus("testing");
    // Simple connectivity test: try to reach the API
    try {
      const url = (baseUrl || provider.baseUrl).replace(/\/+$/, "");
      const res = await fetch(`${url}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(10000)
      });
      setConnectStatus(res.ok ? "success" : "error");
    } catch {
      setConnectStatus("error");
    }
  }

  function getModelEnabled(modelId: string): boolean {
    const cfg = modelConfigs.find((c) => c.modelId === modelId);
    return cfg?.enabled ?? true;
  }

  async function toggleModel(modelId: string) {
    if (!window.electronAPI?.saveModelConfig) return;
    const existing = modelConfigs.find((c) => c.modelId === modelId);
    const config: ModelConfig = existing
      ? { ...existing, enabled: !existing.enabled }
      : { providerId: provider.id, modelId, enabled: false, thinkEnabled: false, thinkBudget: "medium", thinkBodyOn: "{}", thinkBodyOff: "", forceTemperature: "" };
    const updated = await window.electronAPI.saveModelConfig(config);
    setModelConfigs(updated);
  }

  async function handleEnableAll() {
    if (!window.electronAPI?.setAllModelsEnabled) return;
    if (window.electronAPI.bulkInitModels) {
      await window.electronAPI.bulkInitModels(provider.id, provider.models.map((m) => m.id));
    }
    const updated = await window.electronAPI.setAllModelsEnabled(provider.id, true);
    setModelConfigs(updated);
  }

  async function handleDisableAll() {
    if (!window.electronAPI?.setAllModelsEnabled) return;
    const updated = await window.electronAPI.setAllModelsEnabled(provider.id, false);
    setModelConfigs(updated);
  }

  async function handleSaveThinkConfig(config: ModelConfig) {
    if (!window.electronAPI?.saveModelConfig) return;
    const updated = await window.electronAPI.saveModelConfig(config);
    setModelConfigs(updated);
  }

  async function handleDeleteProvider() {
    if (!window.electronAPI?.deleteProviderConfig) return;
    await window.electronAPI.deleteProviderConfig(provider.id);
    setCustomProviders((prev) => prev.filter((p) => p.id !== provider.id));
    setSelectedProvider(AI_PROVIDERS_DEFAULT[0].id);
  }

  const filteredModels = modelSearch
    ? provider.models.filter((m) => m.id.toLowerCase().includes(modelSearch.toLowerCase()))
    : provider.models;

  function handleResize(setter: (w: number) => void, min: number, max: number, currentWidth: number) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = currentWidth;
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
        </nav>
      </div>

      {/* Resize handle 1 */}
      <div
        className="group relative w-[5px] flex-shrink-0 cursor-col-resize"
        onMouseDown={handleResize(setNavWidth, 160, 320, navWidth)}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--lp-border)] transition group-hover:w-[3px] group-hover:bg-white/20 group-active:w-[3px] group-active:bg-white/30" />
      </div>

      {/* Provider List */}
      <div className="flex flex-shrink-0 flex-col overflow-hidden" style={{ width: providerWidth }}>
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("modelConfig.searchProvider")}
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
            />
            <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-text)]/80 hover:bg-white/[0.04]" onClick={() => setAddModalOpen(true)} type="button">＋</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-1">
          {filteredProviders.map((p) => (
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
              <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {PROVIDER_ICON_MAP[p.id] ? (() => { const Icon = PROVIDER_ICON_MAP[p.id]; return <Icon size={18} />; })() : <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.08] text-[10px] font-bold text-[var(--lp-text)]">{p.name[0]}</span>}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Resize handle 2 */}
      <div
        className="group relative w-[5px] flex-shrink-0 cursor-col-resize"
        onMouseDown={handleResize(setProviderWidth, 180, 400, providerWidth)}
      >
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--lp-border)] transition group-hover:w-[3px] group-hover:bg-white/20 group-active:w-[3px] group-active:bg-white/30" />      </div>

      {/* Provider Config */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-7 w-7 items-center justify-center">
              {PROVIDER_ICON_MAP[provider.id] ? (() => { const Icon = PROVIDER_ICON_MAP[provider.id]; return <Icon size={26} />; })() : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-[13px] font-bold text-[var(--lp-text)]">{provider.name[0]}</span>}
            </span>
            <div className="text-[20px] font-semibold text-[var(--lp-text)]">{provider.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--lp-soft-text)]">OpenAI Chat Completions 兼容</span>
            <button type="button" className={`h-6 w-11 rounded-full transition ${providerEnabled ? "bg-[#10A37F]" : "bg-white/10"}`} onClick={handleProviderToggle}>
              <div className={`h-5 w-5 rounded-full bg-white shadow transition ${providerEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
            </button>
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
              type={showApiKey ? "text" : "password"}
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={handleApiKeyBlur}
            />
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-soft-text)] hover:bg-white/[0.04]"
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? "隐藏" : "显示"}
            >
              {showApiKey ? "🙈" : ""}
            </button>
          </div>
        </div>

        {/* API Proxy */}
        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.apiProxy")}</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder={provider.baseUrl || "https://api.example.com/v1"}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={handleBaseUrlBlur}
          />
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("modelConfig.apiProxyHint")}</div>
        </div>

        {/* Connection Test */}
        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.connectTest")}</div>
          <div className="mt-2 flex items-center gap-3">
            <select
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none"
              value={connectModel}
              onChange={(e) => setConnectModel(e.target.value)}
            >
              {provider.models.length > 0 ? provider.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>) : <option>—</option>}
            </select>
            <button
              className={`rounded-lg border px-4 py-2 text-[13px] hover:bg-white/[0.04] ${
                connectStatus === "success" ? "border-green-500/50 text-green-400" :
                connectStatus === "error" ? "border-red-500/50 text-red-400" :
                connectStatus === "testing" ? "border-yellow-500/50 text-yellow-400" :
                "border-[var(--lp-border)] text-[var(--lp-text)]"
              }`}
              type="button"
              onClick={() => void handleConnectTest()}
              disabled={connectStatus === "testing"}
            >
              {connectStatus === "testing" ? "⏳" : connectStatus === "success" ? "✓ " : connectStatus === "error" ? "✗ " : ""}{t("modelConfig.check")}
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="mt-6 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-panel)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.modelList")}</div>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--lp-soft-text)]">{provider.models.length}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("modelConfig.searchModel")}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]" type="button" onClick={() => void handleEnableAll()}>{t("modelConfig.enableAll")}</button>
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)]/78 hover:bg-white/[0.04]" type="button" onClick={() => void handleDisableAll()}>{t("modelConfig.disableAll")}</button>
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04]" type="button">↻ {t("modelConfig.fetchModels")}</button>
          </div>
          {filteredModels.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1">
              {filteredModels.map((m) => {
                const enabled = getModelEnabled(m.id);
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/[0.03]">
                    <span className="flex items-center gap-2 text-[13px] text-[var(--lp-text)]">
                      {m.id}
                      {m.think ? <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">Think</span> : null}
                    </span>
                    <div className="flex items-center gap-2">
                      {m.think ? (
                        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-[var(--lp-soft-text)] hover:bg-white/[0.06]" title="配置 Think" onClick={() => setThinkModalModel(m.id)}>⚙</button>
                      ) : null}
                      <button type="button" className={`h-5 w-9 rounded-full transition ${enabled ? "bg-[#10A37F]" : "bg-white/10"}`} onClick={() => void toggleModel(m.id)}>
                        <div className={`h-4 w-4 rounded-full bg-white shadow transition ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 text-center text-[13px] text-[var(--lp-soft-text)]">
              {provider.models.length === 0 ? t("modelConfig.comingSoon") : "无匹配模型"}
            </div>
          )}
        </div>

        {/* Delete custom provider */}
        {!AI_PROVIDERS_DEFAULT.some((p) => p.id === provider.id) ? (
          <div className="mt-6">
            <button
              className="rounded-lg border border-red-500/30 px-4 py-2 text-[13px] text-red-400 hover:bg-red-500/10"
              type="button"
              onClick={() => void handleDeleteProvider()}
            >
              删除此服务商
            </button>
          </div>
        ) : null}
      </div>

      {addModalOpen ? (
        <AddProviderModal
          onClose={() => setAddModalOpen(false)}
          onAdd={(p) => {
            setCustomProviders((prev) => [...prev, p]);
            setSelectedProvider(p.id);
          }}
        />
      ) : null}

      {thinkModalModel ? (
        <ThinkConfigModal
          modelId={thinkModalModel}
          providerId={provider.id}
          config={modelConfigs.find((c) => c.modelId === thinkModalModel)}
          onClose={() => setThinkModalModel(null)}
          onSave={(c) => void handleSaveThinkConfig(c)}
        />
      ) : null}
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
  const [sidebarWidth, setSidebarWidth] = useState(280);

  function handleSidebarResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.min(420, Math.max(200, startW + delta)));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

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
        <aside className="flex flex-shrink-0 flex-col bg-[var(--lp-side-bg)] px-3 pb-3 pt-0 backdrop-blur-xl" style={{ width: sidebarWidth }}>
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

        {/* Sidebar resize handle */}
        <div
          className="group relative w-[5px] flex-shrink-0 cursor-col-resize"
          onMouseDown={handleSidebarResize}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--lp-border)] transition group-hover:w-[3px] group-hover:bg-white/20 group-active:w-[3px] group-active:bg-white/30" />
        </div>

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
