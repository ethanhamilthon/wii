import React, { useEffect } from "react";
import { useSessionStore } from "@/store/session-store";
import { Header } from "@/components/layout/Header";
import { Timeline } from "@/components/timeline/Timeline";
import { Composer } from "@/components/layout/Composer";
import { CommandCenter } from "@/components/modals/command-center/CommandCenter";
import { SessionManager } from "@/components/modals/session-manager/SessionManager";

export default function App() {
  const tabOrder = useSessionStore((state) => state.tabOrder);
  const activeId = useSessionStore((state) => state.activeId);
  const sessions = useSessionStore((state) => state.sessions);
  const selectedProjectPath = useSessionStore((state) => state.selectedProjectPath);
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const activeProvider =
    multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
    multiConfig.providers[0] ||
    null;

  const switchActive = useSessionStore((state) => state.switchActive);
  const closeTab = useSessionStore((state) => state.closeTab);
  const openTab = useSessionStore((state) => state.openTab);
  const startNewProjectSession = useSessionStore((state) => state.startNewProjectSession);

  const commandCenterOpen = useSessionStore((state) => state.commandCenterOpen);
  const setCommandCenterOpen = useSessionStore((state) => state.setCommandCenterOpen);
  const sessionManagerOpen = useSessionStore((state) => state.sessionManagerOpen);
  const setSessionManagerOpen = useSessionStore((state) => state.setSessionManagerOpen);

  // Global hotkeys listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Escape key: NEVER let it reach macOS fullscreen exit
      if (e.key === "Escape") {
        e.preventDefault();
        if (sessionManagerOpen) {
          setSessionManagerOpen(false);
          return;
        }
        if (commandCenterOpen) {
          setCommandCenterOpen(false);
          return;
        }
        return;
      }

      // 2. Ctrl/Cmd + 1..9 tab switching
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        if (idx < tabOrder.length) {
          e.preventDefault();
          switchActive(tabOrder[idx]);
        }
        return;
      }

      // 3. Ctrl/Cmd + Shift + N: New project native folder picker
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        startNewProjectSession();
        return;
      }

      // 4. Ctrl/Cmd + N: New session in current project
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const active = activeId ? sessions[activeId] : null;
        const project = active?.projectPath || selectedProjectPath;
        if (project && activeProvider) {
          openTab(null, null, project).catch((err) => alert(String(err)));
        } else {
          startNewProjectSession();
        }
        return;
      }

      // 5. Ctrl/Cmd + K: Command Center
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandCenterOpen(true);
        return;
      }

      // 6. Ctrl/Cmd + S: Session Manager
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setSessionManagerOpen(true);
        return;
      }

      // 7. Ctrl/Cmd + W: Close current active tab (never close the window/app)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        if (activeId) {
          closeTab(activeId);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeId,
    closeTab,
    sessions,
    tabOrder,
    commandCenterOpen,
    sessionManagerOpen,
    selectedProjectPath,
    activeProvider,
  ]);

  // Autofocus message textarea on window focus
  useEffect(() => {
    const handleFocus = () => {
      if (!commandCenterOpen && !sessionManagerOpen && tabOrder.length > 0) {
        document.getElementById("message")?.focus();
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [commandCenterOpen, sessionManagerOpen, tabOrder.length]);

  const hasTabs = tabOrder.length > 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg font-sans text-foreground">
      {/* Top Header tab bar: hidden with no open tabs, Session Manager takes over instead */}
      {hasTabs && <Header />}

      {hasTabs && (
        <>
          <Timeline />
          <Composer />
        </>
      )}

      {/* Modals */}
      <CommandCenter />
      <SessionManager />
    </div>
  );
}
