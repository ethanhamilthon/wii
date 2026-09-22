export interface ProviderSettings {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface MultiProviderConfig {
  activeId: string;
  providers: ProviderSettings[];
}

export interface SessionSummary {
  id: string;
  path: string;
  projectPath: string;
  title: string;
  lastActivity: string;
  searchText: string;
}

export interface ToolState {
  id: string;
  name: string;
  args: any;
  result?: any;
  isError?: boolean;
  status: "running" | "done" | "error";
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  thinking?: string;
  thinkingStreaming?: boolean;
  tools?: ToolState[];
}

export interface SessionState {
  id: string;
  title: string;
  projectPath: string | null;
  resumePath: string | null;
  status: "running" | "idle" | "error";
  alive: boolean;
  busy: boolean;
  providerId: string;
  model: string;
  reasoningEffort: string;
  messages: MessageItem[];
  tools: Record<string, ToolState>;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  contextTokens: number;
  cost: number;
  /** Pending `ctx.ui.*` dialog request from a plugin tool, if any (generic \u2014
   *  Wii doesn't know which plugin/tool asked). See docs/rpc.md "Extension UI Protocol". */
  pendingUIRequest: ExtensionUIRequest | null;
  /** Text widgets published by plugins through `ctx.ui.setWidget()`. */
  pluginWidgets: Record<string, PluginWidget>;
}

export interface PluginWidget {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface ExtensionUIRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export interface PersistedTab {
  title: string;
  projectPath: string | null;
  resumePath: string | null;
  providerId?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface PersistedOpenTabs {
  tabs: PersistedTab[];
  activeIndex: number;
}
