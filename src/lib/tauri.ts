import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { MultiProviderConfig, ProviderSettings, SessionSummary } from "@/types/wii";

const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI__);

const MOCK_CONFIG: MultiProviderConfig = {
  activeId: "default",
  providers: [
    {
      id: "default",
      name: "Default Proxy",
      baseUrl: "http://127.0.0.1:8317/v1",
      model: "gemini-3.8-flash-high",
      apiKey: "test-key",
      reasoningEffort: "high",
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
  model: string;
  apiKey: string;
  reasoningEffort?: string | null;
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
}): Promise<string> {
  if (!isTauri) return `session-${Date.now()}`;
  return tauriInvoke<string>("create_session", {
    resumePath: options?.resumePath ?? null,
    projectPath: options?.projectPath ?? null,
  });
}

export async function sendMessage(sessionId: string, message: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("send_message", { sessionId, message });
}

export async function abortSession(sessionId: string): Promise<void> {
  if (!isTauri) return;
  return tauriInvoke<void>("abort", { sessionId });
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
