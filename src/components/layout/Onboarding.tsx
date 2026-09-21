import React, { useState } from "react";
import { useSessionStore } from "@/store/session-store";
import { Button } from "@/components/ui/button";
import * as tauri from "@/lib/tauri";

export const Onboarding: React.FC = () => {
  const selectedProjectPath = useSessionStore((state) => state.selectedProjectPath);
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const activeProvider =
    multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
    multiConfig.providers[0] ||
    null;
  const openTab = useSessionStore((state) => state.openTab);
  const setCommandCenterOpen = useSessionStore((state) => state.setCommandCenterOpen);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handlePickFolder = async () => {
    setError("");
    try {
      const folder = await tauri.pickFolder();
      if (folder) {
        useSessionStore.setState({ selectedProjectPath: folder });
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCreateSession = async () => {
    if (!selectedProjectPath || !activeProvider) return;
    setLoading(true);
    setError("");
    try {
      await openTab(null, null, selectedProjectPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 top-[52px] z-10 flex items-center justify-center bg-bg p-6 select-none">
      <div className="grid w-[min(420px,100%)] gap-3.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Start a session</h1>
        <p className="text-xs text-faint">Choose a project directory for Pi.</p>

        <Button
          type="button"
          onClick={handlePickFolder}
          className="h-10 bg-text text-[#111] hover:opacity-85"
        >
          Choose project directory
        </Button>

        <div className="min-h-[36px] break-all rounded-lg border border-border bg-panel p-2.5 text-xs text-dim">
          {selectedProjectPath || "No directory selected"}
        </div>

        {!activeProvider && (
          <div className="grid gap-2">
            <p className="text-xs text-amber">Provider settings required before creating a session.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCommandCenterOpen(true)}
              className="text-xs"
            >
              Open provider settings
            </Button>
          </div>
        )}

        <Button
          type="button"
          disabled={!selectedProjectPath || !activeProvider || loading}
          onClick={handleCreateSession}
          className="h-10 bg-text text-[#111] hover:opacity-85"
        >
          {loading ? "Starting session…" : "Create session"}
        </Button>

        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    </div>
  );
};
