/**
 * WebFetch tool — pull a URL and return its body as Markdown.
 *
 * v1 constraints (defense-in-depth):
 *  - GET only.
 *  - Content-Type whitelist: text/*, application/json, application/xml,
 *    application/xhtml+xml. Binary types are rejected with a clear
 *    message so the model knows to ask for a download outside the agent.
 *  - Caps: 3 MB body, 3 redirects, 20 s total timeout.
 *  - Host policy: handled by the permission gate via a per-host pattern
 *    (full URL is shown in the modal). The classifier marks any host
 *    not under {localhost, 127.0.0.1} as "ask".
 *  - Headers sent to the upstream are deliberately bare — no
 *    Authorization, no cookies, no user-supplied auth fields. The whole
 *    point of WebFetch is fetching PUBLIC docs.
 *
 * HTML is converted to a lightweight markdown variant inline (regex
 * strip of <script>/<style>/<noscript>/<svg>, tag-to-newline mapping
 * for block elements, link/image extraction). It's not perfect but it
 * keeps the output small without pulling in a 200KB HTML parser.
 */

import { z } from "zod";
import { buildTool, blockFromText, type Tool, type ToolResult } from "../Tool.js";

const inputSchema = z.object({
  url: z
    .string()
    .url()
    .describe("Fully-qualified URL (http or https). The agent will GET this resource and return the body as Markdown.")
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
}

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;
const ALLOWED_CT = /^(text\/|application\/(json|xml|xhtml\+xml|atom\+xml|rss\+xml)\b)/;

export const WebFetchTool: Tool<typeof inputSchema, Output> = buildTool({
  name: "WebFetch",
  aliases: ["web_fetch", "fetch_url"],
  description: "Fetch a URL and return its body as Markdown.",
  inputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  prompt: () =>
    [
      "GET a URL and return the body as Markdown (HTML is converted; JSON/text are returned verbatim).",
      "Use for public documentation, RFCs, package READMEs, and similar references.",
      "Will refuse anything except http/https; will refuse binary payloads; capped at 3 MB.",
      "Auth headers are NEVER sent — this tool is for public resources only."
    ].join("\n"),
  checkPermissions(input: Input) {
    const host = safeHost(input.url);
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { behavior: "allow" as const, reason: "loopback host" };
    }
    return {
      behavior: "ask" as const,
      reason: `Fetch a public URL on ${host}? Auth headers will NOT be sent.`
    };
  },
  async call(input: Input, ctx): Promise<ToolResult<Output>> {
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: "aborted", errorMessage: "aborted" };
    }
    let url = input.url;
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, errorCode: "scheme_invalid", errorMessage: "only http/https URLs are allowed." };
    }
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS).unref?.() ?? null;
    void timeout;

    const redirects: string[] = [];
    let res: Response;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "little-peanut-agent/0.1 (+local)",
            Accept: "text/html,application/json,application/xhtml+xml,text/*;q=0.9,*/*;q=0.1"
          },
          signal: ac.signal
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          const loc = res.headers.get("location")!;
          const next = new URL(loc, url).toString();
          redirects.push(next);
          url = next;
          continue;
        }
        break;
      }
    } catch (e) {
      ctx.signal.removeEventListener("abort", onAbort);
      return { ok: false, errorCode: "fetch_failed", errorMessage: (e as Error).message };
    }

    if (redirects.length > MAX_REDIRECTS) {
      ctx.signal.removeEventListener("abort", onAbort);
      return { ok: false, errorCode: "too_many_redirects", errorMessage: `>${MAX_REDIRECTS} redirects` };
    }

    const contentType = res!.headers.get("content-type") || "";
    if (!ALLOWED_CT.test(contentType.split(";")[0])) {
      ctx.signal.removeEventListener("abort", onAbort);
      return {
        ok: false,
        errorCode: "unsupported_content_type",
        errorMessage: `refusing ${contentType || "(unknown)"} body; expected text/json/xml.`
      };
    }

    let body = "";
    let bytes = 0;
    let truncated = false;
    try {
      const reader = res!.body?.getReader();
      if (!reader) {
        body = await res!.text();
        bytes = Buffer.byteLength(body, "utf8");
        if (bytes > MAX_BYTES) {
          body = body.slice(0, MAX_BYTES);
          truncated = true;
        }
      } else {
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) {
            body += decoder.decode(value, { stream: true });
            body = body.slice(0, MAX_BYTES);
            truncated = true;
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            break;
          }
          body += decoder.decode(value, { stream: true });
        }
      }
    } catch (e) {
      ctx.signal.removeEventListener("abort", onAbort);
      return { ok: false, errorCode: "read_failed", errorMessage: (e as Error).message };
    }
    ctx.signal.removeEventListener("abort", onAbort);

    let markdown = body;
    if (contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml")) {
      markdown = htmlToMarkdown(body);
    }

    return {
      ok: true,
      value: {
        url,
        status: res!.status,
        contentType,
        body: markdown,
        bytes,
        truncated,
        redirects
      }
    };
  },
  mapResultToBlock(out, toolUseId) {
    const header = `GET ${out.url} → ${out.status} (${out.contentType}, ${out.bytes} bytes${out.truncated ? ", truncated" : ""})`;
    return blockFromText(toolUseId, `${header}\n\n${out.body}`);
  },
  renderResultForUI(out) {
    return {
      variant: out.status < 400 ? "ok" : "error",
      title: `WebFetch  ${out.status}  ${out.url}`,
      body: out.body.split("\n").slice(0, 40).join("\n")
    };
  },
  renderUseForUI(input) {
    return { label: "WebFetch", subtitle: input.url };
  }
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "<invalid>";
  }
}

/**
 * Tiny HTML -> Markdown converter. Not a full parser — handles 80% of
 * documentation pages cleanly and gracefully degrades on the rest.
 */
function htmlToMarkdown(html: string): string {
  let s = html;
  // Strip noise.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // Headings.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, body) => {
    return "\n\n" + "#".repeat(Number(lvl)) + " " + stripTags(body).trim() + "\n\n";
  });

  // Code blocks (<pre><code>…</code></pre> or just <pre>).
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body) => {
    const inner = body.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "$1");
    return "\n\n```\n" + decodeEntities(stripTags(inner)) + "\n```\n\n";
  });
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, body) => "`" + decodeEntities(stripTags(body)) + "`");

  // Lists.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, body) => "\n- " + stripTags(body).trim());
  s = s.replace(/<\/(ul|ol)>/gi, "\n");

  // Links.
  s = s.replace(/<a [^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, body) => {
    const txt = stripTags(body).trim() || href;
    return `[${txt}](${href})`;
  });

  // Block elements -> newlines.
  s = s.replace(/<(p|div|section|article|header|footer|nav|main|aside|tr|table|thead|tbody|hr|br)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|header|footer|nav|main|aside|tr|table|thead|tbody)>/gi, "\n");

  // Strip everything else.
  s = stripTags(s);
  s = decodeEntities(s);

  // Collapse whitespace.
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
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
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}
