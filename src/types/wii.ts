export interface ProviderSettings {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: string | null;
  models?: string[];
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
  messages: MessageItem[];
  tools: Record<string, ToolState>;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  contextTokens: number;
  cost: number;
}

export interface PersistedTab {
  title: string;
  projectPath: string | null;
  resumePath: string | null;
}

export interface PersistedOpenTabs {
  tabs: PersistedTab[];
  activeIndex: number;
}
