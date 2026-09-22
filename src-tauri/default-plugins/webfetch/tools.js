// Real pi extension (loaded via explicit --extension, never discovery).
// Runs INSIDE the pi process, not in Wii's webview.

// ponytail: regex-based text extraction, not a real HTML/readability parser; swap in readability library (e.g. Readability/Cheerio) if extraction quality becomes an issue
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|p|div|h[1-6]|li|tr|blockquote|header|footer|nav|article|section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .trim();
}

module.exports = function (pi) {
  pi.registerTool({
    name: "web_fetch",
    description: "Fetch a URL and extract its text content, converting HTML to readable plain text.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The HTTP or HTTPS URL to fetch.",
        },
      },
      required: ["url"],
    },
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const url = params && params.url;
      if (!url || typeof url !== "string") {
        return {
          content: [{ type: "text", text: "Error: Missing or invalid URL parameter." }],
          details: {},
        };
      }

      let targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = "https://" + targetUrl;
      }

      let res;
      try {
        res = await fetch(targetUrl, {
          signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; WiiWebFetch/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.5,*/*;q=0.3",
          },
        });
      } catch (err) {
        return {
          content: [{ type: "text", text: `Fetch error for ${targetUrl}: ${err && err.message ? err.message : String(err)}` }],
          details: { url: targetUrl, error: String(err) },
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Failed to fetch ${targetUrl}: HTTP ${res.status} ${res.statusText}` }],
          details: { url: targetUrl, status: res.status, statusText: res.statusText },
        };
      }

      let text;
      try {
        text = await res.text();
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to read response body for ${targetUrl}: ${err && err.message ? err.message : String(err)}` }],
          details: { url: targetUrl, error: String(err) },
        };
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const isHtml = contentType.includes("html") || /<html\b[^>]*>/i.test(text);

      if (isHtml) {
        text = htmlToText(text);
      }

      const MAX_LENGTH = 8000;
      if (text.length > MAX_LENGTH) {
        text = text.slice(0, MAX_LENGTH) + `\n\n[Content truncated to ${MAX_LENGTH} characters]`;
      }

      return {
        content: [{ type: "text", text: text || "(empty page content)" }],
        details: { url: targetUrl, status: res.status, contentType },
      };
    },
  });
};
