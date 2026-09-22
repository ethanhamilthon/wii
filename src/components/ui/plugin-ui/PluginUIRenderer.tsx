import React from "react";
import * as Icons from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UINode } from "@/lib/plugins";

// Recursive mapper: plugin JSON AST -> Tailwind/shadcn components. No plugin
// ever gets raw HTML/DOM access, only these primitives.

const GAP: Record<number, string> = { 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4" };
const ALIGN: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};
const TEXT_VARIANT: Record<string, string> = {
  title: "text-sm font-semibold text-foreground",
  body: "text-xs text-foreground",
  muted: "text-xs text-dim",
  caption: "text-[11px] text-faint",
};
const PROGRESS_VARIANT: Record<string, string> = {
  default: "bg-primary",
  warning: "bg-amber",
  destructive: "bg-red",
};

export function PluginIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name ? (Icons as any)[name] : null;
  if (!Icon) return <Icons.Component1Icon className={className} />;
  return <Icon className={className} />;
}

export const PluginUIRenderer: React.FC<{
  node: UINode | null | undefined;
  dispatch: (action: string, payload?: any) => void;
}> = ({ node, dispatch }) => {
  if (!node) return null;

  switch (node.type) {
    case "stack":
      return (
        <div
          className={cn(
            "flex",
            node.direction === "row" ? "flex-row items-center" : "flex-col",
            GAP[node.gap ?? 2] || "gap-2",
            node.align && ALIGN[node.align],
          )}
        >
          {node.children.map((child, i) => (
            <PluginUIRenderer key={i} node={child} dispatch={dispatch} />
          ))}
        </div>
      );

    case "text":
      return <div className={TEXT_VARIANT[node.variant || "body"]}>{node.text}</div>;

    case "stat":
      return (
        <div className="min-w-0 flex-1 rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] text-faint">{node.label}</div>
          <div className="truncate text-lg font-semibold text-foreground">{node.value}</div>
          {node.subtext && <div className="text-[11px] text-dim">{node.subtext}</div>}
        </div>
      );

    case "progress": {
      const pct = node.max > 0 ? Math.min(100, Math.max(0, (node.value / node.max) * 100)) : 0;
      return (
        <div className="grid gap-1">
          {node.label && <div className="text-[11px] text-faint">{node.label}</div>}
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", PROGRESS_VARIANT[node.variant || "default"])}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    case "badge":
      return <Badge variant={node.variant || "default"}>{node.text}</Badge>;

    case "button":
      return (
        <Button
          type="button"
          size="sm"
          variant={node.variant || "default"}
          disabled={node.loading}
          onClick={() => dispatch(node.action, node.payload)}
        >
          {node.loading ? "…" : node.label}
        </Button>
      );

    case "spinner":
      return (
        <div className="flex items-center gap-2 text-xs text-faint">
          <Icons.UpdateIcon className="h-4 w-4 animate-spin" />
          {node.text && <span>{node.text}</span>}
        </div>
      );

    case "separator":
      return <div className="h-px w-full bg-border" />;

    default:
      return null;
  }
};
