import React from "react";
import type { PluginDef } from "@/lib/plugins";
import { usePluginRuntime } from "@/lib/plugin-runtime";
import { PluginUIRenderer } from "@/components/ui/plugin-ui/PluginUIRenderer";

// Renders one plugin's declarative panel: wires state/actions via
// usePluginRuntime, hands the resulting UINode tree to PluginUIRenderer.
export const PluginPanel: React.FC<{ plugin: PluginDef }> = ({ plugin }) => {
  const { state, dispatch, ctx } = usePluginRuntime(plugin);
  const node = plugin.render ? plugin.render(state, ctx) : null;
  return (
    <div className="grid gap-3 select-none">
      <PluginUIRenderer node={node} dispatch={dispatch} />
    </div>
  );
};
