import React, { useState } from "react";
import { useSessionStore } from "@/store/session-store";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProvidersPanel } from "./ProvidersPanel";
import { ModelsPanel } from "./ModelsPanel";
import { ContextPanel } from "./ContextPanel";
import { cn } from "@/lib/utils";

type PanelType = "root" | "provider" | "models" | "context";

interface CommandItem {
  id: PanelType;
  title: string;
  icon: string;
}

const ROOT_COMMANDS: CommandItem[] = [
  { id: "provider", title: "Providers", icon: "/assets/icons/link.svg" },
  { id: "models", title: "Models", icon: "/assets/icons/search.svg" },
  { id: "context", title: "Context Settings", icon: "/assets/icons/layers.svg" },
];

export const CommandCenter: React.FC = () => {
  const isOpen = useSessionStore((state) => state.commandCenterOpen);
  const setIsOpen = useSessionStore((state) => state.setCommandCenterOpen);

  const [panel, setPanel] = useState<PanelType>("root");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleClose = () => {
    setIsOpen(false);
    setPanel("root");
    setSearch("");
  };

  const filteredCommands = ROOT_COMMANDS.filter((cmd) =>
    cmd.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (panel !== "root") {
        setPanel("root");
      } else {
        handleClose();
      }
      return;
    }

    if (panel === "root") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length),
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          setPanel(selected.id);
        }
      }
    }
  };

  const panelTitles: Record<PanelType, string> = {
    root: "",
    provider: "Providers",
    models: "Models",
    context: "Context Settings",
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent onKeyDown={handleKeyDown} className="max-h-[690px] w-[min(720px,100%)] select-none">
        {/* Breadcrumb Title */}
        <div className="mb-6 flex items-center gap-1.5 text-lg font-semibold">
          <span
            onClick={() => setPanel("root")}
            className={cn(
              "text-foreground",
              panel !== "root" && "cursor-pointer text-dim hover:text-foreground hover:underline",
            )}
          >
            Command Center
          </span>
          {panel !== "root" && (
            <span className="text-foreground font-semibold"> / {panelTitles[panel]}</span>
          )}
        </div>

        {/* Search input (only visible in root menu) */}
        {panel === "root" && (
          <div className="relative mb-5 border-b border-border">
            <input
              type="text"
              placeholder="Search commands…"
              value={search}
              autoFocus
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIndex(0);
              }}
              className="h-11 w-full bg-transparent pr-9 text-base text-foreground placeholder:text-faint outline-none"
            />
            <img
              src="/assets/icons/search.svg"
              alt=""
              className="pointer-events-none absolute right-1 top-3 h-5 w-5 text-dim"
            />
          </div>
        )}

        {/* Panel Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === "root" && (
            <div className="grid gap-1.5">
              {filteredCommands.length === 0 ? (
                <div className="py-6 text-center text-xs text-faint">No commands found</div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => setPanel(cmd.id)}
                    className={cn(
                      "flex min-h-[38px] w-full cursor-pointer items-center justify-between rounded-md border border-border bg-transparent px-3 text-left text-xs font-medium text-foreground outline-none hover:bg-raised",
                      idx === selectedIndex && "border-white bg-raised",
                    )}
                  >
                    <span>{cmd.title}</span>
                    <img src={cmd.icon} alt="" className="h-5 w-5" />
                  </button>
                ))
              )}
            </div>
          )}

          {panel === "provider" && <ProvidersPanel onSaved={() => setPanel("root")} />}
          {panel === "models" && <ModelsPanel />}
          {panel === "context" && <ContextPanel onSaved={() => setPanel("root")} />}
        </div>
      </DialogContent>
    </Dialog>
  );
};
