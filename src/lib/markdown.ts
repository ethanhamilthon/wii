import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

// Was a hand-rolled regex/line-scanner markdown renderer. It matched code
// fences with a single non-greedy regex (```(\w*)\n([\s\S]*?)```), so a
// message containing a fenced block that itself contained another fence
// (```markdown ... ```typescript ... ``` ... ```) closed on the FIRST inner
// ``` instead of the real outer one, truncating the block and dumping the
// rest as raw text. markdown-it parses fences with a real block scanner
// (counts backtick runs, tracks nesting by indentation/position), so nested
// fences round-trip correctly — that's the whole reason for the switch.
// Custom renderer rules below keep the exact same output classes/behavior
// (hljs highlighting, copy button, task checkboxes, table alignment, link
// target=_blank) the old implementation had, so nothing else changes.

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] || char,
  );
}

const md = new MarkdownIt({
  html: false, // never let LLM-authored text inject raw HTML
  linkify: true, // autolink bare URLs, matching common chat-UI expectations
  breaks: true, // single \n -> <br>, so line-per-line model output still reads as separate lines
  typographer: false,
});
md.use(taskLists, { enabled: false, label: false });

function withClass(rule: string, className: string) {
  md.renderer.rules[rule] = (tokens, idx, options, _env, self) => {
    tokens[idx].attrJoin("class", className);
    return self.renderToken(tokens, idx, options);
  };
}

// --- code fence: hljs highlight + copy button, same markup as before -------
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = (token.info || "").trim().split(/\s+/)[0];
  const rawCode = token.content.replace(/\n$/, "");

  let highlightedHtml: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlightedHtml = hljs.highlight(rawCode, { language: lang, ignoreIllegals: true }).value;
    } catch {
      highlightedHtml = escapeHtml(rawCode);
    }
  } else {
    try {
      highlightedHtml = hljs.highlightAuto(rawCode).value;
    } catch {
      highlightedHtml = escapeHtml(rawCode);
    }
  }

  const langLabel = escapeHtml(lang || "code");
  const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
  const encodedRaw = encodeURIComponent(rawCode);

  return (
    `<div class="my-3 overflow-hidden rounded-lg border border-border bg-[#141414]">` +
    `<div class="flex h-8 items-center justify-between border-b border-border bg-[#181818] px-3 text-[11px] text-faint">` +
    `<span class="font-mono lowercase">${langLabel}</span>` +
    `<button type="button" class="copy-code-btn flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-raised hover:text-foreground transition-colors cursor-pointer select-none" data-code="${encodedRaw}">` +
    `<svg class="copy-icon h-3 w-3" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 9.50006C1 10.3285 1.67157 11.0001 2.5 11.0001H4L4 10.0001H2.5C2.22386 10.0001 2 9.7762 2 9.50006L2 2.50006C2 2.22392 2.22386 2.00006 2.5 2.00006L9.5 2.00006C9.77614 2.00006 10 2.22392 10 2.50006V4.00006H11V2.50006C11 1.67163 10.3284 1.00006 9.5 1.00006L2.5 1.00006C1.67157 1.00006 1 1.67163 1 2.50006L1 9.50006ZM5.5 5.00006C4.67157 5.00006 4 5.67163 4 6.50006V13.5001C4 14.3285 4.67157 15.0001 5.5 15.0001H12.5C13.3284 15.0001 14 14.3285 14 13.5001V6.50006C14 5.67163 13.3284 5.00006 12.5 5.00006H5.5ZM5 6.50006C5 6.22392 5.22386 6.00006 5.5 6.00006H12.5C12.7761 6.00006 13 6.22392 13 6.50006V13.5001C13 13.7762 12.7761 14.0001 12.5 14.0001H5.5C5.22386 14.0001 5 13.7762 5 13.5001V6.50006Z" fill="currentColor"/></svg>` +
    `<span class="btn-text">Copy</span>` +
    `</button>` +
    `</div>` +
    `<pre class="overflow-x-auto p-3 text-xs leading-relaxed font-mono"><code${langClass} class="hljs">${highlightedHtml}</code></pre>` +
    `</div>`
  );
};

md.renderer.rules.code_inline = (tokens, idx) => {
  const code = tokens[idx].content;
  return `<code class="rounded border border-border bg-[#171717] px-1.5 py-0.5 text-xs font-mono text-green">${escapeHtml(code)}</code>`;
};

// --- task-list checkboxes ---------------------------------------------------
// markdown-it-task-lists injects a raw `<input>` as an html_inline token.
// html:false blocks *user text* from becoming html_inline, so the only
// html_inline tokens that can reach here are the plugin's own checkboxes —
// still escape anything else defensively.
md.renderer.rules.html_inline = (tokens, idx) => {
  const content = tokens[idx].content;
  if (/^<input\b/.test(content)) {
    return content.replace(
      "<input",
      '<input class="h-3.5 w-3.5 rounded border border-border bg-panel text-green shrink-0 align-middle mr-1.5"',
    );
  }
  return escapeHtml(content);
};
md.renderer.rules.html_block = (tokens, idx) => escapeHtml(tokens[idx].content);

// --- headings ----------------------------------------------------------------
const HEADING_CLASS: Record<string, string> = {
  h1: "text-base font-bold my-3 text-foreground",
  h2: "text-sm font-semibold my-2.5 text-foreground",
  h3: "text-xs font-semibold my-2 text-foreground",
};
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const tag = tokens[idx].tag;
  tokens[idx].attrJoin("class", HEADING_CLASS[tag] || "text-xs font-semibold my-2 text-foreground");
  return self.renderToken(tokens, idx, options);
};

// --- lists (bullet/ordered/task) ---------------------------------------------
withClass(
  "bullet_list_open",
  "my-2 space-y-1 pl-5 list-disc marker:text-faint [&.contains-task-list]:list-none [&.contains-task-list]:pl-1",
);
withClass("ordered_list_open", "my-2 space-y-1 pl-5 list-decimal marker:text-faint marker:font-mono");
withClass("list_item_open", "pl-1 leading-relaxed");

// --- blockquote / paragraph / hr ---------------------------------------------
withClass("blockquote_open", "my-2.5 border-l-2 border-border-strong pl-3.5 text-dim italic space-y-1");
withClass("paragraph_open", "my-1.5 first:mt-0 last:mb-0 leading-relaxed");
md.renderer.rules.hr = (tokens, idx, options, _env, self) => {
  tokens[idx].attrJoin("class", "my-3.5 border-0 border-t border-border");
  return self.renderToken(tokens, idx, options);
};

// --- tables --------------------------------------------------------------
// Alignment comes for free: markdown-it's built-in GFM table rule already
// writes `style="text-align:..."` on th/td from the `:---:` separator row.
md.renderer.rules.table_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrJoin("class", "w-full text-left text-xs border-collapse font-sans leading-normal");
  return `<div class="my-3 overflow-x-auto rounded-lg border border-border">${self.renderToken(tokens, idx, options)}`;
};
md.renderer.rules.table_close = (tokens, idx, options, _env, self) => `${self.renderToken(tokens, idx, options)}</div>`;
withClass("thead_open", "border-b border-border bg-panel text-dim");
withClass("tbody_open", "divide-y divide-border/60");
withClass("tr_open", "hover:bg-panel/40 transition-colors");
withClass("th_open", "px-3 py-2 font-medium");
withClass("td_open", "px-3 py-2");

// --- inline emphasis / links ---------------------------------------------
withClass("strong_open", "font-semibold text-foreground");
withClass("em_open", "italic");
withClass("s_open", "line-through text-dim");
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const href = String(token.attrGet("href") || "");
  token.attrJoin("class", "text-blue underline underline-offset-2 hover:opacity-85 transition-opacity");
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return self.renderToken(tokens, idx, options);
};

export function renderMarkdown(source: string): string {
  if (!source) return "";
  return md.render(source);
}

export function renderMarkdownInline(source: string): string {
  return source ? md.renderInline(source) : "";
}

export function extractMsgText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function extractMsgThinking(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking)
    .join("\n");
}

export function toolText(value: any): string {
  const content = value?.content;
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : JSON.stringify(value ?? {}, null, 2);
  }
  return content.map((part) => part.text ?? JSON.stringify(part)).join("\n");
}
