/**
 * Agent runtime smoke tests.
 *
 * Goals:
 *  - The default tool registry exposes the 5 starter tools (Read /
 *    Write / Edit / Glob / Bash) and each has a JSON-schema view.
 *  - `executeTool` runs Read against a real file through `AgentStore`
 *    persistence — exercises the safeParse → validate → permission →
 *    call → mapResultToBlock pipeline.
 *  - `queryLoop` drives a fake adapter end-to-end: the adapter yields
 *    a `tool_use` block, the loop runs the tool, the adapter yields
 *    text and a terminal `message_stop`, the loop terminates with
 *    `completed`. message_part rows persist text + tool_use +
 *    tool_result; permission_rule "any" rule auto-allows.
 */

import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppDatabase } from "../main/db/database.js";
import { buildDefaultToolRegistry } from "../main/agent/tools/registry.js";
import { zodToJsonSchema } from "../main/agent/llm/toolSpec.js";
import { ReadTool } from "../main/agent/tools/Read/index.js";
import { executeTool } from "../main/agent/runtime/toolExecution.js";
import { PermissionGate, type PermissionApprover } from "../main/agent/permissions/gate.js";
import { queryLoop } from "../main/agent/runtime/queryLoop.js";
import type { AgentEvent } from "../main/agent/runtime/types.js";
import type { LlmAdapter, LlmStreamEvent } from "../main/agent/llm/types.js";
import { registerAdapter } from "../main/agent/llm/adapters/index.js";
import { getMode } from "../shared/modes.js";

let tmpRoot: string;
let dbFile: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-test-"));
  dbFile = path.join(tmpRoot, "test.db");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("default tool registry", () => {
  it("exposes the 5 starter tools", () => {
    const r = buildDefaultToolRegistry();
    const names = r.list().map((t) => t.name).sort();
    expect(names).toEqual(["Bash", "Edit", "Glob", "Read", "Write"]);
  });

  it("every tool has a JSON-schema input description", () => {
    const r = buildDefaultToolRegistry();
    for (const tool of r.list()) {
      const schema = tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema);
      expect(schema).toBeDefined();
      expect(typeof schema).toBe("object");
      expect((schema as { type: string }).type).toBe("object");
    }
  });

  it("Bash is destructive + not concurrency-safe", () => {
    const r = buildDefaultToolRegistry();
    const bash = r.get("Bash")!;
    expect(bash.isReadOnly({ command: "ls" } as never)).toBe(false);
    expect(bash.isConcurrencySafe({ command: "ls" } as never)).toBe(false);
    expect(bash.isDestructive?.({ command: "ls" } as never)).toBe(true);
  });
});

describe("Read tool — full pipeline through executeTool", () => {
  it("reads a small file with line numbers", async () => {
    const db = new AppDatabase(dbFile);
    const proj = db.createProject({ name: "smoke", path: tmpRoot });

    const file = path.join(tmpRoot, "hello.txt");
    await fs.writeFile(file, "alpha\nbeta\ngamma\n");

    // Create a message row to attach the tool_run to.
    const conv = db.createConversation({ projectId: proj.id, name: "test" });
    const placeholder = db.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: ""
    });

    const approver: PermissionApprover = {
      ask: async () => ({ kind: "allow", scope: "session" })
    };
    const gate = new PermissionGate(db.agent, approver);

    const res = await executeTool(
      ReadTool,
      { path: "hello.txt", offset: 1, limit: 10 },
      "call_read_1",
      {
        projectRoot: tmpRoot,
        conversationId: conv.id,
        messageId: placeholder.id,
        store: db.agent,
        gate,
        scope: { projectId: proj.id, conversationId: conv.id },
        signal: new AbortController().signal
      }
    );
    expect(res.status).toBe("completed");
    expect(res.isError).toBe(false);
    // The block output should include the line-numbered content.
    const text = res.block.output.kind === "text" ? res.block.output.text : "";
    expect(text).toMatch(/alpha/);
    expect(text).toMatch(/beta/);
    expect(text).toMatch(/gamma/);
  });
});

describe("queryLoop with a fake adapter", () => {
  it("runs a tool, terminates with completed, and persists parts", async () => {
    const db = new AppDatabase(dbFile);
    const proj = db.createProject({ name: "smoke", path: tmpRoot });
    const conv = db.createConversation({ projectId: proj.id, name: "test" });

    await fs.writeFile(path.join(tmpRoot, "hello.txt"), "alpha\nbeta\n");

    // 1. install a `permission_rule` row so the gate auto-allows.
    db.agent.insertPermissionRule({
      scope: "session",
      projectId: null,
      conversationId: null,
      toolName: "Read",
      patternJson: JSON.stringify({ kind: "any" }),
      behavior: "allow",
      source: "user_decision"
    });

    // 2. install a fake adapter for the protocol "smoke-llm".
    let turn = 0;
    const fakeAdapter: LlmAdapter = {
      async *stream(): AsyncIterable<LlmStreamEvent> {
        turn += 1;
        if (turn === 1) {
          // First turn: emit one tool_use targeting Read.
          yield { type: "message_start" };
          yield { type: "tool_use_start", id: "call_1", name: "Read" };
          yield {
            type: "tool_use_stop",
            id: "call_1",
            finalInput: { path: "hello.txt" }
          };
          yield { type: "message_stop", stopReason: "tool_use" };
        } else {
          // Second turn: emit text + end.
          yield { type: "message_start" };
          yield { type: "text_delta", text: "Read it." };
          yield { type: "message_stop", stopReason: "end_turn" };
        }
      }
    };
    registerAdapter("smoke-llm", fakeAdapter);

    const approver: PermissionApprover = {
      ask: async () => ({ kind: "deny" }) // shouldn't trigger
    };
    const gate = new PermissionGate(db.agent, approver);
    const registry = buildDefaultToolRegistry();

    const events: AgentEvent[] = [];
    for await (const ev of queryLoop({
      runId: "run_smoke",
      conversationId: conv.id,
      projectId: proj.id,
      projectRoot: tmpRoot,
      userMessage: "Read hello.txt",
      mode: getMode("agent"),
      provider: {
        id: "smoke",
        protocol: "smoke-llm",
        baseUrl: "",
        apiKey: ""
      },
      model: "smoke",
      language: "en",
      tools: registry.list(),
      signal: new AbortController().signal,
      db,
      gate
    })) {
      events.push(ev);
      if (ev.kind === "terminal") break;
    }

    const terminal = events[events.length - 1];
    expect(terminal.kind).toBe("terminal");
    if (terminal.kind === "terminal") {
      expect(terminal.reason).toBe("completed");
    }

    // 3. tool_run row was created + completed
    const runs = db.agent.listToolRunsForConversation(conv.id);
    expect(runs.length).toBe(1);
    expect(runs[0].toolName).toBe("Read");
    expect(runs[0].status).toBe("completed");

    // 4. message_part rows include tool_use + tool_result + text.
    const parts = db.agent.listPartsForConversation(conv.id);
    const types = parts.map((p) => p.type);
    expect(types).toContain("tool_use");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
  });
});
