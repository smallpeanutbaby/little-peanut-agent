import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppearanceSettings, BackgroundColor, TextColor } from "@shared/types";
import { backgroundClassMap, textClassMap } from "../../constants/theme-tokens";

/** Theme picker (background + text color); commits via `onSave`. */
export function ThemeModal({
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
          <button
            className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-4 py-2 text-sm text-[var(--lp-text)]"
            onClick={onClose}
            type="button"
          >
            {t("appearance.close")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 text-sm uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">
            {t("appearance.background")}
          </div>
          <div className="mb-8 grid grid-cols-5 gap-3">
            {(Object.keys(backgroundClassMap) as BackgroundColor[]).map((background) => (
              <button
                key={background}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 ${
                  draft.background === background
                    ? "border-[var(--lp-border)] bg-[var(--lp-panel-2)]"
                    : "border-white/8 bg-[var(--lp-panel)]"
                }`}
                onClick={() => setDraft({ ...draft, background })}
                type="button"
              >
                <span
                  className="h-8 w-8 rounded-full border border-white/10"
                  style={{ backgroundColor: backgroundClassMap[background].base }}
                />
                <span className="text-center text-xs text-[var(--lp-text)]/70">
                  {t(`appearance.colors.${background}`)}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-4 text-sm uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">
            {t("appearance.text")}
          </div>
          <div className="grid grid-cols-5 gap-3">
            {(Object.keys(textClassMap) as TextColor[]).map((text) => (
              <button
                key={text}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 ${
                  draft.text === text
                    ? "border-[var(--lp-border)] bg-[var(--lp-panel-2)]"
                    : "border-white/8 bg-[var(--lp-panel)]"
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
          <button
            className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#151515]"
            onClick={() => onSave(draft)}
            type="button"
          >
            {t("appearance.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
