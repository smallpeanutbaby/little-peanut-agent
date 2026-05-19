/**
 * Skills loader.
 *
 * A "skill" is a folder under one of these roots:
 *   - `<projectRoot>/.agent/skills/<skill-name>/`
 *   - `<userData>/skills/<skill-name>/`           (global)
 *
 * Each skill folder MUST contain a `SKILL.md` file. We parse the YAML
 * frontmatter for `description` + optional `tags` + optional
 * `auto_load: true` (default false — the model has to call the Skill
 * tool to opt in for that turn).
 *
 * On every agent run we:
 *   1. Discover every skill via `loadSkills(roots)` (cheap glob).
 *   2. Inject the descriptions into the system prompt as a Markdown
 *      list (segment 3, after the env segment).
 *   3. Hand the descriptors to the Skill tool so it can `load(name)`
 *      on demand.
 *
 * The Skill tool itself returns the SKILL.md body as a text block —
 * the runtime treats it as added context for the next assistant turn.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  parseMemoryFile,
  type MemoryFrontmatter as Frontmatter
} from "../memory/paths.js";

export interface SkillDescriptor {
  /** Unique identifier (folder basename). */
  name: string;
  /** Absolute path to the skill folder. */
  dir: string;
  /** Absolute path to `SKILL.md`. */
  skillPath: string;
  description: string;
  tags: string[];
  autoLoad: boolean;
  source: "project" | "user";
}

export async function loadSkills(roots: Array<{ dir: string; source: "project" | "user" }>): Promise<SkillDescriptor[]> {
  const out: SkillDescriptor[] = [];
  for (const root of roots) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root.dir, e.name);
      const skillPath = path.join(dir, "SKILL.md");
      let raw: string;
      try {
        raw = await fs.readFile(skillPath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseMemoryFile(raw);
      const fm = parsed.frontmatter as Frontmatter & { auto_load?: unknown };
      out.push({
        name: e.name,
        dir,
        skillPath,
        description: typeof fm.description === "string" ? fm.description : firstLine(parsed.body),
        tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [],
        autoLoad: fm.auto_load === true,
        source: root.source
      });
    }
  }
  return out;
}

export async function readSkillBody(skill: SkillDescriptor): Promise<{ frontmatter: Frontmatter; body: string }> {
  const raw = await fs.readFile(skill.skillPath, "utf8");
  const parsed = parseMemoryFile(raw);
  return parsed;
}

function firstLine(body: string): string {
  return body.trim().split(/\r?\n/, 1)[0]?.slice(0, 200) ?? "";
}
