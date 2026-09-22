import React, { useEffect, useState } from "react";
import type { MessageItem } from "@/types/wii";
import { renderMarkdown, renderMarkdownInline } from "@/lib/markdown";
import { ToolCall } from "./ToolCall";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";

export const UserCard: React.FC<{
  message: MessageItem;
}> = ({ message }) => {
  return (
    <section className="mb-3.5 rounded-xl border border-border bg-panel p-3 text-foreground">
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.55]">
        {message.text}
      </pre>
    </section>
  );
};

const handleCodeClick = (e: React.MouseEvent<HTMLElement>) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy-code-btn");
  if (!btn) return;
  const rawCode = btn.getAttribute("data-code");
  if (!rawCode) return;
  navigator.clipboard.writeText(decodeURIComponent(rawCode)).then(() => {
    const textSpan = btn.querySelector<HTMLSpanElement>(".btn-text");
    if (!textSpan) return;
    const prevText = textSpan.textContent;
    textSpan.textContent = "Copied!";
    btn.classList.add("text-green");
    setTimeout(() => {
      textSpan.textContent = prevText || "Copy";
      btn.classList.remove("text-green");
    }, 1500);
  });
};

const ThinkingBlock: React.FC<{ text: string; streaming: boolean }> = ({ text, streaming }) => {
  const content = text.trim();
  const foldable = content.includes("\n") || content.length > 160;
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    setOpen(streaming);
  }, [streaming, text]);

  if (!foldable) {
    return (
      <div
        onClick={handleCodeClick}
        className="mb-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs leading-[1.55] text-dim opacity-75"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    );
  }

  const preview = `${content.split("\n", 1)[0]}…`;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-2 w-full">
      <Collapsible.Trigger asChild>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((value) => !value);
            }
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-left text-xs text-dim hover:bg-raised"
        >
          <span className={`text-[11px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span
            className="pointer-events-none min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium opacity-75"
            dangerouslySetInnerHTML={{ __html: renderMarkdownInline(preview) }}
          />
          <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
            {streaming ? "streaming" : `~${Math.ceil(content.length / 4)} tokens`}
          </span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-1.5 max-h-[360px] overflow-y-auto break-words rounded-lg border border-border bg-[#171717] p-3 text-xs leading-[1.55] text-dim">
        <div
          onClick={handleCodeClick}
          className="opacity-75"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export const AssistantCard: React.FC<{ message: MessageItem }> = ({ message }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.text) return;
    navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mb-3.5 w-full">
      {message.thinking && (
        <ThinkingBlock text={message.thinking} streaming={!!message.thinkingStreaming} />
      )}

      {/* Tool executions */}
      {message.tools && message.tools.length > 0 && (
        <div className="mb-2">
          {message.tools.map((tool) => (
            <ToolCall key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Assistant markdown reply */}
      {message.text && (
        <section className="group relative rounded-xl border border-border-strong bg-raised p-3 text-foreground">
          <button
            type="button"
            title="Copy markdown"
            aria-label="Copy markdown"
            onClick={handleCopyMarkdown}
            className="absolute right-2.5 top-2.5 z-10 flex h-6 items-center gap-1 rounded border border-border bg-[#171717] px-1.5 py-0.5 text-[11px] text-faint opacity-0 transition-opacity hover:bg-panel hover:text-foreground group-hover:opacity-100 cursor-pointer select-none shadow-sm"
          >
            {copied ? (
              <>
                <CheckIcon className="h-3 w-3 text-green" />
                <span className="text-[10px] text-green">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon className="h-3 w-3" />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>

          <div
            onClick={handleCodeClick}
            className="text-[13px] leading-[1.55] font-sans"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
          />
        </section>
      )}
    </div>
  );
};

export const ErrorCard: React.FC<{ text: string }> = ({ text }) => {
  return (
    <section className="mb-3.5 rounded-xl border border-[#4d2429] bg-[#1c1113] p-3 text-[13px] leading-[1.55] text-red font-sans">
      <pre className="m-0 whitespace-pre-wrap break-words font-sans">{text}</pre>
    </section>
  );
};
