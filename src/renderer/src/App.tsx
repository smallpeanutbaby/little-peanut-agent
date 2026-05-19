import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  AppearanceSettings,
  ChatAttachment,
  Conversation,
  ModelCapability,
  ModelConfig,
  Project,
  ProviderConfig,
  ThinkBudget,
  ThinkProtocol
} from "@shared/types";
import { useUiStore } from "./store/useUiStore";
import { PROVIDER_ICON_MAP } from "./components/ProviderIcons";
import { ChatPanel } from "./components/ChatPanel";
import { ProjectLandingPanel } from "./components/ProjectLandingPanel";
import { SettingsPage } from "./components/SettingsPage";
import { CHAT_MODES, CHAT_MODE_MAP, type ChatModeId } from "@shared/modes";

/**
 * Mode whitelists per context.
 * - Standalone "对话" page: every built-in mode EXCEPT Agent. Agent is
 *   intentionally project-only because its prompt assumes a project root /
 *   workspace context.
 * - Project landing & project chat: ONLY Agent. Users opted into a project so
 *   we lock the mode to the one that knows how to operate on one. Future
 *   project-flavoured modes can be added here.
 */
const STANDALONE_CHAT_MODE_IDS = CHAT_MODES
  .filter((m) => m.id !== "agent" && m.id !== "plan" && m.id !== "pipeline")
  .map((m) => m.id) as readonly ChatModeId[];
const PROJECT_CHAT_MODE_IDS = ["agent", "plan", "pipeline"] as const satisfies readonly ChatModeId[];
import { usePersistedState } from "./hooks/usePersistedState";
import { backgroundClassMap, textClassMap } from "./constants/theme-tokens";
import { AI_PROVIDERS_DEFAULT, type CustomProvider, type ProviderModel } from "./constants/providers";
import { PROTOCOL_LEVELS, THINK_BUDGET_LABELS } from "./constants/think-presets";
import { ThemeModal } from "./components/modals/ThemeModal";
import { PermissionApprovalModal, type PermissionRequest, type PermissionDecisionKind } from "./components/modals/PermissionApprovalModal";
import { RunningTasksTray } from "./components/RunningTasksTray";
import { ResumeToast } from "./components/ResumeToast";
import { AddProviderModal } from "./components/modals/AddProviderModal";
import { ThinkConfigModal } from "./components/modals/ThinkConfigModal";
import { AddModelModal } from "./components/modals/AddModelModal";
import { CapabilityChips } from "./components/CapabilityChips";
import { PipelineConfigurator } from "./components/PipelineConfigurator";
import type { PipelineStageConfig } from "@shared/types";

/**
 * True if the model exposes any form of reasoning/thinking. v4 derives this
 * from the multi-label `capabilities` set instead of a dedicated `think`
 * flag — the catalog literal-types `capabilities` so callers don't need an
 * explicit `null` check.
 */
function hasReasoning(m: ProviderModel | undefined): boolean {
  return !!m && m.capabilities.includes("reasoning");
}

/**
 * Levels available for the model's reasoning protocol. Returns `[]` for
 * non-reasoning models *and* for binary protocols (DeepSeek-R1 etc.) — the
 * binary case is handled by callers with a plain on/off toggle.
 */
function modelLevels(m: ProviderModel | undefined): ThinkBudget[] {
  if (!m || !m.thinkProtocol) return [];
  return PROTOCOL_LEVELS[m.thinkProtocol];
}

function ModelConfigPage() {
  const { t } = useTranslation();
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModelModalOpen, setAddModelModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = usePersistedState<string>("modelConfig.selectedProvider", AI_PROVIDERS_DEFAULT[0].id);
  const [providerWidth, setProviderWidth] = usePersistedState<number>("modelConfig.providerWidth", 260);
  const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
  const [thinkModalModel, setThinkModalModel] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerEnabled, setProviderEnabled] = useState(true);
  const [connectStatus, setConnectStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectMessage, setConnectMessage] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [connectModel, setConnectModel] = useState("");
  const [customModels, setCustomModels] = useState<Record<string, ProviderModel[]>>({});

  const allProviders = [...AI_PROVIDERS_DEFAULT, ...customProviders.map((c) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl, models: [] as ProviderModel[] }))];
  // Localized display name for built-in providers (custom providers fall back
  // to their stored raw name via i18next's defaultValue).
  const localizedName = useCallback(
    (p: { id: string; name: string }) => t(`providers.${p.id}`, { defaultValue: p.name }),
    [t]
  );
  const filteredProviders = providerSearch
    ? allProviders.filter((p) => {
        const q = providerSearch.toLowerCase();
        return (
          localizedName(p).toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      })
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
    setConnectMessage("");
    setModelSearch("");
    setShowApiKey(false);
    setSaveStatus("idle");
  }, [provider.id, provider.baseUrl]);

  // Load custom providers and custom models from DB on mount
  useEffect(() => {
    if (!window.electronAPI?.getAllProviderConfigs) return;
    void window.electronAPI.getAllProviderConfigs().then((configs) => {
      const customs = configs.filter((c) => c.isCustom);
      setCustomProviders(customs.map((c) => ({ id: c.id, name: c.name, protocol: c.protocol, baseUrl: c.baseUrl })));
    });
    if (!window.electronAPI?.getAllCustomModels) return;
    void window.electronAPI.getAllCustomModels().then((models) => {
      const grouped: Record<string, ProviderModel[]> = {};
      for (const m of models) {
        if (!grouped[m.providerId]) grouped[m.providerId] = [];
        // Tolerate v3 rows: if the row still has the legacy `supportsThink`
        // flag with no `capabilities`, synthesise a minimal capability set.
        const capabilities: ModelCapability[] = (m.capabilities && m.capabilities.length > 0)
          ? m.capabilities
          : (m.supportsThink ? ["text", "reasoning"] : ["text"]);
        const thinkProtocol: ThinkProtocol | undefined = m.thinkProtocol ?? undefined;
        grouped[m.providerId].push({ id: m.modelId, capabilities, thinkProtocol });
      }
      setCustomModels(grouped);
    });
  }, []);

  useEffect(() => {
    // Init models in DB and load configs. Pass through capabilities +
    // thinkProtocol so first-time seeded rows get the catalog defaults
    // (replacing the old `string[]` model-id list).
    if (!window.electronAPI?.bulkInitModels) return;
    const seedModels = provider.models.map((m) => ({
      id: m.id,
      capabilities: m.capabilities,
      thinkProtocol: m.thinkProtocol ?? null
    }));
    void window.electronAPI.bulkInitModels(provider.id, seedModels).then(setModelConfigs);
    if (provider.models.length > 0) {
      setConnectModel(provider.models[0].id);
    }
  }, [provider.id, provider.models]);

  const saveProviderToDb = useCallback(async (key: string, url: string, enabled: boolean) => {
    if (!window.electronAPI?.saveProviderConfig) return;
    const isCustom = !AI_PROVIDERS_DEFAULT.some((p) => p.id === provider.id);
    const customMeta = customProviders.find((c) => c.id === provider.id);
    await window.electronAPI.saveProviderConfig({
      id: provider.id,
      name: provider.name,
      apiKey: key,
      baseUrl: url,
      enabled,
      protocol: customMeta?.protocol ?? "openai-chat",
      isCustom
    });
  }, [provider.id, provider.name, customProviders]);

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

  async function handleSaveProvider() {
    setSaveStatus("saving");
    try {
      await saveProviderToDb(apiKey, baseUrl, providerEnabled);
      setSaveStatus("saved");
      window.setTimeout(() => {
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      }, 2000);
    } catch (err) {
      console.error("[SaveProvider]", err);
      setSaveStatus("error");
    }
  }

  async function handleConnectTest() {
    if (!apiKey.trim()) {
      setConnectStatus("error");
      setConnectMessage(t("connectivity.fillApiKey"));
      return;
    }
    if (!window.electronAPI?.checkConnectivity) {
      const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI;
      const keys = api ? Object.keys(api).sort().join(", ") : t("connectivity.undefinedTag");
      setConnectStatus("error");
      setConnectMessage(t("connectivity.unavailableLong", { keys }));
      console.error("[Connectivity] window.electronAPI =", api);
      return;
    }
    const customMeta = customProviders.find((c) => c.id === provider.id);
    const protocol = customMeta?.protocol ?? (
      provider.id === "anthropic" ? "anthropic-messages" :
      provider.id === "google" ? "google-gemini" :
      "openai-chat"
    );
    setConnectStatus("testing");
    setConnectMessage("");
    const res = await window.electronAPI.checkConnectivity({
      providerId: provider.id,
      protocol,
      baseUrl: (baseUrl || provider.baseUrl).trim(),
      apiKey: apiKey.trim(),
      model: connectModel || provider.models[0]?.id || ""
    });
    setConnectStatus(res.ok ? "success" : "error");
    setConnectMessage(
      res.ok
        ? res.latencyMs
          ? t("connectivity.connectedWithLatency", { latency: res.latencyMs })
          : t("connectivity.connected")
        : res.message
          ? `${res.status ? `[${res.status}] ` : ""}${res.message}`
          : t("connectivity.failed")
    );
  }

  function getModelEnabled(modelId: string): boolean {
    const cfg = modelConfigs.find((c) => c.modelId === modelId);
    return cfg?.enabled ?? true;
  }

  async function toggleModel(modelId: string) {
    if (!window.electronAPI?.saveModelConfig) return;
    const existing = modelConfigs.find((c) => c.modelId === modelId);
    // When creating a placeholder ModelConfig for a model we haven't touched
    // yet, look up the catalog entry so capabilities + protocol stay correct.
    const catalogEntry = provider.models.find((m) => m.id === modelId)
      ?? (customModels[provider.id] || []).find((m) => m.id === modelId);
    const config: ModelConfig = existing
      ? { ...existing, enabled: !existing.enabled }
      : {
          providerId: provider.id,
          modelId,
          enabled: false,
          capabilities: catalogEntry?.capabilities ?? ["text"],
          thinkProtocol: catalogEntry?.thinkProtocol ?? null,
          thinkEnabled: false,
          thinkBudget: "medium",
          thinkBodyOn: "{}",
          thinkBodyOff: "",
          forceTemperature: ""
        };
    const updated = await window.electronAPI.saveModelConfig(config);
    setModelConfigs(updated);
  }

  async function handleEnableAll() {
    if (!window.electronAPI?.setAllModelsEnabled) return;
    if (window.electronAPI.bulkInitModels) {
      await window.electronAPI.bulkInitModels(
        provider.id,
        provider.models.map((m) => ({ id: m.id, capabilities: m.capabilities, thinkProtocol: m.thinkProtocol ?? null }))
      );
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

  // Merge default models with custom-added models for this provider
  const allModelsForProvider = useMemo(() => {
    const defaults = provider.models;
    const customs = customModels[provider.id] || [];
    const existingIds = new Set(defaults.map((m) => m.id));
    const merged = [...defaults, ...customs.filter((c) => !existingIds.has(c.id))];
    return merged;
  }, [provider.models, provider.id, customModels]);

  /**
   * `modelSearch` doubles as a free-text id filter AND a capability filter:
   *   - typing `vision`/`reasoning`/`tools`/... narrows to models with that
   *     capability (intentional shortcut so the user doesn't need a separate
   *     dropdown)
   *   - any other text falls back to a substring match on the model id
   * Empty input shows the full list.
   */
  const filteredModelsDisplay = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return allModelsForProvider;
    const CAP_KEYWORDS: ModelCapability[] = [
      "text", "vision", "reasoning", "tools", "image-gen", "audio", "embedding"
    ];
    const capMatch = CAP_KEYWORDS.find((c) => c === q);
    if (capMatch) return allModelsForProvider.filter((m) => m.capabilities.includes(capMatch));
    return allModelsForProvider.filter((m) => m.id.toLowerCase().includes(q));
  }, [modelSearch, allModelsForProvider]);

  function handleAddModel(
    modelId: string,
    capabilities: ModelCapability[],
    thinkProtocol: ThinkProtocol | null
  ) {
    if (window.electronAPI?.addCustomModel) {
      void window.electronAPI.addCustomModel(provider.id, modelId, capabilities, thinkProtocol);
    }
    setCustomModels((prev) => {
      const existing = prev[provider.id] || [];
      if (existing.some((m) => m.id === modelId) || provider.models.some((m) => m.id === modelId)) {
        return prev;
      }
      return {
        ...prev,
        [provider.id]: [
          ...existing,
          { id: modelId, capabilities, thinkProtocol: thinkProtocol ?? undefined }
        ]
      };
    });
  }

  function handleDeleteModel(modelId: string) {
    // Persist to DB
    if (window.electronAPI?.deleteCustomModel) {
      void window.electronAPI.deleteCustomModel(provider.id, modelId);
    }
    setCustomModels((prev) => {
      const existing = prev[provider.id] || [];
      return { ...prev, [provider.id]: existing.filter((m) => m.id !== modelId) };
    });
  }

  return (
    <div className="flex flex-1 overflow-hidden">
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
                {PROVIDER_ICON_MAP[p.id] ? (() => { const Icon = PROVIDER_ICON_MAP[p.id]; return <Icon size={18} />; })() : <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.08] text-[10px] font-bold text-[var(--lp-text)]">{localizedName(p)[0]}</span>}
              </span>
              <span className="truncate">{localizedName(p)}</span>
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
      <div className="flex flex-1 flex-col overflow-hidden px-8 py-6">
        <div className="flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-7 w-7 items-center justify-center">
              {PROVIDER_ICON_MAP[provider.id] ? (() => { const Icon = PROVIDER_ICON_MAP[provider.id]; return <Icon size={26} />; })() : <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-[13px] font-bold text-[var(--lp-text)]">{localizedName(provider)[0]}</span>}
            </span>
            <div className="text-[20px] font-semibold text-[var(--lp-text)]">{localizedName(provider)}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--lp-soft-text)]">{t("modelConfig.openaiCompat")}</span>
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
              onChange={(e) => { setApiKey(e.target.value); setSaveStatus("idle"); }}
              onBlur={handleApiKeyBlur}
            />
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-soft-text)] hover:bg-white/[0.04] hover:text-[var(--lp-text)]"
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? t("modelConfig.hide") : t("modelConfig.show")}
              aria-label={showApiKey ? t("modelConfig.hideApiKey") : t("modelConfig.showApiKey")}
            >
              {showApiKey ? (
                // Eye-off icon
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              ) : (
                // Eye icon
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
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
            onChange={(e) => { setBaseUrl(e.target.value); setSaveStatus("idle"); }}
            onBlur={handleBaseUrlBlur}
          />
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("modelConfig.apiProxyHint")}</div>
        </div>

        {/* Save button — explicit save for this provider's config */}
        <div className="mt-4 flex items-center justify-end gap-3">
          {saveStatus === "saved" ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-green-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t("modelConfig.saved")}
            </span>
          ) : saveStatus === "error" ? (
            <span className="text-[12px] text-red-400">{t("modelConfig.saveFailed")}</span>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-[#151515] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleSaveProvider()}
            disabled={saveStatus === "saving"}
          >
            {saveStatus === "saving" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
            {t("modelConfig.save")}
          </button>
        </div>

        {/* Connection Test */}
        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.connectTest")}</div>
          <div className="mt-2 flex items-center gap-3">
            <div className="relative flex-1">
              <select
                className="w-full appearance-none rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 pr-9 text-[13px] text-[var(--lp-text)] outline-none"
                value={connectModel}
                onChange={(e) => setConnectModel(e.target.value)}
              >
                {provider.models.length > 0 ? provider.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>) : <option>—</option>}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lp-soft-text)]"
                width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
              >
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                connectStatus === "success" ? "border-green-500/50 text-green-400 hover:bg-green-500/5" :
                connectStatus === "error" ? "border-red-500/50 text-red-400 hover:bg-red-500/5" :
                connectStatus === "testing" ? "border-yellow-500/50 text-yellow-400" :
                "border-[var(--lp-border)] text-[var(--lp-text)] hover:bg-white/[0.04]"
              }`}
              type="button"
              onClick={() => void handleConnectTest()}
              disabled={connectStatus === "testing" || !apiKey.trim()}
              title={!apiKey.trim() ? t("modelConfig.fillApiKeyFirst") : undefined}
            >
              {connectStatus === "testing" ? (
                // Spinner
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : connectStatus === "success" ? (
                // Check
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : connectStatus === "error" ? (
                // X
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : null}
              <span>{t("modelConfig.check")}</span>
            </button>
          </div>
          {connectMessage ? (
            <div className={`mt-2 text-[12px] ${
              connectStatus === "success" ? "text-green-400" :
              connectStatus === "error" ? "text-red-400" :
              "text-[var(--lp-soft-text)]"
            }`}>
              {connectMessage}
            </div>
          ) : null}
        </div>
        </div>

        {/* Model List */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-panel)] p-4">
          <div className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("modelConfig.modelList")}</div>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--lp-soft-text)]">{allModelsForProvider.length}</span>
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
            <button className="rounded-lg border border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04] inline-flex items-center gap-1" type="button"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> {t("modelConfig.fetchModels")}</button>
            <button className="rounded-lg border border-dashed border-[var(--lp-border)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.04]" type="button" onClick={() => setAddModelModalOpen(true)}>{t("modelConfig.addModelBtn")}</button>
          </div>
          </div>
          {filteredModelsDisplay.length > 0 ? (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto flex flex-col gap-1">
              {filteredModelsDisplay.map((m) => {
                const enabled = getModelEnabled(m.id);
                const isCustomModel = (customModels[provider.id] || []).some((cm) => cm.id === m.id);
                const canReason = hasReasoning(m);
                return (
                  <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/[0.03]">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-[var(--lp-text)]">
                      <span className="truncate">{m.id}</span>
                      <CapabilityChips capabilities={m.capabilities} />
                      {isCustomModel ? <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">{t("modelConfig.customBadge")}</span> : null}
                    </span>
                    <div className="flex items-center gap-2">
                      {canReason ? (
                        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-[var(--lp-soft-text)] hover:bg-white/[0.06]" title={t("modelConfig.configThink")} onClick={() => setThinkModalModel(m.id)}>⚙</button>
                      ) : null}
                      {isCustomModel ? (
                        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] text-red-400/60 hover:bg-red-500/10 hover:text-red-400" title={t("modelConfig.deleteModel")} onClick={() => handleDeleteModel(m.id)}>🗑</button>
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
              {allModelsForProvider.length === 0 ? t("modelConfig.comingSoon") : t("modelConfig.noMatchModel")}
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
              {t("modelConfig.deleteThisProvider")}
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
            if (window.electronAPI?.saveProviderConfig) {
              void window.electronAPI.saveProviderConfig({
                id: p.id,
                name: p.name,
                apiKey: "",
                baseUrl: p.baseUrl,
                enabled: true,
                protocol: p.protocol,
                isCustom: true
              });
            }
          }}
        />
      ) : null}

      {thinkModalModel ? (() => {
        const target = allModelsForProvider.find((m) => m.id === thinkModalModel);
        return (
          <ThinkConfigModal
            modelId={thinkModalModel}
            providerId={provider.id}
            thinkProtocol={target?.thinkProtocol ?? null}
            capabilities={target?.capabilities ?? ["text"]}
            config={modelConfigs.find((c) => c.modelId === thinkModalModel)}
            onClose={() => setThinkModalModel(null)}
            onSave={(c) => void handleSaveThinkConfig(c)}
          />
        );
      })() : null}

      {addModelModalOpen ? (
        <AddModelModal
          providerId={provider.id}
          onClose={() => setAddModelModalOpen(false)}
          onAdd={handleAddModel}
        />
      ) : null}
    </div>
  );
}

/**
 * Anchored dropdown positioning hook.
 *
 * Returns a ref to attach to the trigger button plus the computed viewport
 * coordinates (`left`, `bottom`) for a dropdown that opens UP from the
 * trigger. The dropdown should be rendered via `createPortal` so that it
 * escapes ancestor `overflow:hidden`/`overflow:auto` clipping (which is the
 * reason the toolbar dropdowns silently "did nothing" before — they were
 * being clipped by the input box wrapper).
 */
function useAnchoredDropdown(open: boolean) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; bottom: number; minWidth: number }>({
    left: 0,
    bottom: 0,
    minWidth: 0
  });
  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setCoords({
        left: r.left,
        bottom: window.innerHeight - r.top + 8,
        minWidth: r.width
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  return { anchorRef, coords };
}

/**
 * Mode selector — replaces the legacy "对话模式▾" placeholder button.
 *
 * Shows the active mode (icon + localized name) and pops a dropdown with all
 * 8 built-in modes. Switching mode is purely UI-side: it does not flush the
 * conversation; the next outgoing message picks up the new mode's
 * systemPrompt + default sampling hints in the main process.
 */
function ModeSelector({
  selectedModeId,
  onChange,
  availableModeIds
}: {
  selectedModeId: ChatModeId;
  onChange: (id: ChatModeId) => void;
  /**
   * Optional whitelist of mode ids that should appear in the dropdown.
   * - Standalone chat passes the 8 non-agent modes (Agent is project-only).
   * - Project context passes ["agent"] so users can't switch mode away from
   *   Agent inside a project (UX choice, not a hard constraint).
   * Default = render every registered mode.
   */
  availableModeIds?: readonly ChatModeId[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { anchorRef, coords } = useAnchoredDropdown(open);
  const visibleModes = availableModeIds
    ? CHAT_MODES.filter((m) => availableModeIds.includes(m.id))
    : CHAT_MODES;
  const effectiveId = availableModeIds && !availableModeIds.includes(selectedModeId)
    ? (visibleModes[0]?.id ?? "chat")
    : selectedModeId;
  const active = CHAT_MODE_MAP[effectiveId] ?? CHAT_MODE_MAP.chat;

  // Each accent maps to a small bg/border tint class set. We intentionally
  // do NOT pin a foreground colour here — the button label always uses the
  // user-chosen ink color (`var(--lp-text)`) so every mode button stays
  // visually consistent with the rest of the chrome, regardless of theme.
  // The accent only paints the surrounding glass (border + tinted fill).
  const accentTints: Record<string, { btn: string; ring: string; chip: string }> = {
    slate:    { btn: "border-slate-400/30 bg-slate-400/10",    ring: "ring-slate-400/40",    chip: "bg-slate-400/15" },
    amber:    { btn: "border-amber-400/40 bg-amber-400/15",    ring: "ring-amber-400/40",    chip: "bg-amber-400/20" },
    emerald:  { btn: "border-emerald-400/40 bg-emerald-400/15", ring: "ring-emerald-400/40", chip: "bg-emerald-400/20" },
    sky:      { btn: "border-sky-400/40 bg-sky-400/15",        ring: "ring-sky-400/40",      chip: "bg-sky-400/20" },
    violet:   { btn: "border-violet-400/40 bg-violet-400/15",  ring: "ring-violet-400/40",   chip: "bg-violet-400/20" },
    rose:     { btn: "border-rose-400/40 bg-rose-400/15",      ring: "ring-rose-400/40",     chip: "bg-rose-400/20" },
    cyan:     { btn: "border-cyan-400/40 bg-cyan-400/15",      ring: "ring-cyan-400/40",     chip: "bg-cyan-400/20" },
    fuchsia:  { btn: "border-fuchsia-400/40 bg-fuchsia-400/15", ring: "ring-fuchsia-400/40", chip: "bg-fuchsia-400/20" },
    indigo:   { btn: "border-indigo-400/40 bg-indigo-400/15",  ring: "ring-indigo-400/40",   chip: "bg-indigo-400/20" }
  };
  const tint = accentTints[active.accent] ?? accentTints.slate;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] text-[var(--lp-text)] transition ${tint.btn} hover:brightness-110`}
        title={t(active.descKey)}
      >
        <span className="text-[14px] leading-none">{active.icon}</span>
        <span className="font-medium">{t(active.nameKey)}</span>
        <span className="opacity-60">▾</span>
      </button>

      {open ? createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="lp-popover fixed z-[210] w-[320px] overflow-hidden rounded-[16px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
            style={{ left: coords.left, bottom: coords.bottom }}
          >
            <div className="border-b border-white/[0.06] px-4 py-2.5 text-[11px] uppercase tracking-wide text-[var(--lp-muted)]">
              {t("modes.dropdownTitle")}
            </div>
            <div className="max-h-[420px] overflow-y-auto px-2 py-2">
              {visibleModes.map((mode) => {
                const isActive = mode.id === effectiveId;
                const mt = accentTints[mode.accent] ?? accentTints.slate;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition text-[var(--lp-text)] ${
                      isActive
                        ? `${mt.chip} ring-1 ${mt.ring}`
                        : "hover:bg-white/[0.04]"
                    }`}
                    onClick={() => { onChange(mode.id); setOpen(false); }}
                  >
                    <span className="mt-0.5 text-[18px] leading-none">{mode.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium">
                          {t(mode.nameKey)}
                        </span>
                        {isActive ? <span className="text-[10px] opacity-70">●</span> : null}
                      </span>
                      <span className={`mt-0.5 block text-[11.5px] leading-snug ${isActive ? "opacity-90" : "text-[var(--lp-muted)]"}`}>
                        {t(mode.descKey)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-white/[0.06] px-4 py-2 text-[10.5px] text-[var(--lp-muted)]">
              {t("modes.footerHint")}
            </div>
          </div>
        </>,
        document.body
      ) : null}
    </>
  );
}

function BypassPermissionToggle({ active, onToggle }: { active: boolean; onToggle: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onToggle(!active)}
      title={active ? t("agent.bypassOn", "免审模式开启：所有工具自动批准") : t("agent.bypassOff", "免审模式关闭：工具需手动审批")}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
          : "bg-[var(--lp-surface)] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
      }`}
    >
      {active ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <polyline points="9 12 11 14 15 10"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      )}
      <span>{active ? t("agent.bypassLabel", "免审") : t("agent.approvalLabel", "审批")}</span>
    </button>
  );
}

function ModelSelector({
  selectedProvider,
  selectedModel,
  thinkBudget,
  thinkEnabled,
  onChangeProvider,
  onChangeModel,
  onChangeBudget,
  onChangeThinkEnabled,
  providerConfigs
}: {
  selectedProvider: string;
  selectedModel: string;
  thinkBudget: ThinkBudget;
  /** Whether the next message should request reasoning. Drives the budget
   *  chip on the model button and the "关闭/Off" item in the budget picker. */
  thinkEnabled: boolean;
  onChangeProvider: (id: string) => void;
  onChangeModel: (id: string) => void;
  onChangeBudget: (b: ThinkBudget) => void;
  onChangeThinkEnabled: (next: boolean) => void;
  /** Provider configs from DB; used to filter out disabled / unkeyed providers. */
  providerConfigs?: Record<string, ProviderConfig>;
}) {
  const { t } = useTranslation();
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const providerAnchor = useAnchoredDropdown(providerOpen);
  const modelAnchor = useAnchoredDropdown(modelOpen);
  // Localized display name for built-in providers; custom providers fall back
  // to their stored raw name via i18next's defaultValue.
  const localizedName = useCallback(
    (p: { id: string; name: string }) => t(`providers.${p.id}`, { defaultValue: p.name }),
    [t]
  );

  // Filter to providers that are enabled AND have an apiKey set.
  // Falls back to all defaults when no configs are loaded yet (first render).
  const availableProviders = useMemo(() => {
    if (!providerConfigs || Object.keys(providerConfigs).length === 0) return AI_PROVIDERS_DEFAULT;
    return AI_PROVIDERS_DEFAULT.filter((p) => {
      const cfg = providerConfigs[p.id];
      if (!cfg) return false;
      return cfg.enabled && !!cfg.apiKey;
    });
  }, [providerConfigs]);

  const provider = availableProviders.find((p) => p.id === selectedProvider)
    ?? availableProviders[0]
    ?? AI_PROVIDERS_DEFAULT[0];
  const model = provider.models.find((m) => m.id === selectedModel);
  const modelDisplay = selectedModel ? selectedModel.split("/").pop()! : t("modelSelector.selectModel");
  const noAvailable = availableProviders.length === 0;

  function selectProvider(id: string) {
    onChangeProvider(id);
    const next = availableProviders.find((p) => p.id === id) ?? AI_PROVIDERS_DEFAULT.find((p) => p.id === id);
    if (next && next.models.length > 0) {
      const firstModel = next.models[0];
      onChangeModel(firstModel.id);
      // If the newly-selected model can't reason, force-off the toggle so we
      // don't ship a stray reasoning_effort to a non-reasoning model.
      if (!hasReasoning(firstModel) && thinkEnabled) onChangeThinkEnabled(false);
    }
    setProviderOpen(false);
  }

  function selectModel(id: string) {
    onChangeModel(id);
    const next = provider.models.find((m) => m.id === id);
    if (next && !hasReasoning(next) && thinkEnabled) onChangeThinkEnabled(false);
    setModelOpen(false);
  }

  return (
    <>
      {/* Provider button */}
      <button
        ref={providerAnchor.anchorRef}
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-white/[0.03] px-3 py-1.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.06]"
        onClick={() => { setProviderOpen((v) => !v); setModelOpen(false); }}
        title={t("modelSelector.selectProvider")}
      >
        <span className="inline-flex h-4 w-4 items-center justify-center">
          {PROVIDER_ICON_MAP[provider.id]
            ? (() => { const Icon = PROVIDER_ICON_MAP[provider.id]; return <Icon size={14} />; })()
            : <span className="text-[10px]">{localizedName(provider)[0]}</span>}
        </span>
        <span className="max-w-[120px] truncate">{localizedName(provider)}</span>
        <span className="text-[var(--lp-soft-text)]">▾</span>
      </button>

      {providerOpen ? createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setProviderOpen(false)} />
          <div
            className="lp-popover fixed z-[210] w-[240px] max-h-[360px] overflow-hidden rounded-[16px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
            style={{ left: providerAnchor.coords.left, bottom: providerAnchor.coords.bottom }}
          >
            <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] text-[var(--lp-muted)]">{t("modelSelector.providerHeading")}</div>
            <div className="max-h-[300px] overflow-y-auto px-2 py-2">
              {noAvailable ? (
                <div className="p-3 text-center text-[12px] text-[var(--lp-muted)]">
                  {t("modelSelector.noProvidersGoConfig")}
                </div>
              ) : availableProviders.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-[var(--lp-text)] transition ${selectedProvider === p.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                  onClick={() => selectProvider(p.id)}
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-4 w-4 items-center justify-center">
                      {PROVIDER_ICON_MAP[p.id]
                        ? (() => { const Icon = PROVIDER_ICON_MAP[p.id]; return <Icon size={14} />; })()
                        : <span className="text-[10px]">{localizedName(p)[0]}</span>}
                    </span>
                    <span className="truncate">{localizedName(p)}</span>
                  </span>
                  {selectedProvider === p.id ? <span className="text-[#10A37F]">✓</span> : null}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      ) : null}

      {/* Model button */}
      <button
        ref={modelAnchor.anchorRef}
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-[var(--lp-border)] bg-white/[0.03] px-3 py-1.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => { setModelOpen((v) => !v); setProviderOpen(false); }}
        disabled={provider.models.length === 0}
        title={t("modelSelector.selectModel")}
      >
        <span className="max-w-[160px] truncate">{modelDisplay}</span>
        {hasReasoning(model) ? (
          thinkEnabled ? (
            <span className="lp-think-chip rounded px-1 py-0.5 text-[9px] font-medium">
              {modelLevels(model).length > 0 ? THINK_BUDGET_LABELS[thinkBudget] : "Think"}
            </span>
          ) : (
            <span className="rounded border border-[var(--lp-border)] px-1 py-0.5 text-[9px] font-medium text-[var(--lp-soft-text)]">
              {t("modelSelector.thinkChipOff")}
            </span>
          )
        ) : null}
        <span className="text-[var(--lp-soft-text)]">▾</span>
      </button>

      {modelOpen ? createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setModelOpen(false)} />
          <div
            className="lp-popover fixed z-[210] w-[280px] max-h-[420px] overflow-hidden rounded-[16px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
            style={{ left: modelAnchor.coords.left, bottom: modelAnchor.coords.bottom }}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px]">
              <span className="text-[var(--lp-muted)]">{t("modelSelector.modelHeading")}</span>
              <span className="text-[var(--lp-muted)]">{t("modelSelector.fromProvider", { name: localizedName(provider) })}</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto px-2 py-2">
              {provider.models.length === 0 ? (
                <div className="p-3 text-center text-[12px] text-[var(--lp-muted)]">
                  {t("modelSelector.noModelsGoConfig")}
                </div>
              ) : provider.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-[var(--lp-text)] transition ${selectedModel === m.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                  onClick={() => selectModel(m.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{m.id}</span>
                    <CapabilityChips capabilities={m.capabilities} size="sm" />
                  </span>
                  {selectedModel === m.id ? <span className="text-[#10A37F]">✓</span> : null}
                </button>
              ))}
            </div>

            {/* Think budget selector */}
            {/*
              Two layouts here:
                1. Model with granular levels  → render each level + an "Off"
                   chip. Picking a level sets thinkBudget AND toggles
                   thinkEnabled=true (otherwise the adapter would never ship
                   `reasoning_effort` for /chat/completions); picking Off
                   sets thinkEnabled=false.
                2. Model with `think: true` but no levels (binary models like
                   DeepSeek-R1 / Kimi-thinking / GLM)  → render an On/Off
                   toggle which only flips thinkEnabled.
            */}
            {hasReasoning(model) && modelLevels(model).length > 0 ? (
              <div className="border-t border-white/[0.06] px-3 py-2.5">
                <div className="mb-1.5 text-[11px] text-[var(--lp-muted)]">{t("modelSelector.reasoningEffort")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {modelLevels(model).map((b) => {
                    const active = thinkEnabled && thinkBudget === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        className={`rounded-md border px-2 py-1 text-[11px] text-[var(--lp-text)] transition ${active ? "border-[#10A37F] bg-[#10A37F]/10 text-[#10A37F]" : "border-[var(--lp-border)] hover:bg-white/[0.04]"}`}
                        onClick={() => {
                          onChangeBudget(b);
                          if (!thinkEnabled) onChangeThinkEnabled(true);
                          setModelOpen(false);
                        }}
                      >
                        {THINK_BUDGET_LABELS[b]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`rounded-md border px-2 py-1 text-[11px] transition ${!thinkEnabled ? "border-red-400/60 bg-red-400/10 text-red-300" : "border-[var(--lp-border)] text-[var(--lp-text)] hover:bg-white/[0.04]"}`}
                    onClick={() => { onChangeThinkEnabled(false); setModelOpen(false); }}
                  >
                    {t("modelSelector.reasoningOff")}
                  </button>
                </div>
              </div>
            ) : hasReasoning(model) ? (
              <div className="border-t border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-[var(--lp-muted)]">{t("modelSelector.thinkToggleLabel")}</div>
                  <button
                    type="button"
                    className={`h-5 w-9 rounded-full transition ${thinkEnabled ? "bg-[#10A37F]" : "bg-white/10"}`}
                    onClick={() => onChangeThinkEnabled(!thinkEnabled)}
                    aria-pressed={thinkEnabled}
                    title={thinkEnabled ? t("modelSelector.thinkToggleOn") : t("modelSelector.thinkToggleOff")}
                  >
                    <div className={`h-4 w-4 rounded-full bg-white shadow transition ${thinkEnabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>,
        document.body
      ) : null}
    </>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const {
    appInfo,
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
  // FIFO queue of pending tool-permission requests emitted by the agent
  // runtime over `agent:run:{runId}`. The modal renders the front of the
  // queue; when the user decides, we forward the answer to the main
  // process and dequeue. Cleared on every run terminate.
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const decidePermission = useCallback((req: PermissionRequest, decision: PermissionDecisionKind) => {
    void window.electronAPI?.answerAgentPermission?.({
      runId: req.runId,
      toolCallId: req.toolCallId,
      decision
    });
    setPermissionQueue((prev) => prev.filter((p) => p.toolCallId !== req.toolCallId));
  }, []);
  /**
   * Deny every pending permission request for a given conversation.
   * Scoped to a single conversation so the modal's "拒绝全部" button
   * doesn't reach across into sibling conversations of the same
   * project (which used to be possible when the queue was global).
   */
  const denyAllPermissionsForConversation = useCallback((conversationId: string) => {
    setPermissionQueue((prev) => {
      const denied = prev.filter((p) => p.conversationId === conversationId);
      const kept = prev.filter((p) => p.conversationId !== conversationId);
      for (const req of denied) {
        void window.electronAPI?.answerAgentPermission?.({
          runId: req.runId,
          toolCallId: req.toolCallId,
          decision: "deny"
        });
      }
      return kept;
    });
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = usePersistedState<"chat" | "modelConfig" | "project">("app.activePage", "chat");
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  /**
   * When the user clicks an EMPTY conversation that sits under a project we
   * still show the project landing page (per UX request), but we keep a
   * handle to that conversation so the first message gets attached to it
   * instead of creating a brand-new one. Cleared whenever we navigate away.
   */
  const [projectDraftConversation, setProjectDraftConversation] = useState<Conversation | null>(null);
  const [sidebarWidth, setSidebarWidth] = usePersistedState<number>("app.sidebarWidth", 280);
  const [conversationsOpen, setConversationsOpen] = usePersistedState<boolean>("sidebar.conversationsOpen", true);
  const [projectsOpen, setProjectsOpen] = usePersistedState<boolean>("sidebar.projectsOpen", true);
  const [chatProvider, setChatProvider] = usePersistedState<string>("chat.provider", AI_PROVIDERS_DEFAULT[0].id);
  const [chatModel, setChatModel] = usePersistedState<string>("chat.model", AI_PROVIDERS_DEFAULT[0].models[0].id);
  const [chatThinkBudget, setChatThinkBudget] = usePersistedState<ThinkBudget>("chat.thinkBudget", "medium");
  /**
   * Whether deep-thinking / reasoning is enabled for the next outgoing message.
   * Default `true` so reasoning-capable models behave intuitively out of the
   * box (otherwise `reasoning_effort` never ships, even when the user picks a
   * level in the model selector — see the chat-completions adapter, which only
   * appends `reasoning_effort` when `thinkEnabled` is true).
   *
   * The "active" value for any given send is `conversation.thinkEnabled` (if
   * set on the conversation row) else this UI-level toggle.
   */
  const [chatThinkEnabled, setChatThinkEnabled] = usePersistedState<boolean>("chat.thinkEnabled", true);
  const [chatModeId, setChatModeId] = usePersistedState<ChatModeId>("chat.modeId", "chat");
  const [bypassPermissions, setBypassPermissions] = useState(false);
  const [pipelineStages, setPipelineStages] = usePersistedState<PipelineStageConfig[]>(
    "pipeline.stages",
    [
      { role: "planner",  providerId: AI_PROVIDERS_DEFAULT[0]?.id ?? "", modelId: AI_PROVIDERS_DEFAULT[0]?.models[0]?.id ?? "" },
      { role: "executor", providerId: AI_PROVIDERS_DEFAULT[0]?.id ?? "", modelId: AI_PROVIDERS_DEFAULT[0]?.models[0]?.id ?? "" },
      { role: "reviewer", providerId: AI_PROVIDERS_DEFAULT[0]?.id ?? "", modelId: AI_PROVIDERS_DEFAULT[0]?.models[0]?.id ?? "" }
    ]
  );
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [providerCache, setProviderCache] = useState<Record<string, ProviderConfig>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  /**
   * Conversations that don't live under any project — these are the ones
   * the sidebar's "Conversations" (对话) section is meant to render.
   * Project-bound conversations belong only under their project node;
   * showing them in both places causes the "duplicate / mixed" bug.
   */
  const unattachedConversations = useMemo(
    () => conversations.filter((c) => !c.projectId),
    [conversations]
  );
  const [conversationPreviews, setConversationPreviews] = useState<Record<string, { role: string; content: string; createdAt: number } | null>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  /** Per-project expansion in the sidebar: when true, that project shows
   * its child conversations underneath. Independent from `projectsOpen`
   * (which collapses the entire "Projects" section). */
  const [expandedProjectIds, setExpandedProjectIds] = usePersistedState<Record<string, boolean>>(
    "sidebar.expandedProjectIds",
    {}
  );

  /**
   * Active per-conversation streams. Stored at the App level (NOT inside
   * ChatPanel) so the IPC subscription stays alive when the user switches
   * conversations or navigates to another page. When they come back, the
   * panel rehydrates from this map.
   */
  type StreamState = {
    streamId: string;
    assistantMessageId: string;
    text: string;
    reasoning: string;
    status: "streaming" | "done" | "error" | "loading";
    errorMessage?: string;
    startedAt: number;
    /** When true the `streamId` is an agent runId — cancel via
     *  `cancelAgentRun` instead of `cancelChatStream`. */
    isAgentRun?: boolean;
    /** Last context compaction notice from agent runtime. */
    compaction?: { before: number; after: number; notes: string[] };
    /** Current context budget utilization from agent runtime. */
    contextBudget?: { usedTokens: number; budgetTokens: number; windowTokens: number; compacted: boolean };
    /** Non-agent chat: signals old messages were dropped to fit context. */
    contextTrimmed?: { dropped: number; originalChars: number; finalChars: number };
    /** Pipeline stage tracking. */
    pipelineStage?: { stage: "planner" | "executor" | "reviewer"; model: string } | null;
  };
  const [activeStreams, setActiveStreams] = useState<Record<string, StreamState>>({});
  const activeStreamsRef = useRef(activeStreams);
  activeStreamsRef.current = activeStreams;

  type ContextBudgetInfo = {
    usedTokens: number;
    budgetTokens: number;
    windowTokens: number;
    compacted: boolean;
    compaction?: { before: number; after: number; notes: string[] };
    trimmed?: { dropped: number; originalChars: number; finalChars: number };
  };
  const [contextBudgets, setContextBudgets] = useState<Record<string, ContextBudgetInfo>>({});

  /**
   * Guarded conversation setter. Two jobs:
   *   1. DIAGNOSTIC: warn (with stack) whenever activeConversation transitions
   *      to `null` while a stream is in flight — this used to silently reset
   *      the chat UI to the "new conversation" hero mid-stream.
   *   2. GUARD: actually refuse the null write while any stream still has
   *      status === "streaming" — protects the user's in-progress output.
   *
   * Pass-through for any non-null write; behaves like the raw setter.
   */
  const setActiveConversationSafe = useCallback((next: Conversation | null) => {
    if (next === null) {
      const streamingIds = Object.keys(activeStreamsRef.current).filter(
        (id) => activeStreamsRef.current[id]?.status === "streaming"
      );
      if (streamingIds.length > 0) {
        console.warn(
          "[lp/conv-guard] refused to clear activeConversation while streaming:",
          streamingIds,
          new Error().stack
        );
        return;
      }
      console.info("[lp/conv-guard] activeConversation -> null (no stream in flight)");
    }
    setActiveConversation(next);
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!window.electronAPI?.listConversations) return;
    const list = await window.electronAPI.listConversations(null);
    setConversations(list);
    // Fetch last-message previews for the sidebar in a single round-trip.
    if (list.length > 0 && window.electronAPI?.getConversationPreviews) {
      const ids = list.map((c) => c.id);
      const previews = await window.electronAPI.getConversationPreviews(ids);
      setConversationPreviews(previews);
    } else {
      setConversationPreviews({});
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!window.electronAPI?.listProjects) return;
    const list = await window.electronAPI.listProjects();
    setProjects(list);
  }, []);

  /**
   * Start a chat stream for a conversation. This:
   *   1. appends the user message + assistant placeholder to DB (so they
   *      persist even if the user closes the app mid-stream)
   *   2. resolves provider credentials
   *   3. calls chat:start-stream via IPC and subscribes to chunks
   *   4. accumulates into `activeStreams[convId]` so any mount of ChatPanel
   *      can render the in-progress state
   *   5. on done/error, persists final content to DB and clears the entry
   *
   * The actual subscription unsubscribe is preserved in a ref so cancelStream
   * can detach it cleanly.
   */
  const streamUnsubsRef = useRef<Record<string, () => void>>({});
  // Ref-based provider resolver so startChatStream can be declared above
  // resolveProvider without TDZ. The ref is updated by an effect once
  // resolveProvider is in scope.
  const resolveProviderRef = useRef<((id: string) => Promise<{ apiKey: string; baseUrl: string; protocol: string } | null>) | null>(null);

  const startChatStream = useCallback(async (params: {
    conversation: Conversation;
    /**
     * Text of the new user message to append. When this is `null`/`undefined`
     * we treat this as a RETRY — we don't write a new user row, we just
     * re-run the assistant pipeline against the existing tail user message.
     */
    userText?: string | null;
    providerId: string;
    modelId: string;
    thinkBudget: ThinkBudget;
    thinkEnabled: boolean;
    modeId: string;
    attachments?: ChatAttachment[];
    /**
     * When set, this prior assistant message (a failed placeholder or an
     * `⚠️` error marker) is deleted BEFORE we list context and start a
     * fresh stream. Used by the retry button on a failed bubble.
     */
    retryFromAssistantId?: string;
  }): Promise<{ ok: true } | { ok: false; reason: "no-api" | "no-key" | "no-provider" | "send-failed"; message?: string }> => {
    const api = window.electronAPI;
    if (!api?.startChatStream || !api.appendMessage || !api.onChatStream) return { ok: false, reason: "no-api" };
    const resolve = resolveProviderRef.current;
    if (!resolve) return { ok: false, reason: "no-api" };
    const providerInfo = await resolve(params.providerId);
    if (!providerInfo) return { ok: false, reason: "no-provider" };
    if (!providerInfo.apiKey) return { ok: false, reason: "no-key" };

    // ── Agent runtime route ────────────────────────────────────────────
    // Project conversations on the "agent" mode go through the new
    // agent runtime (queryLoop + tools) instead of the plain chat
    // stream. The runtime takes ownership of message persistence,
    // tool-call execution, and permission prompts; the UI subscribes to
    // a per-run channel and re-renders the conversation from
    // `message_part` rows. v0 limitation: retries on agent runs simply
    // re-send the last user text rather than reusing message ids.
    if (
      (params.modeId === "agent" ||
        params.modeId === "plan" ||
        params.modeId === "pipeline") &&
      params.conversation.projectId &&
      api.startAgentRun &&
      api.onAgentRun
    ) {
      const convId = params.conversation.id;
      const userText = params.userText ?? "";
      if (!userText.trim() && !params.attachments?.length) {
        return { ok: false, reason: "send-failed", message: "empty message" };
      }
      const modelDef = AI_PROVIDERS_DEFAULT
        .find((p) => p.id === params.providerId)?.models
        .find((m) => m.id === params.modelId);
      const thinkProtocol = modelDef?.thinkProtocol ?? null;
      let started: { runId: string };
      try {
        started = await api.startAgentRun({
          projectId: params.conversation.projectId,
          conversationId: convId,
          userMessage: userText,
          providerId: params.providerId,
          protocol: providerInfo.protocol,
          baseUrl: providerInfo.baseUrl,
          apiKey: providerInfo.apiKey,
          model: params.modelId,
          temperature: undefined,
          thinkEnabled: params.thinkEnabled,
          thinkBudget: params.thinkBudget,
          thinkProtocol,
          modeId: params.modeId,
          language: i18n.language === "en" ? "en" : "zh-CN",
          ...(params.modeId === "pipeline" ? { pipelineStages } : {})
        });
      } catch (e) {
        return { ok: false, reason: "send-failed", message: (e as Error).message };
      }
      setActiveStreams((prev) => ({
        ...prev,
        [convId]: {
          // Reuse the existing live-stream shape so the ChatPanel
          // header dot / cancel button work without changes.
          streamId: started.runId,
          assistantMessageId: "",
          text: "",
          reasoning: "",
          status: "streaming",
          startedAt: Date.now(),
          isAgentRun: true
        }
      }));
      const unsubscribe = api.onAgentRun(started.runId, (ev) => {
        // Permission requests get pushed into the global queue; the
        // PermissionApprovalModal renders the front element FOR THE
        // CURRENTLY ACTIVE CONVERSATION ONLY (see filter at render
        // site). Tagging each request with `convId` is what keeps the
        // prompt from leaking into sibling conversations of the same
        // project — that was the "你好/你是什么模型 both showing
        // ListDir" bug.
        if (ev.kind === "permission_request") {
          setPermissionQueue((prev) => {
            if (prev.some((p) => p.toolCallId === ev.toolCallId)) return prev;
            return [
              ...prev,
              {
                runId: started.runId,
                conversationId: convId,
                toolCallId: ev.toolCallId,
                toolName: ev.toolName,
                input: ev.input,
                uiPreview: ev.uiPreview
              }
            ];
          });
        }
        if (ev.kind === "terminal") {
          // Drop any leftover permission requests tied to this run — the
          // runtime auto-denies them on its side once the loop unwinds.
          setPermissionQueue((prev) => prev.filter((p) => p.runId !== started.runId));
        }
        setActiveStreams((prev) => {
          const cur = prev[convId];
          if (!cur) return prev;
          if (ev.kind === "llm") {
            const e = ev.event;
            if (e.type === "text_delta") {
              return { ...prev, [convId]: { ...cur, text: cur.text + e.text } };
            }
            if (e.type === "reasoning_delta") {
              return { ...prev, [convId]: { ...cur, reasoning: cur.reasoning + e.text } };
            }
            if (e.type === "error") {
              return { ...prev, [convId]: { ...cur, status: "error", errorMessage: e.message } };
            }
          }
          if (ev.kind === "context_compacted") {
            return { ...prev, [convId]: { ...cur, compaction: { before: ev.before, after: ev.after, notes: ev.notes } } };
          }
          if (ev.kind === "context_budget") {
            return { ...prev, [convId]: { ...cur, contextBudget: { usedTokens: ev.usedTokens, budgetTokens: ev.budgetTokens, windowTokens: ev.windowTokens, compacted: ev.compacted } } };
          }
          if (ev.kind === "stage_enter") {
            return { ...prev, [convId]: { ...cur, pipelineStage: { stage: ev.stage, model: ev.model } } };
          }
          if (ev.kind === "stage_exit") {
            return { ...prev, [convId]: { ...cur, pipelineStage: null } };
          }
          if (ev.kind === "terminal") {
            return {
              ...prev,
              [convId]: {
                ...cur,
                status: ev.reason === "completed" ? "done" : "error",
                errorMessage: ev.reason === "completed" ? undefined : ev.message ?? ev.reason,
                pipelineStage: null
              }
            };
          }
          return prev;
        });
        if (ev.kind === "context_compacted") {
          setContextBudgets((prev) => ({
            ...prev,
            [convId]: { ...prev[convId], usedTokens: ev.after, budgetTokens: prev[convId]?.budgetTokens ?? 0, windowTokens: prev[convId]?.windowTokens ?? 0, compacted: true, compaction: { before: ev.before, after: ev.after, notes: ev.notes } }
          }));
        }
        if (ev.kind === "context_budget") {
          setContextBudgets((prev) => ({
            ...prev,
            [convId]: { ...prev[convId], usedTokens: ev.usedTokens, budgetTokens: ev.budgetTokens, windowTokens: ev.windowTokens, compacted: ev.compacted, compaction: prev[convId]?.compaction }
          }));
        }
        if (ev.kind === "message_persisted") {
          void refreshConversations();
        }
        if (ev.kind === "terminal") {
          const dispose = streamUnsubsRef.current[convId];
          if (dispose) {
            dispose();
            delete streamUnsubsRef.current[convId];
          }
          void refreshConversations();
          setTimeout(() => {
            setActiveStreams((prev) => {
              const next = { ...prev };
              delete next[convId];
              return next;
            });
          }, 500);
        }
      });
      streamUnsubsRef.current[convId] = unsubscribe;
      void refreshConversations();
      return { ok: true };
    }

    // If this is a retry, drop the failed assistant row first so it's not
    // listed in context (and the UI bubble disappears immediately when we
    // refresh messages a few lines down).
    if (params.retryFromAssistantId && api.deleteMessage) {
      try { await api.deleteMessage(params.retryFromAssistantId); } catch { /* ignore */ }
    }

    // Persist the user message + assistant placeholder to DB up front. Main
    // process auto-titles on the first user message; this also makes the
    // sidebar preview update immediately. On retry we skip the user-append
    // because the original user message is still in the DB.
    if (params.userText != null) {
      const userMsg = await api.appendMessage({
        conversationId: params.conversation.id,
        role: "user",
        content: params.userText,
        attachments: params.attachments && params.attachments.length > 0 ? params.attachments : null
      });
      void userMsg;
    }
    const placeholderAssistant = await api.appendMessage({
      conversationId: params.conversation.id,
      role: "assistant",
      content: "",
      reasoning: null
    });

    // Load the persisted history for the context window. The main-process
    // compressMessages() will trim further per the active mode's budget.
    //
    // Filter rules:
    //   1. Exclude this turn's own placeholder assistant (still empty).
    //   2. Exclude ANY message whose content is blank AND has no attachments
    //      — these are leftover placeholders from previously cancelled /
    //      failed / network-errored streams. Sending them to OpenAI /
    //      Moonshot-compatible endpoints triggers: "the message at position N
    //      with role 'assistant' must not be empty".
    //      Note: a user message with image attachments but empty text is
    //      perfectly valid (vision-only prompt), so we keep it.
    const persistedMessages = await api.listMessages(params.conversation.id);
    const contextMessages = persistedMessages
      .filter((m) => m.id !== placeholderAssistant.id)
      .filter((m) => (m.content ?? "").trim().length > 0 || (m.attachments && m.attachments.length > 0))
      .map((m) => ({ role: m.role, content: m.content, reasoning: m.reasoning, attachments: m.attachments }));

    // Resolve the model's reasoning protocol from the catalog so the adapter
    // can map thinkBudget → reasoning_effort / budget_tokens / thinkingBudget
    // correctly. `null` (rather than `undefined`) is sent to the main process
    // to mean "model has no reasoning at all" — distinct from "renderer didn't
    // know yet" which legacy builds emit as `undefined`.
    const modelDef = AI_PROVIDERS_DEFAULT
      .find((p) => p.id === params.providerId)?.models
      .find((m) => m.id === params.modelId);
    const thinkProtocol = modelDef?.thinkProtocol ?? null;

    let started: { streamId: string };
    try {
      started = await api.startChatStream({
        providerId: params.providerId,
        protocol: providerInfo.protocol,
        baseUrl: providerInfo.baseUrl,
        apiKey: providerInfo.apiKey,
        model: params.modelId,
        messages: contextMessages,
        thinkEnabled: params.thinkEnabled,
        thinkBudget: params.thinkBudget,
        thinkProtocol,
        conversationId: params.conversation.id,
        assistantMessageId: placeholderAssistant.id,
        modeId: params.modeId
      });
    } catch (e) {
      return { ok: false, reason: "send-failed", message: (e as Error).message };
    }

    const convId = params.conversation.id;
    setActiveStreams((prev) => ({
      ...prev,
      [convId]: {
        streamId: started.streamId,
        assistantMessageId: placeholderAssistant.id,
        text: "",
        reasoning: "",
        status: "streaming",
        startedAt: Date.now()
      }
    }));

    // Watchdog: if no events arrive for a long time, force the stream to end
    // so the sidebar dot doesn't spin forever in the unlikely case the main
    // process safety timeouts also fail. Re-armed on every received event.
    const WATCHDOG_MS = 90_000;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const finalize = (errorMessage?: string) => {
      const dispose = streamUnsubsRef.current[convId];
      if (dispose) {
        dispose();
        delete streamUnsubsRef.current[convId];
      }
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (errorMessage) {
        setActiveStreams((prev) => {
          const cur = prev[convId];
          if (!cur) return prev;
          return { ...prev, [convId]: { ...cur, status: "error", errorMessage } };
        });
      }
      void refreshConversations();
      setTimeout(() => {
        setActiveStreams((prev) => {
          const next = { ...prev };
          delete next[convId];
          return next;
        });
      }, 500);
    };
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        console.warn(`[chat] renderer watchdog: no events for ${WATCHDOG_MS}ms, conv=${convId}, force-ending`);
        void window.electronAPI?.cancelChatStream?.(started.streamId);
        finalize(t("chatStream.timeoutAutoStopped"));
      }, WATCHDOG_MS);
    };
    armWatchdog();

    const unsubscribe = api.onChatStream(started.streamId, (ev) => {
      armWatchdog();
      setActiveStreams((prev) => {
        const cur = prev[convId];
        if (!cur) return prev;
        if (ev.type === "text") {
          return { ...prev, [convId]: { ...cur, text: cur.text + ev.text } };
        }
        if (ev.type === "reasoning") {
          return { ...prev, [convId]: { ...cur, reasoning: cur.reasoning + ev.text } };
        }
        if (ev.type === "error") {
          return { ...prev, [convId]: { ...cur, status: "error", errorMessage: ev.message } };
        }
        if (ev.type === "done") {
          return { ...prev, [convId]: { ...cur, status: "done" } };
        }
        if (ev.type === "context_trimmed") {
          return { ...prev, [convId]: { ...cur, contextTrimmed: { dropped: ev.dropped, originalChars: ev.originalChars, finalChars: ev.finalChars } } };
        }
        return prev;
      });
      if (ev.type === "context_trimmed") {
        setContextBudgets((prev) => ({
          ...prev,
          [convId]: { ...prev[convId], usedTokens: 0, budgetTokens: 0, windowTokens: 0, compacted: false, trimmed: { dropped: ev.dropped, originalChars: ev.originalChars, finalChars: ev.finalChars } }
        }));
      }
      if (ev.type === "done" || ev.type === "error") {
        finalize();
      }
    });
    streamUnsubsRef.current[convId] = unsubscribe;

    // Update the sidebar immediately to reflect the new user message + auto-title.
    void refreshConversations();
    return { ok: true };
  }, [refreshConversations, t]);

  const cancelChatStream = useCallback((conversationId: string) => {
    const cur = activeStreamsRef.current[conversationId];
    if (!cur) return;
    if (cur.isAgentRun) {
      void window.electronAPI?.cancelAgentRun?.(cur.streamId);
    } else {
      void window.electronAPI?.cancelChatStream?.(cur.streamId);
    }
    setActiveStreams((prev) => {
      const next = { ...prev };
      if (next[conversationId]) {
        next[conversationId] = { ...next[conversationId], status: "done" };
      }
      return next;
    });
  }, []);

  const toggleBypassPermissions = useCallback((next: boolean) => {
    setBypassPermissions(next);
    void window.electronAPI?.setBypassPermissions?.(next);
  }, []);

  /**
   * Re-run the assistant pipeline for an existing conversation without
   * appending another user message. The failed assistant placeholder
   * (`failedAssistantId`) is deleted first so the UI cleanly replaces it.
   *
   * Caller responsibility: only invoke when the panel detected a failed /
   * empty assistant tail. Returns the same shape as `startChatStream`.
   */
  const retryChatStream = useCallback(async (params: {
    conversation: Conversation;
    failedAssistantId: string;
  }) => {
    const conv = params.conversation;
    return startChatStream({
      conversation: conv,
      userText: null,
      providerId: conv.providerId ?? chatProvider,
      modelId: conv.modelId ?? chatModel,
      thinkBudget: (conv.thinkBudget as ThinkBudget) ?? chatThinkBudget,
      // Fall back to the UI-level toggle for legacy rows where thinkEnabled
      // was never set (older builds hard-coded `false` on every conversation
      // create, so even reasoning models never shipped reasoning_effort).
      thinkEnabled: conv.thinkEnabled ?? chatThinkEnabled,
      modeId: (conv.modeId as string) ?? chatModeId,
      retryFromAssistantId: params.failedAssistantId
    });
  }, [startChatStream, chatProvider, chatModel, chatThinkBudget, chatThinkEnabled, chatModeId]);

  /**
   * "Execute as Agent" handoff: invoked when the user clicks the button at
   * the end of a plan-mode assistant reply. Flips the conversation's mode
   * to "agent", persists that, and immediately dispatches a new user
   * message containing the plan as the first instruction the Agent sees.
   *
   * The mode flip is persisted so subsequent messages in the same
   * conversation default to Agent — the user only commits once.
   */
  const executePlanAsAgent = useCallback(async (planText: string) => {
    const conv = activeConversation;
    if (!conv) return;
    if (!window.electronAPI?.updateConversation) return;
    const updated = await window.electronAPI.updateConversation(conv.id, { modeId: "agent" });
    const effective = updated ?? { ...conv, modeId: "agent" };
    if (updated) setActiveConversation(updated);
    await refreshConversations();
    await startChatStream({
      conversation: effective,
      userText: `请按下面的计划执行：\n\n${planText}`,
      providerId: effective.providerId ?? chatProvider,
      modelId: effective.modelId ?? chatModel,
      thinkBudget: (effective.thinkBudget as ThinkBudget) ?? chatThinkBudget,
      thinkEnabled: effective.thinkEnabled ?? chatThinkEnabled,
      modeId: "agent"
    });
  }, [
    activeConversation,
    refreshConversations,
    startChatStream,
    chatProvider,
    chatModel,
    chatThinkBudget,
    chatThinkEnabled
  ]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  // After a reload, `activePage` is restored from localStorage but
  // `activeProject` is not — if we land on the project page without a
  // selected project we'd render nothing. Fall back to chat in that case.
  useEffect(() => {
    if (activePage === "project" && !activeProject) {
      setActivePage("chat");
    }
  }, [activePage, activeProject, setActivePage]);

  const handleNewConversation = useCallback(async (projectId: string | null = null) => {
    const api = window.electronAPI;
    if (!api?.createConversation) return;
    // Only seed thinkEnabled when the chosen model actually supports reasoning;
    // otherwise we'd ship a stale `true` to a non-reasoning model (harmless on
    // the wire because the adapter still wouldn't add `reasoning_effort`, but
    // misleading in the UI).
    const modelDef = AI_PROVIDERS_DEFAULT
      .find((p) => p.id === chatProvider)?.models
      .find((m) => m.id === chatModel);
    const seedThinkEnabled = hasReasoning(modelDef) && chatThinkEnabled;
    const seedModeId: ChatModeId = projectId ? "agent" : chatModeId;
    const conv = await api.createConversation({
      projectId,
      name: t("sidebar.newConversation"),
      providerId: chatProvider,
      modelId: chatModel,
      thinkBudget: chatThinkBudget,
      thinkEnabled: seedThinkEnabled,
      modeId: seedModeId
    });
    setActiveConversation(conv);
    if (projectId) {
      // Make sure the parent project is expanded so the new conv is visible.
      setExpandedProjectIds((prev) => ({ ...prev, [projectId]: true }));
      // Route a brand-new under-project conversation to the project landing
      // page (per UX). The landing composer will reuse this conv on first send.
      const proj = projects.find((p) => p.id === projectId);
      if (proj) {
        setActiveProject(proj);
        setProjectDraftConversation(conv);
        setActivePage("project");
      } else {
        setActivePage("chat");
      }
    } else {
      setActivePage("chat");
    }
    await refreshConversations();
  }, [chatProvider, chatModel, chatThinkBudget, chatThinkEnabled, chatModeId, projects, refreshConversations, setActivePage, setExpandedProjectIds, t]);

  const handleCreateProject = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.createProject || !api?.pickDirectory) return;
    // Step 1: open the native folder picker. User cancellation is a no-op.
    const path = await api.pickDirectory();
    if (!path) return;
    // Derive a default project name from the folder's basename. We work in
    // the renderer so we can't import node:path — split on both separators
    // to handle Windows + POSIX paths the same way.
    const basename = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const name = basename || t("sidebar2.untitledProject");
    const project = await api.createProject({ name, path });
    await refreshProjects();
    setProjectsOpen(true);
    setExpandedProjectIds((prev) => ({ ...prev, [project.id]: true }));
  }, [refreshProjects, setExpandedProjectIds, setProjectsOpen, t]);

  const handleDeleteProject = useCallback(async (project: Project) => {
    const api = window.electronAPI;
    if (!api?.deleteProject) return;
    const ok = window.confirm(t("sidebar2.confirmDeleteProject", { name: project.name }));
    if (!ok) return;
    await api.deleteProject(project.id);
    // If active conversation belonged to this project, clear it.
    if (activeConversation && activeConversation.projectId === project.id) {
      setActiveConversationSafe(null);
    }
    // If the project landing page was showing this project, navigate away.
    if (activeProject?.id === project.id) {
      setActiveProject(null);
      setProjectDraftConversation(null);
      setActivePage("chat");
    }
    await Promise.all([refreshProjects(), refreshConversations()]);
  }, [activeConversation, activeProject, refreshConversations, refreshProjects, setActivePage, setActiveConversationSafe, t]);

  const toggleProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }, [setExpandedProjectIds]);

  const handleOpenProject = useCallback((project: Project, draftConv: Conversation | null = null) => {
    setActiveProject(project);
    setProjectDraftConversation(draftConv);
    setActivePage("project");
    setExpandedProjectIds((prev) => ({ ...prev, [project.id]: true }));
    // NOTE: We intentionally do NOT touch the global `chatModeId` here. The
    // global "对话" page's mode selector is the user's preference for casual
    // chat and should survive project navigation. Project conversations are
    // pinned to Agent at creation time (see `onEnsureConversation` and
    // `handleNewConversation`), and their toolbar locks the dropdown to Agent.
  }, [setActivePage, setExpandedProjectIds]);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    // If the conversation lives under a project AND has no messages yet,
    // route to the project landing page with this conversation pre-attached
    // (the first send will reuse it instead of creating another one).
    if (conv.projectId) {
      const preview = conversationPreviews[conv.id];
      const isEmpty = preview === null || preview === undefined;
      if (isEmpty) {
        const proj = projects.find((p) => p.id === conv.projectId);
        if (proj) {
          handleOpenProject(proj, conv);
          setActiveConversation(conv);
          return;
        }
      }
    }
    setActiveConversation(conv);
    setActivePage("chat");
  }, [setActivePage, conversationPreviews, projects, handleOpenProject]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    if (!window.electronAPI?.deleteConversation) return;
    await window.electronAPI.deleteConversation(id);
    if (activeConversation?.id === id) setActiveConversationSafe(null);
    await refreshConversations();
  }, [activeConversation, refreshConversations, setActiveConversationSafe]);

  // Refresh cached provider configs whenever the AI config page may have changed them.
  const refreshProviderCache = useCallback(async () => {
    if (!window.electronAPI?.getAllProviderConfigs) return;
    const list = await window.electronAPI.getAllProviderConfigs();
    const map: Record<string, ProviderConfig> = {};
    for (const p of list) map[p.id] = p;
    setProviderCache(map);
    console.info(
      "[ProviderCache] refreshed:",
      list.map((p) => ({ id: p.id, enabled: p.enabled, apiKeyLen: p.apiKey?.length ?? 0, apiKeyPreview: p.apiKey ? `${p.apiKey.slice(0,4)}…(${p.apiKey.length})` : "<empty>", baseUrl: p.baseUrl, protocol: p.protocol }))
    );
  }, []);

  useEffect(() => { void refreshProviderCache(); }, [refreshProviderCache, activePage]);

  // Auto-pick a usable provider for chat mode whenever the current chat
  // provider has no usable API key but another provider does.
  useEffect(() => {
    const currentCfg = providerCache[chatProvider];
    const currentOk = !!(currentCfg?.enabled && currentCfg.apiKey);
    if (currentOk) return;
    // Find first provider with a usable key.
    const usable = Object.values(providerCache).find((p) => p.enabled && p.apiKey);
    if (!usable) return;
    const def = AI_PROVIDERS_DEFAULT.find((p) => p.id === usable.id);
    setChatProvider(usable.id);
    if (def && def.models.length > 0) setChatModel(def.models[0].id);
  }, [providerCache, chatProvider, setChatProvider, setChatModel]);

  // Provide ChatPanel a way to resolve provider credentials at send time.
  const resolveProvider = useCallback(async (providerId: string) => {
    const api = window.electronAPI;
    if (!api?.getProviderConfig) return null;
    let cfg = providerCache[providerId];
    if (!cfg) {
      const fetched = await api.getProviderConfig(providerId);
      if (fetched) {
        cfg = fetched;
        setProviderCache((prev) => ({ ...prev, [providerId]: fetched }));
      }
    }
    if (!cfg) return null;
    const fallbackProtocol =
      providerId === "anthropic" ? "anthropic-messages" :
      providerId === "google" ? "google-gemini" :
      "openai-chat";
    return {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl || (AI_PROVIDERS_DEFAULT.find((p) => p.id === providerId)?.baseUrl ?? ""),
      protocol: cfg.protocol || fallbackProtocol
    };
  }, [providerCache]);

  // Keep the ref in sync so startChatStream (declared earlier) can call it.
  useEffect(() => { resolveProviderRef.current = resolveProvider; }, [resolveProvider]);

  const ensureConversation = useCallback(async (): Promise<Conversation> => {
    if (activeConversation) return activeConversation;
    const api = window.electronAPI;
    if (!api?.createConversation) throw new Error("conversation API unavailable");
    const modelDef = AI_PROVIDERS_DEFAULT
      .find((p) => p.id === chatProvider)?.models
      .find((m) => m.id === chatModel);
    const seedThinkEnabled = hasReasoning(modelDef) && chatThinkEnabled;
    const conv = await api.createConversation({
      projectId: null,
      name: "New Conversation",
      providerId: chatProvider,
      modelId: chatModel,
      thinkBudget: chatThinkBudget,
      thinkEnabled: seedThinkEnabled,
      modeId: chatModeId
    });
    setActiveConversation(conv);
    void refreshConversations();
    return conv;
  }, [activeConversation, chatProvider, chatModel, chatThinkBudget, chatThinkEnabled, chatModeId, refreshConversations]);

  // When the user opens a saved conversation, restore its mode in the UI selector.
  useEffect(() => {
    if (activeConversation && activeConversation.modeId) {
      setChatModeId(activeConversation.modeId as ChatModeId);
    }
  }, [activeConversation, setChatModeId]);

  /**
   * Context-budget snapshot on conversation load.
   *
   * Before this effect existed, the `ContextRing` indicator stayed
   * invisible until the user sent ANOTHER message — the budget data
   * only landed via the `context_budget` stream event mid-turn. When
   * users opened an existing conversation, the ring just wasn't there.
   *
   * Now: every time a conversation becomes active (or the user changes
   * model / think settings while inside one), we ask the main process
   * for a one-shot snapshot of `(used, budget, window)` based on the
   * persisted history. We skip if a stream is in flight for this
   * conversation — the live stream's own `context_budget` event is the
   * source of truth in that case.
   */
  useEffect(() => {
    const convId = activeConversation?.id;
    if (!convId) return;
    if (activeStreamsRef.current[convId]?.status === "streaming") return;

    const effectiveModel = activeConversation.modelId ?? chatModel;
    const effectiveThinkBudget: ThinkBudget = activeConversation.thinkBudget
      ? (activeConversation.thinkBudget as ThinkBudget)
      : chatThinkBudget;
    const effectiveThinkEnabled =
      activeConversation.thinkEnabled ?? chatThinkEnabled;
    const snapshotThinkBudget: ThinkBudget = effectiveThinkEnabled
      ? effectiveThinkBudget
      : "none";

    let cancelled = false;
    void (async () => {
      try {
        const snap = await window.electronAPI.agentContextSnapshot({
          conversationId: convId,
          model: effectiveModel,
          thinkBudget: snapshotThinkBudget
        });
        if (cancelled) return;
        setContextBudgets((prev) => {
          // Preserve any existing `trimmed` / `compaction` data — those
          // came from real stream events and are more authoritative than
          // a fresh estimate.
          const existing = prev[convId];
          return {
            ...prev,
            [convId]: {
              ...existing,
              usedTokens: snap.usedTokens,
              budgetTokens: snap.budgetTokens,
              windowTokens: snap.windowTokens,
              compacted: existing?.compacted ?? snap.compacted
            }
          };
        });
      } catch (e) {
        console.warn("[lp/context-snapshot] failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeConversation?.id,
    activeConversation?.modelId,
    activeConversation?.thinkBudget,
    activeConversation?.thinkEnabled,
    chatModel,
    chatThinkBudget,
    chatThinkEnabled
  ]);

  /**
   * Tracer: log every transition of `activeConversation`. Helps catch the
   * elusive "mid-stream jump back to new-conversation hero" bug — the log
   * line will show whether a stream was in flight at the moment of the
   * transition. Cheap to leave on; safe to delete once the bug is closed.
   */
  const prevActiveConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevActiveConvIdRef.current;
    const next = activeConversation?.id ?? null;
    if (prev !== next) {
      const streamingIds = Object.keys(activeStreamsRef.current).filter(
        (id) => activeStreamsRef.current[id]?.status === "streaming"
      );
      console.info(
        `[lp/conv-trace] activeConversation: ${prev ?? "null"} -> ${next ?? "null"}`,
        streamingIds.length > 0 ? { streamingIds } : ""
      );
      prevActiveConvIdRef.current = next;
    }
  }, [activeConversation]);

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
    const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI;
    console.info(
      "[Preload Diagnostic] electronAPI =",
      api,
      "keys =",
      api ? Object.keys(api).sort() : "<undefined>",
      "hasCheckConnectivity =",
      typeof api?.checkConnectivity
    );
  }, []);

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
    const selectedBackground = backgroundClassMap[background] ?? backgroundClassMap.dark;
    const rawText = textClassMap[text] ?? textClassMap.ivory;

    // Light backgrounds need a dark-ink text family to stay readable. If the
    // user previously selected a light text color (e.g. ivory, snow) for the
    // dark shell, we fall back to a darker family at render time so the UI
    // doesn't end up white-on-white. We don't mutate the stored preference —
    // switching back to a dark background restores the original color.
    const lightTextColors = new Set(["ivory", "warm-white", "cream", "snow", "linen", "pearl", "soft-gold"]);
    const selectedText = background === "light" && lightTextColors.has(text)
      ? textClassMap.charcoal
      : rawText;

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

  function saveAppearance(next: AppearanceSettings) {
    // Apply all four UI states in one synchronous block so React batches them
    // into a single render. Then kick off i18n + DB persistence — i18n
    // resources are inlined and `changeLanguage` resolves synchronously for
    // already-loaded languages, so the visual result is one atomic update
    // instead of the "double flash" we used to see when each `await`
    // boundary triggered its own re-render.
    setTheme(next.theme);
    setBackground(next.background);
    setText(next.text);
    setLanguage(next.language);
    if (i18n.language !== next.language) {
      void i18n.changeLanguage(next.language);
    }
    // Persist to DB in the background — store is already the source of truth
    // for the UI; we don't need to re-apply the round-tripped value unless
    // it actually differs (rare, but kept for correctness).
    if (window.electronAPI?.setAppearanceSettings) {
      void window.electronAPI.setAppearanceSettings(next).then((saved) => {
        if (!saved) return;
        if (saved.theme !== next.theme) setTheme(saved.theme);
        if (saved.background !== next.background) setBackground(saved.background);
        if (saved.text !== next.text) setText(saved.text);
        if (saved.language !== next.language) {
          setLanguage(saved.language);
          void i18n.changeLanguage(saved.language);
        }
      });
    }
  }

  function toggleLanguage() {
    const next = language === "zh-CN" ? "en" : "zh-CN";
    saveAppearance({
      theme,
      background,
      text,
      language: next
    });
  }

  return (
    <div
      className="h-screen overflow-hidden bg-[var(--lp-bg)] text-[var(--lp-text)] [font-family:'PingFang_SC','HarmonyOS_Sans_SC','Helvetica_Neue',Inter,system-ui,sans-serif] [font-feature-settings:'ss01','cv11'] antialiased"
      data-bg={background}
      style={shellStyle}
    >
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="flex flex-shrink-0 flex-col bg-[var(--lp-side-bg)] px-3 pb-3 pt-0 backdrop-blur-xl" style={{ width: sidebarWidth, height: '100vh' }}>
          {/* macOS traffic-light spacer + header (draggable) */}
          <div
            className="flex h-[52px] items-center justify-center px-2"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="text-[15px] font-semibold tracking-tight text-[var(--lp-text)]">
              🥜 Little Peanut
            </div>
          </div>

          {/* Top nav */}
          <nav className="mt-2 flex flex-col gap-0.5">
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition hover:bg-white/[0.04] ${activePage === "chat" && !activeConversation ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"}`}
              onClick={() => {
                setActiveConversation(null);
                setActivePage("chat");
                if (!STANDALONE_CHAT_MODE_IDS.includes(chatModeId)) {
                  setChatModeId("chat");
                }
              }}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center text-[15px] text-[var(--lp-text)]/72">💬</span>
              <span>{t("sidebar.chatMode")}</span>
            </button>
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition hover:bg-white/[0.04] ${activePage === "modelConfig" ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"}`}
              onClick={() => setActivePage("modelConfig")}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center text-[15px] text-[var(--lp-text)]/72">⚙</span>
              <span>{t("sidebar.modelConfig")}</span>
            </button>
          </nav>

          {/* Scrollable middle area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Projects */}
          <div className="mt-5 flex items-center justify-between px-3">
            <button
              type="button"
              className="flex flex-1 items-center gap-1.5 rounded-md py-1 text-[12px] text-[var(--lp-soft-text)] hover:text-[var(--lp-text)]/85"
              onClick={() => setProjectsOpen((v) => !v)}
              aria-expanded={projectsOpen}
              title={projectsOpen ? t("sidebar2.collapse") : t("sidebar2.expand")}
            >
              <svg
                width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                className="shrink-0 transition-transform"
                style={{ transform: projectsOpen ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t("sidebar.projects")}</span>
              <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] leading-[18px] text-[var(--lp-soft-text)]">
                {projects.length}
              </span>
            </button>
            <div className="flex items-center gap-1 text-[var(--lp-soft-text)]">
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05] hover:text-[var(--lp-text)]"
                title={t("sidebar2.newProjectBtn")}
                onClick={(e) => { e.stopPropagation(); void handleCreateProject(); }}
                type="button"
              >＋</button>
            </div>
          </div>

          {projectsOpen ? (
            projects.length === 0 ? (
              <div className="mt-2 px-3 text-[12px] text-[var(--lp-soft-text)]">
                {t("sidebar2.emptyProjects")}
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-0.5 px-1">
                {projects.map((p) => {
                  const expanded = !!expandedProjectIds[p.id];
                  const projectConvs = conversations.filter((c) => c.projectId === p.id);
                  const isActiveProject = activePage === "project" && activeProject?.id === p.id;
                  return (
                    <div key={p.id} className="group/project">
                      <div className={`flex items-center justify-between rounded-xl px-2 py-2 transition hover:bg-white/[0.04] ${isActiveProject ? "bg-white/[0.06]" : ""}`}>
                        {/* Chevron — toggles expansion only */}
                        <button
                          type="button"
                          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--lp-soft-text)] hover:bg-white/[0.06] hover:text-[var(--lp-text)]"
                          onClick={(e) => { e.stopPropagation(); toggleProjectExpanded(p.id); }}
                          title={expanded ? t("sidebar2.collapse") : t("sidebar2.expand")}
                          aria-label={expanded ? t("sidebar2.collapse") : t("sidebar2.expand")}
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                            className="transition-transform"
                            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                          >
                            <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        {/* Project body — clicking opens the project landing page */}
                        <button
                          type="button"
                          className="flex flex-1 min-w-0 items-center gap-2 text-left"
                          onClick={() => handleOpenProject(p)}
                          title={p.path ? `${p.name}\n${p.path}` : p.name}
                        >
                          <span className="text-[15px] text-[var(--lp-text)]/72">📁</span>
                          <span className="flex flex-1 min-w-0 flex-col">
                            <span className={`truncate text-[14px] font-medium ${isActiveProject ? "text-[var(--lp-text)]" : "text-[var(--lp-text)]/88"}`}>{p.name}</span>
                            {p.path ? (
                              <span className="truncate text-[10.5px] leading-tight text-[var(--lp-soft-text)]">{p.path}</span>
                            ) : null}
                          </span>
                        </button>
                        <div className="ml-1 flex shrink-0 items-center gap-0.5">
                          <span className="text-[12px] text-[var(--lp-soft-text)] opacity-100 group-hover/project:opacity-0">
                            {projectConvs.length}
                          </span>
                          <button
                            type="button"
                            className="hidden h-5 w-5 items-center justify-center rounded text-[14px] leading-none text-[var(--lp-soft-text)] hover:bg-white/[0.06] hover:text-[var(--lp-text)] group-hover/project:flex"
                            onClick={(e) => { e.stopPropagation(); void handleNewConversation(p.id); }}
                            title={t("sidebar2.newConvUnderProject")}
                          >＋</button>
                          <button
                            type="button"
                            className="hidden h-5 w-5 items-center justify-center rounded text-[14px] leading-none text-[var(--lp-soft-text)] hover:bg-red-500/10 hover:text-red-400 group-hover/project:flex"
                            onClick={(e) => { e.stopPropagation(); void handleDeleteProject(p); }}
                            title={t("sidebar2.deleteProject")}
                          >×</button>
                        </div>
                      </div>
                      {expanded ? (
                        projectConvs.length === 0 ? (
                          <div className="mb-1 ml-9 mt-0.5 text-[12px] text-[var(--lp-soft-text)]">
                            {t("sidebar2.emptyProjectConvs")}
                          </div>
                        ) : (
                          <div className="mb-1 ml-7 mt-0.5 flex flex-col gap-0.5">
                            {projectConvs.map((c) => {
                              const active = activeConversation?.id === c.id;
                              const mode = CHAT_MODE_MAP[(c.modeId as ChatModeId) ?? "chat"] ?? CHAT_MODE_MAP.chat;
                              const stream = activeStreams[c.id];
                              const isLiveStreaming = stream?.status === "streaming";
                              return (
                                <div
                                  key={c.id}
                                  className={`group/conv flex items-center gap-1 rounded-lg pr-1 transition hover:bg-white/[0.04] ${
                                    active ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className="flex flex-1 min-w-0 items-center gap-2 truncate px-2 py-1.5 text-left text-[13px]"
                                    onClick={() => handleSelectConversation(c)}
                                    title={c.name}
                                  >
                                    <span className="relative text-[12px] leading-none opacity-90">
                                      {mode.icon}
                                      {isLiveStreaming ? (
                                        <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] lp-streaming-dot" />
                                      ) : null}
                                    </span>
                                    <span className="truncate">{c.name}</span>
                                  </button>
                                  {isLiveStreaming ? (
                                    <button
                                      type="button"
                                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] text-red-300 hover:bg-red-500/15 hover:text-red-200"
                                      onClick={(e) => { e.stopPropagation(); cancelChatStream(c.id); }}
                                      title={t("sidebar2.stopGenTitle")}
                                    >
                                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-[14px] leading-none text-[var(--lp-soft-text)] hover:bg-red-500/10 hover:text-red-400 group-hover/conv:flex"
                                    onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(c.id); }}
                                    title={t("sidebar2.deleteTitle")}
                                  >×</button>
                                </div>
                              );
                            })}
                          </div>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          {/* Divider */}
          <div className="mx-3 my-4 border-t border-white/[0.06]" />

          {/* Conversations */}
          <div className="flex items-center justify-between px-3">
            <button
              type="button"
              className="flex flex-1 items-center gap-1.5 rounded-md py-1 text-[12px] text-[var(--lp-soft-text)] hover:text-[var(--lp-text)]/85"
              onClick={() => setConversationsOpen((v) => !v)}
              aria-expanded={conversationsOpen}
              title={conversationsOpen ? t("sidebar2.collapse") : t("sidebar2.expand")}
            >
              <svg
                width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                className="shrink-0 transition-transform"
                style={{ transform: conversationsOpen ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <path d="M4 2.5L8 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t("sidebar.conversations")}</span>
              <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] leading-[18px]">{unattachedConversations.length}</span>
            </button>
            <div className="flex items-center gap-1 text-[var(--lp-soft-text)]">
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/[0.05]"
                onClick={(e) => { e.stopPropagation(); if (!conversationsOpen) setConversationsOpen(true); void handleNewConversation(); }}
                title={t("sidebar.newConversation")}
                type="button"
              >＋</button>
            </div>
          </div>
          {!conversationsOpen ? null : unattachedConversations.length === 0 ? (
            <div className="mt-2 px-3 text-[12px] text-[var(--lp-soft-text)]">{t("sidebar.emptyConversations")}</div>
          ) : (
            <div className="mt-1 flex flex-col gap-0.5 px-1">
              {unattachedConversations.map((c) => {
                const active = activeConversation?.id === c.id;
                const mode = CHAT_MODE_MAP[(c.modeId as ChatModeId) ?? "chat"] ?? CHAT_MODE_MAP.chat;
                const stream = activeStreams[c.id];
                const isLiveStreaming = stream?.status === "streaming";
                // While streaming, the persisted preview lags. Synthesize a
                // live preview from the accumulating text so the user can see
                // their background conversation progress in the sidebar.
                const preview = conversationPreviews[c.id];
                let previewLabel: string;
                if (isLiveStreaming && stream.text) {
                  previewLabel = `${t("modelConfig.assistant")}: ${stream.text.replace(/\s+/g, " ").trim()}`;
                } else if (preview) {
                  previewLabel = `${preview.role === "user" ? t("modelConfig.you") : t("modelConfig.assistant")}: ${preview.content.replace(/\s+/g, " ").trim()}`;
                } else {
                  previewLabel = "";
                }
                return (
                  <div
                    key={c.id}
                    className={`group rounded-lg px-3 py-2 transition hover:bg-white/[0.04] ${active ? "bg-white/[0.06] text-[var(--lp-text)]" : "text-[var(--lp-text)]/82"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="flex flex-1 min-w-0 items-start gap-1.5 text-left"
                        onClick={() => handleSelectConversation(c)}
                        title={`${c.name} · ${t(mode.nameKey)}${isLiveStreaming ? ` · ${t("sidebar2.inProgressBadge")}` : ""}`}
                      >
                        <span className="relative mt-[2px] inline-flex h-3 w-3 shrink-0 items-center justify-center">
                          <span className="text-[12px] leading-none opacity-90">{mode.icon}</span>
                          {isLiveStreaming ? (
                            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] lp-streaming-dot" />
                          ) : null}
                        </span>
                        <span className="flex flex-1 min-w-0 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] leading-tight">{c.name}</span>
                            {isLiveStreaming ? (
                              <span className="shrink-0 text-[10px] font-medium text-emerald-300">●</span>
                            ) : null}
                          </span>
                          {previewLabel ? (
                            <span className="mt-1 truncate text-[11px] leading-tight text-[var(--lp-soft-text)]" title={previewLabel}>
                              {previewLabel}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <div className="ml-1 flex shrink-0 items-center gap-0.5">
                        {isLiveStreaming ? (
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-red-300 hover:bg-red-500/15 hover:text-red-200"
                            onClick={(e) => { e.stopPropagation(); cancelChatStream(c.id); }}
                            title={t("sidebar2.stopGenTitle")}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="hidden h-5 w-5 items-center justify-center rounded text-[14px] text-[var(--lp-soft-text)] hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(c.id); }}
                          title={t("sidebar2.deleteTitle")}
                        >×</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
          {/* End scrollable middle area */}

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
                {theme === "dark" ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>}
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
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
              <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/90 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.4)] transition delay-100 duration-150 group-hover:opacity-100">
                {t("sidebar.settings")}
              </span>
            </div>
            <div className="group relative">
              <button
                className="flex h-9 min-w-[44px] items-center justify-center rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3 text-[12px] font-medium text-[var(--lp-text)]/82 hover:bg-[var(--lp-panel-2)]"
                onClick={() => toggleLanguage()}
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
              {activePage === "chat"
                ? t("home.pageTitle")
                : activePage === "project"
                  ? (activeProject?.name ?? t("sidebar.projects"))
                  : t("sidebar.modelConfig")}
            </div>
            {/* Reserved for future header actions */}
          </header>

          {activePage === "chat" ? (
            <ChatPanel
              conversation={activeConversation}
              onEnsureConversation={ensureConversation}
              onConversationsChanged={() => { void refreshConversations(); }}
              defaultProviderId={chatProvider}
              defaultModelId={chatModel}
              attachImagesAllowed={(() => {
                // Resolve the effective (provider, model) the same way the
                // composer does, then check the catalog's `vision` capability.
                // Unknown / custom models default to true so we never gate the
                // user out of a workflow we don't have metadata for.
                const pid = activeConversation?.providerId ?? chatProvider;
                const mid = activeConversation?.modelId ?? chatModel;
                const m = AI_PROVIDERS_DEFAULT.find((p) => p.id === pid)?.models.find((x) => x.id === mid);
                return m ? m.capabilities.includes("vision") : true;
              })()}
              defaultThinkBudget={chatThinkBudget}
              defaultThinkEnabled={chatThinkEnabled}
              activeModeId={
                activeConversation?.projectId
                  ? ((activeConversation.modeId as string) ?? "agent")
                  : chatModeId
              }
              liveStream={(() => {
                if (!activeConversation) return undefined;
                const s = activeStreams[activeConversation.id];
                if (!s) return undefined;
                // Project an `agentRunId` onto the ChatPanel snapshot so the
                // TodoPanel (and any future subcomponent) can subscribe to
                // live runtime events without re-plumbing every prop.
                return { ...s, agentRunId: s.isAgentRun ? s.streamId : undefined };
              })()}
              onStartStream={startChatStream}
              onCancelStream={cancelChatStream}
              onRetryStream={retryChatStream}
              onExecuteAsAgent={executePlanAsAgent}
              labels={{
                heroTitle: t("home.heroTitle"),
                heroSubtitle: t("home.heroSubtitle"),
                inputPlaceholder: t("home.inputPlaceholder"),
                start: t("home.start"),
                stop: t("modelConfig.stop"),
                sending: t("home.start"),
                apiKeyMissing: t("modelConfig.apiKeyMissing"),
                deliveryError: t("modelConfig.deliveryError"),
                emptyState: t("modelConfig.emptyState"),
                you: t("modelConfig.you"),
                assistant: t("modelConfig.assistant"),
                thinking: t("modelConfig.thinking"),
                retry: t("modelConfig.retry"),
                retryFailed: t("modelConfig.retryFailed")
              }}
              toolbar={
                <>
                  <ModeSelector
                    selectedModeId={activeConversation?.projectId ? ((activeConversation.modeId as ChatModeId) ?? "agent") : chatModeId}
                    availableModeIds={
                      activeConversation?.projectId
                        ? PROJECT_CHAT_MODE_IDS
                        : STANDALONE_CHAT_MODE_IDS
                    }
                    onChange={(id) => {
                      const conv = activeConversation;
                      if (conv?.projectId) {
                        if (conv && window.electronAPI?.updateConversation) {
                          void window.electronAPI.updateConversation(conv.id, { modeId: id }).then((updated) => {
                            if (updated) setActiveConversation(updated);
                          });
                        }
                        return;
                      }
                      setChatModeId(id);
                      if (conv && window.electronAPI?.updateConversation) {
                        void window.electronAPI.updateConversation(conv.id, { modeId: id }).then((updated) => {
                          if (updated) setActiveConversation(updated);
                        });
                      }
                    }}
                  />
                  {activeConversation?.modeId === "pipeline" ? (
                    <PipelineConfigurator
                      stages={pipelineStages}
                      onChange={setPipelineStages}
                      providerConfigs={providerCache}
                    />
                  ) : (
                    <ModelSelector
                      selectedProvider={chatProvider}
                      selectedModel={chatModel}
                      thinkBudget={chatThinkBudget}
                      thinkEnabled={chatThinkEnabled}
                      onChangeProvider={setChatProvider}
                      onChangeModel={setChatModel}
                      onChangeBudget={(b) => {
                        setChatThinkBudget(b);
                        const conv = activeConversation;
                        if (conv && window.electronAPI?.updateConversation) {
                          void window.electronAPI.updateConversation(conv.id, { thinkBudget: b }).then((updated) => {
                            if (updated) setActiveConversation(updated);
                          });
                        }
                      }}
                      onChangeThinkEnabled={(next) => {
                        setChatThinkEnabled(next);
                        const conv = activeConversation;
                        if (conv && window.electronAPI?.updateConversation) {
                          void window.electronAPI.updateConversation(conv.id, { thinkEnabled: next }).then((updated) => {
                            if (updated) setActiveConversation(updated);
                          });
                        }
                      }}
                      providerConfigs={providerCache}
                    />
                  )}
                  {activeConversation?.projectId && (
                    <BypassPermissionToggle active={bypassPermissions} onToggle={toggleBypassPermissions} />
                  )}
                </>
              }
              aboveComposer={(() => {
                // Only show the permission card for the conversation
                // that triggered it. The global queue used to leak
                // prompts into sibling conversations of the same
                // project — visually identical UI in two tabs, both
                // pretending the tool was theirs.
                const convScopedQueue = activeConversation
                  ? permissionQueue.filter((p) => p.conversationId === activeConversation.id)
                  : [];
                return convScopedQueue.length > 0 && activeConversation ? (
                  <PermissionApprovalModal
                    queue={convScopedQueue}
                    onDecide={decidePermission}
                    onDenyAll={() => denyAllPermissionsForConversation(activeConversation.id)}
                  />
                ) : null;
              })()}
              contextBudgetInfo={activeConversation ? contextBudgets[activeConversation.id] : undefined}
            />
          ) : activePage === "project" && activeProject ? (
            <ProjectLandingPanel
              project={activeProject}
              draftConversation={projectDraftConversation}
              defaultProviderId={chatProvider}
              defaultModelId={chatModel}
              defaultThinkBudget={chatThinkBudget}
              defaultThinkEnabled={chatThinkEnabled}
              activeModeId="agent"
              onEnsureConversation={async () => {
                const api = window.electronAPI;
                if (!api?.createConversation) throw new Error("conversation API unavailable");
                const modelDef = AI_PROVIDERS_DEFAULT
                  .find((p) => p.id === chatProvider)?.models
                  .find((m) => m.id === chatModel);
                const seedThinkEnabled = hasReasoning(modelDef) && chatThinkEnabled;
                const conv = await api.createConversation({
                  projectId: activeProject.id,
                  name: t("sidebar.newConversation"),
                  providerId: chatProvider,
                  modelId: chatModel,
                  thinkBudget: chatThinkBudget,
                  thinkEnabled: seedThinkEnabled,
                  modeId: "agent"
                });
                setActiveConversation(conv);
                setProjectDraftConversation(conv);
                await refreshConversations();
                return conv;
              }}
              onStartStream={startChatStream}
              onConversationStarted={(conv) => {
                // First message is in flight — flip into the chat view so the
                // user immediately sees the streaming reply.
                setActiveConversation(conv);
                setProjectDraftConversation(null);
                setActivePage("chat");
              }}
              toolbar={
                <>
                  <ModeSelector
                    selectedModeId={(projectDraftConversation?.modeId as ChatModeId) ?? "agent"}
                    availableModeIds={PROJECT_CHAT_MODE_IDS}
                    onChange={(id) => {
                      const conv = projectDraftConversation;
                      if (conv && window.electronAPI?.updateConversation) {
                        void window.electronAPI.updateConversation(conv.id, { modeId: id }).then((updated) => {
                          if (updated) setProjectDraftConversation(updated);
                        });
                      }
                    }}
                  />
                  {(projectDraftConversation?.modeId === "pipeline") ? (
                    <PipelineConfigurator
                      stages={pipelineStages}
                      onChange={setPipelineStages}
                      providerConfigs={providerCache}
                    />
                  ) : (
                    <ModelSelector
                      selectedProvider={chatProvider}
                      selectedModel={chatModel}
                      thinkBudget={chatThinkBudget}
                      thinkEnabled={chatThinkEnabled}
                      onChangeProvider={setChatProvider}
                      onChangeModel={setChatModel}
                      onChangeBudget={(b) => {
                        setChatThinkBudget(b);
                        const conv = projectDraftConversation;
                        if (conv && window.electronAPI?.updateConversation) {
                          void window.electronAPI.updateConversation(conv.id, { thinkBudget: b }).then((updated) => {
                            if (updated) setProjectDraftConversation(updated);
                          });
                        }
                      }}
                      onChangeThinkEnabled={(next) => {
                        setChatThinkEnabled(next);
                        const conv = projectDraftConversation;
                        if (conv && window.electronAPI?.updateConversation) {
                          void window.electronAPI.updateConversation(conv.id, { thinkEnabled: next }).then((updated) => {
                            if (updated) setProjectDraftConversation(updated);
                          });
                        }
                      }}
                      providerConfigs={providerCache}
                    />
                  )}
                  <BypassPermissionToggle active={bypassPermissions} onToggle={toggleBypassPermissions} />
                </>
              }
            />
          ) : (
            <ModelConfigPage />
          )}
        </main>
      </div>

      {themeModalOpen ? (
        <ThemeModal
          current={{ theme, background, text, language }}
          onClose={() => setThemeModalOpen(false)}
          onSave={(settings) => {
            saveAppearance(settings);
            setThemeModalOpen(false);
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPage onClose={() => setSettingsOpen(false)} appVersion={appInfo?.version} />
      ) : null}

      {/* PermissionApprovalModal is now rendered inline via ChatPanel.aboveComposer */}

      {activeConversation?.projectId ? <RunningTasksTray projectId={activeConversation.projectId} /> : null}

      <ResumeToast
        onOpenConversation={(convId) => {
          const conv = conversations.find((c) => c.id === convId);
          if (conv) setActiveConversationSafe(conv);
        }}
        onResumeRun={(convId, runId) => {
          const conv = conversations.find((c) => c.id === convId);
          if (conv) {
            setActiveConversationSafe(conv);
            setActivePage("chat");
          }

          setActiveStreams((prev) => ({
            ...prev,
            [convId]: {
              streamId: runId,
              assistantMessageId: "",
              text: "",
              reasoning: "",
              status: "streaming",
              startedAt: Date.now(),
              isAgentRun: true
            }
          }));

          const api = window.electronAPI;
          if (!api?.onAgentRun) return;
          const unsubscribe = api.onAgentRun(runId, (ev) => {
            if (ev.kind === "permission_request") {
              setPermissionQueue((prev) => {
                if (prev.some((p) => p.toolCallId === ev.toolCallId)) return prev;
                return [
                  ...prev,
                  {
                    runId,
                    conversationId: convId,
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolName,
                    input: ev.input,
                    uiPreview: ev.uiPreview
                  }
                ];
              });
            }
            if (ev.kind === "terminal") {
              setPermissionQueue((prev) => prev.filter((p) => p.runId !== runId));
            }
            setActiveStreams((prev) => {
              const cur = prev[convId];
              if (!cur) return prev;
              if (ev.kind === "llm") {
                const e = ev.event;
                if (e.type === "text_delta") return { ...prev, [convId]: { ...cur, text: cur.text + e.text } };
                if (e.type === "reasoning_delta") return { ...prev, [convId]: { ...cur, reasoning: cur.reasoning + e.text } };
                if (e.type === "error") return { ...prev, [convId]: { ...cur, status: "error", errorMessage: e.message } };
              }
              if (ev.kind === "context_compacted") {
                return { ...prev, [convId]: { ...cur, compaction: { before: ev.before, after: ev.after, notes: ev.notes } } };
              }
              if (ev.kind === "context_budget") {
                return { ...prev, [convId]: { ...cur, contextBudget: { usedTokens: ev.usedTokens, budgetTokens: ev.budgetTokens, windowTokens: ev.windowTokens, compacted: ev.compacted } } };
              }
              if (ev.kind === "stage_enter") {
                return { ...prev, [convId]: { ...cur, pipelineStage: { stage: ev.stage, model: ev.model } } };
              }
              if (ev.kind === "stage_exit") {
                return { ...prev, [convId]: { ...cur, pipelineStage: null } };
              }
              if (ev.kind === "terminal") {
                return { ...prev, [convId]: { ...cur, status: ev.reason === "completed" ? "done" : "error", errorMessage: ev.reason === "completed" ? undefined : ev.message ?? ev.reason, pipelineStage: null } };
              }
              return prev;
            });
            if (ev.kind === "context_compacted") {
              setContextBudgets((prev) => ({
                ...prev,
                [convId]: { ...prev[convId], usedTokens: ev.after, budgetTokens: prev[convId]?.budgetTokens ?? 0, windowTokens: prev[convId]?.windowTokens ?? 0, compacted: true, compaction: { before: ev.before, after: ev.after, notes: ev.notes } }
              }));
            }
            if (ev.kind === "context_budget") {
              setContextBudgets((prev) => ({
                ...prev,
                [convId]: { ...prev[convId], usedTokens: ev.usedTokens, budgetTokens: ev.budgetTokens, windowTokens: ev.windowTokens, compacted: ev.compacted, compaction: prev[convId]?.compaction }
              }));
            }
            if (ev.kind === "message_persisted") void refreshConversations();
            if (ev.kind === "terminal") {
              const dispose = streamUnsubsRef.current[convId];
              if (dispose) { dispose(); delete streamUnsubsRef.current[convId]; }
              void refreshConversations();
            }
          });
          streamUnsubsRef.current[convId] = unsubscribe;
        }}
      />
    </div>
  );
}
