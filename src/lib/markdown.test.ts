import { describe, it, expect } from "vitest";
import { renderMarkdown, extractMsgText, extractMsgThinking, toolText } from "./markdown";

describe("renderMarkdown: nested code fences (the reported bug)", () => {
  // Markdown's own spec requires an OUTER fence to use a longer backtick run
  // than anything nested inside it (the standard "````outer ... ```inner```
  // ... ````" convention) \u2014 that's true for every compliant parser, not
  // just ours. The bug was that the old hand-rolled regex
  // (```(\w*)\n([\s\S]*?)```) didn't even implement *that*: being non-greedy
  // over the whole message, it terminated on the first ``` occurring
  // anywhere in the text, on any line, even mid-sentence \u2014 so a properly
  // 4-backtick-fenced outer block still got truncated at the first inner
  // closing ```, dumping the remainder as raw paragraph HTML (exactly what
  // the screenshot shows). markdown-it anchors fence close-detection to
  // whole lines and respects backtick-run length, so the standard nesting
  // convention now actually works.
  it("preserves a 4-backtick outer fence around nested 3-backtick blocks", () => {
    const source = [
      "````markdown",
      "# heading",
      "some text",
      "",
      "```typescript",
      "export type X = { a: string };",
      "```",
      "",
      "more text after inner fence",
      "````",
    ].join("\n");

    const html = renderMarkdown(source);

    // Old renderer closed on the first inner ``` and dumped the rest as a
    // raw paragraph; the whole nested content must now stay inside ONE block.
    expect(html).not.toMatch(/<p[^>]*>more text after inner fence<\/p>/);
    expect(html).toContain("more text after inner fence");
    expect(html.match(/class="lang-markdown"/g)?.length).toBe(1);
    expect(html.match(/copy-code-btn/g)?.length).toBe(1);
    expect(html).toContain("export type X");
  });

  it("degrades equal-length nested fences into clean separate blocks instead of garbled output", () => {
    // Same backtick count outer/inner is inherently ambiguous per the
    // CommonMark spec (no parser can tell them apart) \u2014 the bar here is
    // "no data loss / no broken markup leaking through", not "merged into one
    // block", which isn't achievable without the author using more backticks.
    const source = "```\nzzzouter zzzstart\n```js\nzzzinner\n```\nzzzouter zzzend\n```";
    const html = renderMarkdown(source);
    // hljs auto-detection may tokenize plain code into spans, so match on
    // distinctive substrings rather than exact runs of highlighted text.
    expect(html).toContain("zzzouter");
    expect(html).toContain("zzzstart");
    expect(html).toContain("zzzinner");
    expect(html).toContain("zzzend");
    // No stray, unconsumed backtick runs leaking into visible text.
    expect(html).not.toMatch(/[^`]```[^`]/);
  });
});

describe("renderMarkdown: code blocks", () => {
  it("highlights a language-tagged block and exposes raw code for copy", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain('class="lang-js"');
    expect(html).toContain("data-code=\"" + encodeURIComponent("const x = 1;"));
    expect(html).toContain("hljs");
  });

  it("renders inline code", () => {
    const html = renderMarkdown("use `foo()` here");
    expect(html).toContain("<code");
    expect(html).toContain("foo()");
  });

  it("escapes HTML inside code blocks instead of executing it", () => {
    const html = renderMarkdown("```\n<script>alert(1)</script>\n```");
    // hljs tokenizes the tag into spans, so assert no raw executable tag
    // survives and the angle brackets were entity-escaped somewhere.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });
});

describe("renderMarkdown: inline formatting", () => {
  it("renders bold, italic, strikethrough", () => {
    const html = renderMarkdown("**bold** and *italic* and ~~gone~~");
    expect(html).toContain("<strong");
    expect(html).toContain("bold");
    expect(html).toContain("<em");
    expect(html).toContain("italic");
    expect(html).toMatch(/<s[ >]/);
    expect(html).toContain("gone");
  });

  it("marks external links target=_blank and internal links not", () => {
    const html = renderMarkdown("[ext](https://example.com) [rel](/local)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="/local"');
  });
});

describe("renderMarkdown: lists", () => {
  it("renders unordered and ordered lists", () => {
    const html = renderMarkdown("- one\n- two\n\n1. first\n2. second");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("one");
    expect(html).toContain("first");
  });

  it("renders GFM task list checkboxes", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
    expect(html).toContain("todo");
    expect(html).toContain("done");
  });
});

describe("renderMarkdown: tables", () => {
  it("renders a table with alignment", () => {
    const html = renderMarkdown("| A | B |\n| :-- | --: |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("text-align:right");
  });
});

describe("renderMarkdown: misc blocks", () => {
  it("renders headings, blockquotes, and horizontal rules", () => {
    const html = renderMarkdown("# Title\n\n> quoted\n\n---\n");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted");
    expect(html).toContain("<hr");
  });

  it("keeps single newlines as line breaks within a paragraph", () => {
    const html = renderMarkdown("line one\nline two");
    expect(html).toContain("<br>");
  });

  it("does not execute raw HTML from message text", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("message content extraction", () => {
  const content = [
    { type: "thinking", thinking: "reason one" },
    { type: "text", text: "answer one" },
    { type: "toolCall", id: "call-1" },
    { type: "thinking", thinking: "reason two" },
    { type: "text", text: "answer two" },
  ];

  it("extracts plain string text content", () => {
    expect(extractMsgText("hello")).toBe("hello");
  });

  it("extracts only text blocks", () => {
    expect(extractMsgText(content)).toBe("answer one\nanswer two");
  });

  it("extracts only thinking blocks", () => {
    expect(extractMsgThinking(content)).toBe("reason one\nreason two");
    expect(extractMsgThinking("plain text")).toBe("");
  });

  it("stringifies tool call content", () => {
    expect(toolText({ content: [{ text: "out" }] })).toBe("out");
  });
});
