/**
 * WebSearch tool — return a list of search results for a query.
 *
 * v1 always uses the DuckDuckGo HTML SERP scraper because it requires
 * no API key. Provider-native search (OpenAI Responses' `web_search`,
 * Anthropic `web_search_20250305`, Gemini `googleSearch`) would need to
 * be plumbed through the LlmRequest.tools field which today only
 * carries user-defined tools — that integration is a small future
 * upgrade. Until then, the fallback is acceptable for "find me three
 * references" use cases the model needs.
 *
 * Output is a clean list of `{title, url, snippet}` records (max 10 by
 * default), formatted as a numbered Markdown list so the LLM can
 * follow up with `WebFetch(url)` calls.
 */

import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";

const inputSchema = z.object({
  query: z.string().min(1).max(500).describe("Search query (free text)."),
  max_results: z.number().int().min(1).max(20).optional().describe("Maximum number of results. Default 8.")
});

type Input = z.infer<typeof inputSchema>;

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface Output {
  query: string;
  results: SearchHit[];
  source: "duckduckgo";
}

const DEFAULT_MAX = 8;
const TIMEOUT_MS = 15_000;
const SERP_URL = "https://html.duckduckgo.com/html/";

export const WebSearchTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "WebSearch",
  aliases: ["web_search"],
  description: "Search the public web (DuckDuckGo) and return result links.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "Search the public web for relevant pages. Returns a numbered list of {title, url, snippet}.",
      "Use this BEFORE WebFetch when you don't already have a URL.",
      "Don't search for the user's private data; use only public knowledge queries."
    ].join("\n"),
  checkPermissions() {
    // The query string itself can be sensitive; ask the first time so
    // the user explicitly opts in to the search provider.
    return { behavior: "ask" as const, reason: "Run a public web search (DuckDuckGo). The query will leave the machine." };
  },
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    timer.unref?.();

    let html: string;
    try {
      const body = new URLSearchParams({ q: input.query, kl: "us-en" }).toString();
      const res = await fetch(SERP_URL, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; little-peanut-agent/0.1)"
        },
        body
      });
      if (!res.ok) {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        return {
          ok: false,
          errorCode: "search_failed",
          errorMessage: `DuckDuckGo returned HTTP ${res.status}`
        };
      }
      html = await res.text();
    } catch (e) {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      return { ok: false, errorCode: "search_failed", errorMessage: (e as Error).message };
    }
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);

    const max = input.max_results ?? DEFAULT_MAX;
    const results = parseDuckDuckGo(html, max);
    return {
      ok: true,
      value: { query: input.query, results, source: "duckduckgo" }
    };
  },
  mapResultToBlock(out, toolUseId) {
    if (out.results.length === 0) {
      return blockFromText(toolUseId, `No results for "${out.query}".`);
    }
    const lines = out.results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`);
    return blockFromText(toolUseId, `Results for "${out.query}":\n\n${lines.join("\n\n")}`);
  },
  renderResultForUI(out) {
    return {
      variant: out.results.length > 0 ? "ok" : "warning",
      title: `WebSearch  "${out.query}"  (${out.results.length})`,
      body: out.results
        .slice(0, 6)
        .map((r) => `${r.title}\n${r.url}`)
        .join("\n\n")
    };
  },
  renderUseForUI(input) {
    return { label: "WebSearch", subtitle: input.query };
  }
});

/* -------------------------------------------------------------------------- */
/* SERP parser — keeps the dependency surface small.                          */
/* -------------------------------------------------------------------------- */

function parseDuckDuckGo(html: string, max: number): SearchHit[] {
  const results: SearchHit[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < max) {
    const href = decodeUrl(m[1]);
    const title = stripTags(decodeEntities(m[2])).trim();
    const snippet = stripTags(decodeEntities(m[3])).trim();
    if (!href || !title) continue;
    results.push({ url: href, title, snippet });
  }
  return results;
}

function decodeUrl(raw: string): string {
  // DDG wraps result links as /l/?uddg=<URL-encoded>. Unwrap it.
  if (raw.startsWith("/l/?") || raw.startsWith("//duckduckgo.com/l/?")) {
    const u = raw.startsWith("//") ? "https:" + raw : "https://duckduckgo.com" + raw;
    try {
      const parsed = new URL(u);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      /* fall through */
    }
  }
  return raw.startsWith("//") ? "https:" + raw : raw;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
