/**
 * Skill tool — load a registered skill's `SKILL.md` into the
 * conversation as additional context.
 *
 * The runtime resolves the SkillDescriptors via `bindSkillCatalog` and
 * the tool's `inputSchema.name` enum is dynamically generated at
 * registration time so the model only sees names it can actually use.
 *
 * Permission model: always-allow. Reading a SKILL.md file from a
 * trusted location (project or user dir) has no side effects.
 */

import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";
import { readSkillBody, type SkillDescriptor } from "../../skills/loader.js";

let catalog: SkillDescriptor[] = [];
export function bindSkillCatalog(skills: SkillDescriptor[]): void {
  catalog = skills;
}
export function listSkillCatalog(): SkillDescriptor[] {
  return catalog;
}

/** Base schema — `name` is left as a plain string. The actual enum
 *  constraint is added in `mintSkillTool` so the model gets a fresh
 *  schema matching the current catalog. */
const baseSchema = z.object({
  name: z.string().min(1).describe("Skill name (folder basename, e.g. `create-rule`).")
});

type Input = z.infer<typeof baseSchema>;

interface Output {
  name: string;
  source: "project" | "user";
  description: string;
  body: string;
}

export const SkillTool: Tool<typeof baseSchema, Output> = buildTool({
  name: "Skill",
  aliases: ["load_skill"],
  description: "Load a registered skill's SKILL.md body into the conversation.",
  inputSchema: baseSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Load a registered skill's full SKILL.md. Use only when the skill description in the system prompt suggests it applies.",
      "Pass the skill name from the catalog (folder basename)."
    ].join("\n"),
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const skill = catalog.find((s) => s.name === input.name);
    if (!skill) {
      return { ok: false, errorCode: "unknown_skill", errorMessage: `unknown skill: ${input.name}` };
    }
    let body: string;
    let description: string = skill.description;
    try {
      const parsed = await readSkillBody(skill);
      body = parsed.body;
      const fmDesc = parsed.frontmatter.description;
      if (typeof fmDesc === "string") description = fmDesc;
    } catch (e) {
      return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
    }
    return {
      ok: true,
      value: { name: skill.name, source: skill.source, description, body }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `Skill ${out.name} [${out.source}]\n${out.description}`;
    return blockFromText(toolUseId, `${header}\n\n${out.body}`);
  },
  renderResultForUI(out) {
    return {
      variant: "ok",
      title: `Skill  ${out.name}  (${out.source})`,
      body: out.body.split("\n").slice(0, 60).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "Skill", subtitle: input.name };
  }
});
