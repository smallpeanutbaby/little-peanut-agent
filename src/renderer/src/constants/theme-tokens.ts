import type { BackgroundColor, TextColor } from "@shared/types";

/**
 * Per-background color token set used to drive CSS custom properties
 * (`--lp-bg`, `--lp-side-bg`, etc.) on the app shell.
 *
 * Two themes today (dark / light). Adding a new background = add a new entry
 * here AND extend the `BackgroundColor` union in `@shared/types`.
 */
export const backgroundClassMap: Record<
  BackgroundColor,
  { base: string; top: string; side: string; main: string; panel: string; panel2: string; border: string }
> = {
  dark: {
    base: "#0a0a0a",
    top: "#111111",
    side: "rgba(10,10,10,0.86)",
    main: "rgba(14,14,14,0.8)",
    panel: "rgba(255,255,255,0.05)",
    panel2: "rgba(255,255,255,0.08)",
    border: "rgba(255,255,255,0.12)"
  },
  light: {
    base: "#f5f5f5",
    top: "#ffffff",
    // Both `side` and `main` are intentionally fully opaque on light shells —
    // popover surfaces in the codebase paint with `bg-[var(--lp-main-bg)]`
    // plus `backdrop-blur-2xl`, so any translucency lets the chat content
    // bleed through and turns labels into ghosts.
    side: "#fafafa",
    main: "#ffffff",
    panel: "rgba(0,0,0,0.04)",
    panel2: "rgba(0,0,0,0.06)",
    border: "rgba(0,0,0,0.14)"
  }
};

/**
 * Per-text-color token set. Maps the human-readable name (e.g. "ivory") to
 * the three foreground variants the UI consumes (`--lp-text`, `--lp-muted`,
 * `--lp-soft-text`).
 */
export const textClassMap: Record<TextColor, { main: string; muted: string; soft: string }> = {
  ivory: { main: "rgba(255,246,233,0.94)", muted: "rgba(255,232,193,0.46)", soft: "rgba(255,255,255,0.28)" },
  "warm-white": { main: "rgba(255,250,244,0.96)", muted: "rgba(255,241,222,0.48)", soft: "rgba(255,255,255,0.3)" },
  cream: { main: "rgba(250,242,229,0.95)", muted: "rgba(244,229,204,0.46)", soft: "rgba(255,250,242,0.28)" },
  "soft-gold": { main: "rgba(244,225,180,0.96)", muted: "rgba(234,205,145,0.52)", soft: "rgba(244,225,180,0.24)" },
  charcoal: { main: "rgba(43,35,27,0.95)", muted: "rgba(91,76,57,0.7)", soft: "rgba(78,65,49,0.55)" },
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
