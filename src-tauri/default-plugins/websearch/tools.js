// ponytail: DuckDuckGo HTML scraping is fragile to markup changes. Upgrade to DuckDuckGo official API (api.duckduckgo.com, no key needed) if scraping breaks.
module.exports = function (pi) {
  pi.registerTool({
    name: "web_search",
    description: "Search the web using DuckDuckGo to find documentation, code examples, or recent information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string.",
        },
        numResults: {
          type: "number",
          description: "Number of search results to return (default: 5).",
        },
      },
      required: ["query"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const query = params && params.query ? String(params.query).trim() : "";
      if (!query) {
        return {
          content: [{ type: "text", text: "Error: search query cannot be empty." }],
          details: {},
        };
      }

      const numResults = Math.max(1, Math.min(20, Number(params.numResults) || 5));

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Search request failed with HTTP ${res.status}: ${res.statusText}` }],
            details: {},
          };
        }

        const html = await res.text();
        const clean = (str) =>
          str
            ? str
                .replace(/<[^>]+>/g, "")
                .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
                .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, "\"")
                .replace(/&apos;/g, "\x27")
                .replace(/&nbsp;/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : "";

        const cleanUrl = (raw) => {
          try {
            const u = new URL(raw, "https://duckduckgo.com");
            return u.searchParams.get("uddg") || raw;
          } catch {
            return raw;
          }
        };

        const results = [];
        const blocks = html.split(/class="[^"]*result\s+results_links/);
        for (const block of blocks.slice(1)) {
          const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
          if (!titleMatch) continue;
          const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
          const title = clean(titleMatch[2]);
          const link = cleanUrl(titleMatch[1]);
          const snippet = snippetMatch ? clean(snippetMatch[1]) : "";
          if (title && link) {
            results.push({ title, url: link, snippet });
          }
        }

        const sliced = results.slice(0, numResults);
        if (sliced.length === 0) {
          return {
            content: [{ type: "text", text: `No search results found for: ${query}` }],
            details: { count: 0 },
          };
        }

        const text = sliced
          .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`)
          .join("\n\n");

        return {
          content: [{ type: "text", text }],
          details: { count: sliced.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search failed: ${err.message}` }],
          details: {},
        };
      }
    },
  });
};
