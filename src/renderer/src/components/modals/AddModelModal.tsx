import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkBudget } from "@shared/types";
import { THINK_LEVEL_PRESETS, type ThinkLevelPresetId } from "../../constants/think-presets";

/**
 * Manual model registration. The user supplies a model id (e.g. `gpt-5.6`),
 * declares whether it supports reasoning, and picks the level preset that
 * matches the provider's API surface.
 */
export function AddModelModal({
  providerId,
  onClose,
  onAdd
}: {
  providerId: string;
  onClose: () => void;
  onAdd: (modelId: string, think: boolean, thinkLevels?: ThinkBudget[]) => void;
}) {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState("");
  const [hasThink, setHasThink] = useState(false);
  // Pick a sensible default preset based on the provider being edited.
  const defaultPreset: ThinkLevelPresetId =
    providerId === "openai"
      ? "openai"
      : providerId === "anthropic"
        ? "anthropic"
        : providerId === "google"
          ? "gemini"
          : providerId === "tongyi"
            ? "qwen"
            : "binary";
  const [preset, setPreset] = useState<ThinkLevelPresetId>(defaultPreset);

  function handleAdd() {
    if (!modelId.trim()) return;
    const chosen = THINK_LEVEL_PRESETS.find((p) => p.id === preset);
    const thinkLevels = hasThink ? chosen?.levels : undefined;
    onAdd(modelId.trim(), hasThink, thinkLevels);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-[var(--lp-text)]">{t("addModel.title")}</div>
            <div className="mt-1 text-[13px] text-[var(--lp-muted)]">{t("addModel.subtitle")}</div>
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addModel.modelId")}</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder={t("addModel.modelIdPlaceholder")}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            autoFocus
          />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--lp-border)] px-4 py-3">
          <div>
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addModel.supportThink")}</div>
            <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{t("addModel.supportThinkHint")}</div>
          </div>
          <button
            type="button"
            className={`h-6 w-11 rounded-full transition ${hasThink ? "bg-[#10A37F]" : "bg-white/10"}`}
            onClick={() => setHasThink(!hasThink)}
          >
            <div
              className={`h-5 w-5 rounded-full bg-white shadow transition ${hasThink ? "translate-x-[22px]" : "translate-x-[2px]"}`}
            />
          </button>
        </div>

        {hasThink ? (
          <div className="mt-4">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addModel.presetTitle")}</div>
            <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{t("addModel.presetHint")}</div>
            <div className="mt-2 flex flex-col gap-2">
              {THINK_LEVEL_PRESETS.map((p) => {
                const selected = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${selected ? "border-[#10A37F] bg-[#10A37F]/10" : "border-[var(--lp-border)] hover:bg-white/[0.04]"}`}
                    onClick={() => setPreset(p.id)}
                  >
                    <div
                      className={`text-[13px] font-medium ${selected ? "text-[#10A37F]" : "text-[var(--lp-text)]"}`}
                    >
                      {p.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{p.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-lg border border-[var(--lp-border)] px-4 py-2.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]"
            onClick={onClose}
            type="button"
          >
            {t("addModel.cancel")}
          </button>
          <button
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-[#151515] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!modelId.trim()}
            type="button"
          >
            {t("addModel.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
