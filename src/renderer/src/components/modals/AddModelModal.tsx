import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelCapability, ThinkProtocol } from "@shared/types";
import { THINK_LEVEL_PRESETS, THINK_BUDGET_LABELS } from "../../constants/think-presets";

/**
 * Capability picker rows shown in the Add-Model modal.
 *
 * Ordering matches the ModelSelector / model list rendering so the user
 * builds the same mental map across screens. Translation keys live under
 * `capabilities.*` in `i18n/index.ts`.
 */
const CAPABILITY_OPTIONS: Array<{ id: ModelCapability; defaultEnabled: boolean }> = [
  { id: "text", defaultEnabled: true },
  { id: "vision", defaultEnabled: false },
  { id: "reasoning", defaultEnabled: false },
  { id: "tools", defaultEnabled: true },
  { id: "image-gen", defaultEnabled: false },
  { id: "audio", defaultEnabled: false },
  { id: "embedding", defaultEnabled: false }
];

/**
 * Manual model registration. The user supplies a model id (e.g. `gpt-5.6`),
 * picks the model's capability set, and — when `reasoning` is enabled —
 * declares which reasoning protocol family it follows. The selected protocol
 * drives every downstream effort-level picker (ModelSelector, Think config).
 */
export function AddModelModal({
  providerId,
  onClose,
  onAdd
}: {
  providerId: string;
  onClose: () => void;
  onAdd: (modelId: string, capabilities: ModelCapability[], thinkProtocol: ThinkProtocol | null) => void;
}) {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState("");

  // Capabilities are a multi-select set; we default `text` (every chat model
  // has it) and let the user toggle the rest. Storing as a Set keeps the
  // toggle math trivial.
  const [capabilities, setCapabilities] = useState<Set<ModelCapability>>(
    () => new Set(CAPABILITY_OPTIONS.filter((c) => c.defaultEnabled).map((c) => c.id))
  );

  // Pick a sensible default protocol based on the provider being edited.
  // Falls back to "binary" for unknown / custom providers — it's the safest
  // fallback because it only emits an on/off flag.
  const defaultProtocol: ThinkProtocol = useMemo(() => {
    if (providerId === "openai") return "openai";
    if (providerId === "anthropic") return "anthropic";
    if (providerId === "google") return "gemini";
    if (providerId === "tongyi" || providerId === "siliconflow") return "qwen";
    return "binary";
  }, [providerId]);
  const [protocol, setProtocol] = useState<ThinkProtocol>(defaultProtocol);

  const hasReasoning = capabilities.has("reasoning");

  function toggleCapability(cap: ModelCapability) {
    setCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      // Always keep at least one capability — an empty model is meaningless;
      // re-add text as the fallback so the user never sees a row with zero
      // chips.
      if (next.size === 0) next.add("text");
      return next;
    });
  }

  function handleAdd() {
    if (!modelId.trim()) return;
    // Stable ordering — match the renderer-side display order so chips line
    // up identically across screens.
    const capsArray = CAPABILITY_OPTIONS
      .filter((c) => capabilities.has(c.id))
      .map((c) => c.id);
    onAdd(modelId.trim(), capsArray, hasReasoning ? protocol : null);
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

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addModel.capabilitiesTitle")}</div>
          <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{t("addModel.capabilitiesHint")}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CAPABILITY_OPTIONS.map((c) => {
              const selected = capabilities.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-[#10A37F] bg-[#10A37F]/10"
                      : "border-[var(--lp-border)] hover:bg-white/[0.04]"
                  }`}
                  onClick={() => toggleCapability(c.id)}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      selected ? "border-[#10A37F] bg-[#10A37F]" : "border-[var(--lp-border)]"
                    }`}
                  >
                    {selected ? <span className="text-[10px] text-white">✓</span> : null}
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-[12px] ${selected ? "text-[var(--lp-text)]" : "text-[var(--lp-text)]"}`}>
                      {t(`capabilities.${c.id}`)}
                    </span>
                    <span className="text-[10px] text-[var(--lp-soft-text)]">{t(`capabilities.${c.id}_hint`)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {hasReasoning ? (
          <div className="mt-5">
            <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addModel.protocolTitle")}</div>
            <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">{t("addModel.protocolHint")}</div>
            <div className="mt-2 flex flex-col gap-2">
              {THINK_LEVEL_PRESETS.map((p) => {
                const selected = protocol === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      selected
                        ? "border-[#10A37F] bg-[#10A37F]/10"
                        : "border-[var(--lp-border)] hover:bg-white/[0.04]"
                    }`}
                    onClick={() => setProtocol(p.id)}
                  >
                    <div
                      className={`text-[13px] font-medium ${selected ? "text-[#10A37F]" : "text-[var(--lp-text)]"}`}
                    >
                      {t(`thinkProtocol.${p.id}`, p.label)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--lp-soft-text)]">
                      {p.levels.length > 0
                        ? p.levels.map((lv) => THINK_BUDGET_LABELS[lv]).join(" · ")
                        : t("thinkProtocol.binary_hint", p.description)}
                    </div>
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
