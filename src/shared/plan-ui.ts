/**
 * Plan-mode helpers shared between main-process runtime and renderer UI.
 */

export function isPlanFinalPlan(text: string): boolean {
  return text.includes("## 实施方案");
}

export function isPlanClarificationOnly(text: string): boolean {
  return text.includes("## 需要先确认") && !text.includes("## 实施方案");
}

export function isFinalPlanMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isPlanClarificationOnly(t)) return false;
  return isPlanFinalPlan(t);
}

export function userSkippedPlanClarify(text: string): boolean {
  return /直接出方案|跳过确认|不用问|开始吧|开始执行|^go\b|skip/i.test(text.trim());
}

export interface PlanClarifyQuestion {
  id: string;
  title: string;
  prompt: string;
  options: string[];
}

/** Extract bullet options and Q1/Q2 headings from a Phase-2 clarify message. */
export function parsePlanClarifyQuestions(markdown: string): PlanClarifyQuestion[] {
  const section = extractSection(markdown, "需要先确认");
  if (!section) return [];

  const questions: PlanClarifyQuestion[] = [];
  const blocks = section.split(/\*\*Q\d+\./).slice(1);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const titleEnd = block.indexOf("**");
    const title = titleEnd >= 0 ? block.slice(0, titleEnd).trim() : `问题 ${i + 1}`;
    const rest = titleEnd >= 0 ? block.slice(titleEnd + 2) : block;
    const lines = rest.split("\n").map((l) => l.trim()).filter(Boolean);
    const prompt = lines.find((l) => !l.startsWith("-")) ?? "";
    const options = lines
      .filter((l) => /^[-*]\s/.test(l) || /^选项\s*[A-Z]/i.test(l))
      .map((l) => l.replace(/^[-*]\s*/, "").trim());
    questions.push({
      id: `q${i + 1}`,
      title,
      prompt,
      options
    });
  }

  return questions;
}

export function extractSection(markdown: string, heading: string): string | null {
  const re = new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`, "i");
  const m = markdown.match(re);
  if (!m) return null;
  return m[0].replace(new RegExp(`^##\\s*${heading}\\s*`, "i"), "").trim();
}
