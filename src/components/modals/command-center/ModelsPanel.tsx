import React from "react";
import { useSessionStore } from "@/store/session-store";
import { Switch } from "@/components/ui/switch";

export const ModelsPanel: React.FC = () => {
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const cachedModels = useSessionStore((state) => state.cachedModels);
  const enabledModels = useSessionStore((state) => state.enabledModels);
  const setModelEnabled = useSessionStore((state) => state.setModelEnabled);

  const activeProvider =
    multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
    multiConfig.providers[0] ||
    null;

  const allModels = React.useMemo(() => {
    return [
      ...new Set([activeProvider?.model, ...(activeProvider?.models || []), ...cachedModels].filter(Boolean)),
    ] as string[];
  }, [activeProvider?.model, activeProvider?.models, cachedModels]);

  if (!allModels.length) {
    return (
      <div className="py-6 text-center text-xs text-faint">
        No models available. Fetch models in Providers first.
      </div>
    );
  }

  return (
    <div className="grid gap-3 select-none">
      <p className="text-xs text-faint">Toggle which models appear in the composer dropdown.</p>

      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
        {allModels.map((modelId) => {
          const isChecked = !enabledModels || enabledModels.has(modelId);

          return (
            <div
              key={modelId}
              className="flex items-center justify-between rounded-lg border border-border bg-panel p-2.5 text-xs"
            >
              <span className="truncate font-medium text-foreground">{modelId}</span>

              <Switch
                checked={isChecked}
                onCheckedChange={(checked) => setModelEnabled(modelId, checked)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
