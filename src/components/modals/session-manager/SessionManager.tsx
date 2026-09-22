import React, { useEffect, useState } from "react";
import { formatPath, truncateTitle, useSessionStore } from "@/store/session-store";
import type { SessionSummary } from "@/types/wii";
import * as tauri from "@/lib/tauri";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

interface SmItem {
  id?: string;
  title: string;
  projectPath?: string | null;
  path?: string | null;
  lastActivity?: string;
  searchText?: string;
  isAlive?: boolean;
}

function smFormatTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export const SessionManager: React.FC = () => {
  const sessionManagerOpen = useSessionStore((state) => state.sessionManagerOpen);
  const setIsOpen = useSessionStore((state) => state.setSessionManagerOpen);
  const hasTabs = useSessionStore((state) => state.tabOrder.length > 0);
  // No open tabs = no timeline to show; force the manager open and undismissable
  // instead of rendering the now-unused Onboarding screen.
  const isOpen = sessionManagerOpen || !hasTabs;
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const selectedProjectPath = useSessionStore((state) => state.selectedProjectPath);
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const activeProvider =
    multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
    multiConfig.providers[0] ||
    null;
  const switchActive = useSessionStore((state) => state.switchActive);
  const openTab = useSessionStore((state) => state.openTab);
  const startNewProjectSession = useSessionStore((state) => state.startNewProjectSession);

  const [diskSessions, setDiskSessions] = useState<SessionSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      tauri
        .listSessions()
        .then(setDiskSessions)
        .catch(() => setDiskSessions([]));
    }
  }, [isOpen]);

  const handleClose = () => {
    if (!hasTabs) return; // must pick or create a session first
    setIsOpen(false);
  };

  const handleNewSession = async () => {
    handleClose();
    const activeSession = activeId ? sessions[activeId] : null;
    const project = activeSession?.projectPath || selectedProjectPath;
    if (project && activeProvider) {
      await openTab(null, null, project);
    } else {
      await startNewProjectSession();
    }
  };

  const handleNewProject = async () => {
    handleClose();
    await startNewProjectSession();
  };

  // Build unified items list (recent sessions, alive sessions reflected)
  const aliveList = Object.values(sessions).filter((s) => s.alive);
  const diskPaths = new Set(diskSessions.map((d) => d.path).filter(Boolean));

  // Prepend alive sessions that might not yet be in diskSessions
  const unpersistedAlive: SmItem[] = aliveList
    .filter((s) => !s.resumePath || !diskPaths.has(s.resumePath))
    .map((s) => ({
      id: s.id,
      title: s.title,
      projectPath: s.projectPath,
      path: s.resumePath,
      isAlive: true,
    }));

  const persistedItems: SmItem[] = diskSessions.map((d) => {
    const matchingAlive = aliveList.find(
      (s) => (s.resumePath && s.resumePath === d.path) || s.id === d.id,
    );
    return {
      id: matchingAlive?.id,
      // Prefer the live (possibly LLM-generated) title over the disk-derived
      // one "\u2014 list_sessions only ever reads the first user message.
      title: matchingAlive?.title || d.title,
      projectPath: d.projectPath,
      path: d.path,
      lastActivity: d.lastActivity,
      searchText: d.searchText,
      isAlive: !!matchingAlive,
    };
  });

  const allItems: SmItem[] = [...unpersistedAlive, ...persistedItems];

  const query = search.trim().toLowerCase();
  const filteredItems = allItems.filter((item) => {
    if (!query) return true;
    const text = `${item.title} ${item.projectPath ?? ""} ${item.searchText ?? ""}`.toLowerCase();
    return text.includes(query);
  });

  const handleOpenItem = async (item: SmItem) => {
    handleClose();
    if (item.id && sessions[item.id]?.alive) {
      switchActive(item.id);
      return;
    }
    if (item.path) {
      await openTab(item.path, truncateTitle(item.title), item.projectPath || null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
      return;
    }

    if (!filteredItems.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredItems[selectedIndex];
      if (target) {
        handleOpenItem(target);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent onKeyDown={handleKeyDown} className="max-h-[690px] w-[min(720px,100%)] select-none">
        {/* Top Header Row with Title and Short Action Buttons */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Session Manager</h1>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewSession}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 text-xs font-medium text-foreground outline-none hover:bg-raised transition-colors"
            >
              <span>New session</span>
              <kbd className="rounded border border-border bg-[#171717] px-1 py-0.5 font-sans text-[10px] text-faint">
                Ctrl+N
              </kbd>
            </button>

            <button
              type="button"
              onClick={handleNewProject}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 text-xs font-medium text-foreground outline-none hover:bg-raised transition-colors"
            >
              <span>New project</span>
              <kbd className="rounded border border-border bg-[#171717] px-1 py-0.5 font-sans text-[10px] text-faint">
                Ctrl+⇧+N
              </kbd>
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="relative mb-3 border-b border-border">
          <input
            type="text"
            placeholder="Search sessions…"
            value={search}
            autoFocus
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            className="h-10 w-full bg-transparent pr-9 text-base text-foreground placeholder:text-faint outline-none"
          />
          <MagnifyingGlassIcon className="pointer-events-none absolute right-1 top-2.5 h-5 w-5 text-dim" />
        </div>

        {/* Unified Sessions List (no Running or Recently dividers) */}
        <div className="grid max-h-[500px] min-w-0 flex-1 auto-rows-min gap-1 overflow-y-auto overflow-x-hidden pr-1">
          {filteredItems.length === 0 && (
            <div className="py-8 text-center text-xs text-faint">No sessions found</div>
          )}

          {filteredItems.map((item, idx) => {
            const isSelected = selectedIndex === idx;
            const session = item.id ? sessions[item.id] : null;
            const isRunning = session?.busy || session?.status === "running";

            return (
              <button
                key={item.id || item.path || idx}
                ref={(el) => {
                  if (isSelected && el) {
                    el.scrollIntoView({ block: "nearest" });
                  }
                }}
                type="button"
                onClick={() => handleOpenItem(item)}
                className={cn(
                  "flex min-h-[36px] w-full min-w-0 cursor-pointer items-center justify-between gap-3 overflow-hidden rounded-md border border-border bg-transparent px-3 text-left text-xs text-foreground outline-none hover:bg-raised transition-colors",
                  isSelected && "border-white bg-raised",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>

                <div className="flex max-w-[45%] shrink-0 items-center gap-3 text-[11px]">
                  <span className="min-w-0 truncate text-faint">{formatPath(item.projectPath) || "Unknown project"}</span>
                  {isRunning ? (
                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-green">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green animate-[pulse_1.1s_ease-in-out_infinite]" />
                      running
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-faint">
                      {smFormatTime(item.lastActivity) || "now"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
