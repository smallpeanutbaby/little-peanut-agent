/**
 * Tool registry.
 *
 * A flat map keyed by tool name (case-sensitive). The runtime resolves
 * tool_use blocks against this registry; unknown tool names produce a
 * tool_result with `isError: true` so the model can self-correct.
 *
 * Subagents and contexts that want a narrower toolset (e.g. "no Bash")
 * filter the default registry before passing it to `buildTurnContext`.
 */

import type { Tool } from "./Tool.js";
import { ReadTool } from "./Read/index.js";
import { WriteTool } from "./Write/index.js";
import { EditTool } from "./Edit/index.js";
import { GlobTool } from "./Glob/index.js";
import { BashTool } from "./Bash/index.js";
import { TodoWriteTool } from "./TodoWrite/index.js";
import { GrepTool } from "./Grep/index.js";
import { WebFetchTool } from "./WebFetch/index.js";
import { WebSearchTool } from "./WebSearch/index.js";
import { MemoryReadTool } from "./MemoryRead/index.js";
import { MemoryWriteTool } from "./MemoryWrite/index.js";
import { ListDirTool } from "./ListDir/index.js";
import { ReadLintsTool } from "./ReadLints/index.js";
import { DeleteTool } from "./Delete/index.js";
import { TaskTool } from "./Task/index.js";
import { SkillTool } from "./Skill/index.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  /** Reverse lookup `alias -> canonical name`. */
  private readonly aliasIndex = new Map<string, string>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      this.aliasIndex.set(alias, tool.name);
    }
  }

  get(name: string): Tool | undefined {
    if (this.tools.has(name)) return this.tools.get(name);
    const canonical = this.aliasIndex.get(name);
    if (canonical) return this.tools.get(canonical);
    return undefined;
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Remove a tool from the registry. Returns true if the tool was
   *  present; aliases for that tool are also removed. */
  unregister(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    this.tools.delete(name);
    for (const [alias, canonical] of this.aliasIndex.entries()) {
      if (canonical === name) this.aliasIndex.delete(alias);
    }
    return true;
  }

  /** Subset filtered by an allowlist (used by subagents to drop Bash /
   *  Task). Unknown names in the allowlist are silently ignored. */
  filtered(allow: ReadonlyArray<string>): Tool[] {
    const set = new Set(allow);
    return this.list().filter((t) => set.has(t.name));
  }
}

/** Build the default v1 registry with the 5 starter tools. New tools
 *  added in M1/M2/M3 should land here so the agent picks them up
 *  automatically. */
export function buildDefaultToolRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(ReadTool as Tool);
  r.register(WriteTool as Tool);
  r.register(EditTool as Tool);
  r.register(GlobTool as Tool);
  r.register(GrepTool as Tool);
  r.register(BashTool as Tool);
  r.register(TodoWriteTool as Tool);
  r.register(WebFetchTool as Tool);
  r.register(WebSearchTool as Tool);
  r.register(MemoryReadTool as Tool);
  r.register(MemoryWriteTool as Tool);
  r.register(ListDirTool as Tool);
  r.register(ReadLintsTool as Tool);
  r.register(DeleteTool as Tool);
  r.register(TaskTool as Tool);
  r.register(SkillTool as Tool);
  return r;
}
