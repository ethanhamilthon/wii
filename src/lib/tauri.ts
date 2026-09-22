import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { MultiProviderConfig, ProviderSettings, SessionSummary } from "@/types/wii";

const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI__);
const webviewOwner = crypto.randomUUID();

export async function registerWebview(): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("register_webview", { owner: webviewOwner });
}

const MOCK_CONFIG: MultiProviderConfig = {
  activeId: "default",
  providers: [
    {
      id: "default",
      name: "Default Proxy",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "test-key",
      models: ["gemini-3.8-flash-high", "gemini-2.5-pro", "claude-sonnet-4-6"],
    },
  ],
};

export async function getProvider(): Promise<ProviderSettings | null> {
  if (!isTauri) return MOCK_CONFIG.providers[0];
  return tauriInvoke<ProviderSettings | null>("get_provider");
}

export async function saveProvider(input: {
  id?: string;
  name?: string;
  baseUrl: string;
  apiKey: string;
  models?: string[];
}): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("save_provider", { input });
}

export async function getProviders(): Promise<MultiProviderConfig | null> {
  if (!isTauri) return MOCK_CONFIG;
  return tauriInvoke<MultiProviderConfig | null>("get_providers");
}

export async function saveProviders(config: MultiProviderConfig): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("save_providers", { config });
}

export async function getSystemPrompt(): Promise<string> {
  if (!isTauri) return "";
  return tauriInvoke<string>("get_system_prompt");
}

export async function saveSystemPrompt(text: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("save_system_prompt", { text });
}

export async function createSession(options?: {
  resumePath?: string | null;
  projectPath?: string | null;
  toolPlugins?: string[];
  model: string;
  reasoningEffort?: string | null;
}): Promise<string> {
  if (!isTauri) return `session-${Date.now()}`;
  return tauriInvoke<string>("create_session", {
    owner: webviewOwner,
    resumePath: options?.resumePath ?? null,
    projectPath: options?.projectPath ?? null,
    toolPlugins: options?.toolPlugins ?? [],
    model: options?.model,
    reasoningEffort: options?.reasoningEffort ?? null,
  });
}

export async function setSessionModel(sessionId: string, model: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("set_session_model", { sessionId, model });
}

export async function setSessionThinking(sessionId: string, effort: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("set_session_thinking", { sessionId, effort });
}

// Answers a plugin tool's `ctx.ui.*` request (select/confirm/input/editor).
// Generic on purpose \u2014 Wii doesn't know which plugin or tool asked.
export async function answerExtensionUI(
  sessionId: string,
  id: string,
  response: Record<string, unknown>,
): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("answer_extension_ui", { sessionId, id, response });
}

export async function sendMessage(sessionId: string, message: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("send_message", { sessionId, message });
}

export async function abortSession(sessionId: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("abort", { sessionId });
}

// Stops child; backend keeps used history and removes only header-only new files.
export async function closeSession(sessionId: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("close_session", { sessionId, owner: webviewOwner });
}

export async function getGitBranch(projectPath: string): Promise<string | null> {
  if (!isTauri) return null;
  return tauriInvoke<string | null>("get_git_branch", { projectPath });
}

export async function listPlugins(): Promise<{ id: string; code: string }[]> {
  if (!isTauri) return [];
  return tauriInvoke<{ id: string; code: string }[]>("list_plugins");
}

export async function deletePlugin(id: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("delete_plugin", { id });
}

export interface PluginHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Routes a plugin's `ctx.fetch(...)` through the Rust process (reqwest) so it
// isn't subject to webview CORS. Falls back to a direct browser fetch outside
// Tauri (dev/preview) where CORS may or may not apply depending on the target.
export async function pluginHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<PluginHttpResponse> {
  if (!isTauri) {
    const res = await fetch(url, { method, headers, body: body ?? undefined });
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (respHeaders[k] = v));
    return { status: res.status, headers: respHeaders, body: await res.text() };
  }
  return tauriInvoke<PluginHttpResponse>("plugin_http_request", { url, method, headers, body });
}

export async function listSessions(): Promise<SessionSummary[]> {
  if (!isTauri) {
    return [
      {
        id: "mock-1",
        path: "/path/to/mock-1.jsonl",
        projectPath: "/Users/erdana/Documents/one",
        title: "Mock Past Session",
        lastActivity: new Date().toISOString(),
        searchText: "mock text",
      },
    ];
  }
  return tauriInvoke<SessionSummary[]>("list_sessions");
}

export async function getSessionHistory(path: string): Promise<any[]> {
  if (!isTauri) {
    return [
      {
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "Mock user message" }] },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Mock assistant reply" }],
          usage: { input: 1200, output: 45, cacheRead: 300, cost: { total: 0.001 } },
        },
      },
    ];
  }
  return tauriInvoke<any[]>("get_session_history", { path });
}

export async function getSessionPath(sessionId: string): Promise<string | null> {
  if (!isTauri) return null;
  return tauriInvoke<string | null>("get_session_path", { sessionId });
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return "/Users/erdana/pi/wii-harness";
  const res = await tauriInvoke<string | null>("plugin:dialog|open", {
    options: {
      directory: true,
      multiple: false,
      title: "Choose project folder",
    },
  });
  return typeof res === "string" && res.trim() ? res : null;
}
