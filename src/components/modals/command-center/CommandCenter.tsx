import React, { useState } from "react";
import { useSessionStore } from "@/store/session-store";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProvidersPanel } from "./ProvidersPanel";
import { ModelsPanel } from "./ModelsPanel";
import { ContextPanel } from "./ContextPanel";
import { PluginsPanel } from "./PluginsPanel";
import { PluginPanel } from "./PluginPanel";
import { PluginIcon } from "@/components/ui/plugin-ui/PluginUIRenderer";
import { panelPlugins } from "@/lib/plugins";
import { Link2Icon, LayersIcon, MagnifyingGlassIcon, Component1Icon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

type PanelType = "root" | "provider" | "models" | "context" | "plugins" | `plugin:${string}`;

interface CommandItem {
  id: PanelType;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROOT_COMMANDS: CommandItem[] = [
  { id: "provider", title: "Providers", icon: Link2Icon },
  { id: "models", title: "Models", icon: MagnifyingGlassIcon },
  { id: "context", title: "Context Settings", icon: LayersIcon },
  { id: "plugins", title: "Plugins", icon: Component1Icon },
];

export const CommandCenter: React.FC = () => {
  const isOpen = useSessionStore((state) => state.commandCenterOpen);
  const setIsOpen = useSessionStore((state) => state.setCommandCenterOpen);
  const plugins = useSessionStore((state) => state.plugins);
  const pluginConfig = useSessionStore((state) => state.pluginConfig);

  const [panel, setPanel] = useState<PanelType>("root");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleClose = () => {
    setIsOpen(false);
    setPanel("root");
    setSearch("");
  };

  // Enabled plugins that declare a `panel` + `render` get a dynamic tab,
  // injected alongside the built-in commands. Wii core has no idea what's in
  // them — just title/icon.
  const pluginCommands: CommandItem[] = panelPlugins(plugins, pluginConfig).map((p) => ({
    id: `plugin:${p.id}` as PanelType,
    title: p.panel!.title,
    icon: ({ className }) => <PluginIcon name={p.panel!.icon} className={className} />,
  }));

  const allCommands = [...ROOT_COMMANDS, ...pluginCommands];
  const filteredCommands = allCommands.filter((cmd) =>
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

  const panelTitles: Record<string, string> = {
    root: "",
    provider: "Providers",
    models: "Models",
    context: "Context Settings",
    plugins: "Plugins",
    ...Object.fromEntries(pluginCommands.map((c) => [c.id, c.title])),
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
            <MagnifyingGlassIcon className="pointer-events-none absolute right-1 top-3 h-5 w-5 text-dim" />
          </div>
        )}

        {/* Panel Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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
                    <cmd.icon className="h-5 w-5" />
                  </button>
                ))
              )}
            </div>
          )}

          {panel === "provider" && <ProvidersPanel onSaved={() => setPanel("root")} />}
          {panel === "models" && <ModelsPanel />}
          {panel === "context" && <ContextPanel onSaved={() => setPanel("root")} />}
          {panel === "plugins" && <PluginsPanel />}
          {panel.startsWith("plugin:") &&
            (() => {
              const plugin = plugins.find((p) => `plugin:${p.id}` === panel);
              return plugin ? <PluginPanel plugin={plugin} /> : null;
            })()}
        </div>
      </DialogContent>
    </Dialog>
  );
};
