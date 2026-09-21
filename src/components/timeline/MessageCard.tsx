import React from "react";
import type { MessageItem } from "@/types/wii";
import { renderMarkdown } from "@/lib/markdown";
import { ToolCall } from "./ToolCall";

export const UserCard: React.FC<{
  message: MessageItem;
  canAbort?: boolean;
  onAbort?: () => void;
}> = ({ message, canAbort, onAbort }) => {
  return (
    <section className="group relative mb-3.5 rounded-xl border border-border bg-panel p-3 text-foreground pr-11">
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.55]">
        {message.text}
      </pre>

      {canAbort && (
        <button
          type="button"
          title="Stop (Escape)"
          aria-label="Stop"
          onClick={onAbort}
          className="absolute right-2.5 top-2.5 hidden h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-[#171717] p-1 text-foreground hover:bg-panel group-hover:flex"
        >
          <img src="/assets/icons/pause.svg" alt="" className="h-4 w-4" />
        </button>
      )}
    </section>
  );
};

export const AssistantCard: React.FC<{ message: MessageItem }> = ({ message }) => {
  return (
    <div className="mb-3.5 w-full">
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
        <section className="rounded-xl border border-border-strong bg-raised p-3 text-foreground">
          <div
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
