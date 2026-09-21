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
      }[char] || char),
  );
}

export function renderMarkdown(source: string): string {
  const blocks: string[] = [];
  let text = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    blocks.push(
      `<pre class="my-2.5 overflow-x-auto rounded-lg border border-border bg-[#171717] p-3"><code${
        lang ? ` class="lang-${escapeHtml(lang)}"` : ""
      }>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`,
    );
    return `\u0000${blocks.length - 1}\u0000`;
  });

  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => `<code class="rounded border border-border bg-[#171717] px-1 py-0.5 text-xs">${code}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-blue hover:underline">$1</a>',
  );

  const lines = text.split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;

  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const unordered = line.match(/^[-*]\s+(.*)/);
    const ordered = line.match(/^\d+\.\s+(.*)/);

    if (heading) {
      closeList();
      const level = heading[1].length;
      const sizeClass = level === 1 ? "text-lg" : level === 2 ? "text-base" : "text-sm";
      html.push(`<h${level} class="my-3 font-semibold leading-tight ${sizeClass}">${heading[2]}</h${level}>`);
    } else if (unordered) {
      if (list !== "ul") {
        closeList();
        html.push('<ul class="my-2 list-disc pl-5">');
        list = "ul";
      }
      html.push(`<li class="my-0.5">${unordered[1]}</li>`);
    } else if (ordered) {
      if (list !== "ol") {
        closeList();
        html.push('<ol class="my-2 list-decimal pl-5">');
        list = "ol";
      }
      html.push(`<li class="my-0.5">${ordered[1]}</li>`);
    } else if (line.trim() === "") {
      closeList();
      html.push("");
    } else if (/^\u0000\d+\u0000$/.test(line.trim())) {
      closeList();
      html.push(line.trim());
    } else {
      closeList();
      html.push(`<p class="my-1.5 first:mt-0 last:mb-0 leading-relaxed">${line}</p>`);
    }
  }
  closeList();

  return html.join("\n").replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
}

export function extractMsgText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export function toolText(value: any): string {
  const content = value?.content;
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : JSON.stringify(value ?? {}, null, 2);
  }
  return content.map((part) => part.text ?? JSON.stringify(part)).join("\n");
}
