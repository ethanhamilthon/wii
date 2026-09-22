import React from "react";
import { useSessionStore } from "@/store/session-store";
import { resolvePluginSettings, type PluginSettingField } from "@/lib/plugins";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { TrashIcon } from "@radix-ui/react-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Plugin-supplied strings (name/description/labels) are untrusted-length —
// clamp in JS rather than leaning on CSS truncate across nested flex/grid
// containers, which silently breaks the moment one ancestor forgets
// `min-w-0` (exactly what happened here: the fix belongs on the data, not
// another layer of overflow-hidden that just hides the symptom).
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

// Wii doesn't interpret settings values — it just renders a control per
// declared field `type` and hands changes back to the plugin unchanged.
// Label stacked above the control (not side-by-side) so a long label or a
// long value never compete for width — the field is always full-width.
const SettingField: React.FC<{
  field: PluginSettingField;
  value: string;
  onChange: (value: string) => void;
}> = ({ field, value, onChange }) => {
  if (field.type === "select") {
    return (
      <div className="border-t border-border pt-2">
        <div className="mb-1 truncate text-faint">{clampText(field.label, 60)}</div>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            aria-label={field.label}
            className="h-7 w-full text-xs text-dim hover:text-foreground focus:ring-0 capitalize"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt} value={opt} className="capitalize">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (field.type === "text" || field.type === "password") {
    return (
      <div className="border-t border-border pt-2">
        <div className="mb-1 truncate text-faint">{clampText(field.label, 60)}</div>
        <Input
          type={field.type === "password" ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full text-xs"
        />
      </div>
    );
  }
  return null;
};

export const PluginsPanel: React.FC = () => {
  const plugins = useSessionStore((state) => state.plugins);
  const pluginConfig = useSessionStore((state) => state.pluginConfig);
  const setPluginEnabled = useSessionStore((state) => state.setPluginEnabled);
  const setPluginSetting = useSessionStore((state) => state.setPluginSetting);
  const deletePlugin = useSessionStore((state) => state.deletePlugin);

  if (!plugins.length) {
    return (
      <p className="py-6 text-center text-xs text-faint">
        No plugins installed. Drop a folder with an <code>index.js</code> into{" "}
        <code>~/.wii/plugins/</code>.
      </p>
    );
  }

  return (
    <div className="grid gap-3 select-none">
      <p className="text-xs text-faint">
        Plugins add instructions to every session's system prompt. Installed from{" "}
        <code>~/.wii/plugins/</code>.
      </p>

      {/* No nested scroller: CommandCenter's panel div is the single scroll
          area. A second `max-h` + `overflow-hidden` here compressed the rows
          and clipped cards with settings mid-field. */}
      <div className="grid gap-2 pr-1">
        {plugins.map((plugin) => {
          const isEnabled = !!pluginConfig[plugin.id]?.enabled;
          const settings = resolvePluginSettings(plugin, pluginConfig);

          return (
            <div
              key={plugin.id}
              className="grid min-w-0 gap-2 rounded-lg border border-border bg-panel p-2.5 text-xs"
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{clampText(plugin.name, 60)}</div>
                  <div className="truncate text-[11px] text-faint">{clampText(plugin.description, 140)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => setPluginEnabled(plugin.id, checked)}
                  />
                  <button
                    type="button"
                    title="Remove plugin"
                    aria-label="Remove plugin"
                    onClick={() => deletePlugin(plugin.id)}
                    className="text-faint hover:text-red"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {isEnabled &&
                plugin.settings?.map((field) => (
                  <SettingField
                    key={field.key}
                    field={field}
                    value={settings[field.key]}
                    onChange={(v) => setPluginSetting(plugin.id, field.key, v)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
