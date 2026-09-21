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
import { extractMsgText, toolText } from "@/lib/markdown";

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

function initialMultiConfig(): MultiProviderConfig {
  return {
    activeId: "default",
    providers: [
      {
        id: "default",
        name: "Default",
        baseUrl: "http://127.0.0.1:8317/v1",
        model: "gemini-3.8-flash-high",
        apiKey: "",
        reasoningEffort: "",
        models: [],
      },
    ],
  };
}

function getStoredCachedModels(): string[] {
  try {
    return JSON.parse(localStorage.getItem("wii_cached_models") || "[]");
  } catch {
    return [];
  }
}

function getStoredEnabledModels(): Set<string> | null {
  try {
    const raw = localStorage.getItem("wii_enabled_models");
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

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
  hasLoadedOnBoot: boolean;

  // Actions
  getActiveSession: () => SessionState | null;
  getActiveProvider: () => ProviderSettings | null;
  getAllKnownModels: () => string[];
  getVisibleModels: () => string[];

  switchActive: (id: string) => void;
  closeTab: (id: string) => void;
  openTab: (
    resumePath?: string | null,
    presetTitle?: string | null,
    projectPath?: string | null,
  ) => Promise<string>;
  sendMessage: (message: string) => Promise<void>;
  abortActiveSession: () => Promise<void>;
  startNewProjectSession: () => Promise<void>;

  setCommandCenterOpen: (open: boolean) => void;
  setSessionManagerOpen: (open: boolean) => void;
  setModelEnabled: (modelId: string, enabled: boolean) => void;
  setCachedModels: (models: string[]) => void;

  setMultiConfig: (config: MultiProviderConfig) => void;
  switchProvider: (id: string) => Promise<void>;
  saveCurrentProviderForm: (updates: Partial<ProviderSettings>) => Promise<void>;
  addNewProvider: () => Promise<void>;
  deleteCurrentProvider: () => Promise<void>;

  loadSystemPrompt: () => Promise<void>;
  saveSystemPromptText: (text: string) => Promise<void>;

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
  systemPrompt: "",
  hasLoadedOnBoot: false,

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
    const active = get().getActiveProvider();
    const { cachedModels } = get();
    return [
      ...new Set([active?.model, ...(active?.models || []), ...cachedModels].filter(Boolean)),
    ] as string[];
  },

  getVisibleModels: () => {
    const all = get().getAllKnownModels();
    const enabled = get().enabledModels;
    const active = get().getActiveProvider();
    return all.filter((m) => !enabled || enabled.has(m) || m === active?.model);
  },

  switchActive: (id: string) => {
    set({ activeId: id });
    get().saveOpenTabs();
  },

  closeTab: (id: string) => {
    const { tabOrder, activeId, sessions } = get();
    const index = tabOrder.indexOf(id);
    if (index === -1) return;

    const nextTabOrder = tabOrder.filter((tabId) => tabId !== id);
    let nextActiveId = activeId;

    if (activeId === id) {
      if (nextTabOrder.length > 0) {
        nextActiveId = nextTabOrder[Math.max(0, index - 1)];
      } else {
        nextActiveId = null;
      }
    }

    set({ tabOrder: nextTabOrder, activeId: nextActiveId });
    get().saveOpenTabs();
  },

  openTab: async (resumePath, presetTitle, projectPath) => {
    const id = await tauri.createSession({
      resumePath: resumePath ?? null,
      projectPath: projectPath ?? null,
    });

    const newSession: SessionState = {
      id,
      title: presetTitle || "New session",
      projectPath: projectPath || null,
      resumePath: resumePath || null,
      status: resumePath ? "idle" : "running",
      alive: true,
      busy: false,
      messages: [],
      tools: {},
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      contextTokens: 0,
      cost: 0,
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

              if (text || toolCalls.length) {
                newSession.messages.push({
                  id: entry.id || `a-${Math.random()}`,
                  role: "assistant",
                  text,
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
                  const activeModel = get().getActiveProvider()?.model || "";
                  const inRate = activeModel.includes("claude") ? 3.0 : 0.2;
                  const outRate = activeModel.includes("claude") ? 15.0 : 0.8;
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

    set((state) => {
      const s = state.sessions[active.id];
      if (!s) return state;
      const nextTitle = s.title === "New session" ? truncateTitle(trimmed) : s.title;
      return {
        sessions: {
          ...state.sessions,
          [active.id]: {
            ...s,
            title: nextTitle,
            busy: true,
            status: "running",
            messages: [...s.messages, userMsg],
          },
        },
      };
    });

    get().saveOpenTabs();

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

    localStorage.setItem("wii_enabled_models", JSON.stringify([...nextSet]));
    set({ enabledModels: nextSet });
  },

  setCachedModels: (models) => {
    const all = [...new Set([...get().cachedModels, ...models].filter(Boolean))] as string[];
    localStorage.setItem("wii_cached_models", JSON.stringify(all));
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
      model: "gemini-3.8-flash-high",
      apiKey: "",
      reasoningEffort: "",
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
    try {
      const prompt = await tauri.getSystemPrompt();
      set({ systemPrompt: prompt });
    } catch {}
  },

  saveSystemPromptText: async (text) => {
    await tauri.saveSystemPrompt(text);
    set({ systemPrompt: text });
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
        };
      })
      .filter(Boolean) as any;

    try {
      localStorage.setItem(
        "wii_open_tabs",
        JSON.stringify({ tabs, activeIndex: tabOrder.indexOf(activeId || "") }),
      );
    } catch {}
  },

  bootstrapApp: async () => {
    if (get().hasLoadedOnBoot) return;
    set({ hasLoadedOnBoot: true });

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

    // 2. Load system prompt
    get().loadSystemPrompt();

    // 3. Restore tabs
    try {
      const raw = localStorage.getItem("wii_open_tabs");
      const provider = get().getActiveProvider();
      if (raw && provider) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.tabs) && data.tabs.length > 0) {
          for (const t of data.tabs) {
            if (t.resumePath || t.projectPath) {
              await get().openTab(t.resumePath, t.title, t.projectPath);
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
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;

      const nextSession = { ...s };

      if (event.type === "agent_start") {
        nextSession.busy = true;
        nextSession.status = "running";
      }

      if (event.type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_start") {
          nextSession.messages = [
            ...nextSession.messages,
            { id: `a-${Date.now()}`, role: "assistant", text: "" },
          ];
        } else if (delta?.type === "text_delta") {
          const msgs = [...nextSession.messages];
          let last = msgs[msgs.length - 1];
          if (!last || last.role !== "assistant") {
            last = { id: `a-${Date.now()}`, role: "assistant", text: "" };
            msgs.push(last);
          }
          last.text += delta.delta;
          nextSession.messages = msgs;
        }
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
          last = { id: `a-${Date.now()}`, role: "assistant", text: "", tools: [tool] };
          msgs.push(last);
        } else {
          last.tools = [...(last.tools || []), tool];
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
        if (event.message?.usage) {
          const u = event.message.usage;
          nextSession.inputTokens += u.input || 0;
          nextSession.outputTokens += u.output || 0;
          nextSession.cacheReadTokens += u.cacheRead || 0;
          nextSession.contextTokens = (u.input || 0) + (u.output || 0);

          if (u.cost?.total) {
            nextSession.cost += u.cost.total;
          } else {
            const activeModel = get().getActiveProvider()?.model || "";
            const inRate = activeModel.includes("claude") ? 3.0 : 0.2;
            const outRate = activeModel.includes("claude") ? 15.0 : 0.8;
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
