const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (selector) => document.querySelector(selector);
const timeline = $("#timeline");
const tabsEl = $("#tabs");

// ---------- session state ----------
const sessions = new Map();
const pendingEvents = new Map();
let tabOrder = [];
let activeId = null;
let stickToBottom = true;
let selectedProjectPath = null;
let currentProvider = null;

function makeSessionState(id, title, projectPath, resumePath) {
  const pane = document.createElement("div");
  pane.className = "session-pane";
  pane.hidden = true;
  timeline.append(pane);
  return {
    id,
    title: title || "New session",
    projectPath,
    resumePath,
    status: "running", // running | idle | error
    alive: true,
    pane,
    busy: false,
    assistant: null,
    activeStopBtn: null,
    tools: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0,
    cost: 0,
  };
}

function truncateTitle(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine || "New session";
}

// ---------- tab strip ----------

function renderTabs() {
  tabsEl.replaceChildren();
  for (const id of tabOrder) {
    const state = sessions.get(id);
    if (!state) continue;
    const tab = document.createElement("div");
    tab.className = `tab${id === activeId ? " active" : ""}`;
    tab.dataset.id = id;

    const dot = document.createElement("span");
    dot.className = `tab-dot ${state.status}`;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = state.title;

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close tab (keeps running in background)";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(id);
    });

    tab.append(dot, title, close);
    tab.addEventListener("click", () => switchActive(id));
    tabsEl.append(tab);
  }
}

function formatTokens(num) {
  if (!num) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

function getModelMaxContext(modelName) {
  if (!modelName) return 128_000;
  const lower = modelName.toLowerCase();
  if (lower.includes("gemini")) return 1_000_000;
  if (lower.includes("claude")) return 200_000;
  return 128_000;
}

function formatCost(usd) {
  if (!usd || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function updateStatsUi(state) {
  const stats = $("#composer-stats");
  if (!stats) return;
  if (!state) {
    stats.textContent = "";
    return;
  }
  const maxCtx = getModelMaxContext(currentProvider?.model);
  const inT = formatTokens(state.inputTokens);
  const outT = formatTokens(state.outputTokens);
  const ctxT = formatTokens(state.contextTokens);
  const maxT = formatTokens(maxCtx);
  const totalIn = state.inputTokens + state.cacheReadTokens;
  const cachePct = totalIn > 0 ? Math.round((state.cacheReadTokens / totalIn) * 100) : 0;
  const costStr = formatCost(state.cost);
  stats.textContent = `in: ${inT} · out: ${outT} · ctx: ${ctxT}/${maxT} · cache: ${cachePct}% · ${costStr}`;
}

function formatPath(p) {
  if (!p) return "";
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function updateComposerForActive() {
  const state = sessions.get(activeId);
  $("#composer").hidden = !state?.alive;
  if (state?.alive) {
    setBusyUi(state.busy);
    updateStatsUi(state);
    const projEl = $("#composer-project");
    if (projEl) projEl.textContent = formatPath(state.projectPath);
  }
}

function switchActive(id) {
  if (!sessions.has(id)) return;
  $("#onboarding").hidden = true;
  if (activeId && sessions.has(activeId)) sessions.get(activeId).pane.hidden = true;
  activeId = id;
  sessions.get(id).pane.hidden = false;
  if (!tabOrder.includes(id)) tabOrder.push(id);
  renderTabs();
  updateComposerForActive();
  scrollToBottom();
  saveOpenTabsState();
  setTimeout(() => $("#message")?.focus(), 0);
}

function saveOpenTabsState() {
  const tabs = tabOrder
    .map((id) => {
      const s = sessions.get(id);
      if (!s) return null;
      return {
        title: s.title,
        projectPath: s.projectPath,
        resumePath: s.resumePath,
      };
    })
    .filter(Boolean);
  try {
    localStorage.setItem(
      "wii_open_tabs",
      JSON.stringify({ tabs, activeIndex: tabOrder.indexOf(activeId) })
    );
  } catch {}
}

function extractMsgText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

// Closing a tab only removes it from the strip — the backend process (and
// its timeline) keeps running in the background; see spec item 1.
function closeTab(id) {
  const index = tabOrder.indexOf(id);
  if (index === -1) return;
  tabOrder.splice(index, 1);
  if (activeId === id) {
    sessions.get(id).pane.hidden = true;
    activeId = null;
    if (tabOrder.length) switchActive(tabOrder[Math.max(0, index - 1)]);
  }
  renderTabs();
  saveOpenTabsState();
  if (!activeId) showOnboarding();
}

async function openTab(resumePath, presetTitle, projectPath) {
  const id = await invoke("create_session", {
    resumePath: resumePath ?? null,
    projectPath: projectPath || null,
  });
  const state = makeSessionState(id, presetTitle, projectPath, resumePath);
  sessions.set(id, state);

  if (resumePath) {
    try {
      const history = await invoke("get_session_history", { path: resumePath });
      let firstUser = "";
      for (const entry of history) {
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          if (msg.role === "user") {
            const text = extractMsgText(msg.content);
            if (text) {
              userCard(state.pane, text, () => invoke("abort", { sessionId: state.id }).catch((e) => showErrorIn(state, e)));
              if (!firstUser) firstUser = text;
            }
          } else if (msg.role === "assistant") {
            const text = extractMsgText(msg.content);
            if (text) {
              const asst = assistantCard(state.pane);
              asst.innerHTML = renderMarkdown(text);
            }
            if (Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if (part.type === "toolCall") {
                  const row = toolRow(state.pane, part.name, part.arguments);
                  state.tools.set(part.id, row);
                }
              }
            }
            if (msg.usage) {
              const u = msg.usage;
              state.inputTokens += (u.input || 0);
              state.outputTokens += (u.output || 0);
              state.cacheReadTokens += (u.cacheRead || 0);
              state.contextTokens = (u.input || 0) + (u.output || 0);
              if (u.cost?.total) {
                state.cost += u.cost.total;
              } else {
                const modelName = (currentProvider?.model || "").toLowerCase();
                const inRate = modelName.includes("claude") ? 3.0 : 0.20;
                const outRate = modelName.includes("claude") ? 15.0 : 0.80;
                state.cost += ((u.input || 0) * inRate / 1_000_000) + ((u.output || 0) * outRate / 1_000_000);
              }
            }
          } else if (msg.role === "toolResult") {
            const tool = state.tools.get(msg.toolCallId);
            if (tool) {
              tool.body.textContent = `${tool.body.textContent}\n\n${toolText(msg)}`;
              tool.wrap.dataset.state = msg.isError ? "error" : "done";
            }
          }
        }
      }
      if (firstUser && state.title === "New session") {
        state.title = truncateTitle(firstUser);
      }
      state.status = "idle";
    } catch (err) {
      console.error("Failed to load session history:", err);
    }
  }

  for (const queued of pendingEvents.get(id) ?? []) queued(state);
  pendingEvents.delete(id);
  tabOrder.push(id);
  switchActive(id);
  saveOpenTabsState();
  return id;
}

// ---------- scroll ----------

function scrollToBottom() {
  timeline.scrollTop = timeline.scrollHeight;
}

timeline.addEventListener("scroll", () => {
  const distanceFromBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
  stickToBottom = distanceFromBottom < 72;
});

new MutationObserver(() => {
  if (stickToBottom) scrollToBottom();
}).observe(timeline, { childList: true, subtree: true, characterData: true });

// ---------- minimal markdown ----------

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function renderMarkdown(source) {
  const blocks = [];
  let text = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    blocks.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  text = escapeHtml(text);
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => `<code>${code}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = text.split("\n");
  const html = [];
  let list = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const unordered = line.match(/^[-*]\s+(.*)/);
    const ordered = line.match(/^\d+\.\s+(.*)/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`);
    } else if (unordered) {
      if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; }
      html.push(`<li>${unordered[1]}</li>`);
    } else if (ordered) {
      if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; }
      html.push(`<li>${ordered[1]}</li>`);
    } else if (line.trim() === "") {
      closeList();
      html.push("");
    } else if (/^\u0000\d+\u0000$/.test(line.trim())) {
      closeList();
      html.push(line.trim());
    } else {
      closeList();
      html.push(`<p>${line}</p>`);
    }
  }
  closeList();

  return html
    .join("\n")
    .replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
}

// ---------- cards ----------

function setBusyUi(value) {
  const action = $("#composer-action");
  action.title = value ? "Stop" : "Send (Enter)";
  action.setAttribute("aria-label", value ? "Stop" : "Send");
  action.classList.toggle("is-stop", value);
  action.querySelector(".composer-hint").hidden = value;
  action.querySelector(".icon-stop").hidden = !value;
}

function card(pane, kind, text = "") {
  const node = document.createElement("section");
  node.className = `card ${kind}`;
  const body = document.createElement("pre");
  body.textContent = text;
  node.append(body);
  pane.append(node);
  return body;
}

function userCard(pane, text, onAbort) {
  const node = document.createElement("section");
  node.className = "card user";
  const body = document.createElement("pre");
  body.textContent = text;
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "icon-btn card-stop";
  stop.title = "Stop";
  stop.setAttribute("aria-label", "Stop");
  stop.innerHTML = '<img src="assets/icons/pause.svg" alt="">';
  stop.hidden = true;
  stop.addEventListener("click", onAbort);
  node.append(body, stop);
  pane.append(node);
  return stop;
}

function assistantCard(pane) {
  const node = document.createElement("section");
  node.className = "card assistant";
  const body = document.createElement("div");
  body.className = "markdown";
  body.dataset.raw = "";
  node.append(body);
  pane.append(node);
  return body;
}

function showErrorIn(state, error) {
  card(state.pane, "error-card", String(error));
  state.busy = false;
  state.status = "error";
  renderTabs();
  if (state.id === activeId) updateComposerForActive();
}

function toolText(value) {
  const content = value?.content;
  if (!Array.isArray(content)) return JSON.stringify(value ?? {}, null, 2);
  return content.map((part) => part.text ?? JSON.stringify(part)).join("\n");
}

const KNOWN_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "find", "ls"]);

function toolTagClass(name) {
  return KNOWN_TOOLS.has(name) ? `tool-${name}` : "tool-default";
}

function summarizeArgs(name, args) {
  if (!args) return "";
  const raw =
    (name === "bash" && args.command) ||
    (name === "read" && (args.path ?? args.file)) ||
    (name === "write" && args.path) ||
    (name === "edit" && args.path) ||
    (name === "grep" && [args.pattern, args.path && `in ${args.path}`].filter(Boolean).join(" ")) ||
    (name === "find" && (args.pattern ?? args.glob)) ||
    (name === "ls" && (args.path ?? ".")) ||
    JSON.stringify(args);
  return String(raw).replace(/\s*\n\s*/g, " ⏎ ");
}

function toolRow(pane, toolName, args) {
  const wrap = document.createElement("div");
  wrap.className = "tool-wrap";
  wrap.dataset.state = "running";

  const row = document.createElement("div");
  row.className = "tool-row";
  row.setAttribute("aria-expanded", "false");

  const toggle = document.createElement("span");
  toggle.className = "tool-toggle";
  toggle.textContent = "▸";

  const dot = document.createElement("span");
  dot.className = "tool-dot";

  const tag = document.createElement("span");
  tag.className = `tool-tag ${toolTagClass(toolName)}`;
  tag.textContent = toolName;

  const summary = document.createElement("span");
  summary.className = "tool-summary";
  summary.textContent = summarizeArgs(toolName, args);

  row.append(toggle, dot, tag, summary);

  const body = document.createElement("pre");
  body.className = "tool-body";
  body.hidden = true;
  body.textContent = JSON.stringify(args, null, 2);

  row.addEventListener("click", () => {
    const expanded = row.getAttribute("aria-expanded") === "true";
    row.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });

  wrap.append(row, body);
  pane.append(wrap);
  return { wrap, summary, body };
}

// ---------- event handling ----------

function handleEvent(state, event) {
  if (event.type === "agent_start") {
    state.busy = true;
    state.status = "running";
  }

  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_start") state.assistant = assistantCard(state.pane);
    if (delta?.type === "text_delta") {
      if (!state.assistant) state.assistant = assistantCard(state.pane);
      state.assistant.dataset.raw += delta.delta;
      state.assistant.innerHTML = renderMarkdown(state.assistant.dataset.raw);
    }
  }

  if (event.type === "tool_execution_start") {
    state.tools.set(event.toolCallId, toolRow(state.pane, event.toolName, event.args));
  }
  if (event.type === "tool_execution_update") {
    const tool = state.tools.get(event.toolCallId);
    if (tool) tool.body.textContent = `${JSON.stringify(event.args, null, 2)}\n\n${toolText(event.partialResult)}`;
  }
  if (event.type === "tool_execution_end") {
    const tool = state.tools.get(event.toolCallId);
    if (tool) {
      tool.body.textContent = `${JSON.stringify(event.args, null, 2)}\n\n${toolText(event.result)}`;
      tool.wrap.dataset.state = event.isError ? "error" : "done";
    }
  }

  if (event.type === "message_end") {
    if (event.message?.usage) {
      const u = event.message.usage;
      state.inputTokens += (u.input || 0);
      state.outputTokens += (u.output || 0);
      state.cacheReadTokens += (u.cacheRead || 0);
      state.contextTokens = (u.input || 0) + (u.output || 0);
      if (u.cost?.total) {
        state.cost += u.cost.total;
      } else {
        const modelName = (currentProvider?.model || "").toLowerCase();
        const inRate = modelName.includes("claude") ? 3.0 : 0.20;
        const outRate = modelName.includes("claude") ? 15.0 : 0.80;
        state.cost += ((u.input || 0) * inRate / 1_000_000) + ((u.output || 0) * outRate / 1_000_000);
      }
      if (state.id === activeId) updateStatsUi(state);
    }
    if (event.message?.stopReason === "error") {
      showErrorIn(state, event.message.errorMessage ?? "Provider error");
    }
  }
  if (event.type === "agent_settled") {
    state.assistant = null;
    state.busy = false;
    if (state.status !== "error") state.status = "idle";
    if (!state.resumePath) {
      invoke("get_session_path", { sessionId: state.id })
        .then((p) => {
          if (p) {
            state.resumePath = p;
            saveOpenTabsState();
          }
        })
        .catch(() => {});
    }
  }
  if (event.type === "response" && event.success === false) showErrorIn(state, event.error);

  renderTabs();
  if (state.id === activeId) updateComposerForActive();
}

// ---------- settings ----------

function setEyeVisible(show) {
  $("#api-key").type = show ? "text" : "password";
  const toggle = $("#toggle-key");
  toggle.setAttribute("aria-pressed", String(show));
  toggle.textContent = show ? "Hide" : "Show";
  toggle.setAttribute("aria-label", `${toggle.textContent} key`);
}

$("#toggle-key").addEventListener("click", () => {
  setEyeVisible($("#api-key").type === "password");
});

let multiConfig = { activeId: "default", providers: [] };

function getActiveProvider() {
  return multiConfig.providers.find((p) => p.id === multiConfig.activeId) || multiConfig.providers[0] || null;
}

function getEnabledModels() {
  try {
    const raw = localStorage.getItem("wii_enabled_models");
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function getAllKnownModels() {
  const active = getActiveProvider();
  const cached = getCachedModels();
  return [...new Set([active?.model, ...(active?.models || []), ...cached].filter(Boolean))];
}

function setModelEnabled(modelId, enabled) {
  const all = getAllKnownModels();
  let currentSet = getEnabledModels();
  if (!currentSet) {
    currentSet = new Set(all);
  }
  if (enabled) {
    currentSet.add(modelId);
  } else {
    currentSet.delete(modelId);
  }
  localStorage.setItem("wii_enabled_models", JSON.stringify([...currentSet]));
  setModelOptions();
}

function getCachedModels() {
  try {
    return JSON.parse(localStorage.getItem("wii_cached_models") || "[]");
  } catch {
    return [];
  }
}

function setModelOptions(ids = []) {
  const active = getActiveProvider();
  const cached = getCachedModels();
  const all = [...new Set([active?.model, ...(active?.models || []), ...cached, ...ids].filter(Boolean))];
  if (ids.length) {
    try { localStorage.setItem("wii_cached_models", JSON.stringify(all)); } catch {}
  }
  $("#model-options").replaceChildren(...all.map((value) => Object.assign(document.createElement("option"), { value })));

  const enabledSet = getEnabledModels();
  const visible = all.filter((m) => !enabledSet || enabledSet.has(m) || m === active?.model);
  $("#composer-model").replaceChildren(...visible.map((value) => Object.assign(document.createElement("option"), { value, textContent: value })));
  if (active?.model && visible.includes(active.model)) {
    $("#composer-model").value = active.model;
  }
}

function renderProvidersSelect() {
  const select = $("#provider-select");
  if (!select) return;
  select.replaceChildren(
    ...multiConfig.providers.map((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      return opt;
    })
  );
  select.value = multiConfig.activeId;
}

function syncProviderUi() {
  const provider = getActiveProvider();
  currentProvider = provider;
  $("#provider-required").hidden = Boolean(provider);
  $("#open-provider-settings").hidden = Boolean(provider);
  renderProvidersSelect();
  if (!provider) return;
  $("#provider-name").value = provider.name || "Default";
  $("#base-url").value = provider.baseUrl || "";
  $("#model").value = provider.model || "";
  $("#api-key").value = provider.apiKey || "";
  $("#reasoning-effort").value = provider.reasoningEffort || "";
  $("#composer-effort").value = provider.reasoningEffort || "";
  setModelOptions();
}

async function loadProviderIntoForm() {
  try {
    const cfg = await invoke("get_providers");
    if (cfg && cfg.providers?.length) {
      multiConfig = cfg;
    } else {
      const single = await invoke("get_provider");
      if (single) {
        multiConfig = { activeId: single.id || "default", providers: [single] };
      }
    }
  } catch {}
  syncProviderUi();
  return getActiveProvider();
}

$("#provider-select")?.addEventListener("change", async (e) => {
  multiConfig.activeId = e.target.value;
  await invoke("save_providers", { config: multiConfig });
  syncProviderUi();
});

$("#provider-add-btn")?.addEventListener("click", () => {
  const newId = `prov-${Date.now()}`;
  const newProv = {
    id: newId,
    name: "New Provider",
    baseUrl: "http://127.0.0.1:8317/v1",
    model: "gemini-3.8-flash-high",
    apiKey: "",
    reasoningEffort: "",
    models: [],
  };
  multiConfig.providers.push(newProv);
  multiConfig.activeId = newId;
  syncProviderUi();
});

$("#provider-delete-btn")?.addEventListener("click", async () => {
  if (multiConfig.providers.length <= 1) {
    alert("Cannot delete the only provider.");
    return;
  }
  multiConfig.providers = multiConfig.providers.filter((p) => p.id !== multiConfig.activeId);
  multiConfig.activeId = multiConfig.providers[0].id;
  await invoke("save_providers", { config: multiConfig });
  syncProviderUi();
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#settings-error").textContent = "";
  try {
    const active = getActiveProvider();
    if (active) {
      active.name = $("#provider-name").value.trim() || active.id;
      active.baseUrl = $("#base-url").value.trim().replace(/\/$/, "");
      active.model = $("#model").value.trim();
      active.apiKey = $("#api-key").value.trim();
      active.reasoningEffort = $("#reasoning-effort").value || null;
      await invoke("save_providers", { config: multiConfig });
      syncProviderUi();
      updateOnboarding();
    }
    closeCommandCenter();
  } catch (error) {
    $("#settings-error").textContent = String(error);
  }
});

$("#fetch-models").addEventListener("click", async () => {
  const status = $("#fetch-models-status");
  status.textContent = "Fetching…";
  try {
    const base = $("#base-url").value.trim().replace(/\/$/, "");
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${$("#api-key").value}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const ids = (body.data ?? body.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
    const active = getActiveProvider();
    if (active) {
      active.models = ids;
      await invoke("save_providers", { config: multiConfig });
    }
    setModelOptions(ids);
    status.textContent = `Loaded and saved ${ids.length} model(s).`;
  } catch (error) {
    status.textContent = `Could not fetch models: ${error}`;
  }
});

// ---------- context settings (system prompt) ----------

async function loadSystemPromptIntoForm() {
  $("#system-prompt").value = await invoke("get_system_prompt");
}

$("#save-system-prompt").addEventListener("click", async () => {
  const status = $("#system-prompt-status");
  try {
    await invoke("save_system_prompt", { text: $("#system-prompt").value });
    status.textContent = "Saved. Applies to new tabs.";
  } catch (error) {
    status.textContent = String(error);
  }
});

// ---------- command center ----------

const ccBackdrop = $("#command-center");
const ccRoot = $("#cc-root");
const ccPanels = {
  provider: $("#cc-provider-panel"),
  models: $("#cc-models-panel"),
  context: $("#cc-context-panel"),
};

function renderModelsPanel() {
  const list = $("#models-list");
  list.replaceChildren();
  const all = getAllKnownModels();
  if (!all.length) {
    list.innerHTML = '<p class="hint-text">No models available. Fetch models in Providers first.</p>';
    return;
  }
  const enabledSet = getEnabledModels();
  for (const modelId of all) {
    const row = document.createElement("div");
    row.className = "model-row";

    const name = document.createElement("span");
    name.className = "model-row-name";
    name.textContent = modelId;

    const label = document.createElement("label");
    label.className = "switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !enabledSet || enabledSet.has(modelId);
    checkbox.addEventListener("change", (e) => {
      setModelEnabled(modelId, e.target.checked);
    });

    const slider = document.createElement("span");
    slider.className = "slider";

    label.append(checkbox, slider);
    row.append(name, label);
    list.append(row);
  }
}
let ccSelectedIndex = 0;

function ccVisibleItems() {
  return [...ccRoot.querySelectorAll(".cc-item:not([hidden])")];
}

function ccPaintSelection() {
  const items = ccVisibleItems();
  ccSelectedIndex = Math.min(Math.max(ccSelectedIndex, 0), Math.max(items.length - 1, 0));
  ccRoot.querySelectorAll(".cc-item").forEach((item) => item.classList.remove("selected"));
  items[ccSelectedIndex]?.classList.add("selected");
}

function updateCommandCenterBreadcrumb(subTitle = "") {
  const root = $("#cc-title-root");
  const sub = $("#cc-title-sub");
  if (!root || !sub) return;
  if (subTitle) {
    root.classList.add("is-active");
    sub.textContent = ` / ${subTitle}`;
  } else {
    root.classList.remove("is-active");
    sub.textContent = "";
  }
}

$("#cc-title-root")?.addEventListener("click", () => {
  if ($("#cc-title-root").classList.contains("is-active")) {
    ccShowRoot();
  }
});

function ccShowRoot() {
  ccRoot.hidden = false;
  for (const panel of Object.values(ccPanels)) {
    panel.hidden = true;
  }
  updateCommandCenterBreadcrumb("");
  ccSelectedIndex = 0;
  ccPaintSelection();
  $("#cc-search").focus();
}

async function ccShowPanel(name) {
  ccRoot.hidden = true;
  for (const [key, panel] of Object.entries(ccPanels)) {
    panel.hidden = key !== name;
  }
  const titles = { provider: "Providers", models: "Models", context: "Context Settings" };
  updateCommandCenterBreadcrumb(titles[name] || name);

  if (name === "provider") await loadProviderIntoForm();
  if (name === "models") renderModelsPanel();
  if (name === "context") await loadSystemPromptIntoForm();
}

function openCommandCenter() {
  ccBackdrop.hidden = false;
  ccShowRoot();
  $("#cc-search").value = "";
  filterCommandCenter("");
  $("#cc-search").focus();
}

function closeCommandCenter() {
  ccBackdrop.hidden = true;
  setTimeout(() => $("#message")?.focus(), 0);
}

function filterCommandCenter(query) {
  const needle = query.trim().toLowerCase();
  for (const item of ccRoot.querySelectorAll(".cc-item")) {
    item.hidden = needle.length > 0 && !item.textContent.toLowerCase().includes(needle);
  }
  ccSelectedIndex = 0;
  ccPaintSelection();
}

$("#command-center-toggle").addEventListener("click", openCommandCenter);
$("#cc-search").addEventListener("input", (event) => filterCommandCenter(event.target.value));
ccRoot.addEventListener("click", (event) => {
  const item = event.target.closest(".cc-item");
  if (item) ccShowPanel(item.dataset.panel);
});
for (const back of document.querySelectorAll("#cc-provider-panel [data-back], #cc-models-panel [data-back], #cc-context-panel [data-back]")) {
  back.addEventListener("click", ccShowRoot);
}
ccBackdrop.addEventListener("click", (event) => {
  if (event.target === ccBackdrop) closeCommandCenter();
});

// ---------- session manager ----------

const smBackdrop = $("#session-manager");
const smList = $("#sm-list");
let smDiskSessions = [];
let smFiltered = [];
let smSelectedIndex = 0;

function smFormatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function smHeading(text, recent = false) {
  const heading = document.createElement("div");
  heading.className = `sm-heading${recent ? " recent" : ""}`;
  heading.textContent = text;
  return heading;
}

async function startNewProjectSession() {
  closeSessionManager();
  try {
    const path = await invoke("plugin:dialog|open", {
      options: { directory: true, multiple: false, title: "Choose project folder" },
    });
    if (typeof path === "string" && path.trim()) {
      selectedProjectPath = path;
      if (currentProvider) {
        await openTab(null, null, path);
      }
    }
  } catch (error) {
    alert(String(error));
  }
}

function createSessionRow(item, index) {
  const row = document.createElement("div");
  row.className = `sm-row${index === smSelectedIndex ? " selected" : ""}`;
  row.dataset.index = String(index);
  const title = document.createElement("div");
  title.className = "sm-row-title";
  title.textContent = item.title;
  row.append(title);
  const meta = document.createElement("div");
  meta.className = "sm-row-meta";
  const path = document.createElement("span");
  path.className = "sm-row-path";
  path.textContent = formatPath(item.projectPath) || "Unknown project";
  const time = document.createElement("span");
  time.className = "sm-row-time";
  time.textContent = item.kind === "running" ? "active" : smFormatTime(item.lastActivity);
  meta.append(path, time);
  row.append(meta);
  row.addEventListener("click", () => { smSelectedIndex = index; smOpenSelected(); });
  return row;
}

function smRender() {
  const query = $("#sm-search").value.trim().toLowerCase();
  const running = [...sessions.values()].filter((state) => state.alive).map((state) => ({
    kind: "running", id: state.id, title: state.title, projectPath: state.projectPath ?? "", path: state.resumePath, lastActivity: "",
  }));
  const runningPaths = new Set(running.map((item) => item.path).filter(Boolean));
  const recent = smDiskSessions.filter((item) => !runningPaths.has(item.path));
  const matches = (item) => !query || `${item.title} ${item.projectPath ?? ""} ${item.searchText ?? ""}`.toLowerCase().includes(query);
  const filteredRunning = running.filter(matches);
  const filteredRecent = recent.filter(matches);

  if (query) {
    const matchesList = [...filteredRunning, ...filteredRecent];
    smFiltered = matchesList.length > 0 ? matchesList : [];
    smSelectedIndex = 0;
  } else {
    smFiltered = [
      { kind: "new", title: "New session" },
      { kind: "new_project", title: "New project" },
      ...filteredRunning,
      ...filteredRecent,
    ];
  }

  smList.replaceChildren();

  if (query) {
    if (!smFiltered.length) {
      const empty = document.createElement("div");
      empty.className = "sm-empty";
      empty.textContent = "No sessions found";
      smList.append(empty);
      return;
    }
    smFiltered.forEach((item, index) => {
      smList.append(createSessionRow(item, index));
    });
    return;
  }

  // Top row: New session & New project side by side
  const actionsRow = document.createElement("div");
  actionsRow.className = "sm-actions-row";

  const newSessionBtn = document.createElement("div");
  newSessionBtn.className = `sm-action${smSelectedIndex === 0 ? " selected" : ""}`;
  newSessionBtn.dataset.index = "0";
  newSessionBtn.innerHTML = `<span>New session</span><kbd>Ctrl+N</kbd>`;
  newSessionBtn.addEventListener("click", () => { smSelectedIndex = 0; smOpenSelected(); });

  const newProjectBtn = document.createElement("div");
  newProjectBtn.className = `sm-action${smSelectedIndex === 1 ? " selected" : ""}`;
  newProjectBtn.dataset.index = "1";
  newProjectBtn.innerHTML = `<span>New project</span><kbd>Ctrl+⇧+N</kbd>`;
  newProjectBtn.addEventListener("click", () => { smSelectedIndex = 1; smOpenSelected(); });

  actionsRow.append(newSessionBtn, newProjectBtn);
  smList.append(actionsRow);

  let offset = 2;
  if (filteredRunning.length) {
    smList.append(smHeading("Running"));
    filteredRunning.forEach((item, index) => {
      smList.append(createSessionRow(item, offset + index));
    });
    offset += filteredRunning.length;
  }

  if (filteredRecent.length) {
    smList.append(smHeading("Recently", true));
    filteredRecent.forEach((item, index) => {
      smList.append(createSessionRow(item, offset + index));
    });
  }
}

function smMoveSelection(delta) {
  if (!smFiltered.length) return;
  smSelectedIndex = Math.min(Math.max(smSelectedIndex + delta, 0), smFiltered.length - 1);
  smRender();
  smList.querySelector(`[data-index="${smSelectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

function smOpenSelected() {
  const item = smFiltered[smSelectedIndex];
  if (!item) return;
  closeSessionManager();
  if (item.kind === "new_project") return startNewProjectSession();
  if (item.kind === "new") {
    const active = sessions.get(activeId);
    const project = active?.projectPath || selectedProjectPath;
    if (project && currentProvider) {
      return openTab(null, null, project).catch((err) => alert(String(err)));
    }
    return startNewProjectSession();
  }
  if (item.kind === "running") return switchActive(item.id);
  openTab(item.path, truncateTitle(item.title), item.projectPath || null).catch((error) => alert(String(error)));
}

async function openSessionManager() {
  smBackdrop.hidden = false;
  $("#sm-search").value = "";
  smSelectedIndex = 0;
  try {
    smDiskSessions = await invoke("list_sessions");
  } catch (_) {
    smDiskSessions = [];
  }
  smRender();
  $("#sm-search").focus();
}

function closeSessionManager() {
  smBackdrop.hidden = true;
  setTimeout(() => $("#message")?.focus(), 0);
}

$("#session-manager-toggle").addEventListener("click", openSessionManager);
$("#sm-search").addEventListener("input", () => {
  smSelectedIndex = 0;
  smRender();
});
smBackdrop.addEventListener("click", (event) => {
  if (event.target === smBackdrop) closeSessionManager();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault(); // Prevents macOS WKWebView from exiting native fullscreen!
    if (!smBackdrop.hidden) { closeSessionManager(); return; }
    if (!ccBackdrop.hidden) {
      if (ccRoot.hidden) ccShowRoot();
      else closeCommandCenter();
      return;
    }
    if (!$("#onboarding").hidden && tabOrder.length > 0) {
      $("#onboarding").hidden = true;
      updateComposerForActive();
      return;
    }
    const state = sessions.get(activeId);
    if (state?.busy) {
      invoke("abort", { sessionId: state.id }).catch((error) => showErrorIn(state, error));
      return;
    }
    return;
  }
  if (!smBackdrop.hidden) {
    if (event.key === "ArrowDown") { event.preventDefault(); smMoveSelection(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); smMoveSelection(-1); }
    else if (event.key === "ArrowRight" && smSelectedIndex === 0) { event.preventDefault(); smMoveSelection(1); }
    else if (event.key === "ArrowLeft" && smSelectedIndex === 1) { event.preventDefault(); smMoveSelection(-1); }
    else if (event.key === "Enter") { event.preventDefault(); smOpenSelected(); }
    return;
  }
  if (!ccBackdrop.hidden) {
    if (!ccRoot.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const items = ccVisibleItems();
      if (items.length) ccSelectedIndex = (ccSelectedIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      ccPaintSelection();
    } else if (!ccRoot.hidden && event.key === "Enter") {
      event.preventDefault();
      const item = ccVisibleItems()[ccSelectedIndex];
      if (item) ccShowPanel(item.dataset.panel);
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key >= "1" && event.key <= "9") {
    const idx = Number(event.key) - 1;
    if (idx < tabOrder.length) {
      event.preventDefault();
      switchActive(tabOrder[idx]);
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    startNewProjectSession();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandCenter();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    const active = sessions.get(activeId);
    const project = active?.projectPath || selectedProjectPath;
    if (project && currentProvider) {
      openTab(null, null, project).catch((error) => alert(String(error)));
    } else {
      startNewProjectSession();
    }
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    openSessionManager();
  }
});

// ---------- onboarding ----------

function updateOnboarding() {
  $("#project-path").textContent = selectedProjectPath ?? "No directory selected";
  $("#provider-required").hidden = Boolean(currentProvider);
  $("#open-provider-settings").hidden = Boolean(currentProvider);
  $("#create-session").disabled = !selectedProjectPath || !currentProvider;
}

function showOnboarding() {
  $("#onboarding").hidden = false;
  $("#composer").hidden = true;
  updateOnboarding();
}

$("#choose-project").addEventListener("click", async () => {
  $("#onboarding-error").textContent = "";
  try {
    const path = await invoke("plugin:dialog|open", { options: { directory: true, multiple: false, title: "Choose project folder" } });
    if (typeof path === "string") selectedProjectPath = path;
    updateOnboarding();
  } catch (error) {
    $("#onboarding-error").textContent = String(error);
  }
});

$("#open-provider-settings").addEventListener("click", async () => {
  openCommandCenter();
  await ccShowPanel("provider");
});

$("#create-session").addEventListener("click", async () => {
  $("#create-session").disabled = true;
  $("#onboarding-error").textContent = "";
  try {
    await openTab(null, null, selectedProjectPath);
    $("#onboarding").hidden = true;
  } catch (error) {
    $("#onboarding-error").textContent = String(error);
  } finally {
    updateOnboarding();
  }
});

// ---------- composer ----------

function autoResizeInput() {
  const input = $("#message");
  input.style.height = "auto";
  const newHeight = Math.min(Math.max(input.scrollHeight, 42), 130);
  input.style.height = `${newHeight}px`;
  input.style.overflowY = input.scrollHeight > 130 ? "auto" : "hidden";
}

$("#message").addEventListener("input", autoResizeInput);

async function sendMessage() {
  const input = $("#message");
  const message = input.value.trim();
  if (!message) return;
  if (!activeId) return showOnboarding();
  const state = sessions.get(activeId);
  if (!state?.alive || state.busy) return;
  state.activeStopBtn = userCard(state.pane, message, () => invoke("abort", { sessionId: state.id }).catch((error) => showErrorIn(state, error)));
  input.value = "";
  autoResizeInput();
  state.assistant = null;
  state.busy = true;
  state.status = "running";
  if (state.title === "New session") {
    state.title = truncateTitle(message);
    renderTabs();
    saveOpenTabsState();
  }
  updateComposerForActive();
  try {
    await invoke("send_message", { sessionId: state.id, message });
  } catch (error) {
    showErrorIn(state, error);
  }
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const state = sessions.get(activeId);
  if (state?.busy) invoke("abort", { sessionId: state.id }).catch((error) => showErrorIn(state, error));
  else sendMessage();
});

$("#message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const state = sessions.get(activeId);
    if (!state?.busy) $("#composer").requestSubmit();
  }
});

for (const [selector, key] of [["#composer-model", "model"], ["#composer-effort", "reasoningEffort"]]) {
  $(selector).addEventListener("change", async (event) => {
    const active = getActiveProvider();
    if (!active) return;
    try {
      active[key] = event.target.value || null;
      await invoke("save_providers", { config: multiConfig });
      syncProviderUi();
    } catch (error) {
      alert(String(error));
    }
  });
}

// ---------- boot ----------

async function load() {
  const route = (sessionId, action) => {
    const state = sessions.get(sessionId);
    if (state) action(state);
    else pendingEvents.set(sessionId, [...(pendingEvents.get(sessionId) ?? []), action]);
  };
  await listen("pi-event", ({ payload }) => route(payload.sessionId, (state) => handleEvent(state, payload.event)));
  await listen("pi-stderr", ({ payload }) => route(payload.sessionId, (state) => showErrorIn(state, payload.message)));
  await listen("pi-exit", ({ payload }) => route(payload.sessionId, (state) => {
    state.alive = false;
    const status = payload.status;
    const info = status?.code != null
      ? `code ${status.code}`
      : status?.signal != null
      ? `signal ${status.signal}`
      : "";
    showErrorIn(state, `Pi process stopped${info ? ` (${info})` : ""}`);
  }));
  await loadProviderIntoForm();

  let restoredCount = 0;
  try {
    const raw = localStorage.getItem("wii_open_tabs");
    if (raw && currentProvider) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.tabs) && data.tabs.length > 0) {
        for (const t of data.tabs) {
          if (t.resumePath || t.projectPath) {
            await openTab(t.resumePath, t.title, t.projectPath);
            restoredCount++;
          }
        }
        if (data.activeIndex != null && data.activeIndex >= 0 && data.activeIndex < tabOrder.length) {
          switchActive(tabOrder[data.activeIndex]);
        }
      }
    }
  } catch (err) {
    console.error("Failed to restore open tabs:", err);
  }

  if (restoredCount === 0) {
    showOnboarding();
  } else {
    $("#onboarding").hidden = true;
    updateComposerForActive();
    setTimeout(() => $("#message")?.focus(), 0);
  }
}

window.addEventListener("focus", () => {
  if (activeId && $("#command-center").hidden && $("#session-manager").hidden && $("#onboarding").hidden) {
    $("#message")?.focus();
  }
});

load().catch((error) => alert(String(error)));
