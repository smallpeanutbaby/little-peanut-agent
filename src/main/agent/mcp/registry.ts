/**
 * MCP server manager + tool factory.
 *
 * - Holds one `McpConnection` per enabled MCP server config.
 * - Exposes `buildMcpTools()` which returns ready-to-register Tool
 *   instances mirroring every tool the connected servers advertise.
 * - Tool names are namespaced `mcp__<serverId>__<toolName>` so two
 *   servers exposing tools with the same name don't collide.
 *
 * Reload semantics: `refreshAll(configs)` reconciles connections to
 * the latest config list — drops removed servers, opens new ones,
 * leaves untouched servers alone. Called whenever the user toggles a
 * server in the MCP settings UI.
 */

import { z } from "zod";
import type { McpServerConfig } from "@shared/types.js";
import { McpConnection, type McpToolDescriptor } from "./McpConnection.js";
import { buildTool, blockFromText, type Tool } from "../tools/Tool.js";

class McpManager {
  private connections = new Map<string, McpConnection>();
  private cachedTools: Tool[] | null = null;

  async refreshAll(configs: McpServerConfig[]): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    const want = new Set(enabled.map((c) => c.id));
    for (const id of [...this.connections.keys()]) {
      if (!want.has(id)) {
        this.connections.get(id)?.close();
        this.connections.delete(id);
      }
    }
    for (const cfg of enabled) {
      if (!this.connections.has(cfg.id)) {
        this.connections.set(cfg.id, new McpConnection(cfg));
      }
    }
    // Try to connect everything in parallel; ignore individual failures.
    await Promise.allSettled(
      [...this.connections.values()].map((c) => c.connect())
    );
    this.cachedTools = null;
  }

  /** Build a `Tool` per tool every connected server exposes. */
  async buildTools(): Promise<Tool[]> {
    if (this.cachedTools) return this.cachedTools;
    const out: Tool[] = [];
    for (const [serverId, conn] of this.connections.entries()) {
      let descriptors: McpToolDescriptor[] = [];
      try {
        descriptors = await conn.listTools();
      } catch (e) {
        console.warn(`[mcp:${serverId}] tools/list failed`, e);
        continue;
      }
      for (const desc of descriptors) {
        out.push(buildMcpTool(serverId, conn, desc));
      }
    }
    this.cachedTools = out;
    return out;
  }

  closeAll(): void {
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
    this.cachedTools = null;
  }
}

let _singleton: McpManager | null = null;
export function getMcpManager(): McpManager {
  if (!_singleton) _singleton = new McpManager();
  return _singleton;
}

/* -------------------------------------------------------------------------- */
/* Tool factory                                                               */
/* -------------------------------------------------------------------------- */

function buildMcpTool(serverId: string, conn: McpConnection, desc: McpToolDescriptor): Tool {
  const namespaced = `mcp__${serverId}__${desc.name}`;
  // MCP server schemas are already JSON Schema; we keep them verbatim and
  // sidestep zod by using a passthrough zod object whose JSON schema we
  // override via `inputJsonSchema`.
  const passthrough = z.unknown() as unknown as z.ZodTypeAny;
  return buildTool({
    name: namespaced,
    aliases: [desc.name],
    description: desc.description ?? `MCP tool from ${serverId}`,
    inputSchema: passthrough,
    inputJsonSchema: (desc.inputSchema && typeof desc.inputSchema === "object" ? desc.inputSchema : { type: "object" }) as Record<string, unknown>,
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    prompt: () =>
      `Calls the \`${desc.name}\` tool on MCP server \`${serverId}\`.${
        desc.description ? ` — ${desc.description}` : ""
      }`,
    checkPermissions() {
      // Always ask the first time — the server might do anything.
      return { behavior: "ask" as const, reason: `Call MCP tool ${desc.name} on server ${serverId}?` };
    },
    async call(input: unknown, ctx) {
      if (ctx.signal.aborted) {
        return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
      }
      try {
        const result = await conn.callTool(desc.name, input, ctx.signal);
        if (result.isError) {
          const msg = mcpContentToText(result.content);
          return { ok: false, errorCode: "mcp_error", errorMessage: msg || "MCP tool returned isError=true" };
        }
        return { ok: true, value: { content: result.content, text: mcpContentToText(result.content) } };
      } catch (e) {
        return { ok: false, errorCode: "mcp_call_failed", errorMessage: (e as Error).message };
      }
    },
    mapResultToBlock(out: { content: unknown[]; text: string }, toolUseId: string) {
      return blockFromText(toolUseId, out.text || JSON.stringify(out.content));
    },
    renderResultForUI(out: { text: string }) {
      return {
        variant: "ok" as const,
        title: `MCP  ${desc.name}`,
        body: (out.text || "").split("\n").slice(0, 40).join("\n")
      };
    },
    renderUseForUI() {
      return { label: `MCP ${desc.name}`, subtitle: serverId };
    }
  }) as Tool;
}

function mcpContentToText(content: Array<{ type: string; [k: string]: unknown }>): string {
  const out: string[] = [];
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") out.push(c.text);
    else if (c.type === "image") out.push(`[image: ${String(c.mimeType ?? "?")}]`);
    else out.push(JSON.stringify(c));
  }
  return out.join("\n");
}
