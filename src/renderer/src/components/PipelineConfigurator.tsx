/**
 * PipelineConfigurator — compact 3-stage model picker for pipeline mode.
 *
 * Shows a toggle button in the toolbar; clicking it opens a popover with
 * three rows (Planner / Executor / Reviewer), each with a provider and
 * model dropdown.
 */

import { useCallback, useMemo, useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { PipelineStageConfig, ThinkBudget, ThinkProtocol } from "@shared/types";
import { AI_PROVIDERS_DEFAULT, type ProviderModel } from "../constants/providers";
import type { ProviderConfig } from "@shared/types";
import {
  PROTOCOL_LEVELS,
  PROTOCOL_DEFAULT_LEVEL,
  THINK_BUDGET_LABELS
} from "../constants/think-presets";

interface PipelineConfiguratorProps {
  stages: PipelineStageConfig[];
  onChange: (stages: PipelineStageConfig[]) => void;
  providerConfigs?: Record<string, ProviderConfig>;
}

const STAGE_META: Array<{ role: PipelineStageConfig["role"]; labelKey: string; icon: string }> = [
  { role: "planner",  labelKey: "pipeline.planner",  icon: "📋" },
  { role: "executor", labelKey: "pipeline.executor", icon: "⚡" },
  { role: "reviewer", labelKey: "pipeline.reviewer", icon: "🔍" }
];

export function PipelineConfigurator({ stages, onChange, providerConfigs }: PipelineConfiguratorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = useState({ left: 0, bottom: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setCoords({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  const availableProviders = useMemo(() => {
    if (!providerConfigs || Object.keys(providerConfigs).length === 0) return AI_PROVIDERS_DEFAULT;
    return AI_PROVIDERS_DEFAULT.filter((p) => {
      const cfg = providerConfigs[p.id];
      return cfg && cfg.enabled && !!cfg.apiKey;
    });
  }, [providerConfigs]);

  const updateStage = useCallback(
    (role: PipelineStageConfig["role"], patch: Partial<PipelineStageConfig>) => {
      const next = stages.map((s) =>
        s.role === role ? { ...s, ...patch } : s
      );
      onChange(next);
    },
    [stages, onChange]
  );

  /**
   * Look up the catalog entry for a given (providerId, modelId) pair so we
   * can render the per-stage reasoning level picker when the model supports
   * it. Falls back to `undefined` if the model isn't in the built-in
   * catalog — for now we only show the reasoning row for known reasoning
   * models. (Custom providers added via the AI 配置 page can be wired in
   * later through a modelConfigs lookup.)
   */
  const lookupModel = useCallback(
    (providerId: string, modelId: string): ProviderModel | undefined => {
      const prov = AI_PROVIDERS_DEFAULT.find((p) => p.id === providerId);
      return prov?.models.find((m) => m.id === modelId);
    },
    []
  );

  /**
   * When the user switches model for a stage, reset `thinkBudget` to that
   * model's protocol default — otherwise we'd carry the old budget across
   * incompatible protocols (e.g. picking an OpenAI `xhigh` then switching
   * to a Qwen model that only supports low/medium/high).
   */
  const onPickModel = useCallback(
    (role: PipelineStageConfig["role"], providerId: string, modelId: string) => {
      const m = lookupModel(providerId, modelId);
      const proto: ThinkProtocol | undefined = m?.thinkProtocol;
      const nextBudget = proto && proto !== "binary"
        ? PROTOCOL_DEFAULT_LEVEL[proto]
        : undefined;
      updateStage(role, { providerId, modelId, thinkBudget: nextBudget });
    },
    [lookupModel, updateStage]
  );

  const stageLabel = (s: PipelineStageConfig) => {
    const prov = AI_PROVIDERS_DEFAULT.find((p) => p.id === s.providerId);
    const modelShort = s.modelId.length > 18 ? s.modelId.slice(0, 16) + "…" : s.modelId;
    return `${prov?.name ?? s.providerId} / ${modelShort}`;
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
          open
            ? "border-rose-400/40 bg-rose-400/15 text-rose-300"
            : "border-[var(--lp-border)] bg-white/[0.04] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
        }`}
        title={t("pipeline.configTitle", "配置三阶段模型")}
      >
        <span className="text-[13px]">🔗</span>
        <span>{t("pipeline.config", "流水线")}</span>
        <span className="opacity-60">▾</span>
      </button>

      {open ? createPortal(
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[210] w-[380px] overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
            style={{ left: coords.left, bottom: coords.bottom }}
          >
            <div className="border-b border-white/[0.06] px-4 py-2.5 text-[11px] uppercase tracking-wide text-[var(--lp-muted)]">
              {t("pipeline.configTitle", "多模型流水线配置")}
            </div>
            <div className="space-y-2 px-3 py-3">
              {STAGE_META.map(({ role, labelKey, icon }) => {
                const stage = stages.find((s) => s.role === role);
                if (!stage) return null;
                const currentProvider = availableProviders.find((p) => p.id === stage.providerId) ?? availableProviders[0];
                const currentModel = lookupModel(stage.providerId, stage.modelId);
                const thinkProto = currentModel?.thinkProtocol;
                const supportsReasoning = !!currentModel?.capabilities.includes("reasoning");
                const levels: ThinkBudget[] = thinkProto ? PROTOCOL_LEVELS[thinkProto] : [];
                const showLevels = supportsReasoning && levels.length > 0;
                const showBinary = supportsReasoning && thinkProto === "binary";
                const currentBudget = stage.thinkBudget
                  ?? (thinkProto && thinkProto !== "binary" ? PROTOCOL_DEFAULT_LEVEL[thinkProto] : undefined);
                return (
                  <div key={role} className="rounded-xl border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5">
                    <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--lp-text)]">
                      <span>{icon}</span>
                      <span>{t(labelKey, role)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={stage.providerId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          const prov = availableProviders.find((p) => p.id === pid);
                          const nextModelId = prov?.models[0]?.id ?? "";
                          onPickModel(role, pid, nextModelId);
                        }}
                        className="h-7 flex-1 rounded-lg border border-[var(--lp-border)] bg-transparent px-2 text-[12px] text-[var(--lp-text)] outline-none"
                      >
                        {availableProviders.map((p) => (
                          <option key={p.id} value={p.id}>{t(`providers.${p.id}`, { defaultValue: p.name })}</option>
                        ))}
                      </select>
                      <select
                        value={stage.modelId}
                        onChange={(e) => onPickModel(role, stage.providerId, e.target.value)}
                        className="h-7 flex-[2] rounded-lg border border-[var(--lp-border)] bg-transparent px-2 text-[12px] text-[var(--lp-text)] outline-none"
                      >
                        {currentProvider?.models.map((m) => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                      </select>
                    </div>

                    {/* Reasoning effort row — only shown when the picked
                        model has the `reasoning` capability. The level
                        set is derived from the model's `thinkProtocol`,
                        so OpenAI shows 5 buttons, Anthropic shows 4,
                        Qwen shows 3, etc. Binary-protocol models (e.g.
                        DeepSeek V4 reasoner, Kimi-thinking) show a one-
                        line note instead because there's nothing to
                        configure beyond on/off, and pipeline mode
                        always runs them in "on" state. */}
                    {showLevels ? (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-[10.5px] uppercase tracking-wide text-[var(--lp-muted)]">
                          {t("pipeline.reasoning", { defaultValue: "推理" })}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {levels.map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => updateStage(role, { thinkBudget: b })}
                              className={
                                "rounded-md border px-2 py-0.5 text-[11px] transition " +
                                (currentBudget === b
                                  ? "border-rose-400/50 bg-rose-400/15 text-rose-300"
                                  : "border-[var(--lp-border)] text-[var(--lp-soft-text)] hover:bg-white/[0.04] hover:text-[var(--lp-text)]")
                              }
                            >
                              {THINK_BUDGET_LABELS[b]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : showBinary ? (
                      <div className="mt-2 text-[10.5px] text-[var(--lp-muted)]">
                        {t("pipeline.binaryReasoningNote", {
                          defaultValue: "该模型推理为开关式（无强度档），流水线默认开启。"
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-white/[0.06] px-4 py-2 text-[10.5px] text-[var(--lp-muted)]">
              {t("pipeline.hint", "理解需求 → 执行工作 → 审查结果")}
            </div>
          </div>
        </>,
        document.body
      ) : null}
    </>
  );
}
