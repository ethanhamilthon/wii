import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore, getModelMaxContext } from "./session-store";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  createSession: vi.fn().mockImplementation(async () => `test-session-${Date.now()}-${Math.random()}`),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  setSessionThinking: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
  registerWebview: vi.fn().mockResolvedValue(undefined),
  saveProviders: vi.fn().mockResolvedValue(undefined),
  getProviders: vi.fn().mockResolvedValue(null),
  getProvider: vi.fn().mockResolvedValue(null),
  saveSystemPrompt: vi.fn().mockResolvedValue(undefined),
  getSessionHistory: vi.fn().mockResolvedValue([]),
  getSessionPath: vi.fn().mockResolvedValue(null),
}));

describe("Phase 2: Per-session model and reasoning effort", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: {},
      tabOrder: [],
      activeId: null,
      lastUsedModel: null,
      lastUsedEffort: null,
      multiConfig: {
        activeId: "default",
        providers: [
          {
            id: "default",
            name: "Default",
            baseUrl: "http://127.0.0.1:8317/v1",
            apiKey: "key",
            models: ["model-a", "model-b"],
          },
        ],
      },
    });
    vi.clearAllMocks();
  });

  it("selects first model and default medium effort for first session", async () => {
    const id = await useSessionStore.getState().openTab();
    const session = useSessionStore.getState().sessions[id];

    expect(session.model).toBe("model-a");
    expect(session.providerId).toBe("default");
    expect(session.reasoningEffort).toBe("medium");
    expect(tauri.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "default",
        model: "model-a",
        reasoningEffort: "medium",
      }),
    );
  });

  it("selects lastUsedModel if present in active provider models", async () => {
    useSessionStore.setState({ lastUsedModel: "model-b", lastUsedEffort: "high" });

    const id = await useSessionStore.getState().openTab();
    const session = useSessionStore.getState().sessions[id];

    expect(session.model).toBe("model-b");
    expect(session.reasoningEffort).toBe("high");
  });

  it("falls back to first model if lastUsedModel is not in active provider models", async () => {
    useSessionStore.setState({ lastUsedModel: "non-existent-model" });

    const id = await useSessionStore.getState().openTab();
    const session = useSessionStore.getState().sessions[id];

    expect(session.model).toBe("model-a");
  });

  it("throws if active provider has no models", async () => {
    useSessionStore.setState({
      multiConfig: {
        activeId: "default",
        providers: [
          {
            id: "default",
            name: "Default",
            baseUrl: "http://127.0.0.1:8317/v1",
            apiKey: "key",
            models: [],
          },
        ],
      },
    });

    await expect(useSessionStore.getState().openTab()).rejects.toThrow(
      "Session provider has no configured models",
    );
  });

  it("changes model and effort for active session only", async () => {
    // Session 1
    const id1 = await useSessionStore.getState().openTab(null, "Tab 1", null, "model-a", "low");
    // Session 2
    const id2 = await useSessionStore.getState().openTab(null, "Tab 2", null, "model-b", "high");

    // id2 is active
    expect(useSessionStore.getState().activeId).toBe(id2);

    // Change model and effort for session 2
    await useSessionStore.getState().setActiveSessionModel("model-a");
    await useSessionStore.getState().setActiveSessionReasoningEffort("xhigh");

    expect(tauri.setSessionModel).toHaveBeenCalledWith(id2, "default", "model-a");
    expect(tauri.setSessionThinking).toHaveBeenCalledWith(id2, "xhigh");

    const s1 = useSessionStore.getState().sessions[id1];
    const s2 = useSessionStore.getState().sessions[id2];

    // Session 1 remains unchanged
    expect(s1.model).toBe("model-a");
    expect(s1.reasoningEffort).toBe("low");

    // Session 2 is updated
    expect(s2.model).toBe("model-a");
    expect(s2.reasoningEffort).toBe("xhigh");

    // lastUsed is updated in state and localStorage
    expect(useSessionStore.getState().lastUsedModel).toBe("model-a");
    expect(useSessionStore.getState().lastUsedEffort).toBe("xhigh");
    expect(localStorage.getItem("wii_last_used_model")).toBe("model-a");
    expect(localStorage.getItem("wii_last_used_effort")).toBe("xhigh");
  });

  it("closes used tabs, keeps reopen path and starts a new child", async () => {
    const id = await useSessionStore.getState().openTab(null, "Used", "/project");
    useSessionStore.setState((state) => ({
      sessions: { ...state.sessions, [id]: { ...state.sessions[id], resumePath: "/history.jsonl" } },
    }));
    await useSessionStore.getState().closeTab(id);
    expect(tauri.closeSession).toHaveBeenCalledWith(id);
    expect(useSessionStore.getState().sessions[id]).toBeUndefined();
    expect(useSessionStore.getState().tabOrder).not.toContain(id);
    const reopened = await useSessionStore.getState().openTab("/history.jsonl");
    expect(reopened).not.toBe(id);
    expect(tauri.createSession).toHaveBeenCalledTimes(2);
  });

  it("closes empty tabs and leaves state intact on IPC failure", async () => {
    const id = await useSessionStore.getState().openTab();
    await useSessionStore.getState().closeTab(id);
    expect(useSessionStore.getState().sessions[id]).toBeUndefined();
    const second = await useSessionStore.getState().openTab();
    vi.mocked(tauri.closeSession).mockRejectedValueOnce(new Error("IPC unavailable"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await useSessionStore.getState().closeTab(second);
    expect(useSessionStore.getState().tabOrder).toContain(second);
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("IPC unavailable"));
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("registers WebView before restoring persisted tabs", async () => {
    localStorage.setItem("wii_open_tabs", JSON.stringify({
      tabs: [{ title: "Used", resumePath: "/history.jsonl", projectPath: "/project", model: "model-b", reasoningEffort: "high" }],
      activeIndex: 0,
    }));
    useSessionStore.setState({ hasLoadedOnBoot: false });
    await useSessionStore.getState().bootstrapApp();
    expect(tauri.registerWebview).toHaveBeenCalledOnce();
    expect(vi.mocked(tauri.registerWebview).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(tauri.createSession).mock.invocationCallOrder[0]);
  });

  it("keeps same model ID scoped to each provider across tabs and restore", async () => {
    useSessionStore.setState((state) => ({
      multiConfig: {
        ...state.multiConfig,
        providers: [state.multiConfig.providers[0], {
          id: "other", name: "Other", baseUrl: "https://other.test/v1", apiKey: "other-key", models: ["model-a"],
        }],
      },
    }));
    const first = await useSessionStore.getState().openTab(null, null, "/project");
    await useSessionStore.getState().switchProvider("other");
    const second = await useSessionStore.getState().openTab(null, null, "/project");
    expect(useSessionStore.getState().sessions[first].providerId).toBe("default");
    expect(useSessionStore.getState().sessions[second].providerId).toBe("other");
    await useSessionStore.getState().setActiveSessionModel("model-a");
    expect(tauri.setSessionModel).toHaveBeenCalledWith(second, "other", "model-a");
    const saved = JSON.parse(localStorage.getItem("wii_open_tabs")!);
    expect(saved.tabs.map((tab: { providerId: string }) => tab.providerId)).toEqual(["default", "other"]);
    useSessionStore.setState({ sessions: {}, tabOrder: [], activeId: null, hasLoadedOnBoot: false });
    await useSessionStore.getState().bootstrapApp();
    expect(Object.values(useSessionStore.getState().sessions).map((s) => s.providerId)).toEqual(["default", "other"]);
  });

  it("calculates context window correctly based on model name", () => {
    expect(getModelMaxContext("gemini-2.5-pro")).toBe(1_000_000);
    expect(getModelMaxContext("claude-sonnet-4-6")).toBe(200_000);
    expect(getModelMaxContext("gpt-4o")).toBe(128_000);
    expect(getModelMaxContext(undefined)).toBe(128_000);
  });
});
