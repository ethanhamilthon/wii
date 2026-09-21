import React, { useEffect, useState } from "react";
import { formatPath, truncateTitle, useSessionStore } from "@/store/session-store";
import type { SessionSummary } from "@/types/wii";
import * as tauri from "@/lib/tauri";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface SmItem {
  kind: "new" | "new_project" | "running" | "recent";
  id?: string;
  title: string;
  projectPath?: string | null;
  path?: string | null;
  lastActivity?: string;
  searchText?: string;
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
  const isOpen = useSessionStore((state) => state.sessionManagerOpen);
  const setIsOpen = useSessionStore((state) => state.setSessionManagerOpen);
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
    setIsOpen(false);
  };

  // Build items list
  const runningItems: SmItem[] = Object.values(sessions)
    .filter((s) => s.alive)
    .map((s) => ({
      kind: "running",
      id: s.id,
      title: s.title,
      projectPath: s.projectPath,
      path: s.resumePath,
    }));

  const runningPaths = new Set(runningItems.map((i) => i.path).filter(Boolean));
  const recentItems: SmItem[] = diskSessions
    .filter((d) => !runningPaths.has(d.path))
    .map((d) => ({
      kind: "recent",
      id: d.id,
      title: d.title,
      projectPath: d.projectPath,
      path: d.path,
      lastActivity: d.lastActivity,
      searchText: d.searchText,
    }));

  const query = search.trim().toLowerCase();
  const matchesQuery = (item: SmItem) =>
    !query ||
    `${item.title} ${item.projectPath ?? ""} ${item.searchText ?? ""}`
      .toLowerCase()
      .includes(query);

  const filteredRunning = runningItems.filter(matchesQuery);
  const filteredRecent = recentItems.filter(matchesQuery);

  const allNavItems: SmItem[] = query
    ? [...filteredRunning, ...filteredRecent]
    : [
        { kind: "new", title: "New session" },
        { kind: "new_project", title: "New project" },
        ...filteredRunning,
        ...filteredRecent,
      ];

  const handleOpenItem = async (item: SmItem) => {
    handleClose();
    if (item.kind === "new_project") {
      await startNewProjectSession();
      return;
    }
    if (item.kind === "new") {
      const activeSession = activeId ? sessions[activeId] : null;
      const project = activeSession?.projectPath || selectedProjectPath;
      if (project && activeProvider) {
        await openTab(null, null, project);
      } else {
        await startNewProjectSession();
      }
      return;
    }
    if (item.kind === "running" && item.id) {
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

    if (!allNavItems.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, allNavItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "ArrowRight" && selectedIndex === 0 && !query) {
      e.preventDefault();
      setSelectedIndex(1);
    } else if (e.key === "ArrowLeft" && selectedIndex === 1 && !query) {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = allNavItems[selectedIndex];
      if (target) {
        handleOpenItem(target);
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent onKeyDown={handleKeyDown} className="max-h-[690px] w-[min(720px,100%)] select-none">
        <h1 className="mb-6 text-lg font-semibold text-foreground">Session Manager</h1>

        {/* Search input */}
        <div className="relative mb-5 border-b border-border">
          <input
            type="text"
            placeholder="Search sessions…"
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

        {/* Content list */}
        <div className="grid max-h-full flex-1 auto-rows-min gap-1.5 overflow-y-auto">
          {/* Top action row (side by side) */}
          {!query && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleOpenItem(allNavItems[0])}
                className={cn(
                  "flex min-h-[38px] cursor-pointer items-center justify-between rounded-md border border-border bg-panel px-3 text-left text-xs font-medium text-foreground outline-none hover:bg-raised",
                  selectedIndex === 0 && "border-white bg-raised",
                )}
              >
                <span>New session</span>
                <kbd className="rounded border border-border bg-[#171717] px-1.5 py-0.5 font-sans text-[10px] text-faint">
                  Ctrl+N
                </kbd>
              </button>

              <button
                type="button"
                onClick={() => handleOpenItem(allNavItems[1])}
                className={cn(
                  "flex min-h-[38px] cursor-pointer items-center justify-between rounded-md border border-border bg-panel px-3 text-left text-xs font-medium text-foreground outline-none hover:bg-raised",
                  selectedIndex === 1 && "border-white bg-raised",
                )}
              >
                <span>New project</span>
                <kbd className="rounded border border-border bg-[#171717] px-1.5 py-0.5 font-sans text-[10px] text-faint">
                  Ctrl+⇧+N
                </kbd>
              </button>
            </div>
          )}

          {query && allNavItems.length === 0 && (
            <div className="py-6 text-center text-xs text-faint">No sessions found</div>
          )}

          {/* Running section */}
          {filteredRunning.length > 0 && (
            <>
              <div className="flex h-7 items-center gap-2 text-[11px] text-faint">
                <span className="h-1 w-1 rounded-full bg-green" />
                <span>Running</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {filteredRunning.map((item, idx) => {
                const itemIndex = query ? idx : 2 + idx;
                const isSelected = selectedIndex === itemIndex;

                return (
                  <button
                    key={item.id || idx}
                    type="button"
                    onClick={() => handleOpenItem(item)}
                    className={cn(
                      "flex min-h-[36px] w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-transparent px-3 text-left text-xs text-foreground outline-none hover:bg-raised",
                      isSelected && "border-white bg-raised",
                    )}
                  >
                    <span className="max-w-[48%] truncate font-medium">{item.title}</span>
                    <div className="flex max-w-[50%] items-center gap-3 truncate text-[11px] text-faint">
                      <span className="truncate">{formatPath(item.projectPath) || "Unknown project"}</span>
                      <span className="shrink-0">active</span>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Recently section */}
          {filteredRecent.length > 0 && (
            <>
              <div className="mt-1 flex h-7 items-center gap-2 text-[11px] text-faint">
                <span className="h-1 w-1 rounded-full bg-faint" />
                <span>Recently</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {filteredRecent.map((item, idx) => {
                const itemIndex = query
                  ? filteredRunning.length + idx
                  : 2 + filteredRunning.length + idx;
                const isSelected = selectedIndex === itemIndex;

                return (
                  <button
                    key={item.id || idx}
                    type="button"
                    onClick={() => handleOpenItem(item)}
                    className={cn(
                      "flex min-h-[36px] w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-transparent px-3 text-left text-xs text-foreground outline-none hover:bg-raised",
                      isSelected && "border-white bg-raised",
                    )}
                  >
                    <span className="max-w-[48%] truncate font-medium">{item.title}</span>
                    <div className="flex max-w-[50%] items-center gap-3 truncate text-[11px] text-faint">
                      <span className="truncate">{formatPath(item.projectPath) || "Unknown project"}</span>
                      <span className="shrink-0">{smFormatTime(item.lastActivity)}</span>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
