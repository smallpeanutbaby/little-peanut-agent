import { useTranslation } from "react-i18next";
import type { ModelCapability } from "@shared/types";

/**
 * Display order — matches the `AddModelModal` capability picker so users build
 * the same mental map across the app. We intentionally surface only the
 * visually meaningful chips here (i.e. drop `text`, which every chat model
 * has) — `text` is implicit when there's no badge at all.
 */
const VISIBLE_ORDER: ModelCapability[] = [
  "vision",
  "reasoning",
  "tools",
  "image-gen",
  "audio",
  "embedding"
];

/**
 * Tint per capability. We keep these subtle (low-saturation + low-alpha
 * backgrounds) so several chips on a single row stay readable. The
 * foreground colour is the same `--lp-text` the surrounding row uses, so
 * chips inherit the active light/dark theme contrast.
 */
const TINT: Record<ModelCapability, string> = {
  text: "bg-white/[0.06] text-[var(--lp-text)]/85",
  vision: "bg-sky-400/15 text-sky-200",
  reasoning: "bg-violet-400/15 text-violet-200",
  tools: "bg-emerald-400/15 text-emerald-200",
  "image-gen": "bg-fuchsia-400/15 text-fuchsia-200",
  audio: "bg-amber-400/15 text-amber-200",
  embedding: "bg-slate-400/15 text-slate-200"
};

/**
 * Single-character glyphs shown inside each chip. We use plain unicode rather
 * than icon fonts so the renderer doesn't pull in another asset just for the
 * AI-config row, and the chips stay sharp at any zoom level.
 */
const GLYPH: Record<ModelCapability, string> = {
  text: "T",
  vision: "👁",
  reasoning: "✦",
  tools: "⚙",
  "image-gen": "🎨",
  audio: "♪",
  embedding: "≋"
};

/**
 * Render a horizontal stack of small badges describing what a model can do.
 *
 * Used in:
 *  - the AI config page model list (each row)
 *  - the ModelSelector dropdown (per-model rows)
 *
 * Pass `size="sm"` (the default) for tight model rows; `size="md"` is the
 * variant used in the dropdown where rows have more vertical breathing room.
 */
export function CapabilityChips({
  capabilities,
  size = "sm",
  hideText = true
}: {
  capabilities: ModelCapability[] | null | undefined;
  size?: "sm" | "md";
  /** Drop the `text` capability from the rendered chips; on by default. */
  hideText?: boolean;
}) {
  const { t } = useTranslation();
  if (!capabilities || capabilities.length === 0) return null;
  const filtered = VISIBLE_ORDER.filter((c) =>
    capabilities.includes(c) && (hideText || c !== "text")
  );
  if (filtered.length === 0) return null;
  const sizeClass =
    size === "md"
      ? "h-[18px] px-1.5 text-[10px]"
      : "h-[16px] px-1 text-[9.5px]";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {filtered.map((c) => (
        <span
          key={c}
          className={`${sizeClass} ${TINT[c]} inline-flex items-center gap-0.5 rounded font-medium`}
          title={t(`capabilities.${c}`)}
        >
          <span aria-hidden>{GLYPH[c]}</span>
          <span className="hidden xl:inline">{t(`capabilities.${c}`)}</span>
        </span>
      ))}
    </span>
  );
}
