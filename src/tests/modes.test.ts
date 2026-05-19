import { describe, expect, it } from "vitest";
import { CHAT_MODES, CHAT_MODE_MAP, compressMessages, estimateTokens, getMode } from "@shared/modes.js";

describe("modes / context compression", () => {
  describe("getMode", () => {
    it("returns the chat mode for null / unknown ids", () => {
      expect(getMode(null).id).toBe("chat");
      expect(getMode(undefined).id).toBe("chat");
      expect(getMode("does-not-exist").id).toBe("chat");
    });

    it("returns the requested mode when it exists", () => {
      expect(getMode("code").id).toBe("code");
      expect(getMode("research").id).toBe("research");
    });

    it("CHAT_MODE_MAP covers all CHAT_MODES", () => {
      for (const m of CHAT_MODES) {
        expect(CHAT_MODE_MAP[m.id]).toBe(m);
      }
    });
  });

  describe("estimateTokens", () => {
    it("rounds up using a 3.5 chars/token heuristic", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("hello")).toBe(Math.ceil(5 / 3.5));
      expect(estimateTokens("a".repeat(70))).toBe(20);
    });
  });

  describe("compressMessages", () => {
    const mkMsg = (role: string, content: string) => ({ role, content });

    it("preserves all system messages and never drops them", () => {
      const mode = { contextMaxMessages: 1, contextCharBudget: 100 };
      const msgs = [
        mkMsg("system", "S1"),
        mkMsg("system", "S2"),
        mkMsg("user", "u1"),
        mkMsg("user", "u2")
      ];
      const { messages } = compressMessages(msgs, mode);
      // both system messages survive
      expect(messages.filter((m) => m.role === "system").length).toBe(2);
    });

    it("enforces contextMaxMessages by dropping oldest non-system", () => {
      const mode = { contextMaxMessages: 2 };
      const msgs = [
        mkMsg("system", "S"),
        mkMsg("user", "u1"),
        mkMsg("assistant", "a1"),
        mkMsg("user", "u2"),
        mkMsg("assistant", "a2"),
        mkMsg("user", "u3")
      ];
      const result = compressMessages(msgs, mode);
      expect(result.messages).toEqual([mkMsg("system", "S"), mkMsg("assistant", "a2"), mkMsg("user", "u3")]);
      expect(result.dropped).toBe(3);
    });

    it("enforces contextCharBudget by dropping oldest, never the last", () => {
      const mode = { contextCharBudget: 30 };
      const msgs = [
        mkMsg("user", "a".repeat(40)),
        mkMsg("assistant", "b".repeat(40)),
        mkMsg("user", "c".repeat(20))
      ];
      const result = compressMessages(msgs, mode);
      // last must survive
      expect(result.messages[result.messages.length - 1].content).toBe("c".repeat(20));
      // first/second dropped
      expect(result.messages.length).toBeLessThan(msgs.length);
    });

    it("truncates the single remaining message when it is still over budget", () => {
      // NOTE: compressMessages only truncates when at least 200 chars would be
      // saved (`original.length > overshoot + 200`). So we pick a budget where
      // the saving is well above that floor.
      const mode = { contextCharBudget: 1000 };
      const huge = "x".repeat(5000);
      const result = compressMessages([{ role: "user", content: huge }], mode);
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].content).toMatch(/^…\[内容已截断\]/);
      // and the truncated text is no longer the full original
      expect(result.messages[0].content.length).toBeLessThan(huge.length);
    });

    it("reports the original and final char counts", () => {
      const mode = { contextMaxMessages: 1 };
      const msgs = [mkMsg("user", "u1"), mkMsg("user", "u2")];
      const result = compressMessages(msgs, mode);
      expect(result.originalChars).toBe(4);
      expect(result.finalChars).toBe(2);
    });

    it("no-ops when neither budget is set", () => {
      const result = compressMessages([{ role: "user", content: "hi" }], {});
      expect(result.dropped).toBe(0);
      expect(result.messages.length).toBe(1);
    });
  });
});
