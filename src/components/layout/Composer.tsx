import React, { useEffect, useRef, useState } from "react";
import {
  formatCost,
  formatPath,
  formatTokens,
  getModelMaxContext,
  useSessionStore,
} from "@/store/session-store";
import { cn } from "@/lib/utils";

export const Composer: React.FC = () => {
  const activeId = useSessionStore((state) => state.activeId);
  const activeSession = useSessionStore((state) => (state.activeId ? state.sessions[state.activeId] : null));
  const multiConfig = useSessionStore((state) => state.multiConfig);
  const enabledModels = useSessionStore((state) => state.enabledModels);
  const cachedModels = useSessionStore((state) => state.cachedModels);

  const activeProvider =
    multiConfig.providers.find((p) => p.id === multiConfig.activeId) ||
    multiConfig.providers[0] ||
    null;

  const visibleModels = React.useMemo(() => {
    const all = [
      ...new Set([activeProvider?.model, ...(activeProvider?.models || []), ...cachedModels].filter(Boolean)),
    ] as string[];
    return all.filter((m) => !enabledModels || enabledModels.has(m) || m === activeProvider?.model);
  }, [activeProvider?.model, activeProvider?.models, cachedModels, enabledModels]);

  const sendMessage = useSessionStore((state) => state.sendMessage);
  const abortActiveSession = useSessionStore((state) => state.abortActiveSession);
  const saveCurrentProviderForm = useSessionStore((state) => state.saveCurrentProviderForm);

  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea (min 42px, max 130px)
  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextH = Math.min(Math.max(el.scrollHeight, 42), 130);
    el.style.height = `${nextH}px`;
    el.style.overflowY = el.scrollHeight > 130 ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustHeight();
  }, [message]);

  // Keep input focused when active session changes or window refocuses
  useEffect(() => {
    if (activeSession?.alive) {
      textareaRef.current?.focus();
    }
  }, [activeSession?.id]);

  if (!activeSession || !activeSession.alive) {
    return null;
  }

  const isBusy = activeSession.busy;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isBusy) {
      abortActiveSession();
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "42px";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    if (!model) return;
    await saveCurrentProviderForm({ model });
  };

  const handleEffortChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const reasoningEffort = e.target.value || null;
    await saveCurrentProviderForm({ reasoningEffort });
  };

  // Stats formatting
  const maxCtx = getModelMaxContext(activeProvider?.model);
  const inT = formatTokens(activeSession.inputTokens);
  const outT = formatTokens(activeSession.outputTokens);
  const ctxT = formatTokens(activeSession.contextTokens);
  const maxT = formatTokens(maxCtx);
  const totalIn = activeSession.inputTokens + activeSession.cacheReadTokens;
  const cachePct = totalIn > 0 ? Math.round((activeSession.cacheReadTokens / totalIn) * 100) : 0;
  const costStr = formatCost(activeSession.cost);

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-x-0 bottom-0 z-20 bg-bg px-6 pb-4 pt-0 select-none"
    >
      {/* Top controls row: Project path on the left, Stats + Selects on the right */}
      <div className="flex h-[30px] items-center justify-between gap-3 text-xs">
        {/* Left: Project path */}
        <div
          title={activeSession.projectPath || undefined}
          className="max-w-[35%] truncate text-[11px] text-faint"
        >
          {formatPath(activeSession.projectPath)}
        </div>

        {/* Right: Token stats + Model selects */}
        <div className="flex max-w-[65%] items-center justify-end gap-3 truncate">
          <div className="whitespace-nowrap text-[11px] text-faint">
            in: {inT} · out: {outT} · ctx: {ctxT}/{maxT} · cache: {cachePct}% · {costStr}
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Model"
              value={activeProvider?.model || ""}
              onChange={handleModelChange}
              className="h-6 w-auto cursor-pointer border-0 bg-bg pr-4 text-xs text-dim outline-none hover:text-foreground"
            >
              {visibleModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              aria-label="Reasoning effort"
              value={activeProvider?.reasoningEffort || ""}
              onChange={handleEffortChange}
              className="h-6 w-auto cursor-pointer border-0 bg-bg pr-4 text-xs text-dim outline-none hover:text-foreground"
            >
              <option value="">Default</option>
              <option value="minimal">minimal</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">Max</option>
            </select>
          </div>
        </div>
      </div>

      {/* Input container */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          id="message"
          rows={1}
          placeholder="Message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex min-h-[42px] max-h-[130px] w-full resize-none rounded-lg border border-border-strong bg-[#171717] py-[11px] pl-3 pr-20 text-sm leading-[18px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-border-strong"
        />

        {/* Send / Stop action */}
        <button
          type="submit"
          title={isBusy ? "Stop (Escape)" : "Send (Enter)"}
          aria-label={isBusy ? "Stop" : "Send"}
          className={cn(
            "absolute bottom-1.5 right-2 flex h-[30px] items-center justify-center rounded px-2 text-xs font-medium transition-colors",
            isBusy
              ? "bg-raised text-foreground hover:bg-border"
              : "bg-transparent text-faint hover:text-foreground",
          )}
        >
          {isBusy ? (
            <img src="/assets/icons/pause.svg" alt="" className="h-4 w-4" />
          ) : (
            <span className="text-[11px]">Enter ⏎</span>
          )}
        </button>
      </div>
    </form>
  );
};
