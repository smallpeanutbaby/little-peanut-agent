import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppearanceSettings, BackgroundColor, TextColor } from "@shared/types";
import { backgroundClassMap, textClassMap } from "../../constants/theme-tokens";

/**
 * Two curated "style" presets the user can pick from. Each preset bundles
 * a background + a text color so they always pair correctly. The underlying
 * `AppearanceSettings` schema (background + text) is unchanged — we just
 * collapse the picker UI down to 2 cards instead of exposing the full
 * 19-color matrix.
 */
type StyleId = "night" | "day";

const STYLE_PRESETS: Record<StyleId, { background: BackgroundColor; text: TextColor }> = {
  night: { background: "dark", text: "snow" },
  day: { background: "light", text: "charcoal" }
};

function inferStyle(s: AppearanceSettings): StyleId {
  return s.background === "light" ? "day" : "night";
}

/** Theme picker (style presets only); commits via `onSave`. */
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
  const [draft, setDraft] = useState<AppearanceSettings>(current);
  const activeStyle = useMemo(() => inferStyle(draft), [draft]);

  function pick(style: StyleId) {
    const preset = STYLE_PRESETS[style];
    setDraft({ ...draft, background: preset.background, text: preset.text });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/6 px-6 py-5">
          <div className="text-[18px] font-semibold text-[var(--lp-text)]">{t("appearance.title")}</div>
          <button
            className="rounded-full border border-[var(--lp-border)] bg-[var(--lp-panel)] px-3.5 py-1.5 text-[12.5px] text-[var(--lp-text)] hover:bg-[var(--lp-panel-2)]"
            onClick={onClose}
            type="button"
          >
            {t("appearance.close")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[var(--lp-soft-text)]">
            {t("appearance.style")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StyleCard
              active={activeStyle === "night"}
              preset={STYLE_PRESETS.night}
              label={t("appearance.night")}
              onClick={() => pick("night")}
            />
            <StyleCard
              active={activeStyle === "day"}
              preset={STYLE_PRESETS.day}
              label={t("appearance.day")}
              onClick={() => pick("day")}
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-white/6 px-6 py-4">
          <button
            className="rounded-full bg-white px-5 py-2 text-[13px] font-medium text-[#151515]"
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

function StyleCard({
  active,
  preset,
  label,
  onClick
}: {
  active: boolean;
  preset: { background: BackgroundColor; text: TextColor };
  label: string;
  onClick: () => void;
}) {
  const bgTokens = backgroundClassMap[preset.background];
  const textTokens = textClassMap[preset.text];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-stretch overflow-hidden rounded-2xl border transition ${
        active
          ? "border-[var(--lp-text)]/40 ring-2 ring-[var(--lp-text)]/15"
          : "border-[var(--lp-border)] hover:border-[var(--lp-text)]/25"
      }`}
    >
      {/* Preview swatch — uses the preset's actual colors so user sees the result */}
      <div
        className="flex h-[140px] items-center justify-center"
        style={{ backgroundColor: bgTokens.base }}
      >
        <span
          className="text-[44px] font-semibold leading-none"
          style={{ color: textTokens.main }}
        >
          Aa
        </span>
      </div>
      {/* Label row */}
      <div className="flex items-center justify-between bg-[var(--lp-panel)] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[var(--lp-text)]">{label}</span>
        {active ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--lp-text)] text-[10px] text-[var(--lp-main-bg)]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        ) : null}
      </div>
    </button>
  );
}
