import * as tauri from "@/lib/tauri";

// Wii-native plugins: plain JS files in ~/.wii/plugins/<id>/index.js, CommonJS
// shape. Loaded here — read as text over Tauri, executed in this webview
// context via `new Function`. No sandbox: same trust model as an
// Obsidian/Raycast plugin, the user put the file on their own disk.
// Unrelated to pi's own --extension flag.
//
// Wii core stays domain-agnostic: it knows setting field *types* and the
// declarative UINode shapes below, never what a plugin's data means. Two
// independent, both-optional plugin capabilities:
//  - `prompt(settings)` — injected into the system prompt when enabled.
//  - `panel` + `render`/`actions`/`initState`/`onMount` — a declarative UI
//    tab in Command Center, driven by plugin-runtime.ts's usePluginRuntime.

export interface SelectSettingField {
  key: string;
  type: "select";
  label: string;
  options: string[];
  default: string;
}

export interface TextLikeSettingField {
  key: string;
  type: "text" | "password";
  label: string;
  default: string;
}

export type PluginSettingField = SelectSettingField | TextLikeSettingField;

// --- Declarative UI AST -----------------------------------------------------
// `render(state, ctx)` returns one of these; PluginUIRenderer maps it to
// Tailwind/shadcn components. No raw HTML from plugins.

export type UINode =
  | {
      type: "stack";
      direction?: "row" | "col";
      gap?: number;
      align?: "start" | "center" | "end" | "between";
      children: UINode[];
    }
  | {
      type: "text";
      text: string;
      variant?: "title" | "body" | "muted" | "caption";
    }
  | {
      type: "stat";
      label: string;
      value: string | number;
      subtext?: string;
    }
  | {
      type: "progress";
      label?: string;
      value: number;
      max: number;
      unit?: string;
      variant?: "default" | "warning" | "destructive";
    }
  | {
      type: "badge";
      text: string;
      variant?: "default" | "success" | "warning" | "destructive";
    }
  | {
      type: "button";
      label: string;
      action: string;
      payload?: any;
      variant?: "default" | "secondary" | "outline" | "ghost";
      loading?: boolean;
    }
  | {
      type: "spinner";
      text?: string;
    }
  | {
      type: "separator";
    };

export interface PluginPanelDef {
  title: string;
  icon?: string;
}

// Action handler signature — see plugin-runtime.ts for what `ctx` carries.
export type PluginActionHandler = (args: {
  state: any;
  setState: (updater: any) => void;
  dispatch: (action: string, payload?: any) => void;
  ctx: any;
  payload?: any;
}) => void | Promise<void>;

export type PluginOnMount = (args: {
  state: any;
  setState: (updater: any) => void;
  dispatch: (action: string, payload?: any) => void;
  ctx: any;
}) => void | (() => void);

export interface PluginDef {
  id: string;
  name: string;
  description: string;
  settings?: PluginSettingField[];
  /** System-prompt injection. Optional — panel-only plugins may omit it. */
  prompt?: (settings: Record<string, string>) => string;
  /** True if `~/.wii/plugins/<id>/tools.js` should be loaded into pi as a real
   *  extension (via explicit `--extension`, never discovery) when this plugin
   *  is enabled. tools.js is a normal pi extension file — Wii never executes
   *  or interprets it, only decides whether to point pi at it. */
  hasTools?: boolean;

  // Declarative UI (all optional; a plugin needs all four to show a panel).
  panel?: PluginPanelDef;
  initState?: (ctx: any) => any;
  onMount?: PluginOnMount;
  actions?: Record<string, PluginActionHandler>;
  render?: (state: any, ctx: any) => UINode;
}

function isPluginDef(x: any): x is PluginDef {
  return x && typeof x.id === "string" && typeof x.name === "string";
}

/** Reads every ~/.wii/plugins/<id>/index.js and evaluates it as CommonJS. */
export async function loadPlugins(): Promise<PluginDef[]> {
  const files = await tauri.listPlugins();
  const out: PluginDef[] = [];
  for (const file of files) {
    try {
      const module = { exports: {} as any };
      new Function("module", "exports", file.code)(module, module.exports);
      const def = module.exports;
      if (isPluginDef(def)) out.push(def);
      else console.error(`Plugin "${file.id}" did not export a valid plugin object`);
    } catch (err) {
      console.error(`Failed to load plugin "${file.id}":`, err);
    }
  }
  return out;
}

export interface PluginState {
  enabled: boolean;
  settings: Record<string, string>;
}

export type PluginConfigMap = Record<string, PluginState>;

function defaultSettings(plugin: PluginDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of plugin.settings || []) out[field.key] = field.default;
  return out;
}

/** Resolved settings for a plugin: stored values over the plugin's own defaults. */
export function resolvePluginSettings(plugin: PluginDef, config: PluginConfigMap): Record<string, string> {
  return { ...defaultSettings(plugin), ...(config[plugin.id]?.settings || {}) };
}

/** Base user prompt + every enabled plugin's block appended below it. */
export function composeSystemPrompt(base: string, config: PluginConfigMap, plugins: PluginDef[]): string {
  const blocks = plugins
    .filter((p) => config[p.id]?.enabled && p.prompt)
    .map((p) => p.prompt!(resolvePluginSettings(p, config)))
    .filter(Boolean);
  return [base.trim(), ...blocks].filter(Boolean).join("\n\n");
}

/** Plugins with a declarative panel, enabled, ready for a Command Center tab. */
export function panelPlugins(plugins: PluginDef[], config: PluginConfigMap): PluginDef[] {
  return plugins.filter((p) => p.panel && p.render && config[p.id]?.enabled);
}
