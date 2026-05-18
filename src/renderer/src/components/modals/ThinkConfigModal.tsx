import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelConfig, ThinkBudget } from "@shared/types";
import { THINK_BUDGET_LABELS } from "../../constants/think-presets";

/**
 * Configure how a given model speaks reasoning/thinking to its provider:
 *  - whether reasoning is enabled by default
 *  - what default level (when the model exposes granular levels)
 *  - extra body JSON merged into the chat request on/off
 *  - forced temperature (Anthropic needs t=1, GLM dislikes >0.8, etc.)
 */
export function ThinkConfigModal({
  modelId,
  providerId,
  thinkLevels,
  config,
  onClose,
  onSave
}: {
  modelId: string;
  providerId: string;
  /** Levels the model supports. Empty array / undefined ⇒ binary on/off only. */
  thinkLevels?: ThinkBudget[];
  config: ModelConfig | undefined;
  onClose: () => void;
  onSave: (c: ModelConfig) => void;
}) {
  const { t } = useTranslation();
  const hasLevels = !!thinkLevels && thinkLevels.length > 0;
  const defaultLevel: ThinkBudget = hasLevels && thinkLevels!.includes("medium") ? "medium" : thinkLevels?.[0] ?? "medium";
  const [thinkEnabled, setThinkEnabled] = useState(config?.thinkEnabled ?? false);
  const [budget, setBudget] = useState<ThinkBudget>(() => {
    const saved = config?.thinkBudget;
    if (saved && (!hasLevels || thinkLevels!.includes(saved))) return saved;
    return defaultLevel;
  });
  const [bodyOn, setBodyOn] = useState(config?.thinkBodyOn ?? "{\n}");
  const [bodyOff, setBodyOff] = useState(config?.thinkBodyOff ?? "");
  const [forceTemp, setForceTemp] = useState(config?.forceTemperature ?? "");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-[var(--lp-text)]">{t("thinkConfig.title")}</div>
            <div className="mt-1 text-[13px] text-[var(--lp-muted)]">
              {t("thinkConfig.subtitle", { modelId })}
              {hasLevels ? (
                <span className="ml-1 text-[var(--lp-soft-text)]">
                  {t("thinkConfig.levelsBadge", { count: thinkLevels!.length })}
                </span>
              ) : (
                <span className="ml-1 text-[var(--lp-soft-text)]">{t("thinkConfig.binaryBadge")}</span>
              )}
            </div>
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("thinkConfig.enable")}</div>
          <button
            type="button"
            className={`h-6 w-11 rounded-full transition ${thinkEnabled ? "bg-[#10A37F]" : "bg-white/10"}`}
            onClick={() => setThinkEnabled(!thinkEnabled)}
          >
            <div
              className={`h-5 w-5 rounded-full bg-white shadow transition ${thinkEnabled ? "translate-x-[22px]" : "translate-x-[2px]"}`}
            />
          </button>
        </div>

        {thinkEnabled ? (
          <>
            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("thinkConfig.bodyOn")}</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("thinkConfig.bodyOnHint")}</div>
              <textarea
                className="mt-2 h-24 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none font-mono"
                value={bodyOn}
                onChange={(e) => setBodyOn(e.target.value)}
              />
            </div>

            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("thinkConfig.bodyOff")}</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("thinkConfig.bodyOffHint")}</div>
              <textarea
                className="mt-2 h-24 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none font-mono"
                placeholder={t("thinkConfig.empty")}
                value={bodyOff}
                onChange={(e) => setBodyOff(e.target.value)}
              />
            </div>

            {hasLevels ? (
              <div className="mt-5">
                <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("thinkConfig.defaultLevel")}</div>
                <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("thinkConfig.defaultLevelHint")}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {thinkLevels!.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`rounded-lg border px-3 py-1.5 text-[12px] ${
                        budget === b
                          ? "border-[#10A37F] bg-[#10A37F]/10 text-[#10A37F]"
                          : "border-[var(--lp-border)] text-[var(--lp-text)]/78 hover:bg-white/[0.04]"
                      }`}
                      onClick={() => setBudget(b)}
                    >
                      {THINK_BUDGET_LABELS[b]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 text-[12px] text-[var(--lp-soft-text)]">
                {t("thinkConfig.binaryNote")}
              </div>
            )}

            <div className="mt-5">
              <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("thinkConfig.forceTemp")}</div>
              <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("thinkConfig.forceTempHint")}</div>
              <input
                className="mt-2 w-40 rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--lp-text)] outline-none"
                placeholder={t("thinkConfig.empty")}
                value={forceTemp}
                onChange={(e) => setForceTemp(e.target.value)}
              />
            </div>
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-lg border border-[var(--lp-border)] px-4 py-2.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]"
            onClick={onClose}
            type="button"
          >
            {t("thinkConfig.cancel")}
          </button>
          <button
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-[#151515]"
            type="button"
            onClick={() => {
              onSave({
                providerId,
                modelId,
                enabled: config?.enabled ?? true,
                thinkEnabled,
                thinkBudget: budget,
                thinkBodyOn: bodyOn,
                thinkBodyOff: bodyOff,
                forceTemperature: forceTemp
              });
              onClose();
            }}
          >
            {t("thinkConfig.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
