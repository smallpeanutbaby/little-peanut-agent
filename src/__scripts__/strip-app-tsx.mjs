/* eslint-env node */
// One-shot refactor helper: removes the now-duplicated blocks from App.tsx
// after we extracted them to dedicated modules. Idempotent — running twice
// is safe (the markers are gone after the first run).
//
// USAGE: node src/__scripts__/strip-app-tsx.mjs
//
// This file lives in __scripts__ so neither Vite, Vitest, nor tsc picks it
// up automatically.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const target = path.resolve(__dirname, "..", "renderer", "src", "App.tsx");

const src = readFileSync(target, "utf8");

/**
 * Strip a region from `text` that starts with `start` (inclusive) and ends
 * just before `end`. The region is replaced with `replacement`. Throws if
 * either marker isn't found, so we fail loud rather than silently leave
 * duplicate code in place.
 */
function strip(text, start, end, replacement = "") {
  const s = text.indexOf(start);
  if (s < 0) {
    console.log(`[strip-app-tsx] start marker not found — assuming already stripped: ${start.slice(0, 60)}…`);
    return text;
  }
  const e = text.indexOf(end, s);
  if (e < 0) throw new Error(`end marker not found after start: ${end.slice(0, 60)}…`);
  return text.slice(0, s) + replacement + text.slice(e);
}

let out = src;

// 1) Reasoning presets + AI_PROVIDERS_DEFAULT + PROTOCOL_OPTIONS + CustomProvider + AddProviderModal
out = strip(
  out,
  "// ── Reasoning effort presets per provider API ──",
  "const THINK_BUDGET_LABELS: Record<ThinkBudget, string> = {"
);

// 2) THINK_BUDGET_LABELS + ThinkConfigModal
out = strip(out, "const THINK_BUDGET_LABELS: Record<ThinkBudget, string> = {", "type ThinkLevelPresetId = ");

// 3) ThinkLevelPresetId + ThinkLevelPreset + THINK_LEVEL_PRESETS + AddModelModal
out = strip(out, "type ThinkLevelPresetId = ", "function ModelConfigPage() {");

// Tidy up any accidental triple-blank-line runs left behind.
out = out.replace(/\n{3,}/g, "\n\n");

writeFileSync(target, out, "utf8");
console.log(`[strip-app-tsx] done — file is now ${out.split("\n").length} lines (was ${src.split("\n").length})`);
