/**
 * Run-completion hooks ("stop hooks").
 *
 * Currently ships one optional hook: `extractMemories`. Default OFF.
 *
 * `extractMemories` runs a small follow-up LLM call after each
 * non-cancelled run, asking the model to identify any "should we keep
 * this around?" candidates (decisions, conventions, gotchas). The
 * candidates are written as Markdown files into `.agent/memory/` after
 * a user-explicit "save" through the UI — never silently.
 *
 * The hook itself does NOT auto-write. It only proposes. M3-3 wires
 * the proposal generation; the renderer surface that lets the user
 * accept/decline is intentionally out of scope here (a notification
 * panel — to be added by the UI team).
 */

import type { AppDatabase } from "../../db/database.js";
import type { ProviderRef } from "../llm/types.js";
import { getCanonicalAdapter } from "../llm/adapters/index.js";

export interface MemoryProposal {
  /** Filename to suggest under `.agent/memory/` (e.g. `decisions/build.md`). */
  path: string;
  type: "convention" | "decision" | "note" | "reference";
  description: string;
  body: string;
}

export interface ExtractMemoriesInput {
  db: AppDatabase;
  projectId: string;
  conversationId: string;
  provider: ProviderRef;
  model: string;
  signal: AbortSignal;
}

/** Default OFF — flip to true in user settings to enable. */
let extractEnabled = false;
export function setExtractMemoriesEnabled(enabled: boolean): void {
  extractEnabled = enabled;
}
export function isExtractMemoriesEnabled(): boolean {
  return extractEnabled;
}

/**
 * Run the hook. Yields zero or more `MemoryProposal`s. Caller is
 * responsible for surfacing them to the user and (after user approval)
 * writing them via the `MemoryWrite` tool.
 */
export async function extractMemories(input: ExtractMemoriesInput): Promise<MemoryProposal[]> {
  if (!extractEnabled) return [];
  if (input.signal.aborted) return [];

  // Pull the recent transcript for context — last ~3000 chars worth.
  const recent = recentTranscript(input.db, input.conversationId, 3000);
  if (!recent) return [];

  const adapter = getCanonicalAdapter(input.provider);
  const system = [
    "You are a memory extractor for a coding agent.",
    "Read the transcript and propose at most 3 Markdown memory notes that capture decisions, conventions, or reusable references the agent (or user) is likely to want next time.",
    "Strictly output a JSON array of objects with fields {path, type, description, body}. No prose around the JSON.",
    "Paths should be short and kebab-case, under one of: decisions/, conventions/, notes/, references/.",
    "Body should be brief Markdown (≤ 30 lines)."
  ].join(" ");

  const proposals: MemoryProposal[] = [];
  let text = "";
  for await (const ev of adapter.stream({
    provider: input.provider,
    model: input.model,
    system: [system],
    messages: [
      {
        role: "user",
        blocks: [
          {
            type: "text",
            text: `Recent transcript:\n\n${recent}\n\nReturn a JSON array of memory proposals (at most 3, possibly empty).`
          }
        ]
      }
    ],
    temperature: 0.1,
    maxOutputTokens: 1500,
    signal: input.signal
  })) {
    if (ev.type === "text_delta") text += ev.text;
    if (ev.type === "message_stop") break;
  }
  const jsonText = extractJsonArray(text);
  if (!jsonText) return [];
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { path?: unknown }).path === "string" &&
        typeof (item as { body?: unknown }).body === "string"
      ) {
        const i = item as {
          path: string;
          type?: string;
          description?: string;
          body: string;
        };
        proposals.push({
          path: ensureMdSuffix(i.path),
          type: (i.type as MemoryProposal["type"]) ?? "note",
          description: i.description ?? "",
          body: i.body
        });
      }
    }
  } catch {
    return [];
  }
  return proposals;
}

function recentTranscript(db: AppDatabase, conversationId: string, maxChars: number): string {
  const messages = db.listMessages(conversationId);
  let buffer: string[] = [];
  let used = 0;
  // Walk from the end so the freshest content wins the budget.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line = `[${m.role}] ${m.content}`;
    if (used + line.length > maxChars) break;
    buffer.push(line);
    used += line.length;
  }
  return buffer.reverse().join("\n\n");
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function ensureMdSuffix(p: string): string {
  return p.endsWith(".md") ? p : `${p}.md`;
}
