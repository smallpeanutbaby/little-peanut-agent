/**
 * Adapter registry. Resolves `provider.protocol` to a canonical
 * adapter. Unknown protocols fall back to OpenAI Chat Completions (the
 * widest-compatible dialect) and log a one-off warning.
 */

import type { LlmAdapter, ProviderRef } from "../types.js";
import { OpenAILlmAdapter } from "./openai.js";
import { AnthropicLlmAdapter } from "./anthropic.js";
import { GeminiLlmAdapter } from "./gemini.js";

const ADAPTERS: Record<string, LlmAdapter> = {
  "openai-chat": new OpenAILlmAdapter(),
  "openai-compatible": new OpenAILlmAdapter(),
  "openai-responses": new OpenAILlmAdapter(),
  "anthropic-messages": new AnthropicLlmAdapter(),
  // Gemini ships as the wire protocol id used by the existing
  // `ProtocolId` enum + the chat-side adapter so users with a Gemini
  // provider configured pick this up automatically once they enable
  // agent mode.
  gemini: new GeminiLlmAdapter()
};

const warned = new Set<string>();
function warnOnce(protocol: string) {
  if (warned.has(protocol)) return;
  warned.add(protocol);
  console.warn(
    `[agent/llm] no canonical adapter for protocol '${protocol}'; falling back to openai-chat.`
  );
}

export function getCanonicalAdapter(provider: ProviderRef): LlmAdapter {
  const adapter = ADAPTERS[provider.protocol];
  if (adapter) return adapter;
  warnOnce(String(provider.protocol));
  return ADAPTERS["openai-chat"];
}

/** Register a custom adapter. Used by tests + by third-party
 *  integrations (M2-2 ships the third real provider through this). */
export function registerAdapter(protocol: string, adapter: LlmAdapter): void {
  ADAPTERS[protocol] = adapter;
}

export { OpenAILlmAdapter } from "./openai.js";
export { AnthropicLlmAdapter } from "./anthropic.js";
export { GeminiLlmAdapter } from "./gemini.js";
