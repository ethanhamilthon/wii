import React, { useState } from "react";
import type { ToolState } from "@/types/wii";
import * as Collapsible from "@radix-ui/react-collapsible";
import { cn } from "@/lib/utils";

const KNOWN_TOOL_COLORS: Record<string, string> = {
  bash: "text-green",
  read: "text-blue",
  write: "text-purple",
  edit: "text-amber",
  grep: "text-cyan",
  find: "text-cyan",
  ls: "text-cyan",
};

export function summarizeArgs(name: string, args: any): string {
  if (!args) return "";
  const raw =
    (name === "bash" && args.command) ||
    (name === "read" && (args.path ?? args.file)) ||
    (name === "write" && args.path) ||
    (name === "edit" && args.path) ||
    (name === "grep" && [args.pattern, args.path && `in ${args.path}`].filter(Boolean).join(" ")) ||
    (name === "find" && (args.pattern ?? args.glob)) ||
    (name === "ls" && (args.path ?? ".")) ||
    JSON.stringify(args);
  return String(raw).replace(/\s*\n\s*/g, " ⏎ ");
}

export const ToolCall: React.FC<{ tool: ToolState }> = ({ tool }) => {
  const [open, setOpen] = useState(false);
  const colorClass = KNOWN_TOOL_COLORS[tool.name] || "text-dim";

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-1.5 w-full">
      <Collapsible.Trigger
        type="button"
        className="flex h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-[9px] border border-border bg-panel px-3 text-left transition-colors hover:bg-raised"
      >
        {/* Fold arrow */}
        <span
          className={cn(
            "w-3.5 shrink-0 text-center text-[11px] text-faint transition-transform duration-150",
            open && "rotate-90",
          )}
        >
          ▸
        </span>

        {/* Status dot */}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            tool.status === "running" && "bg-faint animate-[pulse_1.1s_ease-in-out_infinite]",
            tool.status === "done" && "bg-green",
            tool.status === "error" && "bg-red",
          )}
        />

        {/* Tool tag */}
        <span className={cn("shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded", colorClass)}>
          {tool.name}
        </span>

        {/* One-line arg summary */}
        <span
          className={cn(
            "flex-1 min-w-0 truncate text-xs font-mono",
            tool.status === "error" ? "text-red" : "text-dim",
          )}
        >
          {summarizeArgs(tool.name, tool.args)}
        </span>
      </Collapsible.Trigger>

      {/* Expanded body with formatted args and result */}
      <Collapsible.Content className="mt-1.5 max-h-[360px] overflow-y-auto whitespace-pre-wrap break-all rounded-[9px] border border-border bg-[#171717] p-3 text-xs leading-[1.55] text-dim">
        {JSON.stringify(tool.args, null, 2)}
        {tool.result && `\n\n${tool.result}`}
      </Collapsible.Content>
    </Collapsible.Root>
  );
};
