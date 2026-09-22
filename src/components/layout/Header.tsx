import React from "react";
import { useSessionStore } from "@/store/session-store";
import { GearIcon, StackIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

export const Header: React.FC = () => {
  const tabOrder = useSessionStore((state) => state.tabOrder);
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const switchActive = useSessionStore((state) => state.switchActive);
  const closeTab = useSessionStore((state) => state.closeTab);
  const setCommandCenterOpen = useSessionStore((state) => state.setCommandCenterOpen);
  const setSessionManagerOpen = useSessionStore((state) => state.setSessionManagerOpen);

  return (
    <header className="flex h-[52px] items-center gap-3.5 border-b border-border bg-bg px-6 select-none">
      {/* Horizontal tab strip */}
      <div className="flex flex-1 items-center gap-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabOrder.map((id) => {
          const session = sessions[id];
          if (!session) return null;
          const isActive = id === activeId;

          return (
            <div
              key={id}
              ref={(el) => {
                if (isActive && el) {
                  el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                }
              }}
              onClick={() => switchActive(id)}
              className={cn(
                "group relative flex h-8 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs transition-colors",
                isActive
                  ? "border-text bg-text text-[#111]"
                  : "border-border bg-panel text-faint hover:bg-raised hover:text-foreground",
              )}
            >
              {/* Status dot */}
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  session.status === "running" && "bg-green animate-[pulse_1.1s_ease-in-out_infinite]",
                  session.status === "idle" && "bg-faint",
                  session.status === "error" && "bg-red",
                )}
              />

              {/* Title */}
              <span className="truncate font-medium">{session.title}</span>

              {/* Close tab on hover */}
              <button
                type="button"
                title="Close tab (keeps session history)"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
                className={cn(
                  "hidden h-4 w-4 shrink-0 items-center justify-center rounded text-xs group-hover:flex",
                  isActive
                    ? "text-[#111] hover:bg-black/10"
                    : "text-faint hover:bg-panel hover:text-foreground",
                )}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Header action buttons */}
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          title="Sessions (Ctrl+S)"
          aria-label="Sessions"
          onClick={() => setSessionManagerOpen(true)}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-panel p-1.5 text-faint hover:bg-raised hover:text-foreground"
        >
          <StackIcon className="h-5 w-5" />
        </button>

        <button
          type="button"
          title="Command Center (Ctrl+K)"
          aria-label="Command Center"
          onClick={() => setCommandCenterOpen(true)}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-panel p-1.5 text-faint hover:bg-raised hover:text-foreground"
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
};
