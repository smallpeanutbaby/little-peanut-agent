import { describe, expect, it } from "vitest";
import type { CanonicalMessage } from "../main/agent/llm/types.js";
import { prepareContextForLlm, computePromptHardCap } from "../main/agent/context/budget.js";
import { tokensForHistory } from "../main/agent/context/tokenizer.js";

function bigReadResult(id: string, chars: number): CanonicalMessage {
  return {
    role: "user",
    blocks: [
      {
        type: "tool_result",
        toolUseId: id,
        output: { kind: "text", text: "x".repeat(chars) },
        isError: false
      }
    ]
  };
}

describe("prepareContextForLlm", () => {
  const deepseekCtx = { contextWindow: 128_000, promptBudget: 96_000 };

  it("keeps small histories unchanged", () => {
    const history: CanonicalMessage[] = [
      { role: "user", blocks: [{ type: "text", text: "hello" }] },
      { role: "assistant", blocks: [{ type: "text", text: "hi" }] }
    ];
    const prepared = prepareContextForLlm(history, deepseekCtx);
    expect(prepared.compacted).toBe(false);
    expect(prepared.usedTokens).toBeLessThanOrEqual(deepseekCtx.contextWindow);
  });

  it("compresses oversized agent history under the hard cap", () => {
    const history: CanonicalMessage[] = [];
    for (let i = 0; i < 20; i++) {
      history.push({
        role: "assistant",
        blocks: [{ type: "tool_use", id: `call-${i}`, name: "Read", input: { path: `f${i}.ts` } }]
      });
      history.push(bigReadResult(`call-${i}`, 80_000));
    }
    const hardCap = computePromptHardCap(deepseekCtx.contextWindow);
    const prepared = prepareContextForLlm(history, deepseekCtx);
    expect(prepared.compacted).toBe(true);
    expect(prepared.usedTokens).toBeLessThanOrEqual(deepseekCtx.contextWindow);
    expect(prepared.usedTokens).toBeLessThanOrEqual(hardCap);
    expect(tokensForHistory(prepared.messages)).toBe(prepared.usedTokens);
  });
});
