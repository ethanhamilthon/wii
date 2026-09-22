import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The plugin ships as plain CommonJS, loaded in the app via
// `new Function("module", "exports", code)` (see src/lib/plugins.ts
// loadPlugins()). Load it the same way here so the test exercises exactly
// what ships, not a TS-compiled stand-in.
function loadPlugin(path: string) {
  const code = readFileSync(resolve(__dirname, path), "utf8");
  const mod = { exports: {} as any };
  new Function("module", "exports", code)(mod, mod.exports);
  return mod.exports;
}

let quota: any;

beforeAll(() => {
  quota = loadPlugin("../../src-tauri/default-plugins/quota/index.js");
});

type FetchImpl = (url: string, options: any) => Promise<any>;

function makeCtx(settings: Record<string, string> = {}, fetchImpl?: FetchImpl) {
  const calls: Array<{ url: string; options: any }> = [];
  return {
    calls,
    ctx: {
      settings: { managementUrl: "", managementKey: "", ...settings },
      storage: { get: () => null, set: () => {} },
      fetch: async (url: string, options: any) => {
        calls.push({ url, options });
        if (fetchImpl) return fetchImpl(url, options);
        return { ok: false, status: 404, json: async () => ({}) };
      },
    },
  };
}

async function run(ctx: any) {
  let state = quota.initState();
  const setState = (updater: any) => (state = updater(state));
  await quota.actions.refresh({ state, setState, ctx });
  return state;
}

// Standard CLIProxyAPI response envelope for POST /api-call.
function apiCallResult(statusCode: number, bodyObj: any) {
  return { status_code: statusCode, header: {}, body: JSON.stringify(bodyObj) };
}

describe("quota plugin: shape", () => {
  it("declares a panel and the declarative UI contract, no LLM prompt needed", () => {
    expect(quota.id).toBe("quota");
    expect(quota.panel).toEqual({ title: "Quotas", icon: "BarChartIcon" });
    expect(quota.prompt()).toBe("");
    expect(typeof quota.actions.refresh).toBe("function");
    expect(typeof quota.render).toBe("function");
  });

  it("only asks for CLIProxyAPI's own coordinates — no vendor OAuth tokens, no ~/.pi", () => {
    expect(quota.settings).toEqual([
      { key: "managementUrl", type: "text", label: "CLIProxyAPI URL", default: "http://127.0.0.1:8317" },
      { key: "managementKey", type: "password", label: "Management Key", default: "" },
    ]);
  });
});

describe("quota plugin: not configured", () => {
  it("errors without any network call when URL or key is missing", async () => {
    const { ctx, calls } = makeCtx({ managementUrl: "http://127.0.0.1:8317" }); // no key
    const state = await run(ctx);
    expect(calls).toHaveLength(0);
    expect(state.error).toBe("Set CLIProxyAPI URL + Management Key in plugin settings.");
    expect(state.accounts).toEqual([]);
  });
});

describe("quota plugin: Management API base URL normalization", () => {
  it.each([
    ["http://127.0.0.1:8317", "http://127.0.0.1:8317/v0/management/auth-files"],
    ["http://127.0.0.1:8317/", "http://127.0.0.1:8317/v0/management/auth-files"],
    ["http://127.0.0.1:8317/v1", "http://127.0.0.1:8317/v0/management/auth-files"],
    ["http://127.0.0.1:8317/v0/management", "http://127.0.0.1:8317/v0/management/auth-files"],
    ["http://127.0.0.1:8317/v0/management/", "http://127.0.0.1:8317/v0/management/auth-files"],
  ])("normalizes %s -> auth-files at %s", async (input, expectedUrl) => {
    const { ctx, calls } = makeCtx({ managementUrl: input, managementKey: "mk" }, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [] }),
    }));
    await run(ctx);
    expect(calls[0].url).toBe(expectedUrl);
  });
});

describe("quota plugin: account discovery", () => {
  it("keeps only codex/antigravity accounts, ignores other providers", async () => {
    const { ctx, calls } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              { id: "1", auth_index: "a1", provider: "codex", label: "Codex work", account: "acct-1" },
              { id: "2", auth_index: "a2", provider: "antigravity", label: "Antigravity home" },
              { id: "3", auth_index: "a3", provider: "claude", label: "Claude Max" },
              { id: "4", auth_index: "a4", provider: "gemini", label: "Gemini key" },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => apiCallResult(200, { rate_limit: {} }) };
    });

    const state = await run(ctx);
    expect(state.accounts.map((a: any) => a.provider).sort()).toEqual(["antigravity", "codex"]);
    // 1 auth-files call + 1 api-call per matched (codex, antigravity) account = 3, never for claude/gemini.
    expect(calls).toHaveLength(3);
  });

  it("surfaces an auth-files failure as a top-level error", async () => {
    const { ctx } = makeCtx({ managementUrl: "http://h:8317", managementKey: "wrong-key" }, async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    const state = await run(ctx);
    expect(state.error).toBe("Management API HTTP 401");
    expect(state.accounts).toEqual([]);
  });
});

describe("quota plugin: Codex via CLIProxyAPI /api-call", () => {
  it("asks CLIProxyAPI to call chatgpt.com on the account's behalf and parses the windows", async () => {
    const { ctx, calls } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url, options) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ auth_index: "auth-42", provider: "codex", label: "Work", account: "acct-99" }] }),
        };
      }
      expect(url).toBe("http://h:8317/v0/management/api-call");
      const payload = JSON.parse(options.body);
      expect(payload.method).toBe("GET");
      expect(payload.url).toBe("https://chatgpt.com/backend-api/wham/usage");
      expect(payload.header.Authorization).toBe("Bearer $TOKEN$"); // CLIProxyAPI substitutes the real token
      expect(payload.header["chatgpt-account-id"]).toBe("acct-99");
      expect(payload.auth_index).toBe("auth-42");
      return {
        ok: true,
        status: 200,
        json: async () =>
          apiCallResult(200, {
            rate_limit: {
              primary_window: { used_percent: 44, reset_at: Math.floor(Date.now() / 1000) + 3600 },
              secondary_window: { used_percent: 12, reset_at: Math.floor(Date.now() / 1000) + 86400 },
            },
          }),
      };
    });

    const state = await run(ctx);
    expect(calls).toHaveLength(2);
    const codex = state.accounts.find((a: any) => a.provider === "codex");
    expect(codex.label).toBe("Work");
    expect(codex.windows[0]).toMatchObject({ name: "5-Hour", left: 56 });
    expect(codex.windows[1]).toMatchObject({ name: "Weekly", left: 88 });
  });

  it("falls back to email when the account field is missing for chatgpt-account-id", async () => {
    const { ctx, calls } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url, options) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ auth_index: "a", provider: "codex", label: "L", email: "[email protected]" }] }),
        };
      }
      const payload = JSON.parse(options.body);
      expect(payload.header["chatgpt-account-id"]).toBe("me@example.com");
      return { ok: true, status: 200, json: async () => apiCallResult(200, { rate_limit: {} }) };
    });
    await run(ctx);
    expect(calls).toHaveLength(2);
  });
});

describe("quota plugin: Antigravity via CLIProxyAPI /api-call", () => {
  it("asks CLIProxyAPI to call the Google quota-summary endpoint and parses buckets", async () => {
    const { ctx } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url, options) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ auth_index: "auth-7", provider: "antigravity", label: "Home" }] }),
        };
      }
      const payload = JSON.parse(options.body);
      expect(payload.method).toBe("POST");
      expect(payload.url).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
      expect(payload.data).toBe("{}");
      expect(payload.auth_index).toBe("auth-7");
      return {
        ok: true,
        status: 200,
        json: async () =>
          apiCallResult(200, {
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  { window: "5h", remainingFraction: 0.9, resetTime: "2031-01-01T00:00:00Z" },
                  { window: "weekly", remainingFraction: 0.5, resetTime: "2031-01-08T00:00:00Z" },
                ],
              },
            ],
          }),
      };
    });

    const state = await run(ctx);
    const antigravity = state.accounts.find((a: any) => a.provider === "antigravity");
    expect(antigravity.windows[0]).toMatchObject({ name: "Gemini Models · 5-Hour", left: 90 });
    expect(antigravity.windows[1]).toMatchObject({ name: "Gemini Models · Weekly", left: 50 });
  });

  it("keeps every model group's windows separately instead of collapsing to one 5h/weekly pair", async () => {
    // Real CLIProxyAPI responses split quota into multiple groups (Gemini vs
    // Claude/GPT), each with its own 5h + weekly bucket — a naive "first match
    // wins" reducer silently drops every group after the first.
    const { ctx } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url, options) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ auth_index: "a", provider: "antigravity", label: "Home" }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          apiCallResult(200, {
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  { window: "5h", remainingFraction: 1, resetTime: null },
                  { window: "weekly", remainingFraction: 1, resetTime: null },
                ],
              },
              {
                displayName: "Claude and GPT models",
                buckets: [
                  { window: "5h", remainingFraction: 1, resetTime: null },
                  { window: "weekly", remainingFraction: 0.4, resetTime: null },
                ],
              },
            ],
          }),
      };
    });

    const state = await run(ctx);
    const antigravity = state.accounts.find((a: any) => a.provider === "antigravity");
    expect(antigravity.windows).toHaveLength(4);
    const claudeGptWeekly = antigravity.windows.find((w: any) => w.name === "Claude and GPT models · Weekly");
    expect(claudeGptWeekly.left).toBe(40);
  });

  it("keeps a near-full sliver visible instead of rounding remaining quota up to 100%", async () => {
    // Observed live: remainingFraction 0.9999744 → 99.99744% left. Rounding to
    // a whole percent renders "100%", identical to a never-touched account.
    const { ctx } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ auth_index: "a", provider: "antigravity", label: "Home" }] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          apiCallResult(200, {
            groups: [
              {
                displayName: "Claude and GPT models",
                buckets: [
                  { window: "weekly", remainingFraction: 0.9999744, resetTime: null },
                  { window: "5h", remainingFraction: 1, resetTime: null },
                ],
              },
            ],
          }),
      };
    });

    const state = await run(ctx);
    const windows = state.accounts[0].windows;
    expect(windows.find((w: any) => w.name.endsWith("Weekly")).left).toBe(99.99);
    expect(windows.find((w: any) => w.name.endsWith("5-Hour")).left).toBe(100);
  });
});

describe("quota plugin: partial failures", () => {
  it("keeps one account's error from breaking the others", async () => {
    const { ctx } = makeCtx({ managementUrl: "http://h:8317", managementKey: "mk" }, async (url, options) => {
      if (url.endsWith("/auth-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              { auth_index: "a1", provider: "codex", label: "Broken", account: "x" },
              { auth_index: "a2", provider: "antigravity", label: "Fine" },
            ],
          }),
        };
      }
      const payload = JSON.parse(options.body);
      if (payload.auth_index === "a1") return { ok: true, status: 200, json: async () => apiCallResult(500, {}) };
      return {
        ok: true,
        status: 200,
        json: async () => apiCallResult(200, { groups: [{ buckets: [{ window: "5h", remainingFraction: 1, resetTime: null }] }] }),
      };
    });

    const state = await run(ctx);
    const broken = state.accounts.find((a: any) => a.label === "Broken");
    const fine = state.accounts.find((a: any) => a.label === "Fine");
    expect(broken.error).toBe("Upstream HTTP 500");
    expect(broken.windows).toEqual([]);
    expect(fine.error).toBeNull();
    expect(fine.windows).toHaveLength(1);
  });
});

describe("quota plugin: render()", () => {
  it("shows a spinner on first load", () => {
    expect(quota.render({ loading: true, error: null, accounts: [] })).toEqual({
      type: "spinner",
      text: "Fetching quota via CLIProxyAPI...",
    });
  });

  it("shows the top-level error with a retry button", () => {
    const node = quota.render({ loading: false, error: "Management API HTTP 401", accounts: [] });
    expect(node.children).toContainEqual({ type: "badge", text: "Management API HTTP 401", variant: "destructive" });
    expect(node.children.some((c: any) => c.type === "button" && c.action === "refresh")).toBe(true);
  });

  it("shows a friendly empty state when nothing matched", () => {
    const node = quota.render({ loading: false, error: null, accounts: [] });
    expect(node.children[0].text).toBe("No Codex or Antigravity accounts found on this CLIProxyAPI instance.");
  });

  it("renders provider·label titles, stats, and progress bars with an 80% warning threshold", () => {
    const state = {
      loading: false,
      error: null,
      accounts: [
        {
          provider: "codex",
          label: "Work",
          error: null,
          windows: [
            { name: "5-Hour", left: 8, total: 100, resetIn: "1h" },
            { name: "Weekly", left: 80, total: 100, resetIn: "3d" },
          ],
        },
      ],
    };
    const node = quota.render(state);
    expect(node.children[0]).toEqual({ type: "text", text: "Codex · Work", variant: "title" });
    const progress = node.children.filter((c: any) => c.type === "progress");
    expect(progress[0].variant).toBe("warning");
    expect(progress[1].variant).toBe("default");
  });

  it("shows a destructive badge for an account-level error", () => {
    const node = quota.render({
      loading: false,
      error: null,
      accounts: [{ provider: "antigravity", label: "Home", error: "Upstream HTTP 500", windows: [] }],
    });
    expect(node.children).toContainEqual({ type: "badge", text: "Upstream HTTP 500", variant: "destructive" });
  });
});
