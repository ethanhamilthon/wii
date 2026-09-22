import React, { useEffect, useState } from "react";
import { useSessionStore } from "@/store/session-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const ProvidersPanel: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const activeProvider = useSessionStore((state) => state.getActiveProvider());
  const switchProvider = useSessionStore((state) => state.switchProvider);
  const addNewProvider = useSessionStore((state) => state.addNewProvider);
  const deleteCurrentProvider = useSessionStore((state) => state.deleteCurrentProvider);
  const saveCurrentProviderForm = useSessionStore((state) => state.saveCurrentProviderForm);
  const setCachedModels = useSessionStore((state) => state.setCachedModels);
  const cachedModels = useSessionStore((state) => state.cachedModels);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [newModelInput, setNewModelInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [fetchStatus, setFetchStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (activeProvider) {
      setName(activeProvider.name || "Default");
      setBaseUrl(activeProvider.baseUrl || "");
      setApiKey(activeProvider.apiKey || "");
      setModels(activeProvider.models || []);
    }
  }, [activeProvider?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      setError("Base URL must start with http:// or https://");
      return;
    }
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    try {
      await saveCurrentProviderForm({
        name: name.trim() || "Default",
        baseUrl: baseUrl.trim().replace(/\/$/, ""),
        apiKey: apiKey.trim(),
        models,
      });
      onSaved();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleFetchModels = async () => {
    setFetchStatus("Fetching…");
    try {
      const cleanBase = baseUrl.trim().replace(/\/$/, "");
      const res = await fetch(`${cleanBase}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const ids: string[] = (body.data ?? body.models ?? [])
        .map((m: any) => m.id ?? m.name)
        .filter(Boolean);

      const merged = [...new Set([...models, ...ids])];
      setModels(merged);
      setCachedModels(merged);
      await saveCurrentProviderForm({ models: merged });
      setFetchStatus(`Loaded ${ids.length} model(s).`);
    } catch (err) {
      setFetchStatus(`Could not fetch models: ${err}`);
    }
  };

  const handleAddModel = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed || models.includes(trimmed)) return;
    const next = [...models, trimmed];
    setModels(next);
    setCachedModels(next);
    setNewModelInput("");
  };

  const handleRemoveModel = (m: string) => {
    const next = models.filter((x) => x !== m);
    setModels(next);
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 select-none text-xs">
      <h2 className="text-sm font-semibold text-foreground">OpenAI-compatible API</h2>

      {/* Provider switcher bar */}
      <div className="flex items-end gap-2">
        <label className="grid flex-1 gap-1 text-dim">
          Provider
          <select
            aria-label="Provider"
            value={multiConfig.activeId}
            onChange={(e) => switchProvider(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-panel px-3 text-xs text-foreground outline-none"
          >
            {multiConfig.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        </label>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addNewProvider}
          className="h-9 text-xs"
        >
          + New
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={deleteCurrentProvider}
          className="h-9 text-xs"
        >
          Delete
        </Button>
      </div>

      <label className="grid gap-1 text-dim">
        Name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Provider name"
          required
        />
      </label>

      <label className="grid gap-1 text-dim">
        Base URL
        <Input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:8317/v1"
          required
        />
      </label>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-dim">Available models ({models.length})</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleFetchModels}
            className="h-7 text-xs"
          >
            Fetch models
          </Button>
        </div>

        {fetchStatus && <p className="text-[11px] text-faint">{fetchStatus}</p>}

        <div className="flex gap-2">
          <Input
            value={newModelInput}
            onChange={(e) => setNewModelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddModel();
              }
            }}
            placeholder="Add model ID…"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddModel}
            className="h-8 text-xs shrink-0"
          >
            Add
          </Button>
        </div>

        {models.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-panel p-2 grid gap-1">
            {models.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-raised"
              >
                <span className="truncate font-mono text-[11px] text-foreground">{m}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveModel(m)}
                  className="text-faint hover:text-foreground text-xs ml-2"
                  title="Remove model"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="grid gap-1 text-dim">
        API key
        <div className="relative flex items-center">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="pr-14"
            required
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 text-xs text-dim hover:text-foreground"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
      </label>

      <small className="text-[11px] text-faint">
        Stored securely in app data and reused across sessions.
      </small>

      <Button type="submit" className="mt-1 h-9 bg-text text-[#111] hover:opacity-85 text-xs">
        Save
      </Button>

      {error && <p className="text-xs text-red">{error}</p>}
    </form>
  );
};
