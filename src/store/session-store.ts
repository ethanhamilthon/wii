import { create } from "zustand";
import type {
  MessageItem,
  MultiProviderConfig,
  PersistedOpenTabs,
  ProviderSettings,
  SessionState,
  ToolState,
} from "@/types/wii";
import * as tauri from "@/lib/tauri";
import { extractMsgText, extractMsgThinking, toolText } from "@/lib/markdown";
import { composeSystemPrompt, loadPlugins, type PluginConfigMap, type PluginDef } from "@/lib/plugins";

export function formatTokens(num: number): string {
  if (!num) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

export function formatCost(usd: number): string {
  if (!usd || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function getModelMaxContext(modelName?: string): number {
  if (!modelName) return 128_000;
  const lower = modelName.toLowerCase();
  if (lower.includes("gemini")) return 1_000_000;
  if (lower.includes("claude")) return 200_000;
  return 128_000;
}

export function formatPath(p?: string | null): string {
  if (!p) return "";
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine || "New session";
}

function storageGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {}
}

export const DEFAULT_TITLE_PROMPT =
  "Summarize the user's request as a short session title, 3-6 words, no quotes, no trailing punctuation. Reply with the title only.";

function getStoredTitlePrompt(): string {
  return storageGet("wii_title_prompt") || "";
}

// Best-effort async title: one cheap completion call against the user's own
// configured provider/model, same endpoint pi itself talks to. Failure just
// leaves the truncated-message placeholder title in place.
async function generateTitle(
  userText: string,
  provider: ProviderSettings,
  titlePrompt: string,
  model: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 20,
        messages: [
          { role: "system", content: titlePrompt.trim() || DEFAULT_TITLE_PROMPT },
          { role: "user", content: userText.slice(0, 2000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ? text.replace(/^["'\u201c]+|["'\u201d]+$/g, "") : null;
  } catch {
    return null;
  }
}

function initialMultiConfig(): MultiProviderConfig {
  return {
    activeId: "default",
    providers: [
      {
        id: "default",
        name: "Default",
        baseUrl: "http://127.0.0.1:8317/v1",
        apiKey: "",
        models: ["gemini-3.8-flash-high"],
      },
    ],
  };
}

function getStoredLastUsedModel(): string | null {
  return storageGet("wii_last_used_model");
}

function getStoredLastUsedEffort(): string | null {
  return storageGet("wii_last_used_effort");
}

function getStoredCachedModels(): string[] {
  try {
    return JSON.parse(storageGet("wii_cached_models") || "[]");
  } catch {
    return [];
  }
}

function getStoredEnabledModels(): Set<string> | null {
  try {
    const raw = storageGet("wii_enabled_models");
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// The Context panel's editable base prompt lives in localStorage, not the
// backend file: the backend file holds the *effective* prompt (base + enabled
// plugin blocks) actually sent to pi, so plugin text never leaks into the textarea.
function getStoredBaseSystemPrompt(): string {
  return storageGet("wii_base_system_prompt") || "";
}

function getStoredPluginConfig(): PluginConfigMap {
  try {
    return JSON.parse(storageGet("wii_plugins") || "{}");
  } catch {
    return {};
  }
}

// A freshly spawned pi process can emit startup widget events before the
// create_session invoke resolves and its tab exists in Zustand.
const earlyPiEvents = new Map<string, any[]>();
const closingTabs = new Set<string>();

interface SessionStoreState {
  sessions: Record<string, SessionState>;
  tabOrder: string[];
  activeId: string | null;
  selectedProjectPath: string | null;
  multiConfig: MultiProviderConfig;
  enabledModels: Set<string> | null;
  cachedModels: string[];
  commandCenterOpen: boolean;
  sessionManagerOpen: boolean;
  systemPrompt: string;
  titlePrompt: string;
  pluginConfig: PluginConfigMap;
  plugins: PluginDef[];
  hasLoadedOnBoot: boolean;
  drafts: Record<string, string>;
  lastUsedModel: string | null;
  lastUsedEffort: string | null;

  // Actions
  getActiveSession: () => SessionState | null;
  getActiveProvider: () => ProviderSettings | null;
  getAllKnownModels: () => string[];
  getVisibleModels: () => string[];

  setDraft: (sessionId: string, text: string) => void;
  switchActive: (id: string) => void;
  closeTab: (id: string) => Promise<void>;
  openTab: (
    resumePath?: string | null,
    presetTitle?: string | null,
    projectPath?: string | null,
    savedModel?: string | null,
    savedEffort?: string | null,
    savedProviderId?: string | null,
  ) => Promise<string>;
  sendMessage: (message: string) => Promise<void>;
  abortActiveSession: () => Promise<void>;
  startNewProjectSession: () => Promise<void>;

  setActiveSessionModel: (model: string) => Promise<void>;
  setActiveSessionReasoningEffort: (effort: string) => Promise<void>;

  setCommandCenterOpen: (open: boolean) => void;
  setSessionManagerOpen: (open: boolean) => void;
  setModelEnabled: (modelId: string, enabled: boolean) => void;
  setCachedModels: (models: string[]) => void;
  setPluginEnabled: (pluginId: string, enabled: boolean) => void;
  setPluginSetting: (pluginId: string, key: string, value: string) => void;
  reloadPlugins: () => Promise<void>;
  deletePlugin: (pluginId: string) => Promise<void>;
  answerExtensionUIRequest: (sessionId: string, response: Record<string, unknown>) => Promise<void>;

  setMultiConfig: (config: MultiProviderConfig) => void;
  switchProvider: (id: string) => Promise<void>;
  saveCurrentProviderForm: (updates: Partial<ProviderSettings>) => Promise<void>;
  addNewProvider: () => Promise<void>;
  deleteCurrentProvider: () => Promise<void>;

  loadSystemPrompt: () => Promise<void>;
  saveSystemPromptText: (text: string) => Promise<void>;
  saveTitlePromptText: (text: string) => void;
  pushEffectiveSystemPrompt: () => Promise<void>;

  bootstrapApp: () => Promise<void>;
  saveOpenTabs: () => void;

  // Pi event handlers
  handlePiEvent: (sessionId: string, event: any) => void;
  handlePiStderr: (sessionId: string, message: string) => void;
  handlePiExit: (sessionId: string, status: any) => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: {},
  tabOrder: [],
  activeId: null,
  selectedProjectPath: null,
  multiConfig: initialMultiConfig(),
  enabledModels: getStoredEnabledModels(),
  cachedModels: getStoredCachedModels(),
  commandCenterOpen: false,
  sessionManagerOpen: false,
  systemPrompt: getStoredBaseSystemPrompt(),
  titlePrompt: getStoredTitlePrompt(),
  pluginConfig: getStoredPluginConfig(),
  plugins: [],
  hasLoadedOnBoot: false,
  drafts: {},
  lastUsedModel: getStoredLastUsedModel(),
  lastUsedEffort: getStoredLastUsedEffort(),

  setDraft: (sessionId, text) => {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [sessionId]: text,
      },
    }));
  },

  getActiveSession: () => {
    const { sessions, activeId } = get();
    return activeId ? sessions[activeId] || null : null;
  },

  getActiveProvider: () => {
    const { multiConfig } = get();
    return (
      multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
      multiConfig.providers[0] ||
      null
    );
  },

  getAllKnownModels: () => {
    const session = get().getActiveSession();
    const provider = session
      ? get().multiConfig.providers.find((p) => p.id === session.providerId)
      : get().getActiveProvider();
    return [...new Set([session?.model, ...(provider?.models || [])].filter(Boolean))] as string[];
  },

  getVisibleModels: () => {
    const all = get().getAllKnownModels();
    const enabled = get().enabledModels;
    const activeSession = get().getActiveSession();
    return all.filter((m) => !enabled || enabled.has(m) || m === activeSession?.model);
  },

  switchActive: (id: string) => {
    const { tabOrder } = get();
    if (!tabOrder.includes(id)) {
      set({ tabOrder: [...tabOrder, id], activeId: id });
    } else {
      set({ activeId: id });
    }
    get().saveOpenTabs();
  },

  closeTab: async (id: string) => {
    if (!get().tabOrder.includes(id) || closingTabs.has(id)) return;
    closingTabs.add(id);
    try {
      await tauri.closeSession(id);
      const { tabOrder, activeId } = get();
      const index = tabOrder.indexOf(id);
      const nextTabOrder = tabOrder.filter((tabId) => tabId !== id);
      const nextActiveId = activeId === id
        ? nextTabOrder[Math.max(0, index - 1)] ?? null
        : activeId;
      set((state) => {
        const { [id]: _removed, ...sessions } = state.sessions;
        const { [id]: _draft, ...drafts } = state.drafts;
        return { sessions, drafts, tabOrder: nextTabOrder, activeId: nextActiveId };
      });
      earlyPiEvents.delete(id);
      get().saveOpenTabs();
    } catch (error) {
      console.error("Failed to close session:", error);
      alert(`Failed to close session: ${String(error)}`);
    } finally {
      closingTabs.delete(id);
    }
  },

  openTab: async (resumePath, presetTitle, projectPath, savedModel, savedEffort, savedProviderId) => {
    if (resumePath) {
      const { tabOrder, sessions } = get();
      const existing = tabOrder.map((id) => sessions[id]).find(
        (s) => s?.alive && s.resumePath === resumePath,
      );
      if (existing) {
        get().switchActive(existing.id);
        return existing.id;
      }
    }

    const provider = savedProviderId
      ? get().multiConfig.providers.find((p) => p.id === savedProviderId)
      : get().getActiveProvider();
    if (!provider || !provider.models || provider.models.length === 0) {
      throw new Error("Session provider has no configured models");
    }

    const { lastUsedModel, lastUsedEffort } = get();
    const model =
      savedModel ||
      ((lastUsedModel && provider.models.includes(lastUsedModel))
        ? lastUsedModel
        : provider.models[0]);
    const reasoningEffort = savedEffort ?? (lastUsedEffort ?? "medium");

    if (!lastUsedModel) {
      set({ lastUsedModel: model });
      storageSet("wii_last_used_model", model);
    }
    if (!lastUsedEffort) {
      set({ lastUsedEffort: reasoningEffort });
      storageSet("wii_last_used_effort", reasoningEffort);
    }

    const { plugins, pluginConfig } = get();
    const toolPlugins = plugins
      .filter((p) => p.hasTools && pluginConfig[p.id]?.enabled)
      .map((p) => p.id);

    const id = await tauri.createSession({
      resumePath: resumePath ?? null,
      projectPath: projectPath ?? null,
      toolPlugins,
      providerId: provider.id,
      model,
      reasoningEffort,
    });

    const newSession: SessionState = {
      id,
      title: presetTitle || "New session",
      projectPath: projectPath || null,
      resumePath: resumePath || null,
      status: resumePath ? "idle" : "running",
      alive: true,
      busy: false,
      providerId: provider.id,
      model,
      reasoningEffort,
      messages: [],
      tools: {},
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      contextTokens: 0,
      cost: 0,
      pendingUIRequest: null,
      pluginWidgets: {},
    };

    if (resumePath) {
      try {
        const history = await tauri.getSessionHistory(resumePath);
        let firstUserText = "";

        for (const entry of history) {
          if (entry.type === "message" && entry.message) {
            const msg = entry.message;
            if (msg.role === "user") {
              const text = extractMsgText(msg.content);
              if (text) {
                newSession.messages.push({
                  id: entry.id || `u-${Math.random()}`,
                  role: "user",
                  text,
                });
                if (!firstUserText) firstUserText = text;
              }
            } else if (msg.role === "assistant") {
              const text = extractMsgText(msg.content);
              const thinking = extractMsgThinking(msg.content);
              const toolCalls: ToolState[] = [];

              if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                  if (part.type === "toolCall") {
                    const t: ToolState = {
                      id: part.id,
                      name: part.name,
                      args: part.arguments,
                      status: "done",
                    };
                    toolCalls.push(t);
                    newSession.tools[part.id] = t;
                  }
                }
              }

              if (text || thinking || toolCalls.length) {
                newSession.messages.push({
                  id: entry.id || `a-${Math.random()}`,
                  role: "assistant",
                  text,
                  thinking,
                  tools: toolCalls,
                });
              }

              if (msg.usage) {
                const u = msg.usage;
                newSession.inputTokens += u.input || 0;
                newSession.outputTokens += u.output || 0;
                newSession.cacheReadTokens += u.cacheRead || 0;
                newSession.contextTokens = (u.input || 0) + (u.output || 0);
                if (u.cost?.total) {
                  newSession.cost += u.cost.total;
                } else {
                  const sessionModel = newSession.model || "";
                  const inRate = sessionModel.includes("claude") ? 3.0 : 0.2;
                  const outRate = sessionModel.includes("claude") ? 15.0 : 0.8;
                  newSession.cost +=
                    ((u.input || 0) * inRate) / 1_000_000 +
                    ((u.output || 0) * outRate) / 1_000_000;
                }
              }
            } else if (msg.role === "toolResult") {
              const t = newSession.tools[msg.toolCallId];
              if (t) {
                t.result = toolText(msg);
                t.isError = !!msg.isError;
                t.status = msg.isError ? "error" : "done";
              }
            }
          }
        }

        if (firstUserText && (!presetTitle || presetTitle === "New session")) {
          newSession.title = truncateTitle(firstUserText);
        }
      } catch (err) {
        console.error("Failed to load session history:", err);
      }
    }

    set((state) => ({
      sessions: { ...state.sessions, [id]: newSession },
      tabOrder: [...state.tabOrder, id],
      activeId: id,
    }));

    for (const event of earlyPiEvents.get(id) || []) get().handlePiEvent(id, event);
    earlyPiEvents.delete(id);

    get().saveOpenTabs();
    return id;
  },

  sendMessage: async (message) => {
    const active = get().getActiveSession();
    if (!active || !active.alive || active.busy) return;

    const trimmed = message.trim();
    if (!trimmed) return;

    const userMsg: MessageItem = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
    };

    const isFirstMessage = active.title === "New session";
    const placeholderTitle = isFirstMessage ? truncateTitle(trimmed) : active.title;

    set((state) => {
      const s = state.sessions[active.id];
      if (!s) return state;
      const nextDrafts = { ...state.drafts };
      delete nextDrafts[active.id];
      return {
        drafts: nextDrafts,
        sessions: {
          ...state.sessions,
          [active.id]: {
            ...s,
            title: placeholderTitle,
            busy: true,
            status: "running",
            messages: [...s.messages, userMsg],
          },
        },
      };
    });

    get().saveOpenTabs();

    if (isFirstMessage) {
      const provider = get().multiConfig.providers.find((p) => p.id === active.providerId);
      if (provider) {
        generateTitle(trimmed, provider, get().titlePrompt, active.model).then((title) => {
          if (!title) return;
          set((state) => {
            const s = state.sessions[active.id];
            // Only overwrite if nothing else (user rename, resume reload) touched the title meanwhile.
            if (!s || s.title !== placeholderTitle) return state;
            return {
              sessions: { ...state.sessions, [active.id]: { ...s, title: truncateTitle(title) } },
            };
          });
          get().saveOpenTabs();
        });
      }
    }

    try {
      await tauri.sendMessage(active.id, trimmed);
    } catch (error) {
      get().handlePiStderr(active.id, String(error));
    }
  },

  abortActiveSession: async () => {
    const active = get().getActiveSession();
    if (!active || !active.busy) return;
    try {
      await tauri.abortSession(active.id);
    } catch (error) {
      get().handlePiStderr(active.id, String(error));
    }
  },

  startNewProjectSession: async () => {
    get().setSessionManagerOpen(false);
    try {
      const folder = await tauri.pickFolder();
      if (folder) {
        set({ selectedProjectPath: folder });
        const provider = get().getActiveProvider();
        if (provider) {
          await get().openTab(null, null, folder);
        }
      }
    } catch (err) {
      alert(String(err));
    }
  },

  setActiveSessionModel: async (model: string) => {
    const active = get().getActiveSession();
    if (!active) return;
    try {
      await tauri.setSessionModel(active.id, active.providerId, model);
      set((state) => {
        const s = state.sessions[active.id];
        if (!s) return state;
        return {
          sessions: {
            ...state.sessions,
            [active.id]: { ...s, model },
          },
          lastUsedModel: model,
        };
      });
      storageSet("wii_last_used_model", model);
      get().saveOpenTabs();
    } catch (err) {
      console.error("Failed to set session model:", err);
      throw err;
    }
  },

  setActiveSessionReasoningEffort: async (effort: string) => {
    const active = get().getActiveSession();
    if (!active) return;
    try {
      await tauri.setSessionThinking(active.id, effort);
      set((state) => {
        const s = state.sessions[active.id];
        if (!s) return state;
        return {
          sessions: {
            ...state.sessions,
            [active.id]: { ...s, reasoningEffort: effort },
          },
          lastUsedEffort: effort,
        };
      });
      storageSet("wii_last_used_effort", effort);
      get().saveOpenTabs();
    } catch (err) {
      console.error("Failed to set session reasoning effort:", err);
      throw err;
    }
  },

  setCommandCenterOpen: (open) => set({ commandCenterOpen: open }),
  setSessionManagerOpen: (open) => set({ sessionManagerOpen: open }),

  setModelEnabled: (modelId, enabled) => {
    const all = get().getAllKnownModels();
    let setObj = get().enabledModels;
    if (!setObj) {
      setObj = new Set(all);
    }
    const nextSet = new Set(setObj);
    if (enabled) nextSet.add(modelId);
    else nextSet.delete(modelId);

    storageSet("wii_enabled_models", JSON.stringify([...nextSet]));
    set({ enabledModels: nextSet });
  },

  setCachedModels: (models) => {
    const all = [...new Set([...get().cachedModels, ...models].filter(Boolean))] as string[];
    storageSet("wii_cached_models", JSON.stringify(all));
    set({ cachedModels: all });
  },

  setMultiConfig: (config) => {
    set({ multiConfig: config });
  },

  switchProvider: async (id) => {
    const { multiConfig } = get();
    const nextConfig = { ...multiConfig, activeId: id };
    await tauri.saveProviders(nextConfig);
    set({ multiConfig: nextConfig });
  },

  saveCurrentProviderForm: async (updates) => {
    const { multiConfig } = get();
    const active = get().getActiveProvider();
    if (!active) return;

    const updatedProvider: ProviderSettings = {
      ...active,
      ...updates,
      baseUrl: (updates.baseUrl ?? active.baseUrl).replace(/\/$/, ""),
    };

    const nextProviders = multiConfig.providers.map((p) =>
      p.id === active.id ? updatedProvider : p,
    );

    const nextConfig: MultiProviderConfig = {
      ...multiConfig,
      providers: nextProviders,
    };

    await tauri.saveProviders(nextConfig);
    set({ multiConfig: nextConfig });
  },

  addNewProvider: async () => {
    const { multiConfig } = get();
    const newId = `prov-${Date.now()}`;
    const newProv: ProviderSettings = {
      id: newId,
      name: "New Provider",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "",
      models: [],
    };

    const nextConfig: MultiProviderConfig = {
      activeId: newId,
      providers: [...multiConfig.providers, newProv],
    };

    await tauri.saveProviders(nextConfig);
    set({ multiConfig: nextConfig });
  },

  deleteCurrentProvider: async () => {
    const { multiConfig } = get();
    if (multiConfig.providers.length <= 1) {
      alert("Cannot delete the only provider.");
      return;
    }
    const remaining = multiConfig.providers.filter((p) => p.id !== multiConfig.activeId);
    const nextConfig: MultiProviderConfig = {
      activeId: remaining[0].id,
      providers: remaining,
    };
    await tauri.saveProviders(nextConfig);
    set({ multiConfig: nextConfig });
  },

  loadSystemPrompt: async () => {
    // Base prompt is local (see getStoredBaseSystemPrompt); just push the
    // effective (base + plugins) prompt to the backend so a fresh app start
    // sends it before the first session spawns.
    await get().pushEffectiveSystemPrompt();
  },

  saveSystemPromptText: async (text) => {
    storageSet("wii_base_system_prompt", text);
    set({ systemPrompt: text });
    await get().pushEffectiveSystemPrompt();
  },

  saveTitlePromptText: (text) => {
    storageSet("wii_title_prompt", text);
    set({ titlePrompt: text });
  },

  pushEffectiveSystemPrompt: async () => {
    const { systemPrompt, pluginConfig, plugins } = get();
    await tauri.saveSystemPrompt(composeSystemPrompt(systemPrompt, pluginConfig, plugins));
  },

  setPluginEnabled: (pluginId, enabled) => {
    const prev = get().pluginConfig[pluginId];
    const next: PluginConfigMap = {
      ...get().pluginConfig,
      [pluginId]: { enabled, settings: prev?.settings || {} },
    };
    storageSet("wii_plugins", JSON.stringify(next));
    set({ pluginConfig: next });
    get().pushEffectiveSystemPrompt();
  },

  // Generic: Wii doesn't know what a plugin's setting *means*, it just stores
  // whatever key/value the plugin's own settings field reported.
  setPluginSetting: (pluginId, key, value) => {
    const prev = get().pluginConfig[pluginId];
    const next: PluginConfigMap = {
      ...get().pluginConfig,
      [pluginId]: {
        enabled: prev?.enabled ?? false,
        settings: { ...prev?.settings, [key]: value },
      },
    };
    storageSet("wii_plugins", JSON.stringify(next));
    set({ pluginConfig: next });
    get().pushEffectiveSystemPrompt();
  },

  reloadPlugins: async () => {
    try {
      const plugins = await loadPlugins();
      set({ plugins });
    } catch (err) {
      console.error("Failed to load plugins:", err);
    }
  },

  deletePlugin: async (pluginId) => {
    await tauri.deletePlugin(pluginId);
    const { [pluginId]: _removed, ...restConfig } = get().pluginConfig;
    storageSet("wii_plugins", JSON.stringify(restConfig));
    set({ pluginConfig: restConfig });
    await get().reloadPlugins();
    await get().pushEffectiveSystemPrompt();
  },

  answerExtensionUIRequest: async (sessionId, response) => {
    const session = get().sessions[sessionId];
    const pending = session?.pendingUIRequest;
    if (!pending) return;
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...s, pendingUIRequest: null } } };
    });
    await tauri.answerExtensionUI(sessionId, pending.id, response);
  },

  saveOpenTabs: () => {
    const { tabOrder, sessions, activeId } = get();
    const tabs: PersistedOpenTabs["tabs"] = tabOrder
      .map((id) => {
        const s = sessions[id];
        if (!s) return null;
        return {
          title: s.title,
          projectPath: s.projectPath,
          resumePath: s.resumePath,
          providerId: s.providerId,
          model: s.model,
          reasoningEffort: s.reasoningEffort,
        };
      })
      .filter(Boolean) as any;

    try {
      storageSet(
        "wii_open_tabs",
        JSON.stringify({ tabs, activeIndex: tabOrder.indexOf(activeId || "") }),
      );
    } catch {}
  },

  bootstrapApp: async () => {
    if (get().hasLoadedOnBoot) return;
    set({ hasLoadedOnBoot: true });
    try {
      await tauri.registerWebview();
    } catch (error) {
      set({ hasLoadedOnBoot: false });
      console.error("Failed to register WebView:", error);
      alert(`Failed to restore sessions: ${String(error)}`);
      return;
    }

    // 1. Load providers
    try {
      const cfg = await tauri.getProviders();
      if (cfg && cfg.providers?.length) {
        set({ multiConfig: cfg });
      } else {
        const single = await tauri.getProvider();
        if (single) {
          set({
            multiConfig: {
              activeId: single.id || "default",
              providers: [single],
            },
          });
        }
      }
    } catch (e) {
      console.error("Failed to load provider settings:", e);
    }

    // 2. Load plugins, then system prompt (composing needs the loaded plugin list)
    await get().reloadPlugins();
    get().loadSystemPrompt();

    // 3. Restore tabs
    try {
      const raw = storageGet("wii_open_tabs");
      const provider = get().getActiveProvider();
      if (raw && provider) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.tabs) && data.tabs.length > 0) {
          for (const t of data.tabs) {
            if (t.resumePath || t.projectPath) {
              await get().openTab(t.resumePath, t.title, t.projectPath, t.model, t.reasoningEffort, t.providerId);
            }
          }
          const { tabOrder } = get();
          if (
            data.activeIndex != null &&
            data.activeIndex >= 0 &&
            data.activeIndex < tabOrder.length
          ) {
            get().switchActive(tabOrder[data.activeIndex]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to restore open tabs:", err);
    }
  },

  // ---------------- Pi Event Dispatch ----------------
  handlePiEvent: (sessionId, event) => {
    if (!get().sessions[sessionId]) {
      earlyPiEvents.set(sessionId, [...(earlyPiEvents.get(sessionId) || []), event]);
      return;
    }

    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;

      const nextSession = { ...s };

      if (event.type === "agent_start") {
        nextSession.busy = true;
        nextSession.status = "running";
      }

      // Dialog-type extension UI request from a plugin tool's `ctx.ui.*` call
      // (select/confirm/input/editor). Generic: Wii never inspects which
      // plugin/tool asked, just renders a matching dialog and forwards the answer.
      if (event.type === "extension_ui_request") {
        if (event.method === "setWidget" && event.widgetKey) {
          const widgets = { ...nextSession.pluginWidgets };
          if (Array.isArray(event.widgetLines)) {
            widgets[event.widgetKey] = {
              key: event.widgetKey,
              lines: event.widgetLines.map(String),
              placement: event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
            };
          } else {
            delete widgets[event.widgetKey];
          }
          nextSession.pluginWidgets = widgets;
          return { sessions: { ...state.sessions, [sessionId]: nextSession } };
        }
        if (event.method === "notify" || event.method === "setStatus" || event.method === "setTitle" || event.method === "set_editor_text") {
          // Fire-and-forget methods: nothing to answer, nothing to block on.
          return { sessions: { ...state.sessions, [sessionId]: nextSession } };
        }
        nextSession.pendingUIRequest = {
          id: event.id,
          method: event.method,
          title: event.title,
          message: event.message,
          options: event.options,
          placeholder: event.placeholder,
          prefill: event.prefill,
        };
      }

      if (event.type === "message_start" && event.message?.role === "assistant") {
        nextSession.messages = [
          ...nextSession.messages,
          { id: `a-${crypto.randomUUID()}`, role: "assistant", text: "" },
        ];
      }

      if (event.type === "message_update") {
        const delta = event.assistantMessageEvent;
        const messages = [...nextSession.messages];
        let last = messages[messages.length - 1];
        if (!last || last.role !== "assistant") {
          last = { id: `a-${crypto.randomUUID()}`, role: "assistant", text: "" };
          messages.push(last);
        }

        if (delta?.type === "thinking_start") {
          last = { ...last, thinking: last.thinking || "", thinkingStreaming: true };
        } else if (delta?.type === "thinking_delta") {
          last = {
            ...last,
            thinking: `${last.thinking || ""}${delta.delta || ""}`,
            thinkingStreaming: true,
          };
        } else if (delta?.type === "thinking_end") {
          last = {
            ...last,
            thinking: last.thinking || delta.content || "",
            thinkingStreaming: false,
          };
        } else if (delta?.type === "text_start") {
          last = { ...last, text: last.text || "" };
        } else if (delta?.type === "text_delta") {
          last = { ...last, text: `${last.text}${delta.delta || ""}` };
        } else if (delta?.type === "text_end") {
          last = { ...last, text: last.text || delta.content || "" };
        }

        messages[messages.length - 1] = last;
        nextSession.messages = messages;
      }

      if (event.type === "tool_execution_start") {
        const tool: ToolState = {
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
          status: "running",
        };
        nextSession.tools = { ...nextSession.tools, [event.toolCallId]: tool };

        const msgs = [...nextSession.messages];
        let last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") {
          last = { id: `a-${crypto.randomUUID()}`, role: "assistant", text: "", tools: [tool] };
          msgs.push(last);
        } else {
          const tools = last.tools || [];
          last = {
            ...last,
            tools: tools.some((item) => item.id === tool.id)
              ? tools.map((item) => (item.id === tool.id ? tool : item))
              : [...tools, tool],
          };
          msgs[msgs.length - 1] = last;
        }
        nextSession.messages = msgs;
      }

      if (event.type === "tool_execution_update") {
        const t = nextSession.tools[event.toolCallId];
        if (t) {
          nextSession.tools = {
            ...nextSession.tools,
            [event.toolCallId]: { ...t, result: toolText(event.partialResult) },
          };
        }
      }

      if (event.type === "tool_execution_end") {
        const t = nextSession.tools[event.toolCallId];
        if (t) {
          const updated: ToolState = {
            ...t,
            result: toolText(event.result),
            isError: !!event.isError,
            status: event.isError ? "error" : "done",
          };
          nextSession.tools = { ...nextSession.tools, [event.toolCallId]: updated };

          // Update tool reference in messages array
          nextSession.messages = nextSession.messages.map((m) => {
            if (!m.tools) return m;
            return {
              ...m,
              tools: m.tools.map((x) => (x.id === event.toolCallId ? updated : x)),
            };
          });
        }
      }

      if (event.type === "message_end") {
        if (event.message?.role === "assistant") {
          const content = event.message.content;
          const tools: ToolState[] = Array.isArray(content)
            ? content
                .filter((part) => part?.type === "toolCall")
                .map((part) => {
                  const existing = nextSession.tools[part.id];
                  const tool: ToolState = existing
                    ? { ...existing, name: part.name, args: part.arguments }
                    : {
                        id: part.id,
                        name: part.name,
                        args: part.arguments,
                        status: "running",
                      };
                  nextSession.tools = { ...nextSession.tools, [tool.id]: tool };
                  return tool;
                })
            : [];
          const messages = [...nextSession.messages];
          const index = messages.map((message) => message.role).lastIndexOf("assistant");
          const finalMessage: MessageItem = {
            ...(index >= 0
              ? messages[index]
              : { id: `a-${crypto.randomUUID()}`, role: "assistant" as const }),
            text: extractMsgText(content),
            thinking: extractMsgThinking(content),
            thinkingStreaming: false,
            tools,
          };
          if (index >= 0) messages[index] = finalMessage;
          else messages.push(finalMessage);
          nextSession.messages = messages;
        }

        if (event.message?.usage) {
          const u = event.message.usage;
          nextSession.inputTokens += u.input || 0;
          nextSession.outputTokens += u.output || 0;
          nextSession.cacheReadTokens += u.cacheRead || 0;
          nextSession.contextTokens = (u.input || 0) + (u.output || 0);

          if (u.cost?.total) {
            nextSession.cost += u.cost.total;
          } else {
            const sessionModel = nextSession.model || "";
            const inRate = sessionModel.includes("claude") ? 3.0 : 0.2;
            const outRate = sessionModel.includes("claude") ? 15.0 : 0.8;
            nextSession.cost +=
              ((u.input || 0) * inRate) / 1_000_000 +
              ((u.output || 0) * outRate) / 1_000_000;
          }
        }

        if (event.message?.stopReason === "error") {
          nextSession.status = "error";
          nextSession.busy = false;
          nextSession.messages = [
            ...nextSession.messages,
            {
              id: `err-${Date.now()}`,
              role: "error",
              text: String(event.message.errorMessage || "Provider error"),
            },
          ];
        }
      }

      if (event.type === "agent_settled") {
        nextSession.busy = false;
        if (nextSession.status !== "error") {
          nextSession.status = "idle";
        }
        if (!nextSession.resumePath) {
          tauri
            .getSessionPath(sessionId)
            .then((p) => {
              if (p) {
                set((inner) => {
                  const curr = inner.sessions[sessionId];
                  if (!curr) return inner;
                  return {
                    sessions: {
                      ...inner.sessions,
                      [sessionId]: { ...curr, resumePath: p },
                    },
                  };
                });
                get().saveOpenTabs();
              }
            })
            .catch(() => {});
        }
      }

      if (event.type === "response" && event.success === false) {
        nextSession.status = "error";
        nextSession.messages = [
          ...nextSession.messages,
          { id: `err-${Date.now()}`, role: "error", text: String(event.error) },
        ];
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: nextSession,
        },
      };
    });
  },

  handlePiStderr: (sessionId, message) => {
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            busy: false,
            status: "error",
            messages: [
              ...s.messages,
              { id: `err-${Date.now()}`, role: "error", text: String(message) },
            ],
          },
        },
      };
    });
  },

  handlePiExit: (sessionId, status) => {
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      const codeInfo =
        status?.code != null
          ? `code ${status.code}`
          : status?.signal != null
          ? `signal ${status.signal}`
          : "";
      const text = `Pi process stopped${codeInfo ? ` (${codeInfo})` : ""}`;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            alive: false,
            busy: false,
            status: "error",
            messages: [...s.messages, { id: `err-${Date.now()}`, role: "error", text }],
          },
        },
      };
    });
  },
}));
