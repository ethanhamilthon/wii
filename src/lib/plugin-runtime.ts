import { useEffect, useMemo, useRef, useState } from "react";
import * as tauri from "@/lib/tauri";
import { useSessionStore } from "@/store/session-store";
import { resolvePluginSettings, type PluginDef } from "@/lib/plugins";

// Context handed to a plugin's initState/onMount/actions/render. Wii itself
// never reads or interprets these fields — it only wires them up.
export interface PluginCtx {
  fetch: (url: string, options?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
    text: () => Promise<string>;
  }>;
  storage: { get: (key: string) => any; set: (key: string, value: any) => void };
  settings: Record<string, string>;
  activeProvider: { id: string; name: string; baseUrl: string; models: string[]; apiKey: string } | null;
}

function storageKey(pluginId: string, key: string) {
  return `wii_plugin_data_${pluginId}_${key}`;
}

function makeCtx(plugin: PluginDef, settings: Record<string, string>): PluginCtx {
  const activeProvider = useSessionStore.getState().getActiveProvider();
  return {
    fetch: async (url, options) => {
      const headers: Record<string, string> = {};
      if (options?.headers) {
        for (const [k, v] of Object.entries(options.headers as Record<string, string>)) headers[k] = String(v);
      }
      const body =
        typeof options?.body === "string" ? options.body : options?.body ? JSON.stringify(options.body) : null;
      const res = await tauri.pluginHttpRequest(url, options?.method || "GET", headers, body);
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        status: res.status,
        json: async () => JSON.parse(res.body),
        text: async () => res.body,
      };
    },
    storage: {
      get: (key) => {
        try {
          const raw = localStorage.getItem(storageKey(plugin.id, key));
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        localStorage.setItem(storageKey(plugin.id, key), JSON.stringify(value));
      },
    },
    settings,
    activeProvider: activeProvider
      ? {
          id: activeProvider.id,
          name: activeProvider.name,
          baseUrl: activeProvider.baseUrl,
          models: activeProvider.models,
          apiKey: activeProvider.apiKey,
        }
      : null,
  };
}

/** Wires a plugin's initState/onMount/actions into React state + dispatch. */
export function usePluginRuntime(plugin: PluginDef) {
  const pluginConfig = useSessionStore((s) => s.pluginConfig);
  const settings = useMemo(() => resolvePluginSettings(plugin, pluginConfig), [plugin, pluginConfig]);
  const ctx = useMemo(() => makeCtx(plugin, settings), [plugin, settings]);

  const [state, setState] = useState(() => plugin.initState?.(ctx) ?? {});
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useMemo(() => {
    const fn = async (action: string, payload?: any) => {
      const handler = plugin.actions?.[action];
      if (!handler) {
        console.error(`Plugin "${plugin.id}" has no action "${action}"`);
        return;
      }
      await handler({ state: stateRef.current, setState, dispatch: fn, ctx, payload });
    };
    return fn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, ctx]);

  useEffect(() => {
    if (!plugin.onMount) return;
    const cleanup = plugin.onMount({ state: stateRef.current, setState, dispatch, ctx });
    return typeof cleanup === "function" ? cleanup : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin]);

  return { state, dispatch, ctx };
}
