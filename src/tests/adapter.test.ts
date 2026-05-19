import { describe, expect, it } from "vitest";
import {
  SSE_LINE_LIMIT_BYTES,
  buildAnthropicMessages,
  buildGeminiParts,
  buildOpenAiMessages,
  mapBudget,
  parseSse,
  splitDataUrl
} from "../main/ai/adapter.js";

describe("adapter helpers", () => {
  describe("splitDataUrl", () => {
    it("parses a valid data URL", () => {
      const r = splitDataUrl("data:image/png;base64,AAAA");
      expect(r).toEqual({ mimeType: "image/png", base64Body: "AAAA" });
    });

    it("returns null for a non-data URL", () => {
      expect(splitDataUrl("https://example.com/x.png")).toBeNull();
    });

    it("returns null for malformed data URLs", () => {
      expect(splitDataUrl("data:image/png;AAAA")).toBeNull();
      expect(splitDataUrl("data:image/png,base64,AAAA")).toBeNull();
    });
  });

  describe("mapBudget", () => {
    it("returns undefined for 'none' or missing budget", () => {
      expect(mapBudget("openai")).toBeUndefined();
      expect(mapBudget("openai", "none")).toBeUndefined();
    });

    it("maps OpenAI buckets to reasoning_effort strings", () => {
      expect(mapBudget("openai", "minimal")).toBe("minimal");
      expect(mapBudget("openai", "medium")).toBe("medium");
      // max/xhigh both clamp to 'high' — that's a known OpenAI ceiling
      expect(mapBudget("openai", "max")).toBe("high");
      expect(mapBudget("openai", "xhigh")).toBe("high");
    });

    it("maps Anthropic buckets to budget_tokens numbers", () => {
      expect(mapBudget("anthropic", "low")).toBe(1024);
      expect(mapBudget("anthropic", "medium")).toBe(8192);
      expect(mapBudget("anthropic", "max")).toBe(64000);
    });

    it("maps Gemini buckets to thinkingBudget numbers", () => {
      expect(mapBudget("gemini", "minimal")).toBe(256);
      expect(mapBudget("gemini", "high")).toBe(24576);
    });
  });

  describe("buildOpenAiMessages", () => {
    it("keeps simple string content when no message has attachments", () => {
      const result = buildOpenAiMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" }
      ]);
      expect(result).toEqual([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" }
      ]);
    });

    it("converts to multimodal parts when at least one message has attachments", () => {
      const result = buildOpenAiMessages([
        {
          role: "user",
          content: "describe",
          attachments: [{ id: "a1", dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png" }]
        },
        { role: "assistant", content: "ok" }
      ]);
      expect(result).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
          ]
        },
        { role: "assistant", content: "ok" }
      ]);
    });
  });

  describe("buildAnthropicMessages", () => {
    it("returns plain content when no attachments", () => {
      const result = buildAnthropicMessages([{ role: "user", content: "hi" }]);
      expect(result).toEqual([{ role: "user", content: "hi" }]);
    });

    it("encodes images as base64 source blocks", () => {
      const result = buildAnthropicMessages([
        {
          role: "user",
          content: "ok",
          attachments: [{ id: "a1", dataUrl: "data:image/jpeg;base64,XYZ", mimeType: "image/jpeg" }]
        }
      ]);
      expect(result).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "ok" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "XYZ" } }
          ]
        }
      ]);
    });

    it("silently drops malformed data URLs (defensive)", () => {
      const result = buildAnthropicMessages([
        {
          role: "user",
          content: "hi",
          attachments: [{ id: "a1", dataUrl: "not-a-data-url", mimeType: "image/png" }]
        }
      ]);
      expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    });
  });

  describe("buildGeminiParts", () => {
    it("returns a text part for plain text", () => {
      expect(buildGeminiParts({ role: "user", content: "hi" })).toEqual([{ text: "hi" }]);
    });

    it("emits an empty-text fallback when there is no content and no parts (Gemini requires >=1 part)", () => {
      expect(buildGeminiParts({ role: "user", content: "" })).toEqual([{ text: "" }]);
    });

    it("encodes inline image data alongside text", () => {
      const parts = buildGeminiParts({
        role: "user",
        content: "hi",
        attachments: [{ id: "a1", dataUrl: "data:image/webp;base64,BLOB", mimeType: "image/webp" }]
      });
      expect(parts).toEqual([{ text: "hi" }, { inlineData: { mimeType: "image/webp", data: "BLOB" } }]);
    });
  });

  describe("parseSse", () => {
    /** Tiny helper: construct a ReadableStream from a string. */
    function streamOf(s: string): ReadableStream<Uint8Array> {
      const bytes = new TextEncoder().encode(s);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        }
      });
    }

    it("yields each `data: ...` payload in order", async () => {
      const sse = "data: {\"a\":1}\n\ndata: {\"a\":2}\n\n";
      const out: string[] = [];
      for await (const p of parseSse(streamOf(sse))) out.push(p);
      expect(out).toEqual(['{"a":1}', '{"a":2}']);
    });

    it("stops on [DONE] without yielding it", async () => {
      const sse = "data: hello\n\ndata: [DONE]\n\ndata: should-not-see\n\n";
      const out: string[] = [];
      for await (const p of parseSse(streamOf(sse))) out.push(p);
      expect(out).toEqual(["hello"]);
    });

    it("ignores non-data SSE fields (event:, id:, comments)", async () => {
      const sse = "event: ping\ndata: {\"x\":1}\n\n: this is a comment\ndata: {\"x\":2}\n\n";
      const out: string[] = [];
      for await (const p of parseSse(streamOf(sse))) out.push(p);
      expect(out).toEqual(['{"x":1}', '{"x":2}']);
    });

    it("aborts promptly when the signal fires", async () => {
      // A neverending stream: emits a chunk and then blocks.
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
      const neverending = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          controller.enqueue(new TextEncoder().encode("data: a\n\n"));
        }
      });
      const ac = new AbortController();
      const out: string[] = [];
      const runner = (async () => {
        for await (const p of parseSse(neverending, ac.signal)) {
          out.push(p);
          ac.abort();
        }
      })();
      await runner;
      expect(out).toEqual(["a"]);
      // Cleanup so the test doesn't hold a reference forever.
      try {
        controllerRef?.close();
      } catch {
        /* ignore */
      }
    });

    it("exposes a hard line-length ceiling that is sensible", () => {
      expect(SSE_LINE_LIMIT_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    });
  });
});
