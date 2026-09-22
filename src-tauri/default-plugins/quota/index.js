// Quota for accounts sitting behind CLIProxyAPI (https://github.com/router-for-me/CLIProxyAPI)
// — a local proxy that holds OAuth sessions for Antigravity/Codex/Claude/etc
// and exposes them as one OpenAI-compatible API. This plugin talks ONLY to
// CLIProxyAPI's own Management API:
//   GET  /v0/management/auth-files  — list configured accounts (provider, auth_index, label)
//   POST /v0/management/api-call    — ask CLIProxyAPI to make an authenticated
//                                      upstream call on a chosen account's behalf
//                                      ($TOKEN$ in a header is substituted with
//                                      that account's live access token)
// CLIProxyAPI already owns and refreshes the real OAuth tokens, so this
// plugin never sees or stores one — it only needs the Management Key the
// user already uses to administer their own CLIProxyAPI instance. No direct
// calls to api.anthropic.com / googleapis.com / chatgpt.com with credentials
// this plugin manages itself, and nothing under ~/.pi is touched.

const ANTIGRAVITY_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const ANTIGRAVITY_UA = "antigravity/cli/1.1.23 (aidev_client; os_type=linux; arch=amd64; cl=974125021; auth_method=consumer)";
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_UA = "codex_cli_rs/0.56.0";

const PROVIDER_LABEL = { codex: "Codex", antigravity: "Antigravity" };

// "http://host:8317", ".../v1", or a URL already ending in /v0/management —
// all normalize to the same Management API base.
function managementBase(rawUrl) {
  let u = (rawUrl || "").trim().replace(/\/+$/, "");
  u = u.replace(/\/v0\/management$/i, "").replace(/\/v1$/i, "");
  return `${u}/v0/management`;
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function formatTimeLeft(epochMs) {
  if (epochMs === null || epochMs === undefined) return "unknown";
  const leftMs = epochMs - Date.now();
  if (leftMs <= 0) return "resets now";
  const min = Math.floor(leftMs / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${day}d ${hr % 24}h`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return "< 1m";
}

// Windows are reported as quota REMAINING \u2014 that's the number you act on
// ("can I keep going?"), not how much is already spent.
function window_(name, leftPercent, resetRaw) {
  if (typeof leftPercent !== "number" || Number.isNaN(leftPercent)) return null;
  const clamped = Math.max(0, Math.min(100, leftPercent));
  const round2 = (v) => Math.round(v * 100) / 100;
  // Whole percent, except near the ends: a barely-touched account (99.9974%)
  // must not read as a pristine "100%", and a nearly-exhausted one (0.3%)
  // must not read as "0%" when calls still go through.
  const left =
    clamped > 0 && clamped < 1
      ? Math.max(0.01, round2(clamped))
      : clamped > 99 && clamped < 100
        ? Math.min(99.99, round2(clamped))
        : Math.round(clamped);
  return { name, left, total: 100, resetIn: formatTimeLeft(toEpochMs(resetRaw)) };
}

async function listAccounts(ctx, base, key) {
  const res = await ctx.fetch(`${base}/auth-files`, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

// Runs one upstream call *through* CLIProxyAPI using a specific account's
// credentials, and returns the parsed JSON body.
async function apiCall(ctx, base, key, payload) {
  const res = await ctx.fetch(`${base}/api-call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
  const data = await res.json(); // { status_code, header, body }
  if (data.status_code < 200 || data.status_code >= 300) throw new Error(`Upstream HTTP ${data.status_code}`);
  return JSON.parse(data.body || "{}");
}

async function antigravityWindows(ctx, base, key, account) {
  const data = await apiCall(ctx, base, key, {
    method: "POST",
    url: ANTIGRAVITY_URL,
    header: { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json", "User-Agent": ANTIGRAVITY_UA },
    data: "{}",
    auth_index: account.auth_index,
  });
  // Antigravity splits quota into multiple model groups (e.g. "Gemini Models"
  // vs "Claude and GPT models"), each with its own 5h + weekly bucket \u2014
  // collapsing to a single 5h/weekly pair (picking whichever group's bucket
  // is seen first) silently drops the other group's numbers. Emit one window
  // per (group, bucket) instead.
  const windows = [];
  for (const g of data.groups || []) {
    const groupName = g.displayName || "Group";
    for (const b of g.buckets || []) {
      if (typeof b.remainingFraction !== "number") continue;
      const label = b.window === "5h" ? "5-Hour" : b.window === "weekly" ? "Weekly" : b.displayName || b.window || "Limit";
      const w = window_(`${groupName} \u00b7 ${label}`, b.remainingFraction * 100, b.resetTime);
      if (w) windows.push(w);
    }
  }
  return windows;
}

async function codexWindows(ctx, base, key, account) {
  const accountId = account.account || account.email || "";
  const data = await apiCall(ctx, base, key, {
    method: "GET",
    url: CODEX_URL,
    header: {
      Authorization: "Bearer $TOKEN$",
      "chatgpt-account-id": accountId,
      originator: "codex_cli_rs",
      "User-Agent": CODEX_UA,
    },
    auth_index: account.auth_index,
  });
  const pw = data.rate_limit && data.rate_limit.primary_window;
  const sw = data.rate_limit && data.rate_limit.secondary_window;
  return [
    pw ? window_("5-Hour", 100 - pw.used_percent, pw.reset_at) : null,
    sw ? window_("Weekly", 100 - sw.used_percent, sw.reset_at) : null,
  ].filter(Boolean);
}

module.exports = {
  id: "quota",
  name: "Quota Monitor",
  description: "5-hour and weekly usage for Codex/Antigravity accounts served through your CLIProxyAPI instance.",
  panel: {
    title: "Quotas",
    icon: "BarChartIcon",
  },
  settings: [
    { key: "managementUrl", type: "text", label: "CLIProxyAPI URL", default: "http://127.0.0.1:8317" },
    { key: "managementKey", type: "password", label: "Management Key", default: "" },
  ],
  prompt: () => "", // No LLM prompt injection required

  initState: () => ({ loading: true, error: null, accounts: [] }),

  onMount: ({ dispatch }) => {
    dispatch("refresh");
    const timer = setInterval(() => dispatch("refresh"), 60000);
    return () => clearInterval(timer);
  },

  actions: {
    refresh: async ({ setState, ctx }) => {
      setState((s) => ({ ...s, loading: true, error: null }));

      const url = ctx.settings.managementUrl;
      const key = ctx.settings.managementKey;
      if (!url || !key) {
        setState((s) => ({ ...s, loading: false, error: "Set CLIProxyAPI URL + Management Key in plugin settings.", accounts: [] }));
        return;
      }
      const base = managementBase(url);

      try {
        const files = await listAccounts(ctx, base, key);
        const targets = files.filter((f) => {
          const p = (f.provider || "").toLowerCase();
          return p === "codex" || p === "antigravity";
        });

        const accounts = await Promise.all(
          targets.map(async (f) => {
            const provider = (f.provider || "").toLowerCase();
            const label = f.label || f.email || f.name || f.id || "account";
            try {
              const windows = provider === "codex" ? await codexWindows(ctx, base, key, f) : await antigravityWindows(ctx, base, key, f);
              return { provider, label, windows, error: null };
            } catch (err) {
              return { provider, label, windows: [], error: (err && err.message) || "Request failed" };
            }
          }),
        );

        setState((s) => ({ ...s, loading: false, error: null, accounts }));
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: (err && err.message) || "Failed to reach CLIProxyAPI.", accounts: [] }));
      }
    },
  },

  render: (state) => {
    if (state.loading && !state.accounts.length && !state.error) {
      return { type: "spinner", text: "Fetching quota via CLIProxyAPI..." };
    }

    if (state.error) {
      return {
        type: "stack",
        direction: "col",
        gap: 3,
        children: [
          { type: "badge", text: state.error, variant: "destructive" },
          { type: "button", label: "Retry", action: "refresh", variant: "outline" },
        ],
      };
    }

    if (!state.accounts.length) {
      return {
        type: "stack",
        direction: "col",
        gap: 3,
        children: [
          { type: "text", text: "No Codex or Antigravity accounts found on this CLIProxyAPI instance.", variant: "body" },
          { type: "button", label: "Refresh", action: "refresh", variant: "outline" },
        ],
      };
    }

    const sections = state.accounts.flatMap((a) => {
      const title = `${PROVIDER_LABEL[a.provider] || a.provider} · ${a.label}`;
      if (a.error) {
        return [
          { type: "text", text: title, variant: "title" },
          { type: "badge", text: a.error, variant: "destructive" },
        ];
      }
      if (!a.windows.length) {
        return [
          { type: "text", text: title, variant: "title" },
          { type: "text", text: "No quota data returned.", variant: "caption" },
        ];
      }
      return [
        { type: "text", text: title, variant: "title" },
        {
          type: "stack",
          direction: "row",
          gap: 3,
          children: a.windows.map((w) => ({ type: "stat", label: w.name, value: `${w.left}% left`, subtext: `Resets in ${w.resetIn}` })),
        },
        ...a.windows.map((w) => ({
          type: "progress",
          label: `${w.name} \u00b7 ${w.left}% left \u00b7 resets in ${w.resetIn}`,
          value: w.left,
          max: w.total,
          unit: "%",
          variant: w.left < 20 ? "warning" : "default",
        })),
      ];
    });

    return {
      type: "stack",
      direction: "col",
      gap: 3,
      children: [
        ...sections,
        { type: "separator" },
        {
          type: "stack",
          direction: "row",
          align: "between",
          children: [
            { type: "text", text: "Auto-refresh: 60s", variant: "caption" },
            { type: "button", label: "Refresh Now", action: "refresh", variant: "secondary", loading: state.loading },
          ],
        },
      ],
    };
  },
};
