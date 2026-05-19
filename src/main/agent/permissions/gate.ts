/**
 * Permission gate (v0 — minimal).
 *
 * Resolves a permission decision for a `(tool, input)` pair. The v0
 * pipeline:
 *   1. Ask the tool itself (`tool.checkPermissions`). Static deny wins.
 *   2. Consult persisted `permission_rule` rows (session > project >
 *      user, deny always wins on tie).
 *   3. If still "ask" or "passthrough", emit an IPC request to the
 *      renderer and wait for the user's choice.
 *
 * M1 (id: m1_perm) expands step 2's pattern matching and step 3's UI
 * affordances ("always allow this exact command", "allow any command
 * starting with `git status`", …). For v0 we accept simple
 * `{ kind: "literal", value: string }` patterns plus `{ kind: "any" }`
 * blanket rules so `ask`/`allow` round-trips can persist after M1.
 */

import { randomUUID } from "node:crypto";
import type { Tool, PermissionDecision } from "../tools/Tool.js";
import type { AgentStore, PermissionRule } from "../../db/agent-store.js";

export interface PermissionScopeRef {
  projectId: string | null;
  conversationId: string | null;
}

export interface PermissionApprover {
  /** Ask the user via IPC; resolves once they choose. The promise must
   *  reject with an `AbortError`-shaped error when the run is
   *  cancelled. */
  ask(req: PermissionAskRequest, signal: AbortSignal): Promise<PermissionAskResponse>;
}

export interface PermissionAskRequest {
  id: string;
  conversationId: string;
  toolName: string;
  toolDescription: string;
  /** Already-validated input (zod-parsed) — safe to JSON.stringify. */
  input: unknown;
  toolReason?: string;
  /** Optional pre-formatted UI preview the tool wants to show (e.g. the
   *  bash command, the target file path). */
  uiPreview?: { title?: string; subtitle?: string; body?: string };
}

export type PermissionAskResponse =
  | { kind: "allow"; scope: "once" | "session" | "project" }
  | { kind: "deny" };

export class PermissionGate {
  /** When true, all permission checks return "allow" immediately. */
  public bypassAll = false;

  constructor(
    private readonly store: AgentStore,
    private readonly approver: PermissionApprover
  ) {}

  /** Top-level entry. Returns a decision the executor can act on:
   *  `{ behavior: "allow" }` or `{ behavior: "deny", reason }`. */
  async resolve(
    tool: Tool,
    input: unknown,
    scope: PermissionScopeRef & { toolCallId: string; signal: AbortSignal },
    ctxBundle: { toolCallId: string; signal: AbortSignal; conversationId: string }
  ): Promise<{ behavior: "allow"; reason?: string } | { behavior: "deny"; reason: string }> {
    // Step 0 — bypass all checks when the user toggled "免审模式".
    if (this.bypassAll) {
      return { behavior: "allow", reason: "bypass mode" };
    }

    // Step 1 — let the tool object weigh in.
    const initial: PermissionDecision = await tool.checkPermissions(
      input as never,
      // Build a minimal ctx; the tool gate cares about projectRoot but
      // we don't bind it here. v0 tools that care about the project
      // root validate in `validateInput` instead.
      {
        projectRoot: "",
        conversationId: ctxBundle.conversationId,
        messageId: "",
        toolCallId: ctxBundle.toolCallId,
        signal: ctxBundle.signal,
        canUseTool: async () => ({ behavior: "passthrough" })
      }
    );

    if (initial.behavior === "deny") {
      return { behavior: "deny", reason: initial.reason };
    }
    if (initial.behavior === "allow") {
      return { behavior: "allow", reason: initial.reason };
    }

    // Step 2 — consult persisted rules.
    const rules = this.store.listPermissionRules(tool.name, {
      projectId: scope.projectId,
      conversationId: scope.conversationId
    });
    const ruleHit = matchRule(rules, input);
    if (ruleHit) {
      if (ruleHit.behavior === "deny") {
        return { behavior: "deny", reason: `permission rule denies ${tool.name}` };
      }
      if (ruleHit.behavior === "allow") {
        return { behavior: "allow", reason: `permission rule allows ${tool.name}` };
      }
      // explicit ask rule → fall through to step 3
    }

    // Step 3 — ask the user.
    const askReason =
      initial.behavior === "ask" ? initial.reason : undefined;
    const askId = randomUUID();
    const renderUse = tool.renderUseForUI?.(input as never);
    const resp = await this.approver.ask(
      {
        id: askId,
        conversationId: ctxBundle.conversationId,
        toolName: tool.name,
        toolDescription: tool.description,
        input,
        toolReason: askReason,
        uiPreview: {
          title: renderUse?.label ?? tool.name,
          subtitle: renderUse?.subtitle
        }
      },
      ctxBundle.signal
    );
    if (resp.kind === "deny") {
      return { behavior: "deny", reason: "user denied" };
    }
    if (resp.scope === "session" || resp.scope === "project") {
      // "本会话允许" / "本项目允许" blanket-allows the entire tool
      // so the user doesn't get re-prompted for every different input.
      this.store.insertPermissionRule({
        scope: resp.scope,
        projectId: resp.scope === "project" ? scope.projectId : null,
        conversationId: resp.scope === "session" ? scope.conversationId : null,
        toolName: tool.name,
        patternJson: JSON.stringify({ kind: "any" }),
        behavior: "allow",
        source: "user_decision"
      });
    }
    return { behavior: "allow", reason: "user allowed" };
  }
}

/* -------------------------------------------------------------------------- */
/* Pattern matching                                                           */
/* -------------------------------------------------------------------------- */

/** Find the highest-precedence rule that matches `input`. */
function matchRule(rules: PermissionRule[], input: unknown): PermissionRule | null {
  // Precedence: session > project > user; deny always wins on tie.
  const sorted = [...rules].sort((a, b) => scopePriority(b.scope) - scopePriority(a.scope));
  for (const r of sorted) {
    if (matchesPattern(r.patternJson, input, r.toolName)) {
      return r;
    }
  }
  // After the highest-precedence non-deny, check for any deny at any scope.
  const deny = rules.find((r) => r.behavior === "deny" && matchesPattern(r.patternJson, input, r.toolName));
  if (deny) return deny;
  return null;
}

function scopePriority(scope: PermissionRule["scope"]): number {
  return scope === "session" ? 3 : scope === "project" ? 2 : 1;
}

function matchesPattern(patternJson: string, input: unknown, toolName: string): boolean {
  let pattern: { kind: string; value?: unknown };
  try {
    pattern = JSON.parse(patternJson);
  } catch {
    return false;
  }
  if (pattern.kind === "any") return true;
  if (pattern.kind === "literal") {
    return JSON.stringify(literalPatternFor(toolName, input).value) === JSON.stringify(pattern.value);
  }
  if (pattern.kind === "bash_verb") {
    const command =
      typeof (input as { command?: unknown })?.command === "string"
        ? String((input as { command: string }).command)
        : "";
    const verb = (command.match(/^([\w./-]+)/)?.[1] ?? "").toLowerCase();
    return typeof pattern.value === "string" && pattern.value === verb;
  }
  return false;
}

/** Produce the "literal" pattern used when the user clicks "always
 *  allow". For Bash this is the verb (first token) so e.g. "ls -la"
 *  doesn't re-prompt for "ls foo/bar"; for other tools it's the full
 *  input. */
function literalPatternFor(toolName: string, input: unknown): { kind: string; value: unknown } {
  if (toolName === "Bash") {
    const command =
      typeof (input as { command?: unknown })?.command === "string"
        ? String((input as { command: string }).command)
        : "";
    const verb = (command.match(/^([\w./-]+)/)?.[1] ?? "").toLowerCase();
    return { kind: "bash_verb", value: verb };
  }
  return { kind: "literal", value: input };
}
